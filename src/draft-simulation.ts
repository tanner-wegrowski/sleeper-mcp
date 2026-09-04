import { performance } from "node:perf_hooks";
import type { ContextualCandidate } from "./contextual-draft.js";
import type { DraftRoomModel } from "./draft-room-model.js";

export interface DraftSimulationResult {
  recommendations: ContextualCandidate[];
  rollouts: number;
  candidate_scenarios: number;
  duration_ms: number;
  timed_out: boolean;
  confidence: "none" | "low" | "medium" | "high";
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function updatedNextPickValue(
  current: ContextualCandidate,
  next: ContextualCandidate,
  draftedCounts: Record<string, number>,
  starterTargets: Record<string, number>,
  flexSlots: number,
): number {
  const position = next.player.position;
  const afterCurrent = (draftedCounts[position] ?? 0) + (current.player.position === position ? 1 : 0);
  const required = starterTargets[position] ?? 0;
  let adjustment = afterCurrent < required ? 8 : 0;
  if (current.player.position === position && afterCurrent >= required) {
    adjustment -= ["RB", "WR", "TE"].includes(position) && flexSlots > 0 ? 2 : 7;
  }
  return next.overall_score + adjustment;
}

export function simulateToNextPick(input: {
  candidates: ContextualCandidate[];
  room: DraftRoomModel;
  draftedCounts: Record<string, number>;
  starterTargets: Record<string, number>;
  flexSlots: number;
  limit: number;
  timeBudgetMs: number;
  seed: number;
  maxRollouts?: number;
}): DraftSimulationResult {
  const started = performance.now();
  const deadline = started + Math.max(0, input.timeBudgetMs);
  const actions = input.candidates.slice(0, Math.min(12, Math.max(input.limit, 8)));
  const selectionPool = input.candidates.slice(0, 100);
  if (!actions.length || !input.room.upcoming_opponent_picks || input.timeBudgetMs <= 0) {
    return {
      recommendations: input.candidates.slice(0, input.limit),
      rollouts: 0,
      candidate_scenarios: actions.length,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      timed_out: false,
      confidence: "none",
    };
  }

  const random = seededRandom(input.seed);
  const totals = new Map<string, number>();
  const nextTargets = new Map<string, Map<string, number>>();
  let rollouts = 0;
  const maxRollouts = input.maxRollouts ?? 5000;

  while (rollouts < maxRollouts && performance.now() < deadline) {
    for (const action of actions) {
      const selected = new Set([action.player.player_id]);
      const simulatedCounts = new Map<number, Record<string, number>>(
        input.room.manager_profiles.map((profile) => [profile.roster_id, { ...profile.position_counts }]),
      );

      for (const rosterId of input.room.upcoming_roster_ids) {
        const profile = input.room.manager_profiles.find((item) => item.roster_id === rosterId);
        if (!profile) continue;
        const counts = simulatedCounts.get(rosterId) ?? {};
        let chosen: ContextualCandidate | null = null;
        let bestBoardPosition = Number.POSITIVE_INFINITY;
        for (const candidate of selectionPool) {
          if (selected.has(candidate.player.player_id)) continue;
          const position = candidate.player.position;
          const open = Math.max(0, (input.starterTargets[position] ?? 0) - (counts[position] ?? 0));
          const preference = profile.position_preference[position] ?? 0.25;
          const deviation = candidate.adp_stdev ?? 7;
          const reachVolatility = 1 + Math.min(1, Math.abs(profile.average_reach ?? 0) / 20);
          const sampledBoardPosition = candidate.rank
            + normal(random) * deviation * reachVolatility
            - (open > 0 ? 5 : 0)
            - Math.max(0, preference - 0.25) * 10;
          if (sampledBoardPosition < bestBoardPosition) {
            bestBoardPosition = sampledBoardPosition;
            chosen = candidate;
          }
        }
        if (chosen) {
          selected.add(chosen.player.player_id);
          counts[chosen.player.position] = (counts[chosen.player.position] ?? 0) + 1;
          simulatedCounts.set(rosterId, counts);
        }
      }

      let bestNext: ContextualCandidate | null = null;
      let bestNextValue = 0;
      for (const candidate of selectionPool) {
        if (selected.has(candidate.player.player_id)) continue;
        const value = updatedNextPickValue(
          action,
          candidate,
          input.draftedCounts,
          input.starterTargets,
          input.flexSlots,
        );
        if (value > bestNextValue) {
          bestNextValue = value;
          bestNext = candidate;
        }
      }
      const portfolioValue = action.overall_score + 0.8 * bestNextValue;
      totals.set(action.player.player_id, (totals.get(action.player.player_id) ?? 0) + portfolioValue);
      if (bestNext) {
        const targets = nextTargets.get(action.player.player_id) ?? new Map<string, number>();
        targets.set(bestNext.player.player_id, (targets.get(bestNext.player.player_id) ?? 0) + 1);
        nextTargets.set(action.player.player_id, targets);
      }
    }
    rollouts += 1;
  }

  const expected = new Map(actions.map((action) => [
    action.player.player_id,
    rollouts ? (totals.get(action.player.player_id) ?? 0) / rollouts : action.overall_score,
  ]));
  const values = Array.from(expected.values());
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const rawSpan = maximum - minimum;
  const span = Math.max(0.001, rawSpan);
  const simulated = actions.map((action): ContextualCandidate => {
    const value = expected.get(action.player.player_id)!;
    const targetCounts = nextTargets.get(action.player.player_id) ?? new Map();
    const commonTargets = Array.from(targetCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([playerId, count]) => {
        const player = selectionPool.find((candidate) => candidate.player.player_id === playerId)!;
        return { player_id: playerId, name: player.player.full_name, probability: Math.round((count / Math.max(1, rollouts)) * 1000) / 1000 };
      });
    return {
      ...action,
      simulation: {
        rollouts,
        expected_two_pick_value: Math.round(value * 100) / 100,
        draft_equity_score: rawSpan < 0.001 ? 100 : Math.round(((value - minimum) / span) * 1000) / 10,
        opportunity_cost: Math.round((maximum - value) * 100) / 100,
        common_next_targets: commonTargets,
      },
    };
  }).sort((a, b) =>
    (b.simulation?.expected_two_pick_value ?? b.overall_score)
      - (a.simulation?.expected_two_pick_value ?? a.overall_score),
  );

  return {
    recommendations: simulated.slice(0, input.limit),
    rollouts,
    candidate_scenarios: actions.length,
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
    timed_out: rollouts < maxRollouts && performance.now() >= deadline,
    confidence: rollouts >= 2000 ? "high" : rollouts >= 500 ? "medium" : rollouts > 0 ? "low" : "none",
  };
}

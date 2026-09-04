import { performance } from "node:perf_hooks";
import type { PlayerWithDetails } from "./types.js";
import type { DraftRanking, DraftStrategy } from "./draft-recommendations.js";

export interface ContextualDraftOptions {
  currentPickNo: number;
  nextPickNo: number | null;
  teams: number;
  draftedCounts: Record<string, number>;
  leagueDraftedCounts: Record<string, number>;
  starterTargets: Record<string, number>;
  flexSlots: number;
  superFlexSlots?: number;
  strategy: DraftStrategy;
  limit: number;
  timeBudgetMs: number;
  positionPressure?: Record<string, number>;
  averageManagerReach?: number;
}

export interface ContextualCandidate {
  player: PlayerWithDetails;
  overall_score: number;
  rank: number;
  rank_source: "custom" | "ffc_adp" | "sleeper_search_rank";
  projected_points?: number;
  adp_stdev?: number;
  market_sample_size?: number;
  tier?: string;
  notes?: string;
  probability_available_next_pick: number | null;
  replacement_player: { player_id: string; name: string; rank: number; projected_points?: number } | null;
  score_components: {
    market_value: number;
    roster_fit: number;
    value_over_replacement: number;
    urgency: number;
    health_multiplier: number;
  };
  reasons: string[];
  simulation?: {
    rollouts: number;
    expected_two_pick_value: number;
    draft_equity_score: number;
    opportunity_cost: number;
    common_next_targets: Array<{ player_id: string; name: string; probability: number }>;
  };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function healthMultiplier(player: PlayerWithDetails): number {
  const status = `${player.status ?? ""} ${player.injury_status ?? ""}`.toLowerCase();
  if (/injured reserve|\bir\b|physically unable|\bpup\b|suspended/.test(status)) return 0.55;
  if (/out|doubtful/.test(status)) return 0.72;
  if (/questionable|limited/.test(status)) return 0.92;
  return 1;
}

function rosterFit(position: string, options: ContextualDraftOptions): number {
  const drafted = options.draftedCounts[position] ?? 0;
  const required = options.starterTargets[position] ?? 0;
  if (drafted < required) return 100;

  if (position === "QB" && drafted < required + (options.superFlexSlots ?? 0)) return 90;
  if (["RB", "WR", "TE"].includes(position)) {
    const excess = ["RB", "WR", "TE"].reduce(
      (total, key) => total + Math.max(0, (options.draftedCounts[key] ?? 0) - (options.starterTargets[key] ?? 0)),
      0,
    );
    if (excess < options.flexSlots) return 82;
  }
  return drafted === required ? 48 : 25;
}

function strategyWeights(strategy: DraftStrategy) {
  if (strategy === "best_player_available") return { market: 0.56, fit: 0.08, replacement: 0.24, urgency: 0.12 };
  if (strategy === "needs_based") return { market: 0.32, fit: 0.34, replacement: 0.22, urgency: 0.12 };
  return { market: 0.42, fit: 0.22, replacement: 0.24, urgency: 0.12 };
}

export function rankContextualDraftCandidates(
  players: PlayerWithDetails[],
  rankings: DraftRanking[],
  options: ContextualDraftOptions,
): { recommendations: ContextualCandidate[]; candidatePool: ContextualCandidate[]; calculationMs: number; evaluated: number; timedOut: boolean } {
  const started = performance.now();
  const deadline = started + options.timeBudgetMs;
  const byId = new Map(rankings.filter((item) => item.player_id).map((item) => [item.player_id!, item]));
  const byName = new Map(rankings.filter((item) => item.name).map((item) => [normalizeName(item.name!), item]));
  const candidates = players.map((player) => {
    const custom = byId.get(player.player_id) ?? byName.get(normalizeName(player.full_name));
    return {
      player,
      ranking: custom,
      rank: custom?.rank ?? player.search_rank ?? Number.MAX_SAFE_INTEGER,
      rankSource: custom
        ? (custom.source === "ffc_adp" ? "ffc_adp" as const : "custom" as const)
        : "sleeper_search_rank" as const,
    };
  }).filter((item) => Number.isFinite(item.rank)).sort((a, b) => a.rank - b.rank);

  const byPosition = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byPosition.get(candidate.player.position) ?? [];
    list.push(candidate);
    byPosition.set(candidate.player.position, list);
  }

  const weights = strategyWeights(options.strategy);
  const results: ContextualCandidate[] = [];
  let timedOut = false;
  for (const candidate of candidates.slice(0, 250)) {
    if (performance.now() >= deadline) { timedOut = true; break; }
    const positionPool = byPosition.get(candidate.player.position) ?? [];
    const baseDemand = options.teams * (options.starterTargets[candidate.player.position] ?? 0);
    const flexibleDemand = ["RB", "WR", "TE"].includes(candidate.player.position)
      ? Math.ceil(options.teams * options.flexSlots / 3)
      : candidate.player.position === "QB" ? options.teams * (options.superFlexSlots ?? 0) : 0;
    const remainingDemand = Math.max(1, baseDemand + flexibleDemand - (options.leagueDraftedCounts[candidate.player.position] ?? 0));
    const replacement = positionPool[Math.min(positionPool.length - 1, remainingDemand)] ?? null;
    const projectedGap = candidate.ranking?.projected_points !== undefined && replacement?.ranking?.projected_points !== undefined
      ? candidate.ranking.projected_points - replacement.ranking.projected_points
      : null;
    const rankGap = replacement ? replacement.rank - candidate.rank : 50;
    const replacementScore = projectedGap === null ? clamp(rankGap * 2) : clamp(50 + projectedGap * 2.5);
    const marketScore = clamp(100 * logistic((options.currentPickNo + 8 - candidate.rank) / 12));
    const fitScore = rosterFit(candidate.player.position, options);
    const survivalScale = Math.max(2.5, (candidate.ranking?.adp_stdev ?? 4.1) * 1.7);
    const picksUntilNext = options.nextPickNo === null ? 0 : Math.max(0, options.nextPickNo - options.currentPickNo);
    const positionPressure = options.positionPressure?.[candidate.player.position] ?? 0.25;
    const pressureShift = (positionPressure - 0.25) * Math.min(12, picksUntilNext * 0.6);
    const reachShift = Math.max(-5, Math.min(5, options.averageManagerReach ?? 0));
    const adjustedNextPick = options.nextPickNo === null
      ? null
      : options.nextPickNo + pressureShift + reachShift;
    const survival = options.nextPickNo === null
      ? null
      : clamp(logistic((candidate.rank - adjustedNextPick!) / survivalScale), 0.01, 0.99);
    const urgency = survival === null ? 50 : 100 * (1 - survival);
    const health = healthMultiplier(candidate.player);
    const rawScore = marketScore * weights.market + fitScore * weights.fit + replacementScore * weights.replacement + urgency * weights.urgency;
    const reasons = [
      `${candidate.rankSource === "custom" ? "Imported" : candidate.rankSource === "ffc_adp" ? "FFC ADP" : "Sleeper fallback"} rank ${candidate.rank}`,
      fitScore >= 90 ? `${candidate.player.position} fills a starting requirement` : `${candidate.player.position} roster-fit score ${Math.round(fitScore)}`,
      replacement ? `${Math.max(0, Math.round(rankGap))}-rank gap to the dynamic ${candidate.player.position} replacement` : `No clear ${candidate.player.position} replacement remains`,
    ];
    if (survival !== null && survival < 0.35) reasons.push(`Only ${Math.round(survival * 100)}% estimated chance to reach your next pick`);
    if (positionPressure >= 0.4) reasons.push(`Draft-room demand is elevated at ${candidate.player.position}`);
    if (health < 1) reasons.push("Current availability status reduces confidence");
    results.push({
      player: candidate.player,
      overall_score: Math.round(rawScore * health * 10) / 10,
      rank: candidate.rank,
      rank_source: candidate.rankSource,
      projected_points: candidate.ranking?.projected_points,
      adp_stdev: candidate.ranking?.adp_stdev,
      market_sample_size: candidate.ranking?.times_drafted,
      tier: candidate.ranking?.tier,
      notes: candidate.ranking?.notes,
      probability_available_next_pick: survival === null ? null : Math.round(survival * 1000) / 1000,
      replacement_player: replacement ? {
        player_id: replacement.player.player_id,
        name: replacement.player.full_name,
        rank: replacement.rank,
        projected_points: replacement.ranking?.projected_points,
      } : null,
      score_components: {
        market_value: Math.round(marketScore * 10) / 10,
        roster_fit: Math.round(fitScore * 10) / 10,
        value_over_replacement: Math.round(replacementScore * 10) / 10,
        urgency: Math.round(urgency * 10) / 10,
        health_multiplier: health,
      },
      reasons,
    });
  }

  results.sort((a, b) => b.overall_score - a.overall_score || a.rank - b.rank);
  return {
    recommendations: results.slice(0, options.limit),
    candidatePool: results,
    calculationMs: Math.round((performance.now() - started) * 100) / 100,
    evaluated: results.length,
    timedOut,
  };
}

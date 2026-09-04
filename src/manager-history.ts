import type { HistoricalManagerPrior } from "./draft-room-model.js";
import type { DraftRanking } from "./draft-recommendations.js";
import { normalizePlayerName } from "./player-name.js";
import type { SleeperDraft, SleeperDraftPick, SleeperRoster } from "./types.js";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type RoundBand = "early" | "middle" | "late";

export interface HistoricalDraftSeason {
  season: number;
  seasons_ago: number;
  rosters: SleeperRoster[];
  drafts: Array<{ draft: SleeperDraft; picks: SleeperDraftPick[] }>;
  market_rankings?: DraftRanking[];
  format_similarity?: number;
}

function band(round: number): RoundBand {
  return round <= 3 ? "early" : round <= 8 ? "middle" : "late";
}

function positionOf(pick: SleeperDraftPick): string {
  return String(pick.metadata?.position ?? "").toUpperCase();
}

function playerName(pick: SleeperDraftPick): string {
  const full = String(pick.metadata?.full_name ?? "").trim();
  if (full) return full;
  return `${String(pick.metadata?.first_name ?? "")} ${String(pick.metadata?.last_name ?? "")}`.trim();
}

function starterTargets(draft: SleeperDraft): Record<string, number> {
  return {
    QB: draft.settings.slots_qb ?? 1,
    RB: draft.settings.slots_rb ?? 2,
    WR: draft.settings.slots_wr ?? 2,
    TE: draft.settings.slots_te ?? 1,
  };
}

function weightedMean(values: Array<{ value: number; weight: number }>): number | null {
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  return weight ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : null;
}

export function buildHistoricalManagerPriors(input: {
  currentRosters: SleeperRoster[];
  seasons: HistoricalDraftSeason[];
}): Record<number, HistoricalManagerPrior> {
  const currentRosterByOwner = new Map(input.currentRosters.map((roster) => [roster.owner_id, roster.roster_id]));
  const aggregates = new Map<number, {
    position: Record<string, number>;
    bands: Record<RoundBand, Record<string, number>>;
    totalWeight: number;
    bandWeights: Record<RoundBand, number>;
    rawPicks: number;
    drafts: Set<string>;
    seasons: Set<number>;
    reaches: Array<{ value: number; weight: number }>;
    needEvents: Array<{ filled: boolean; weight: number }>;
    runEvents: Array<{ followed: boolean; expected: number; weight: number }>;
  }>();

  for (const season of input.seasons) {
    const ownerByRoster = new Map(season.rosters.map((roster) => [roster.roster_id, roster.owner_id]));
    const recency = [1, 0.62, 0.38][Math.min(2, Math.max(0, season.seasons_ago - 1))];
    const seasonWeight = recency * Math.max(0.35, Math.min(1, season.format_similarity ?? 1));
    const market = new Map(
      (season.market_rankings ?? []).filter((item) => item.name).map((item) => [normalizePlayerName(item.name!), item.rank]),
    );

    for (const history of season.drafts) {
      const countsByOwner = new Map<string, Record<string, number>>();
      const recentPositions: string[] = [];
      const targets = starterTargets(history.draft);
      for (const pick of [...history.picks].sort((a, b) => a.pick_no - b.pick_no)) {
        const ownerId = currentRosterByOwner.has(pick.picked_by)
          ? pick.picked_by
          : ownerByRoster.get(Number(pick.roster_id));
        const rosterId = ownerId ? currentRosterByOwner.get(ownerId) : undefined;
        const position = positionOf(pick);
        if (rosterId !== undefined && ownerId && POSITIONS.includes(position as typeof POSITIONS[number])) {
          const aggregate = aggregates.get(rosterId) ?? {
            position: {}, bands: { early: {}, middle: {}, late: {} }, totalWeight: 0,
            bandWeights: { early: 0, middle: 0, late: 0 }, rawPicks: 0,
            drafts: new Set<string>(), seasons: new Set<number>(), reaches: [], needEvents: [], runEvents: [],
          };
          const roundBand = band(pick.round);
          aggregate.position[position] = (aggregate.position[position] ?? 0) + seasonWeight;
          aggregate.bands[roundBand][position] = (aggregate.bands[roundBand][position] ?? 0) + seasonWeight;
          aggregate.totalWeight += seasonWeight;
          aggregate.bandWeights[roundBand] += seasonWeight;
          aggregate.rawPicks += 1;
          aggregate.drafts.add(history.draft.draft_id);
          aggregate.seasons.add(season.season);

          const managerCounts = countsByOwner.get(ownerId) ?? {};
          const anyStarterOpen = POSITIONS.some((item) => (managerCounts[item] ?? 0) < (targets[item] ?? 0));
          if (anyStarterOpen) {
            aggregate.needEvents.push({ filled: (managerCounts[position] ?? 0) < (targets[position] ?? 0), weight: seasonWeight });
          }
          const recent = recentPositions.slice(-6);
          if (recent.length >= 4) {
            const strongest = POSITIONS.reduce((best, item) =>
              recent.filter((value) => value === item).length > recent.filter((value) => value === best).length ? item : best,
            );
            const strongestCount = recent.filter((item) => item === strongest).length;
            if (strongestCount >= 2) {
              aggregate.runEvents.push({ followed: position === strongest, expected: strongestCount / recent.length, weight: seasonWeight });
            }
          }
          const rank = market.get(normalizePlayerName(playerName(pick)));
          if (rank !== undefined) aggregate.reaches.push({ value: Math.max(-50, Math.min(50, rank - pick.pick_no)), weight: seasonWeight });
          managerCounts[position] = (managerCounts[position] ?? 0) + 1;
          countsByOwner.set(ownerId, managerCounts);
          aggregates.set(rosterId, aggregate);
        }
        if (POSITIONS.includes(position as typeof POSITIONS[number])) recentPositions.push(position);
      }
    }
  }

  return Object.fromEntries(Array.from(aggregates.entries()).map(([rosterId, aggregate]) => {
    const overall = Object.fromEntries(POSITIONS.map((position) => [
      position, aggregate.totalWeight ? (aggregate.position[position] ?? 0) / aggregate.totalWeight : 0.25,
    ]));
    const byRound = Object.fromEntries((["early", "middle", "late"] as RoundBand[]).map((roundBand) => [
      roundBand,
      Object.fromEntries(POSITIONS.map((position) => [
        position,
        aggregate.bandWeights[roundBand]
          ? (aggregate.bands[roundBand][position] ?? 0) / aggregate.bandWeights[roundBand]
          : overall[position],
      ])),
    ])) as Record<RoundBand, Record<string, number>>;
    const meanReach = weightedMean(aggregate.reaches);
    const reachVariance = meanReach === null ? null : weightedMean(aggregate.reaches.map((item) => ({
      value: (item.value - meanReach) ** 2, weight: item.weight,
    })));
    const needRate = weightedMean(aggregate.needEvents.map((item) => ({ value: item.filled ? 1 : 0, weight: item.weight }))) ?? 0.5;
    const runRate = weightedMean(aggregate.runEvents.map((item) => ({ value: item.followed ? 1 : 0, weight: item.weight })));
    const runExpected = weightedMean(aggregate.runEvents.map((item) => ({ value: item.expected, weight: item.weight })));
    return [rosterId, {
      position_preference: overall,
      round_position_preference: byRound,
      picks_observed: aggregate.rawPicks,
      effective_picks: aggregate.totalWeight,
      drafts_observed: aggregate.drafts.size,
      seasons_observed: aggregate.seasons.size,
      average_reach: meanReach,
      reach_stdev: reachVariance === null ? null : Math.sqrt(reachVariance),
      ranked_picks_observed: aggregate.reaches.length,
      need_sensitivity: Math.max(-1, Math.min(1, (needRate - 0.5) * 2)),
      run_sensitivity: runRate === null || runExpected === null ? 0 : Math.max(-1, Math.min(1, runRate - runExpected)),
    } satisfies HistoricalManagerPrior];
  }));
}

import type { HistoricalManagerPrior } from "./draft-room-model.js";
import type { SleeperDraftPick, SleeperRoster } from "./types.js";

const POSITIONS = ["QB", "RB", "WR", "TE"];

export function buildHistoricalManagerPriors(input: {
  currentRosters: SleeperRoster[];
  historicalRosters: SleeperRoster[];
  drafts: Array<{ picks: SleeperDraftPick[] }>;
}): Record<number, HistoricalManagerPrior> {
  const currentRosterByOwner = new Map(input.currentRosters.map((roster) => [roster.owner_id, roster.roster_id]));
  const ownerByHistoricalRoster = new Map(input.historicalRosters.map((roster) => [roster.roster_id, roster.owner_id]));
  const counts = new Map<number, Record<string, number>>();
  const samples = new Map<number, number>();
  const draftsSeen = new Map<number, Set<number>>();
  input.drafts.forEach((draft, draftIndex) => {
    for (const pick of draft.picks) {
      const ownerId = currentRosterByOwner.has(pick.picked_by)
        ? pick.picked_by
        : ownerByHistoricalRoster.get(Number(pick.roster_id));
      const currentRosterId = ownerId ? currentRosterByOwner.get(ownerId) : undefined;
      const position = String(pick.metadata?.position ?? "").toUpperCase();
      if (currentRosterId === undefined || !POSITIONS.includes(position)) continue;
      const managerCounts = counts.get(currentRosterId) ?? {};
      managerCounts[position] = (managerCounts[position] ?? 0) + 1;
      counts.set(currentRosterId, managerCounts);
      samples.set(currentRosterId, (samples.get(currentRosterId) ?? 0) + 1);
      const seen = draftsSeen.get(currentRosterId) ?? new Set<number>();
      seen.add(draftIndex);
      draftsSeen.set(currentRosterId, seen);
    }
  });
  return Object.fromEntries(Array.from(counts.entries()).map(([rosterId, values]) => {
    const total = samples.get(rosterId) ?? 0;
    return [rosterId, {
      position_preference: Object.fromEntries(POSITIONS.map((position) => [position, total ? (values[position] ?? 0) / total : 0.25])),
      picks_observed: total,
      drafts_observed: draftsSeen.get(rosterId)?.size ?? 0,
    }];
  }));
}

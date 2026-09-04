import { getPickLocation } from "./draft-analysis.js";
import type { DraftRanking } from "./draft-recommendations.js";
import { normalizePlayerName } from "./player-name.js";
import type {
  PlayerWithDetails,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
} from "./types.js";

const CORE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export interface DraftManagerProfile {
  roster_id: number;
  picks_made: number;
  upcoming_picks_before_user: number;
  position_counts: Record<string, number>;
  open_starter_positions: Record<string, number>;
  position_preference: Record<string, number>;
  average_reach: number | null;
  ranked_picks_observed: number;
  historical_picks_observed: number;
  historical_seasons_observed: number;
  need_sensitivity: number;
  run_sensitivity: number;
  reach_stdev: number | null;
}

export interface HistoricalManagerPrior {
  position_preference: Record<string, number>;
  round_position_preference: Record<"early" | "middle" | "late", Record<string, number>>;
  picks_observed: number;
  effective_picks: number;
  drafts_observed: number;
  seasons_observed: number;
  average_reach: number | null;
  reach_stdev: number | null;
  ranked_picks_observed: number;
  need_sensitivity: number;
  run_sensitivity: number;
}

export interface DraftRoomModel {
  upcoming_opponent_picks: number;
  upcoming_roster_ids: number[];
  position_pressure: Record<string, number>;
  recent_position_run: Record<string, number>;
  average_upcoming_manager_reach: number;
  manager_profiles: DraftManagerProfile[];
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildDraftRoomModel(input: {
  draft: SleeperDraft;
  tradedPicks: SleeperTradedPick[];
  picks: SleeperDraftPick[];
  playerById: Map<string, PlayerWithDetails>;
  marketRankings: DraftRanking[];
  starterTargets: Record<string, number>;
  currentPickNo: number;
  nextUserPickNo: number | null;
  userRosterId: number;
  historicalManagerPriors?: Record<number, HistoricalManagerPrior>;
}): DraftRoomModel {
  const marketByName = new Map(
    input.marketRankings
      .filter((ranking) => ranking.name)
      .map((ranking) => [normalizePlayerName(ranking.name!), ranking.rank]),
  );
  const rosterCounts = new Map<number, Record<string, number>>();
  const rosterPicks = new Map<number, SleeperDraftPick[]>();
  const roomCounts: Record<string, number> = {};

  for (const pick of input.picks) {
    const rosterId = Number(pick.roster_id);
    const player = input.playerById.get(pick.player_id);
    const position = player?.position ?? String(pick.metadata?.position ?? "");
    if (position) {
      const counts = rosterCounts.get(rosterId) ?? {};
      counts[position] = (counts[position] ?? 0) + 1;
      rosterCounts.set(rosterId, counts);
      roomCounts[position] = (roomCounts[position] ?? 0) + 1;
    }
    const picks = rosterPicks.get(rosterId) ?? [];
    picks.push(pick);
    rosterPicks.set(rosterId, picks);
  }

  const upcomingRosterIds: number[] = [];
  if (input.nextUserPickNo !== null) {
    for (let pickNo = input.currentPickNo; pickNo < input.nextUserPickNo; pickNo += 1) {
      const owner = getPickLocation(input.draft, input.tradedPicks, pickNo).owner_roster_id;
      if (owner !== null && owner !== input.userRosterId) upcomingRosterIds.push(owner);
    }
  }

  const recent = input.picks.slice(-6);
  const recentCounts: Record<string, number> = {};
  for (const pick of recent) {
    const player = input.playerById.get(pick.player_id);
    const position = player?.position ?? String(pick.metadata?.position ?? "");
    if (CORE_POSITIONS.includes(position as typeof CORE_POSITIONS[number])) {
      recentCounts[position] = (recentCounts[position] ?? 0) + 1;
    }
  }
  const recentPositionRun = Object.fromEntries(
    CORE_POSITIONS.map((position) => [position, recent.length ? rounded((recentCounts[position] ?? 0) / recent.length) : 0]),
  );

  const totalCorePicks = CORE_POSITIONS.reduce((sum, position) => sum + (roomCounts[position] ?? 0), 0);
  const profiles = new Map<number, DraftManagerProfile>();
  const currentRound = Math.ceil(input.currentPickNo / Math.max(1, input.draft.settings.teams));
  const roundBand = currentRound <= 3 ? "early" : currentRound <= 8 ? "middle" : "late";
  const allRosterIds = new Set([...rosterPicks.keys(), ...upcomingRosterIds]);
  for (const rosterId of allRosterIds) {
    const counts = rosterCounts.get(rosterId) ?? {};
    const picks = rosterPicks.get(rosterId) ?? [];
    const open = Object.fromEntries(
      CORE_POSITIONS.map((position) => [position, Math.max(0, (input.starterTargets[position] ?? 0) - (counts[position] ?? 0))]),
    );
    const preferences: Record<string, number> = {};
    const historical = input.historicalManagerPriors?.[rosterId];
    const historicalWeight = Math.min(12, historical?.effective_picks ?? historical?.picks_observed ?? 0);
    for (const position of CORE_POSITIONS) {
      const roomShare = totalCorePicks ? (roomCounts[position] ?? 0) / totalCorePicks : 0.25;
      preferences[position] = rounded((
        (counts[position] ?? 0)
        + 4 * roomShare
        + historicalWeight * (historical?.round_position_preference?.[roundBand]?.[position]
          ?? historical?.position_preference[position] ?? roomShare)
      ) / (picks.length + 4 + historicalWeight));
    }
    const reaches = picks.flatMap((pick) => {
      const player = input.playerById.get(pick.player_id);
      if (!player) return [];
      const marketRank = marketByName.get(normalizePlayerName(player.full_name));
      return marketRank === undefined ? [] : [Math.max(-50, Math.min(50, marketRank - pick.pick_no))];
    });
    const liveReachWeight = reaches.length;
    const historicalReachWeight = Math.min(8, historical?.ranked_picks_observed ?? 0);
    const blendedReach = liveReachWeight + historicalReachWeight
      ? (reaches.reduce((sum, value) => sum + value, 0)
        + historicalReachWeight * (historical?.average_reach ?? 0)) / (liveReachWeight + historicalReachWeight)
      : null;
    profiles.set(rosterId, {
      roster_id: rosterId,
      picks_made: picks.length,
      upcoming_picks_before_user: upcomingRosterIds.filter((id) => id === rosterId).length,
      position_counts: counts,
      open_starter_positions: open,
      position_preference: preferences,
      average_reach: blendedReach === null ? null : rounded(blendedReach),
      ranked_picks_observed: reaches.length + (historical?.ranked_picks_observed ?? 0),
      historical_picks_observed: historical?.picks_observed ?? 0,
      historical_seasons_observed: historical?.seasons_observed ?? 0,
      need_sensitivity: historical?.need_sensitivity ?? 0,
      run_sensitivity: historical?.run_sensitivity ?? 0,
      reach_stdev: historical?.reach_stdev ?? null,
    });
  }

  const pressure: Record<string, number> = {};
  for (const position of CORE_POSITIONS) {
    let total = 0;
    for (const rosterId of upcomingRosterIds) {
      const profile = profiles.get(rosterId)!;
      const totalOpen = CORE_POSITIONS.reduce((sum, key) => sum + profile.open_starter_positions[key], 0);
      const needShare = totalOpen
        ? profile.open_starter_positions[position] / totalOpen
        : profile.position_preference[position];
      const needWeight = Math.max(0.55, Math.min(0.9, 0.72 + 0.18 * profile.need_sensitivity));
      const runAdjustment = profile.run_sensitivity * recentPositionRun[position] * 0.12;
      total += needWeight * needShare + (1 - needWeight) * profile.position_preference[position] + runAdjustment;
    }
    const opponentDemand = upcomingRosterIds.length ? total / upcomingRosterIds.length : 0.25;
    pressure[position] = rounded(0.9 * opponentDemand + 0.1 * recentPositionRun[position]);
  }

  const upcomingProfiles = upcomingRosterIds
    .map((id) => profiles.get(id)!)
    .filter((profile) => profile.average_reach !== null);
  const averageReach = upcomingProfiles.length
    ? upcomingProfiles.reduce((sum, profile) => sum + profile.average_reach!, 0) / upcomingProfiles.length
    : 0;

  return {
    upcoming_opponent_picks: upcomingRosterIds.length,
    upcoming_roster_ids: upcomingRosterIds,
    position_pressure: pressure,
    recent_position_run: recentPositionRun,
    average_upcoming_manager_reach: rounded(averageReach),
    manager_profiles: Array.from(profiles.values()).sort((a, b) => a.roster_id - b.roster_id),
  };
}

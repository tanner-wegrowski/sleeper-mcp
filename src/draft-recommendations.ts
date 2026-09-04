import type { PlayerWithDetails } from "./types.js";

export type DraftStrategy = "balanced" | "best_player_available" | "needs_based";

export interface DraftRanking {
  player_id?: string;
  name?: string;
  rank: number;
  tier?: string;
  projected_points?: number;
  notes?: string;
  source?: "user" | "ffc_adp";
  adp_stdev?: number;
  times_drafted?: number;
  projection_floor?: number;
  projection_ceiling?: number;
  projection_confidence?: number;
  projection_source?: "nflverse_history";
  projection_model?: "veteran_history" | "rookie_prior";
  role_multiplier?: number;
  depth_rank?: number | null;
  rookie_draft_pick?: number;
}

export interface DraftCandidateScore {
  player: PlayerWithDetails;
  overall_score: number;
  rank: number;
  rank_source: "custom" | "sleeper_search_rank";
  tier?: string;
  projected_points?: number;
  notes?: string;
  score_components: {
    rank: number;
    roster_need: number;
    scarcity: number;
  };
  reasons: string[];
}

const STRATEGY_WEIGHTS: Record<
  DraftStrategy,
  { rank: number; rosterNeed: number; scarcity: number }
> = {
  balanced: { rank: 0.65, rosterNeed: 0.25, scarcity: 0.1 },
  best_player_available: { rank: 0.9, rosterNeed: 0.05, scarcity: 0.05 },
  needs_based: { rank: 0.45, rosterNeed: 0.45, scarcity: 0.1 },
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreRank(rank: number): number {
  return Math.max(0, Math.min(100, 101 - rank));
}

function scoreRosterNeed(
  position: string,
  draftedCounts: Record<string, number>,
  starterTargets: Record<string, number>,
  flexSlots: number,
): number {
  const drafted = draftedCounts[position] ?? 0;
  const target = starterTargets[position] ?? 0;
  if (drafted < target) return 100;

  if (["RB", "WR", "TE"].includes(position)) {
    const flexEligibleDrafted = ["RB", "WR", "TE"].reduce(
      (sum, key) => sum + Math.max(0, (draftedCounts[key] ?? 0) - (starterTargets[key] ?? 0)),
      0,
    );
    if (flexEligibleDrafted < flexSlots) return 70;
  }

  return drafted === target ? 35 : 10;
}

function findRanking(
  player: PlayerWithDetails,
  byId: Map<string, DraftRanking>,
  byName: Map<string, DraftRanking>,
): DraftRanking | undefined {
  return (
    byId.get(player.player_id) ??
    byName.get(normalizeName(player.full_name || `${player.first_name} ${player.last_name}`))
  );
}

export function rankDraftCandidates(
  players: PlayerWithDetails[],
  rankings: DraftRanking[],
  draftedCounts: Record<string, number>,
  starterTargets: Record<string, number>,
  flexSlots: number,
  strategy: DraftStrategy,
  limit: number,
): DraftCandidateScore[] {
  const byId = new Map(
    rankings
      .filter((ranking) => ranking.player_id)
      .map((ranking) => [ranking.player_id!, ranking]),
  );
  const byName = new Map(
    rankings
      .filter((ranking) => ranking.name)
      .map((ranking) => [normalizeName(ranking.name!), ranking]),
  );
  const resolved = players
    .map((player) => {
      const custom = findRanking(player, byId, byName);
      const fallbackRank = player.search_rank ?? Number.MAX_SAFE_INTEGER;
      return {
        player,
        ranking: custom,
        rank: custom?.rank ?? fallbackRank,
        rankSource: custom ? "custom" as const : "sleeper_search_rank" as const,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.rank));
  const positionRanks = new Map<string, number[]>();
  for (const candidate of resolved) {
    const ranks = positionRanks.get(candidate.player.position) ?? [];
    ranks.push(candidate.rank);
    positionRanks.set(candidate.player.position, ranks);
  }
  for (const ranks of positionRanks.values()) ranks.sort((a, b) => a - b);

  const weights = STRATEGY_WEIGHTS[strategy];
  return resolved
    .map((candidate): DraftCandidateScore => {
      const rankComponent = scoreRank(candidate.rank);
      const needComponent = scoreRosterNeed(
        candidate.player.position,
        draftedCounts,
        starterTargets,
        flexSlots,
      );
      const samePositionRanks = positionRanks.get(candidate.player.position) ?? [];
      const currentIndex = samePositionRanks.indexOf(candidate.rank);
      const nextRank = samePositionRanks[currentIndex + 1];
      const scarcityComponent = nextRank === undefined
        ? 100
        : Math.max(0, Math.min(100, (nextRank - candidate.rank) * 10));
      const overallScore =
        rankComponent * weights.rank +
        needComponent * weights.rosterNeed +
        scarcityComponent * weights.scarcity;
      const reasons = [
        `${candidate.rankSource === "custom" ? "Personal" : "Sleeper fallback"} rank: ${candidate.rank}`,
        needComponent === 100
          ? `${candidate.player.position} starter slot is still open`
          : needComponent === 70
            ? `${candidate.player.position} can fill an open flex slot`
            : `${candidate.player.position} is currently depth`,
      ];
      if (scarcityComponent >= 50) reasons.push("Meaningful positional tier drop follows");

      return {
        player: candidate.player,
        overall_score: Math.round(overallScore * 10) / 10,
        rank: candidate.rank,
        rank_source: candidate.rankSource,
        tier: candidate.ranking?.tier,
        projected_points: candidate.ranking?.projected_points,
        notes: candidate.ranking?.notes,
        score_components: {
          rank: rankComponent,
          roster_need: needComponent,
          scarcity: scarcityComponent,
        },
        reasons,
      };
    })
    .sort((a, b) => b.overall_score - a.overall_score || a.rank - b.rank)
    .slice(0, limit);
}

export function getStarterTargets(settings: {
  slots_qb?: number;
  slots_rb?: number;
  slots_wr?: number;
  slots_te?: number;
  slots_k?: number;
  slots_def?: number;
  slots_flex?: number;
}): {
  starterTargets: Record<string, number>;
  flexSlots: number;
} {
  return {
    starterTargets: {
      QB: settings.slots_qb ?? 0,
      RB: settings.slots_rb ?? 0,
      WR: settings.slots_wr ?? 0,
      TE: settings.slots_te ?? 0,
      K: settings.slots_k ?? 0,
      DEF: settings.slots_def ?? 0,
    },
    flexSlots: settings.slots_flex ?? 0,
  };
}

export interface HistoricalProjection {
  name: string;
  position: string;
  projected_games: number;
  career_games_used: number;
  seasons_used: number[];
  confidence: number;
  uncertainty: number;
  stats: Record<string, number>;
  model_type?: "veteran_history" | "rookie_prior";
  role?: {
    depth_rank: number | null;
    depth_position: string | null;
    multiplier: number;
  };
  rookie?: {
    draft_round: number;
    draft_pick: number;
    combine_score: number | null;
  };
}

const SCORING_FIELDS: Record<string, string> = {
  completions: "pass_cmp",
  attempts: "pass_att",
  passing_yards: "pass_yd",
  passing_tds: "pass_td",
  passing_interceptions: "pass_int",
  passing_first_downs: "pass_fd",
  passing_2pt_conversions: "pass_2pt",
  carries: "rush_att",
  rushing_yards: "rush_yd",
  rushing_tds: "rush_td",
  rushing_first_downs: "rush_fd",
  rushing_2pt_conversions: "rush_2pt",
  receptions: "rec",
  targets: "rec_tgt",
  receiving_yards: "rec_yd",
  receiving_tds: "rec_td",
  receiving_first_downs: "rec_fd",
  receiving_2pt_conversions: "rec_2pt",
  fumbles_lost_total: "fum_lost",
  special_teams_tds: "st_td",
};

export interface ScoredProjection {
  median: number;
  floor: number;
  ceiling: number;
  confidence: number;
  unsupported_scoring_keys: string[];
}

export function scoreHistoricalProjection(
  projection: HistoricalProjection,
  scoring: Record<string, number>,
): ScoredProjection {
  let median = 0;
  for (const [stat, scoringKey] of Object.entries(SCORING_FIELDS)) {
    median += (projection.stats[stat] ?? 0) * (scoring[scoringKey] ?? 0);
  }
  const supported = new Set(Object.values(SCORING_FIELDS));
  const unsupported = Object.keys(scoring).filter((key) =>
    scoring[key] !== 0 && !supported.has(key),
  );
  const spread = Math.max(8, Math.abs(median) * projection.uncertainty);
  return {
    median: Math.round(median * 10) / 10,
    floor: Math.round(Math.max(0, median - spread) * 10) / 10,
    ceiling: Math.round(Math.max(0, median + spread) * 10) / 10,
    confidence: projection.confidence,
    unsupported_scoring_keys: unsupported,
  };
}

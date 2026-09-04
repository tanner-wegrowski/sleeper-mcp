import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parseCsvRows, defaultDataDirectory } from "./rankings.js";
import type { HistoricalProjection } from "./projection-scoring.js";

interface ProjectionDocument {
  version: 2;
  source: "nflverse_history";
  target_season: number;
  fetched_at: string;
  source_urls: string[];
  projections: HistoricalProjection[];
  warnings?: string[];
}

export interface ProjectionResult {
  projections: HistoricalProjection[];
  source: "nflverse_history";
  target_season: number;
  fetched_at: string | null;
  source_urls: string[];
  cache_status: "refreshed" | "fresh" | "stale" | "unavailable";
  error?: string;
  warnings?: string[];
}

type TextResponse = Pick<Response, "ok" | "status" | "statusText" | "text">;
type FetchTextLike = (url: string, init?: RequestInit) => Promise<TextResponse>;

const STAT_FIELDS = [
  "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
  "passing_first_downs", "passing_2pt_conversions", "carries", "rushing_yards",
  "rushing_tds", "rushing_first_downs", "rushing_2pt_conversions", "receptions",
  "targets", "receiving_yards", "receiving_tds", "receiving_first_downs",
  "receiving_2pt_conversions", "fumbles_lost_total", "special_teams_tds",
] as const;

const POSITION_UNCERTAINTY: Record<string, number> = { QB: 0.18, RB: 0.32, WR: 0.30, TE: 0.34, K: 0.25 };
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function number(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseSeasonCsv(content: string): Array<Record<string, string>> {
  const rows = parseCsvRows(content.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export function buildHistoricalProjections(
  seasons: Array<{ season: number; rows: Array<Record<string, string>> }>,
): HistoricalProjection[] {
  const byPlayer = new Map<string, Array<{ season: number; row: Record<string, string> }>>();
  for (const season of seasons) {
    for (const row of season.rows) {
      const name = row.player_display_name || row.player_name;
      if (!name || !row.position || number(row.games) <= 0) continue;
      const key = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}:${row.position}`;
      const history = byPlayer.get(key) ?? [];
      history.push({ season: season.season, row });
      byPlayer.set(key, history);
    }
  }

  const projections: HistoricalProjection[] = [];
  for (const history of byPlayer.values()) {
    history.sort((a, b) => b.season - a.season);
    const latest = history[0];
    const weights = [0.55, 0.30, 0.15];
    const weightedRates: Record<string, number> = {};
    let totalWeight = 0;
    let careerGames = 0;
    let weightedGames = 0;
    history.slice(0, 3).forEach(({ row }, index) => {
      const games = number(row.games);
      const reliability = Math.min(1, games / 12);
      const weight = weights[index] * reliability;
      totalWeight += weight;
      careerGames += games;
      weightedGames += games * weights[index];
      for (const field of STAT_FIELDS) {
        weightedRates[field] = (weightedRates[field] ?? 0) + (number(row[field]) / games) * weight;
      }
    });
    if (!totalWeight) continue;
    const projectedGames = Math.max(12, Math.min(17, weightedGames / weights.slice(0, Math.min(3, history.length)).reduce((a, b) => a + b, 0) + 1));
    const stats = Object.fromEntries(STAT_FIELDS.map((field) => [field, (weightedRates[field] / totalWeight) * projectedGames]));
    const confidence = Math.round(Math.min(0.95, 0.35 + Math.min(40, careerGames) / 70) * 1000) / 1000;
    const sparsePenalty = Math.max(0, (16 - careerGames) / 40);
    projections.push({
      name: latest.row.player_display_name || latest.row.player_name,
      position: latest.row.position,
      projected_games: Math.round(projectedGames * 10) / 10,
      career_games_used: careerGames,
      seasons_used: history.slice(0, 3).map((item) => item.season),
      confidence,
      uncertainty: Math.min(0.65, (POSITION_UNCERTAINTY[latest.row.position] ?? 0.35) + sparsePenalty),
      stats,
      model_type: "veteran_history",
    });
  }
  return projections;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");
}

function depthMultiplier(position: string, rank: number | null): number {
  if (rank === null || rank <= 0) return 1;
  const values: Record<string, number[]> = {
    QB: [1.02, 0.35, 0.15],
    RB: [1.03, 0.82, 0.62],
    WR: [1.02, 0.86, 0.68],
    TE: [1.02, 0.72, 0.50],
  };
  return values[position]?.[Math.min(2, rank - 1)] ?? (rank === 1 ? 1 : 0.8);
}

function rookieTemplate(position: string): Record<string, number> {
  if (position === "QB") return {
    completions: 270, attempts: 430, passing_yards: 3000, passing_tds: 18,
    passing_interceptions: 13, passing_first_downs: 145, passing_2pt_conversions: 1,
    carries: 45, rushing_yards: 220, rushing_tds: 2, rushing_first_downs: 14,
  };
  if (position === "RB") return {
    carries: 150, rushing_yards: 650, rushing_tds: 5, rushing_first_downs: 35,
    receptions: 30, targets: 40, receiving_yards: 225, receiving_tds: 1.5,
  };
  if (position === "WR") return {
    receptions: 55, targets: 86, receiving_yards: 720, receiving_tds: 4.5,
    receiving_first_downs: 36,
  };
  return {
    receptions: 36, targets: 52, receiving_yards: 410, receiving_tds: 3,
    receiving_first_downs: 22,
  };
}

function draftCapitalMultiplier(round: number, pick: number): number {
  if (pick <= 10) return 1.28;
  if (round === 1) return 1.15;
  if (round === 2) return 1;
  if (round === 3) return 0.82;
  if (round <= 5) return 0.65;
  return 0.52;
}

function combineMultiplier(position: string, row: Record<string, string> | undefined): number | null {
  if (!row) return null;
  const forty = number(row.forty);
  const vertical = number(row.vertical);
  const fortyReference: Record<string, number> = { QB: 4.8, RB: 4.55, WR: 4.5, TE: 4.7 };
  let adjustment = 1;
  if (forty > 0) adjustment += Math.max(-0.06, Math.min(0.06, (fortyReference[position] - forty) * 0.25));
  if (vertical > 0) adjustment += Math.max(-0.04, Math.min(0.04, (vertical - 34) / 100));
  return Math.round(Math.max(0.9, Math.min(1.1, adjustment)) * 1000) / 1000;
}

export function enrichProjectionsWithRolesAndRookies(input: {
  projections: HistoricalProjection[];
  depthRows: Array<Record<string, string>>;
  draftRows: Array<Record<string, string>>;
  combineRows: Array<Record<string, string>>;
  targetSeason: number;
}): HistoricalProjection[] {
  const latestDepth = new Map<string, Record<string, string>>();
  for (const row of input.depthRows) {
    if (!row.player_name) continue;
    const key = normalizeName(row.player_name);
    const existing = latestDepth.get(key);
    if (!existing || String(row.dt) > String(existing.dt)) latestDepth.set(key, row);
  }
  const combineByName = new Map(
    input.combineRows
      .filter((row) => number(row.season || row.draft_year) === input.targetSeason && row.player_name)
      .map((row) => [normalizeName(row.player_name), row]),
  );

  const enriched = input.projections.map((projection) => {
    const depth = latestDepth.get(normalizeName(projection.name));
    const depthRank = depth ? number(depth.pos_rank || depth.depth_team) : null;
    const multiplier = depthMultiplier(projection.position, depthRank);
    return {
      ...projection,
      stats: Object.fromEntries(Object.entries(projection.stats).map(([field, value]) => [field, value * multiplier])),
      confidence: depth ? Math.min(0.97, projection.confidence + 0.03) : projection.confidence,
      role: {
        depth_rank: depthRank,
        depth_position: depth?.pos_abb || depth?.depth_position || null,
        multiplier,
      },
    };
  });

  const existingNames = new Set(enriched.map((projection) => normalizeName(projection.name)));
  for (const draft of input.draftRows) {
    if (number(draft.season) !== input.targetSeason) continue;
    const position = draft.position;
    if (!["QB", "RB", "WR", "TE"].includes(position)) continue;
    const name = draft.pfr_player_name;
    if (!name || existingNames.has(normalizeName(name))) continue;
    const round = number(draft.round);
    const pick = number(draft.pick);
    const depth = latestDepth.get(normalizeName(name));
    const depthRank = depth ? number(depth.pos_rank || depth.depth_team) : null;
    const roleMultiplier = depthMultiplier(position, depthRank);
    const athletic = combineMultiplier(position, combineByName.get(normalizeName(name)));
    const totalMultiplier = draftCapitalMultiplier(round, pick) * roleMultiplier * (athletic ?? 1);
    const stats = Object.fromEntries(
      Object.entries(rookieTemplate(position)).map(([field, value]) => [field, value * totalMultiplier]),
    );
    enriched.push({
      name,
      position,
      projected_games: 15,
      career_games_used: 0,
      seasons_used: [],
      confidence: Math.round(Math.min(0.62, 0.3 + Math.max(0, 4 - round) * 0.07 + (depthRank === 1 ? 0.06 : 0)) * 1000) / 1000,
      uncertainty: 0.52,
      stats,
      model_type: "rookie_prior",
      role: { depth_rank: depthRank, depth_position: depth?.pos_abb || null, multiplier: roleMultiplier },
      rookie: { draft_round: round, draft_pick: pick, combine_score: athletic },
    });
    existingNames.add(normalizeName(name));
  }
  return enriched;
}

export class NflverseProjectionProvider {
  constructor(
    private readonly dataDirectory = defaultDataDirectory(),
    private readonly fetchImpl: FetchTextLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private cachePath(targetSeason: number): string {
    return join(this.dataDirectory, "projections", `nflverse-${targetSeason}.json`);
  }

  private async readCache(targetSeason: number): Promise<ProjectionDocument | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.cachePath(targetSeason), "utf8")) as ProjectionDocument;
      return parsed.version === 2 ? parsed : null;
    } catch {
      return null;
    }
  }

  async getProjections(input: { targetSeason: number; allowNetwork: boolean; timeoutMs?: number }): Promise<ProjectionResult> {
    const cached = await this.readCache(input.targetSeason);
    const age = cached ? this.now() - Date.parse(cached.fetched_at) : Number.POSITIVE_INFINITY;
    if (cached && age < CACHE_TTL_MS) return { ...cached, cache_status: "fresh" };
    if (!input.allowNetwork) {
      return {
        projections: cached?.projections ?? [], source: "nflverse_history",
        target_season: input.targetSeason, fetched_at: cached?.fetched_at ?? null,
        source_urls: cached?.source_urls ?? [], cache_status: cached ? "stale" : "unavailable",
        warnings: cached?.warnings,
      };
    }

    const statsUrls = [1, 2, 3].map((offset) =>
      `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${input.targetSeason - offset}.csv`,
    );
    const enrichmentUrls = [
      `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${input.targetSeason}.csv`,
      "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv",
      "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv",
    ];
    const sourceUrls = [...statsUrls, ...enrichmentUrls];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20000);
      let responses: TextResponse[];
      try {
        responses = await Promise.all(statsUrls.map((url) => this.fetchImpl(url, { signal: controller.signal })));
      } finally {
        clearTimeout(timer);
      }
      for (const response of responses) {
        if (!response.ok) throw new Error(`nflverse HTTP ${response.status} ${response.statusText}`);
      }
      const contents = await Promise.all(responses.map((response) => response.text()));
      const seasons = contents.map((content, index) => ({
        season: input.targetSeason - index - 1,
        rows: parseSeasonCsv(content),
      }));
      const warnings: string[] = [];
      const enrichmentContents = await Promise.all(enrichmentUrls.map(async (url) => {
        try {
          const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(input.timeoutMs ?? 20000) });
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
          return await response.text();
        } catch (error) {
          warnings.push(`${url}: ${error instanceof Error ? error.message : "unavailable"}`);
          return "";
        }
      }));
      const baseProjections = buildHistoricalProjections(seasons);
      const projections = enrichProjectionsWithRolesAndRookies({
        projections: baseProjections,
        depthRows: parseSeasonCsv(enrichmentContents[0]),
        draftRows: parseSeasonCsv(enrichmentContents[1]),
        combineRows: parseSeasonCsv(enrichmentContents[2]),
        targetSeason: input.targetSeason,
      });
      const document: ProjectionDocument = {
        version: 2, source: "nflverse_history", target_season: input.targetSeason,
        fetched_at: new Date(this.now()).toISOString(), source_urls: sourceUrls,
        projections,
        warnings,
      };
      const path = this.cachePath(input.targetSeason);
      await fs.mkdir(join(this.dataDirectory, "projections"), { recursive: true });
      const temporaryPath = `${path}.${process.pid}.${this.now()}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(document), "utf8");
      await fs.rename(temporaryPath, path);
      return { ...document, cache_status: "refreshed" };
    } catch (error) {
      return {
        projections: cached?.projections ?? [], source: "nflverse_history",
        target_season: input.targetSeason, fetched_at: cached?.fetched_at ?? null,
        source_urls: cached?.source_urls ?? sourceUrls, cache_status: cached ? "stale" : "unavailable",
        warnings: cached?.warnings,
        error: error instanceof Error ? error.message : "Unknown nflverse projection error",
      };
    }
  }
}

export const projectionProvider = new NflverseProjectionProvider();

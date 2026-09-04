import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parseCsvRows, defaultDataDirectory } from "./rankings.js";
import type { HistoricalProjection } from "./projection-scoring.js";

interface ProjectionDocument {
  version: 1;
  source: "nflverse_history";
  target_season: number;
  fetched_at: string;
  source_urls: string[];
  projections: HistoricalProjection[];
}

export interface ProjectionResult {
  projections: HistoricalProjection[];
  source: "nflverse_history";
  target_season: number;
  fetched_at: string | null;
  source_urls: string[];
  cache_status: "refreshed" | "fresh" | "stale" | "unavailable";
  error?: string;
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

function parseSeasonCsv(content: string): Array<Record<string, string>> {
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
    });
  }
  return projections;
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
      return JSON.parse(await fs.readFile(this.cachePath(targetSeason), "utf8")) as ProjectionDocument;
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
      };
    }

    const sourceUrls = [1, 2, 3].map((offset) =>
      `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${input.targetSeason - offset}.csv`,
    );
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 20000);
      let responses: TextResponse[];
      try {
        responses = await Promise.all(sourceUrls.map((url) => this.fetchImpl(url, { signal: controller.signal })));
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
      const document: ProjectionDocument = {
        version: 1, source: "nflverse_history", target_season: input.targetSeason,
        fetched_at: new Date(this.now()).toISOString(), source_urls: sourceUrls,
        projections: buildHistoricalProjections(seasons),
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
        error: error instanceof Error ? error.message : "Unknown nflverse projection error",
      };
    }
  }
}

export const projectionProvider = new NflverseProjectionProvider();

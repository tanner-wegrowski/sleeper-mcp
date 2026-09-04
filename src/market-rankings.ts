import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DraftRanking } from "./draft-recommendations.js";
import { defaultDataDirectory } from "./rankings.js";

export type FfcFormat = "standard" | "half-ppr" | "ppr" | "2qb";

const FfcPlayerSchema = z.object({
  name: z.string(),
  position: z.string(),
  team: z.string().nullish(),
  adp: z.number().positive(),
  stdev: z.number().nonnegative().nullish(),
  times_drafted: z.number().nonnegative().nullish(),
});

const FfcResponseSchema = z.object({ players: z.array(FfcPlayerSchema) });

interface CacheDocument {
  version: 1;
  source: "ffc_adp";
  fetched_at: string;
  format: FfcFormat;
  teams: number;
  year: number;
  rankings: DraftRanking[];
}

export interface MarketRankingResult {
  rankings: DraftRanking[];
  source: "ffc_adp";
  source_url: string;
  fetched_at: string | null;
  cache_status: "fresh" | "refreshed" | "stale" | "unavailable";
  format: FfcFormat;
  teams: number;
  requested_teams: number;
  year: number;
  error?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "statusText" | "json">>;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14];

export function nearestFfcTeamCount(teams: number): number {
  return SUPPORTED_TEAM_COUNTS.reduce((best, value) =>
    Math.abs(value - teams) < Math.abs(best - teams) ? value : best,
  );
}

export function selectFfcFormat(scoring: Record<string, number>, superFlexSlots = 0): FfcFormat {
  if (superFlexSlots > 0) return "2qb";
  const receptions = scoring.rec ?? 0;
  if (receptions >= 0.75) return "ppr";
  if (receptions >= 0.25) return "half-ppr";
  return "standard";
}

export class FantasyFootballCalculatorProvider {
  constructor(
    private readonly dataDirectory = defaultDataDirectory(),
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private cachePath(format: FfcFormat, teams: number, year: number): string {
    return join(this.dataDirectory, "market-rankings", `ffc-${format}-${teams}-${year}.json`);
  }

  private sourceUrl(format: FfcFormat, teams: number, year: number): string {
    return `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${year}`;
  }

  private async readCache(format: FfcFormat, teams: number, year: number): Promise<CacheDocument | null> {
    try {
      return JSON.parse(await fs.readFile(this.cachePath(format, teams, year), "utf8")) as CacheDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return null;
    }
  }

  private async saveCache(document: CacheDocument): Promise<void> {
    const path = this.cachePath(document.format, document.teams, document.year);
    await fs.mkdir(join(this.dataDirectory, "market-rankings"), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${this.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
    await fs.rename(temporaryPath, path);
  }

  async getRankings(input: {
    format: FfcFormat;
    teams: number;
    year: number;
    timeoutMs?: number;
    allowNetwork?: boolean;
  }): Promise<MarketRankingResult> {
    const requestedTeams = input.teams;
    const teams = nearestFfcTeamCount(requestedTeams);
    const url = this.sourceUrl(input.format, teams, input.year);
    const cached = await this.readCache(input.format, teams, input.year);
    const cachedAge = cached ? this.now() - Date.parse(cached.fetched_at) : Number.POSITIVE_INFINITY;
    if (cached && cachedAge < CACHE_TTL_MS) {
      return { ...cached, source_url: url, requested_teams: requestedTeams, cache_status: "fresh" };
    }
    if (input.allowNetwork === false) {
      return {
        rankings: cached?.rankings ?? [], source: "ffc_adp", source_url: url,
        fetched_at: cached?.fetched_at ?? null, cache_status: cached ? "stale" : "unavailable",
        format: input.format, teams, requested_teams: requestedTeams, year: input.year,
      };
    }

    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(input.timeoutMs ?? 1500) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const payload = FfcResponseSchema.parse(await response.json());
      const fetchedAt = new Date(this.now()).toISOString();
      const rankings: DraftRanking[] = payload.players.map((player) => ({
        name: player.name,
        rank: player.adp,
        source: "ffc_adp",
        adp_stdev: player.stdev ?? undefined,
        times_drafted: player.times_drafted ?? undefined,
        notes: `${player.position}${player.team ? `, ${player.team}` : ""}; Fantasy Football Calculator ADP`,
      }));
      const document: CacheDocument = {
        version: 1, source: "ffc_adp", fetched_at: fetchedAt,
        format: input.format, teams, year: input.year, rankings,
      };
      await this.saveCache(document);
      return { ...document, source_url: url, requested_teams: requestedTeams, cache_status: "refreshed" };
    } catch (error) {
      return {
        rankings: cached?.rankings ?? [], source: "ffc_adp", source_url: url,
        fetched_at: cached?.fetched_at ?? null, cache_status: cached ? "stale" : "unavailable",
        format: input.format, teams, requested_teams: requestedTeams, year: input.year,
        error: error instanceof Error ? error.message : "Unknown FFC ADP error",
      };
    }
  }
}

export const marketRankingProvider = new FantasyFootballCalculatorProvider();

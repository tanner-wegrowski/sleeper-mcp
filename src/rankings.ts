import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import type { DraftRanking } from "./draft-recommendations.js";
import { normalizePlayerName } from "./player-name.js";

export const DraftRankingSchema = z
  .object({
    player_id: z.string().optional().describe("Sleeper player ID"),
    name: z.string().optional().describe("Player name used when an ID is unavailable"),
    rank: z.number().positive().describe("Overall rank; lower is better"),
    tier: z.string().optional().describe("Optional personal tier label"),
    projected_points: z.number().optional().describe("Optional projected season points"),
    notes: z.string().optional().describe("Optional personal note"),
  })
  .refine((ranking) => ranking.player_id || ranking.name, {
    message: "Each ranking requires player_id or name",
  });

interface RankingDocument {
  version: 1;
  draft_id: string;
  updated_at: string;
  rankings: DraftRanking[];
}

export interface RankingProvider {
  getRankings(draftId: string): Promise<DraftRanking[]>;
  saveRankings(draftId: string, rankings: DraftRanking[]): Promise<RankingDocument>;
  getInfo(draftId: string): Promise<Omit<RankingDocument, "rankings"> & { count: number } | null>;
}

export function defaultDataDirectory(): string {
  return process.env.SLEEPER_MCP_DATA_DIR || join(homedir(), ".sleeper-mcp");
}

function validateDraftId(draftId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(draftId)) {
    throw new Error("draft_id may contain only letters, numbers, underscores, and hyphens");
  }
}

export class FileRankingProvider implements RankingProvider {
  constructor(private readonly dataDirectory = defaultDataDirectory()) {}

  private filePath(draftId: string): string {
    validateDraftId(draftId);
    return join(this.dataDirectory, "rankings", `${draftId}.json`);
  }

  private async readDocument(draftId: string): Promise<RankingDocument | null> {
    try {
      const raw = await fs.readFile(this.filePath(draftId), "utf8");
      const parsed = JSON.parse(raw) as RankingDocument;
      return {
        version: 1,
        draft_id: draftId,
        updated_at: parsed.updated_at,
        rankings: DraftRankingSchema.array().parse(parsed.rankings),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getRankings(draftId: string): Promise<DraftRanking[]> {
    return (await this.readDocument(draftId))?.rankings ?? [];
  }

  async saveRankings(
    draftId: string,
    rankings: DraftRanking[],
  ): Promise<RankingDocument> {
    const validated = DraftRankingSchema.array().max(2000).parse(rankings);
    const filePath = this.filePath(draftId);
    const directory = join(this.dataDirectory, "rankings");
    const document: RankingDocument = {
      version: 1,
      draft_id: draftId,
      updated_at: new Date().toISOString(),
      rankings: validated,
    };
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
    await fs.rename(temporaryPath, filePath);
    return document;
  }

  async getInfo(
    draftId: string,
  ): Promise<Omit<RankingDocument, "rankings"> & { count: number } | null> {
    const document = await this.readDocument(draftId);
    if (!document) return null;
    return {
      version: document.version,
      draft_id: document.draft_id,
      updated_at: document.updated_at,
      count: document.rankings.length,
    };
  }
}

export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  return rows;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

export function parseRankings(
  content: string,
  format: "json" | "csv",
): DraftRanking[] {
  let rankings: unknown;
  if (format === "json") {
    const parsed = JSON.parse(content);
    rankings = Array.isArray(parsed) ? parsed : parsed.rankings;
  } else {
    const rows = parseCsvRows(content.replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new Error("CSV requires a header and at least one ranking row");
    const headers = rows[0].map((header) =>
      header.trim().toLowerCase().replace(/[ -]+/g, "_"),
    );
    const column = (row: string[], name: string) => {
      const index = headers.indexOf(name);
      return index === -1 ? undefined : row[index]?.trim();
    };
    rankings = rows.slice(1).map((row) => ({
      player_id: column(row, "player_id") || undefined,
      name: column(row, "name") || column(row, "player_name") || undefined,
      rank: optionalNumber(column(row, "rank")),
      tier: column(row, "tier") || undefined,
      projected_points: optionalNumber(column(row, "projected_points")),
      notes: column(row, "notes") || undefined,
    }));
  }
  return DraftRankingSchema.array().min(1).max(2000).parse(rankings);
}

function rankingKey(ranking: DraftRanking): string {
  return ranking.player_id
    ? `id:${ranking.player_id}`
    : `name:${normalizePlayerName(ranking.name!)}`;
}

export function mergeRankings(
  base: DraftRanking[],
  overrides: DraftRanking[],
): DraftRanking[] {
  const merged = new Map(base.map((ranking) => [rankingKey(ranking), ranking]));
  for (const ranking of overrides) {
    const key = rankingKey(ranking);
    merged.set(key, { ...merged.get(key), ...ranking });
  }
  return Array.from(merged.values()).sort((a, b) => a.rank - b.rank);
}

export const rankingProvider = new FileRankingProvider();

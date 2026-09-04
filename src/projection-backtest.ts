import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { buildHistoricalProjections, parseSeasonCsv, STAT_FIELDS } from "./nflverse-projections.js";
import { defaultDataDirectory } from "./rankings.js";
import { scoreHistoricalProjection, type HistoricalProjection, type ScoredProjection } from "./projection-scoring.js";

const POSITIONS = ["QB", "RB", "WR", "TE"];

export interface BacktestMetrics {
  samples: number;
  mae: number;
  rmse: number;
  bias: number;
  correlation: number | null;
  interval_coverage: number;
}

export interface PositionCalibration {
  points_multiplier: number;
  uncertainty_multiplier: number;
  samples: number;
  metrics: BacktestMetrics;
  calibrated_metrics: BacktestMetrics;
}

export interface ProjectionCalibration {
  version: 1;
  scoring_fingerprint: string;
  created_at: string;
  evaluation_seasons: number[];
  overall: BacktestMetrics;
  calibrated_overall: BacktestMetrics;
  positions: Record<string, PositionCalibration>;
}

interface Observation {
  position: string;
  predicted: number;
  actual: number;
  floor: number;
  ceiling: number;
  baseSpread: number;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");
}

function numeric(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scoringFingerprint(scoring: Record<string, number>): string {
  const stable = Object.entries(scoring).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

function actualProjection(row: Record<string, string>): HistoricalProjection {
  return {
    name: row.player_display_name || row.player_name,
    position: row.position,
    projected_games: numeric(row.games),
    career_games_used: numeric(row.games),
    seasons_used: [numeric(row.season)],
    confidence: 1,
    uncertainty: 0,
    stats: Object.fromEntries(STAT_FIELDS.map((field) => [field, numeric(row[field])])),
  };
}

function correlation(observations: Observation[]): number | null {
  if (observations.length < 2) return null;
  const predictedMean = observations.reduce((sum, item) => sum + item.predicted, 0) / observations.length;
  const actualMean = observations.reduce((sum, item) => sum + item.actual, 0) / observations.length;
  let numerator = 0;
  let predictedVariance = 0;
  let actualVariance = 0;
  for (const item of observations) {
    const predictedDelta = item.predicted - predictedMean;
    const actualDelta = item.actual - actualMean;
    numerator += predictedDelta * actualDelta;
    predictedVariance += predictedDelta ** 2;
    actualVariance += actualDelta ** 2;
  }
  if (!predictedVariance || !actualVariance) return null;
  return numerator / Math.sqrt(predictedVariance * actualVariance);
}

function metrics(observations: Observation[]): BacktestMetrics {
  if (!observations.length) return { samples: 0, mae: 0, rmse: 0, bias: 0, correlation: null, interval_coverage: 0 };
  const errors = observations.map((item) => item.predicted - item.actual);
  const coefficient = correlation(observations);
  return {
    samples: observations.length,
    mae: Math.round((errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length) * 100) / 100,
    rmse: Math.round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length) * 100) / 100,
    bias: Math.round((errors.reduce((sum, error) => sum + error, 0) / errors.length) * 100) / 100,
    correlation: coefficient === null ? null : Math.round(coefficient * 1000) / 1000,
    interval_coverage: Math.round((observations.filter((item) => item.actual >= item.floor && item.actual <= item.ceiling).length / observations.length) * 1000) / 1000,
  };
}

function quantile(values: number[], probability: number): number {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability))];
}

export function runProjectionBacktest(input: {
  rowsBySeason: Map<number, Array<Record<string, string>>>;
  evaluationSeasons: number[];
  scoring: Record<string, number>;
  now?: number;
}): ProjectionCalibration {
  const observations: Observation[] = [];
  for (const evaluationSeason of input.evaluationSeasons) {
    const histories = [1, 2, 3].map((offset) => ({
      season: evaluationSeason - offset,
      rows: input.rowsBySeason.get(evaluationSeason - offset) ?? [],
    }));
    const predictions = buildHistoricalProjections(histories);
    const predictedByKey = new Map(predictions.map((projection) => [
      `${normalizedName(projection.name)}:${projection.position}`,
      projection,
    ]));
    for (const row of input.rowsBySeason.get(evaluationSeason) ?? []) {
      if (!POSITIONS.includes(row.position)) continue;
      const prediction = predictedByKey.get(`${normalizedName(row.player_display_name || row.player_name)}:${row.position}`);
      if (!prediction) continue;
      const predicted = scoreHistoricalProjection(prediction, input.scoring);
      if (predicted.median < 30) continue;
      const actual = scoreHistoricalProjection(actualProjection(row), input.scoring).median;
      observations.push({
        position: row.position,
        predicted: predicted.median,
        actual,
        floor: predicted.floor,
        ceiling: predicted.ceiling,
        baseSpread: Math.max(1, predicted.ceiling - predicted.median),
      });
    }
  }

  const positions: Record<string, PositionCalibration> = {};
  const calibratedObservations: Observation[] = [];
  for (const position of POSITIONS) {
    const subset = observations.filter((item) => item.position === position);
    const predictedTotal = subset.reduce((sum, item) => sum + item.predicted, 0);
    const actualTotal = subset.reduce((sum, item) => sum + item.actual, 0);
    const rawMultiplier = predictedTotal ? actualTotal / predictedTotal : 1;
    const reliability = subset.length / (subset.length + 30);
    const pointMultiplier = Math.max(0.75, Math.min(1.25, 1 + (rawMultiplier - 1) * reliability));
    const ratios = subset.map((item) => Math.abs(item.actual - item.predicted * pointMultiplier) / item.baseSpread);
    const uncertaintyMultiplier = Math.max(0.75, Math.min(2, quantile(ratios, 0.68)));
    const calibrated = subset.map((item) => ({
      ...item,
      predicted: item.predicted * pointMultiplier,
      floor: Math.max(0, item.predicted * pointMultiplier - item.baseSpread * uncertaintyMultiplier),
      ceiling: item.predicted * pointMultiplier + item.baseSpread * uncertaintyMultiplier,
    }));
    calibratedObservations.push(...calibrated);
    positions[position] = {
      points_multiplier: Math.round(pointMultiplier * 1000) / 1000,
      uncertainty_multiplier: Math.round(uncertaintyMultiplier * 1000) / 1000,
      samples: subset.length,
      metrics: metrics(subset),
      calibrated_metrics: metrics(calibrated),
    };
  }
  return {
    version: 1,
    scoring_fingerprint: scoringFingerprint(input.scoring),
    created_at: new Date(input.now ?? Date.now()).toISOString(),
    evaluation_seasons: input.evaluationSeasons,
    overall: metrics(observations),
    calibrated_overall: metrics(calibratedObservations),
    positions,
  };
}

export function applyProjectionCalibration(
  scored: ScoredProjection,
  position: string,
  calibration: ProjectionCalibration | null,
): ScoredProjection {
  const positionCalibration = calibration?.positions[position];
  if (!positionCalibration || positionCalibration.samples < 20) return scored;
  const median = scored.median * positionCalibration.points_multiplier;
  const lowerSpread = (scored.median - scored.floor) * positionCalibration.uncertainty_multiplier;
  const upperSpread = (scored.ceiling - scored.median) * positionCalibration.uncertainty_multiplier;
  return {
    ...scored,
    median: Math.round(median * 10) / 10,
    floor: Math.round(Math.max(0, median - lowerSpread) * 10) / 10,
    ceiling: Math.round(Math.max(0, median + upperSpread) * 10) / 10,
  };
}

export class ProjectionCalibrationProvider {
  constructor(private readonly dataDirectory = defaultDataDirectory()) {}

  private filePath(fingerprint: string): string {
    return join(this.dataDirectory, "calibration", `${fingerprint}.json`);
  }

  async get(scoring: Record<string, number>): Promise<ProjectionCalibration | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(scoringFingerprint(scoring)), "utf8")) as ProjectionCalibration;
    } catch {
      return null;
    }
  }

  async save(calibration: ProjectionCalibration): Promise<void> {
    const directory = join(this.dataDirectory, "calibration");
    await fs.mkdir(directory, { recursive: true });
    const path = this.filePath(calibration.scoring_fingerprint);
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(calibration, null, 2), "utf8");
    await fs.rename(temporary, path);
  }
}

export class NflverseBacktestDataProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async loadSeasons(seasons: number[], timeoutMs: number): Promise<Map<number, Array<Record<string, string>>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const contents = await Promise.all(seasons.map(async (season) => {
        const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`;
        const response = await this.fetchImpl(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`nflverse ${season}: HTTP ${response.status}`);
        return [season, parseSeasonCsv(await response.text())] as const;
      }));
      return new Map(contents);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const calibrationProvider = new ProjectionCalibrationProvider();
export const backtestDataProvider = new NflverseBacktestDataProvider();

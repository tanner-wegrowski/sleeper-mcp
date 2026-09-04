import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyProjectionCalibration,
  ProjectionCalibrationProvider,
  runProjectionBacktest,
  scoringFingerprint,
} from "../dist/projection-backtest.js";

const scoring = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

function row(season, index, position) {
  const usage = 1 + index / 20 + (season - 2020) * 0.04;
  return {
    season: String(season),
    player_display_name: `${position} Player ${index}`,
    position,
    games: "16",
    passing_yards: position === "QB" ? String(3200 * usage) : "0",
    passing_tds: position === "QB" ? String(20 * usage) : "0",
    passing_interceptions: position === "QB" ? "10" : "0",
    carries: position === "RB" ? String(180 * usage) : position === "QB" ? "40" : "0",
    rushing_yards: position === "RB" ? String(760 * usage) : position === "QB" ? "180" : "0",
    rushing_tds: position === "RB" ? String(6 * usage) : position === "QB" ? "2" : "0",
    receptions: position === "WR" ? String(65 * usage) : position === "TE" ? String(50 * usage) : position === "RB" ? "30" : "0",
    receiving_yards: position === "WR" ? String(850 * usage) : position === "TE" ? String(600 * usage) : position === "RB" ? "220" : "0",
    receiving_tds: position === "WR" ? String(6 * usage) : position === "TE" ? String(5 * usage) : position === "RB" ? "1" : "0",
    fumbles_lost_total: "1",
  };
}

function seasonRows(season) {
  return ["QB", "RB", "WR", "TE"].flatMap((position) =>
    Array.from({ length: 8 }, (_, index) => row(season, index, position)),
  );
}

test("walk-forward backtest reports metrics and position calibration", () => {
  const rowsBySeason = new Map(
    [2020, 2021, 2022, 2023, 2024].map((season) => [season, seasonRows(season)]),
  );
  const result = runProjectionBacktest({
    rowsBySeason,
    evaluationSeasons: [2023, 2024],
    scoring,
    now: Date.UTC(2026, 0, 1),
  });
  assert.equal(result.overall.samples, 64);
  assert.ok(result.overall.mae > 0);
  assert.ok(result.overall.correlation > 0.9);
  assert.ok(result.calibrated_overall.mae <= result.overall.mae);
  assert.deepEqual(Object.keys(result.positions), ["QB", "RB", "WR", "TE"]);
  assert.equal(result.positions.WR.samples, 16);
  assert.equal(result.created_at, "2026-01-01T00:00:00.000Z");
});

test("scoring fingerprints are stable across object key order", () => {
  assert.equal(
    scoringFingerprint({ rec: 1, pass_td: 4, pass_yd: 0.04 }),
    scoringFingerprint({ pass_yd: 0.04, rec: 1, pass_td: 4 }),
  );
});

test("calibration adjusts points and uncertainty only with enough evidence", () => {
  const scored = { median: 100, floor: 80, ceiling: 130, confidence: 0.7, unsupported_scoring_keys: [] };
  const calibration = {
    version: 1,
    scoring_fingerprint: "test",
    created_at: "2026-01-01T00:00:00.000Z",
    evaluation_seasons: [2023, 2024],
    overall: { samples: 25, mae: 10, rmse: 12, bias: 0, correlation: 0.8, interval_coverage: 0.68 },
    calibrated_overall: { samples: 25, mae: 9, rmse: 11, bias: 0, correlation: 0.8, interval_coverage: 0.68 },
    positions: {
      WR: {
        points_multiplier: 1.1,
        uncertainty_multiplier: 1.5,
        samples: 25,
        metrics: { samples: 25, mae: 10, rmse: 12, bias: 0, correlation: 0.8, interval_coverage: 0.68 },
        calibrated_metrics: { samples: 25, mae: 9, rmse: 11, bias: 0, correlation: 0.8, interval_coverage: 0.68 },
      },
    },
  };
  assert.deepEqual(applyProjectionCalibration(scored, "WR", calibration), {
    ...scored,
    median: 110,
    floor: 80,
    ceiling: 155,
  });
  calibration.positions.WR.samples = 19;
  assert.equal(applyProjectionCalibration(scored, "WR", calibration), scored);
});

test("calibration provider persists by league scoring fingerprint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sleeper-calibration-"));
  try {
    const provider = new ProjectionCalibrationProvider(directory);
    assert.equal(await provider.get(scoring), null);
    const calibration = runProjectionBacktest({
      rowsBySeason: new Map([2020, 2021, 2022, 2023].map((season) => [season, seasonRows(season)])),
      evaluationSeasons: [2023],
      scoring,
    });
    await provider.save(calibration);
    assert.deepEqual(await provider.get(scoring), calibration);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

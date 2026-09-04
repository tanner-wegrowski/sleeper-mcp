import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHistoricalProjections,
  enrichProjectionsWithRolesAndRookies,
  NflverseProjectionProvider,
} from "../dist/nflverse-projections.js";
import { scoreHistoricalProjection } from "../dist/projection-scoring.js";

const row = (season, games, overrides = {}) => ({
  player_display_name: "Example Runner",
  player_name: "E.Runner",
  position: "RB",
  season: String(season),
  games: String(games),
  carries: "200",
  rushing_yards: "1000",
  rushing_tds: "10",
  receptions: "40",
  receiving_yards: "300",
  receiving_tds: "2",
  fumbles_lost_total: "1",
  ...overrides,
});

test("historical model weights recent per-game production and reports uncertainty", () => {
  const projections = buildHistoricalProjections([
    { season: 2025, rows: [row(2025, 10)] },
    { season: 2024, rows: [row(2024, 17, { rushing_yards: "850" })] },
    { season: 2023, rows: [row(2023, 16, { rushing_yards: "640" })] },
  ]);
  assert.equal(projections.length, 1);
  assert.deepEqual(projections[0].seasons_used, [2025, 2024, 2023]);
  assert.ok(projections[0].stats.rushing_yards > 850);
  assert.ok(projections[0].projected_games <= 17);
  assert.ok(projections[0].confidence > 0.5);
  assert.ok(projections[0].uncertainty >= 0.32);
});

test("projection scoring applies the league's linear Sleeper settings", () => {
  const projection = buildHistoricalProjections([{ season: 2025, rows: [row(2025, 17)] }])[0];
  const scored = scoreHistoricalProjection(projection, {
    rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2,
    bonus_rush_yd_100: 3,
  });
  assert.ok(scored.median > 200);
  assert.ok(scored.floor < scored.median);
  assert.ok(scored.ceiling > scored.median);
  assert.ok(scored.unsupported_scoring_keys.includes("bonus_rush_yd_100"));
});

test("depth charts bound veteran roles and draft capital creates rookie priors", () => {
  const veteran = buildHistoricalProjections([{ season: 2025, rows: [row(2025, 17)] }])[0];
  const enriched = enrichProjectionsWithRolesAndRookies({
    projections: [veteran],
    depthRows: [
      { dt: "2026-08-01T00:00:00Z", player_name: "Example Runner", pos_abb: "RB", pos_rank: "2" },
      { dt: "2026-08-01T00:00:00Z", player_name: "Rookie Star", pos_abb: "WR", pos_rank: "1" },
    ],
    draftRows: [
      { season: "2026", round: "1", pick: "12", pfr_player_name: "Rookie Star", position: "WR" },
    ],
    combineRows: [
      { season: "2026", player_name: "Rookie Star", pos: "WR", forty: "4.40", vertical: "38" },
    ],
    targetSeason: 2026,
  });
  const adjustedVeteran = enriched.find((projection) => projection.name === "Example Runner");
  const rookie = enriched.find((projection) => projection.name === "Rookie Star");
  assert.equal(adjustedVeteran.role.multiplier, 0.82);
  assert.ok(adjustedVeteran.stats.rushing_yards < veteran.stats.rushing_yards);
  assert.equal(rookie.model_type, "rookie_prior");
  assert.equal(rookie.rookie.draft_pick, 12);
  assert.ok(rookie.stats.receiving_yards > 700);
  assert.ok(rookie.uncertainty > adjustedVeteran.uncertainty);
});

test("nflverse provider prepares and reuses a projection cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sleeper-projections-"));
  const headers = ["player_display_name", "player_name", "position", "season", "games", "carries", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds", "fumbles_lost_total"];
  let calls = 0;
  const provider = new NflverseProjectionProvider(directory, async (url) => {
    calls += 1;
    const season = Number(url.match(/_(\d{4})\.csv$/)[1]);
    const record = row(season, 17);
    const csv = `${headers.join(",")}\n${headers.map((header) => record[header] ?? "0").join(",")}`;
    return { ok: true, status: 200, statusText: "OK", text: async () => csv };
  }, () => Date.parse("2026-08-01T12:00:00Z"));
  try {
    const first = await provider.getProjections({ targetSeason: 2026, allowNetwork: true });
    const second = await provider.getProjections({ targetSeason: 2026, allowNetwork: false });
    assert.equal(first.cache_status, "refreshed");
    assert.equal(second.cache_status, "fresh");
    assert.equal(second.projections.length, 1);
    assert.equal(calls, 6);
    assert.equal(first.warnings.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

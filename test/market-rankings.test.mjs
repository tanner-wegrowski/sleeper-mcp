import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FantasyFootballCalculatorProvider,
  nearestFfcTeamCount,
  selectFfcFormat,
} from "../dist/market-rankings.js";

const payload = {
  players: [
    { player_id: 1, name: "Runner One", position: "RB", team: "DEN", adp: 12.4, stdev: 3.2, times_drafted: 800 },
    { player_id: 2, name: "Receiver Two", position: "WR", team: "SEA", adp: 15.1, stdev: 4.4, times_drafted: 750 },
  ],
};

test("FFC format follows scoring and superflex settings", () => {
  assert.equal(selectFfcFormat({ rec: 1 }), "ppr");
  assert.equal(selectFfcFormat({ rec: 0.5 }), "half-ppr");
  assert.equal(selectFfcFormat({ rec: 0 }), "standard");
  assert.equal(selectFfcFormat({ rec: 1 }, 1), "2qb");
  assert.equal(nearestFfcTeamCount(11), 10);
  assert.equal(nearestFfcTeamCount(13), 12);
});

test("FFC provider refreshes once and then serves the daily cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sleeper-market-"));
  let calls = 0;
  const provider = new FantasyFootballCalculatorProvider(directory, async () => {
    calls += 1;
    return { ok: true, status: 200, statusText: "OK", json: async () => payload };
  }, () => Date.parse("2026-09-04T12:00:00Z"));
  try {
    const first = await provider.getRankings({ format: "ppr", teams: 12, year: 2026 });
    const second = await provider.getRankings({ format: "ppr", teams: 12, year: 2026 });
    assert.equal(first.cache_status, "refreshed");
    assert.equal(second.cache_status, "fresh");
    assert.equal(calls, 1);
    assert.equal(second.rankings[0].rank, 12.4);
    assert.equal(second.rankings[0].adp_stdev, 3.2);
    assert.equal(second.rankings[0].source, "ffc_adp");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("FFC provider returns stale data when refresh fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sleeper-market-"));
  let now = Date.parse("2026-09-01T12:00:00Z");
  const provider = new FantasyFootballCalculatorProvider(directory, async () => {
    if (now > Date.parse("2026-09-02T12:00:00Z")) throw new Error("offline");
    return { ok: true, status: 200, statusText: "OK", json: async () => payload };
  }, () => now);
  try {
    await provider.getRankings({ format: "ppr", teams: 12, year: 2026 });
    now = Date.parse("2026-09-04T12:00:00Z");
    const result = await provider.getRankings({ format: "ppr", teams: 12, year: 2026 });
    assert.equal(result.cache_status, "stale");
    assert.equal(result.rankings.length, 2);
    assert.match(result.error, /offline/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

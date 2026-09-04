import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileRankingProvider,
  mergeRankings,
  parseRankings,
} from "../dist/rankings.js";

test("JSON imports accept arrays and wrapped ranking documents", () => {
  assert.equal(
    parseRankings('[{"player_id":"p1","rank":1}]', "json")[0].player_id,
    "p1",
  );
  assert.equal(
    parseRankings('{"rankings":[{"name":"Player Two","rank":2}]}', "json")[0].name,
    "Player Two",
  );
});

test("CSV imports support aliases, quoted commas, and numeric projections", () => {
  const rankings = parseRankings(
    'rank,player_name,player_id,tier,projected_points,notes\r\n1,"Doe, John",p1,A,301.5,"Safe, elite pick"',
    "csv",
  );
  assert.deepEqual(rankings[0], {
    player_id: "p1",
    name: "Doe, John",
    rank: 1,
    tier: "A",
    projected_points: 301.5,
    notes: "Safe, elite pick",
  });
});

test("invalid rankings fail validation", () => {
  assert.throws(
    () => parseRankings('[{"name":"Missing Rank"}]', "json"),
    /rank/i,
  );
  assert.throws(
    () => parseRankings('rank,name\n1,', "csv"),
    /player_id|name/i,
  );
});

test("merge replaces matching entries and preserves rank order", () => {
  const merged = mergeRankings(
    [
      { player_id: "p1", rank: 1, notes: "old" },
      { name: "Player Two", rank: 2 },
    ],
    [
      { player_id: "p1", rank: 3, notes: "new" },
      { player_id: "p3", rank: 1 },
    ],
  );
  assert.deepEqual(merged.map((ranking) => ranking.rank), [1, 2, 3]);
  assert.equal(merged.find((ranking) => ranking.player_id === "p1").notes, "new");
});

test("file provider persists and replaces a draft ranking set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sleeper-rankings-"));
  const provider = new FileRankingProvider(directory);
  try {
    const first = await provider.saveRankings("draft-123", [
      { player_id: "p1", rank: 1 },
    ]);
    assert.equal(first.rankings.length, 1);
    assert.deepEqual(await provider.getRankings("draft-123"), first.rankings);
    assert.equal((await provider.getInfo("draft-123")).count, 1);

    await provider.saveRankings("draft-123", [{ player_id: "p2", rank: 2 }]);
    assert.equal((await provider.getRankings("draft-123"))[0].player_id, "p2");
    assert.deepEqual(await provider.getRankings("missing-draft"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file provider rejects unsafe draft IDs", async () => {
  const provider = new FileRankingProvider(tmpdir());
  await assert.rejects(
    () => provider.saveRankings("../outside", [{ player_id: "p1", rank: 1 }]),
    /draft_id/,
  );
});

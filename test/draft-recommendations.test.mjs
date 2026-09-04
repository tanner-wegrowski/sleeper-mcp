import test from "node:test";
import assert from "node:assert/strict";
import {
  getStarterTargets,
  rankDraftCandidates,
} from "../dist/draft-recommendations.js";

const player = (id, name, position, searchRank) => ({
  player_id: id,
  first_name: name.split(" ")[0],
  last_name: name.split(" ").slice(1).join(" "),
  full_name: name,
  display_position: position,
  position,
  team: "TEST",
  status: "Active",
  fantasy_positions: [position],
  search_full_name: name.toLowerCase().replaceAll(" ", ""),
  search_rank: searchRank,
});

test("personal rankings override Sleeper fallback rank", () => {
  const players = [
    player("rb1", "Runner One", "RB", 30),
    player("wr1", "Receiver One", "WR", 2),
    player("rb2", "Runner Two", "RB", 50),
  ];
  const result = rankDraftCandidates(
    players,
    [{ player_id: "wr1", rank: 1, tier: "A" }],
    {},
    { RB: 1, WR: 1 },
    0,
    "balanced",
    3,
  );
  assert.equal(result[0].player.player_id, "wr1");
  assert.equal(result[0].rank_source, "custom");
  assert.equal(result[0].tier, "A");
  assert.equal(result[1].rank_source, "sleeper_search_rank");
});

test("needs-based strategy favors an open starter slot", () => {
  const players = [
    player("qb1", "Quarterback One", "QB", 1),
    player("rb1", "Runner One", "RB", 5),
  ];
  const result = rankDraftCandidates(
    players,
    [],
    { QB: 1 },
    { QB: 1, RB: 1 },
    0,
    "needs_based",
    2,
  );
  assert.equal(result[0].player.player_id, "rb1");
  assert.equal(result[0].score_components.roster_need, 100);
});

test("personal rankings can match normalized player names", () => {
  const result = rankDraftCandidates(
    [player("wr1", "Amon-Ra St. Brown", "WR", 25)],
    [{ name: "Amon Ra St Brown", rank: 3, notes: "My guy" }],
    {},
    { WR: 1 },
    0,
    "balanced",
    1,
  );
  assert.equal(result[0].rank, 3);
  assert.equal(result[0].notes, "My guy");
});

test("starter targets are derived from Sleeper draft settings", () => {
  assert.deepEqual(
    getStarterTargets({ slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_flex: 2 }),
    {
      starterTargets: { QB: 1, RB: 2, WR: 3, TE: 0, K: 0, DEF: 0 },
      flexSlots: 2,
    },
  );
});

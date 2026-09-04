import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftRoomModel } from "../dist/draft-room-model.js";

const draft = {
  draft_id: "draft",
  league_id: "league",
  type: "snake",
  status: "drafting",
  start_time: 0,
  sport: "nfl",
  settings: { teams: 4, rounds: 4, pick_timer: 120 },
  season: "2026",
  season_type: "regular",
  slot_to_roster_id: { "1": 1, "2": 2, "3": 3, "4": 4 },
  created: 0,
};

const player = (id, name, position) => ({
  player_id: id,
  first_name: name,
  last_name: "Player",
  full_name: `${name} Player`,
  display_position: position,
  position,
  team: "TEST",
  status: "Active",
  fantasy_positions: [position],
  search_full_name: `${name.toLowerCase()}player`,
});

test("room model emphasizes positions needed by managers picking before the user", () => {
  const players = [
    player("rb", "User", "RB"),
    player("q2", "Two", "QB"),
    player("q3", "Three", "QB"),
    player("q4", "Four", "QB"),
  ];
  const picks = players.map((item, index) => ({
    player_id: item.player_id,
    picked_by: `u${index + 1}`,
    roster_id: String(index + 1),
    round: 1,
    draft_slot: index + 1,
    pick_no: index + 1,
    draft_id: "draft",
  }));
  const model = buildDraftRoomModel({
    draft,
    tradedPicks: [],
    picks,
    playerById: new Map(players.map((item) => [item.player_id, item])),
    marketRankings: players.map((item, index) => ({ name: item.full_name, rank: index + 1, source: "ffc_adp" })),
    starterTargets: { QB: 1, RB: 1, WR: 1, TE: 1 },
    currentPickNo: 5,
    nextUserPickNo: 8,
    userRosterId: 1,
  });
  assert.deepEqual(model.upcoming_roster_ids, [4, 3, 2]);
  assert.equal(model.upcoming_opponent_picks, 3);
  assert.ok(model.position_pressure.RB > model.position_pressure.QB);
  assert.ok(model.manager_profiles.find((profile) => profile.roster_id === 2).open_starter_positions.RB > 0);
});

test("room model measures recent position runs and manager reaches", () => {
  const players = [player("w1", "One", "WR"), player("w2", "Two", "WR")];
  const picks = players.map((item, index) => ({
    player_id: item.player_id, picked_by: `u${index + 1}`, roster_id: String(index + 1),
    round: 1, draft_slot: index + 1, pick_no: index + 1, draft_id: "draft",
  }));
  const model = buildDraftRoomModel({
    draft, tradedPicks: [], picks,
    playerById: new Map(players.map((item) => [item.player_id, item])),
    marketRankings: [{ name: "One Player", rank: 8 }, { name: "Two Player", rank: 12 }],
    starterTargets: { QB: 1, RB: 1, WR: 1, TE: 1 },
    currentPickNo: 3, nextUserPickNo: 8, userRosterId: 1,
  });
  assert.equal(model.recent_position_run.WR, 1);
  assert.ok(model.manager_profiles.find((profile) => profile.roster_id === 2).average_reach > 0);
});

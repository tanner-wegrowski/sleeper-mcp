import test from "node:test";
import assert from "node:assert/strict";
import { handleToolCall } from "../dist/handlers.js";
import { sleeperClient } from "../dist/sleeper-client.js";
import { tools } from "../dist/tools.js";

test("draft tools are registered", () => {
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of [
    "get_league_drafts",
    "get_draft",
    "get_draft_picks",
    "get_live_draft_board",
    "get_draft_recommendations",
    "prepare_draft_data",
    "import_draft_rankings",
    "get_saved_draft_rankings",
  ]) {
    assert.equal(names.has(name), true, `${name} should be registered`);
  }
});

test("live draft board aggregates picks, ownership, managers, and next pick", async () => {
  const originalMethods = new Map();
  const mock = (name, implementation) => {
    originalMethods.set(name, sleeperClient[name]);
    sleeperClient[name] = implementation;
  };

  mock("getDraft", async () => ({
    draft_id: "draft-1",
    league_id: "league-1",
    type: "snake",
    status: "drafting",
    start_time: 0,
    sport: "nfl",
    settings: { teams: 2, rounds: 3, pick_timer: 120 },
    season: "2026",
    season_type: "regular",
    slot_to_roster_id: { "1": 10, "2": 20 },
    created: 0,
  }));
  mock("getDraftPicks", async () => [
    { player_id: "p1", picked_by: "u1", roster_id: "10", round: 1, draft_slot: 1, pick_no: 1, draft_id: "draft-1" },
    { player_id: "p2", picked_by: "u2", roster_id: "20", round: 1, draft_slot: 2, pick_no: 2, draft_id: "draft-1" },
  ]);
  mock("getDraftTradedPicks", async () => [
    { season: "2026", round: 2, roster_id: 20, previous_owner_id: 20, owner_id: 10 },
  ]);
  mock("getLeagueRosters", async () => [
    { roster_id: 10, owner_id: "u1" },
    { roster_id: 20, owner_id: "u2" },
  ]);
  mock("getLeagueUsers", async () => [
    { user_id: "u1", username: "alice", display_name: "Alice", avatar: null },
    { user_id: "u2", username: "bob", display_name: "Bob", avatar: null },
  ]);
  mock("getPlayersWithDetails", async () => [
    { player_id: "p1", position: "RB", full_name: "Runner One" },
    { player_id: "p2", position: "WR", full_name: "Receiver Two" },
  ]);
  mock("getAvailableDraftPlayers", async () => [
    { player_id: "p3", position: "QB", full_name: "Quarterback Three" },
  ]);

  try {
    const result = await handleToolCall("get_live_draft_board", {
      draft_id: "draft-1",
      user_id: "u2",
      available_limit: 10,
    });
    assert.equal(result.success, true);
    assert.equal(result.progress.current_pick_no, 3);
    assert.equal(result.on_clock.owner_roster_id, 10);
    assert.equal(result.on_clock.manager.display_name, "Alice");
    assert.equal(result.next_user_pick.pick_no, 6);
    assert.equal(result.available_players[0].player_id, "p3");
    assert.deepEqual(result.teams[0].position_counts, { RB: 1 });
  } finally {
    for (const [name, implementation] of originalMethods) {
      sleeperClient[name] = implementation;
    }
  }
});

test("draft recommendations combine live roster state with personal rankings", async () => {
  const originalMethods = new Map();
  const mock = (name, implementation) => {
    originalMethods.set(name, sleeperClient[name]);
    sleeperClient[name] = implementation;
  };
  const activePlayer = (id, name, position, searchRank) => ({
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
    search_rank: searchRank,
  });

  mock("getDraft", async () => ({
    draft_id: "draft-1",
    league_id: "league-1",
    type: "snake",
    status: "drafting",
    start_time: 0,
    sport: "nfl",
    settings: { teams: 2, rounds: 3, pick_timer: 120, slots_qb: 1, slots_rb: 1 },
    season: "2026",
    season_type: "regular",
    slot_to_roster_id: { "1": 10, "2": 20 },
    created: 0,
  }));
  mock("getDraftPicks", async () => [
    { player_id: "owned-qb", picked_by: "u1", roster_id: "10", round: 1, draft_slot: 1, pick_no: 1, draft_id: "draft-1" },
  ]);
  mock("getDraftTradedPicks", async () => []);
  mock("getLeague", async () => ({
    league_id: "league-1",
    name: "Test League",
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB"],
  }));
  mock("getLeagueRosters", async () => [
    { roster_id: 10, owner_id: "u1" },
    { roster_id: 20, owner_id: "u2" },
  ]);
  mock("getPlayersWithDetails", async () => [
    activePlayer("owned-qb", "Owned", "QB", 10),
  ]);
  mock("getAvailableDraftPlayers", async () => [
    activePlayer("qb2", "Top", "QB", 1),
    activePlayer("rb1", "Needed", "RB", 5),
  ]);

  try {
    const result = await handleToolCall("get_draft_recommendations", {
      draft_id: "draft-1",
      user_id: "u1",
      strategy: "needs_based",
      use_saved_rankings: false,
      use_free_adp: false,
      rankings: [
        { player_id: "qb2", rank: 1 },
        { player_id: "rb1", rank: 5, notes: "Fill RB" },
      ],
    });
    assert.equal(result.success, true);
    assert.equal(result.recommendations[0].player.player_id, "rb1");
    assert.equal(result.recommendations[0].notes, "Fill RB");
    assert.equal(result.roster_construction.position_counts.QB, 1);
    assert.equal(result.next_pick.pick_no, 4);
    assert.equal(result.following_pick.pick_no, 5);
    assert.equal(result.on_user_clock, false);
    assert.ok(result.performance.calculation_ms < 250);
    assert.equal(result.league_context.scoring_settings.rec, 1);
    assert.equal(result.draft_room.upcoming_opponent_picks, 2);
    assert.deepEqual(result.draft_room.upcoming_roster_ids, [20, 20]);
    assert.equal(result.performance.simulation_rollouts, 0);
  } finally {
    for (const [name, implementation] of originalMethods) {
      sleeperClient[name] = implementation;
    }
  }
});

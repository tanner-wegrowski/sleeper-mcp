import test from "node:test";
import assert from "node:assert/strict";
import { buildHistoricalManagerPriors } from "../dist/manager-history.js";

const draft = (id, season) => ({
  draft_id: id, league_id: `league-${season}`, type: "snake", status: "complete",
  start_time: 0, sport: "nfl", season: String(season), season_type: "regular", created: 0,
  settings: { teams: 10, rounds: 12, pick_timer: 120, slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1 },
});

const pick = (draftId, roster, owner, position, round, pickNo, name) => ({
  player_id: `${draftId}-${pickNo}`, picked_by: owner, roster_id: String(roster), round,
  draft_slot: roster, pick_no: pickNo, draft_id: draftId,
  metadata: { position, first_name: name, last_name: "Player" },
});

test("historical manager priors follow owners across changed roster IDs", () => {
  const priors = buildHistoricalManagerPriors({
    currentRosters: [{ roster_id: 9, owner_id: "user-a" }, { roster_id: 10, owner_id: "user-b" }],
    seasons: [{
      season: 2025, seasons_ago: 1,
      rosters: [{ roster_id: 2, owner_id: "user-a" }, { roster_id: 3, owner_id: "user-b" }],
      drafts: [{ draft: draft("old", 2025), picks: [
        pick("old", 2, "user-a", "RB", 1, 1, "Alpha"),
        pick("old", 2, "user-a", "RB", 2, 12, "Beta"),
        pick("old", 2, "user-a", "WR", 4, 33, "Gamma"),
        pick("old", 3, "user-b", "QB", 1, 4, "Delta"),
      ] }],
    }],
  });
  assert.equal(priors[9].picks_observed, 3);
  assert.equal(priors[9].drafts_observed, 1);
  assert.equal(priors[9].seasons_observed, 1);
  assert.equal(priors[9].position_preference.RB, 2 / 3);
  assert.equal(priors[9].round_position_preference.early.RB, 1);
  assert.equal(priors[9].round_position_preference.middle.WR, 1);
  assert.equal(priors[10].position_preference.QB, 1);
});

test("recent seasons outweigh older behavior and ADP reaches are measured", () => {
  const recentPicks = [
    pick("recent", 2, "user-a", "WR", 1, 1, "Reach"),
    pick("recent", 2, "user-a", "WR", 2, 12, "Value"),
  ];
  const oldPicks = [
    pick("old", 5, "user-a", "RB", 1, 1, "Oldone"),
    pick("old", 5, "user-a", "RB", 2, 12, "Oldtwo"),
  ];
  const priors = buildHistoricalManagerPriors({
    currentRosters: [{ roster_id: 9, owner_id: "user-a" }],
    seasons: [
      {
        season: 2025, seasons_ago: 1, rosters: [{ roster_id: 2, owner_id: "user-a" }],
        drafts: [{ draft: draft("recent", 2025), picks: recentPicks }],
        market_rankings: [{ name: "Reach Player", rank: 20, source: "ffc_adp" }, { name: "Value Player", rank: 10, source: "ffc_adp" }],
      },
      {
        season: 2023, seasons_ago: 3, rosters: [{ roster_id: 5, owner_id: "user-a" }],
        drafts: [{ draft: draft("old", 2023), picks: oldPicks }],
      },
    ],
  });
  assert.ok(priors[9].round_position_preference.early.WR > priors[9].round_position_preference.early.RB);
  assert.equal(priors[9].ranked_picks_observed, 2);
  assert.equal(priors[9].average_reach, 8.5);
  assert.ok(priors[9].reach_stdev > 0);
  assert.equal(priors[9].seasons_observed, 2);
  assert.ok(priors[9].effective_picks < priors[9].picks_observed);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildHistoricalManagerPriors } from "../dist/manager-history.js";

test("historical manager priors follow owners across changed roster IDs", () => {
  const pick = (roster, position, pickNo) => ({
    player_id: `p${pickNo}`, picked_by: "user", roster_id: String(roster), round: 1,
    draft_slot: roster, pick_no: pickNo, draft_id: "old", metadata: { position },
  });
  const priors = buildHistoricalManagerPriors({
    currentRosters: [{ roster_id: 9, owner_id: "user-a" }, { roster_id: 10, owner_id: "user-b" }],
    historicalRosters: [{ roster_id: 2, owner_id: "user-a" }, { roster_id: 3, owner_id: "user-b" }],
    drafts: [{ picks: [pick(2, "RB", 1), pick(2, "RB", 2), pick(2, "WR", 3), pick(3, "QB", 4)] }],
  });
  assert.equal(priors[9].picks_observed, 3);
  assert.equal(priors[9].drafts_observed, 1);
  assert.equal(priors[9].position_preference.RB, 2 / 3);
  assert.equal(priors[10].position_preference.QB, 1);
});

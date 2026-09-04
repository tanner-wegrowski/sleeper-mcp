import test from "node:test";
import assert from "node:assert/strict";
import {
  findNextPickForRoster,
  getDraftSlot,
  getPickLocation,
} from "../dist/draft-analysis.js";

const draft = {
  draft_id: "draft-1",
  league_id: "league-1",
  type: "snake",
  status: "drafting",
  start_time: 0,
  sport: "nfl",
  settings: { teams: 4, rounds: 3, pick_timer: 120 },
  season: "2026",
  season_type: "regular",
  slot_to_roster_id: { "1": 10, "2": 20, "3": 30, "4": 40 },
  created: 0,
};

test("snake drafts reverse slot order in even rounds", () => {
  assert.deepEqual(getDraftSlot(1, 4, "snake"), { round: 1, draftSlot: 1 });
  assert.deepEqual(getDraftSlot(4, 4, "snake"), { round: 1, draftSlot: 4 });
  assert.deepEqual(getDraftSlot(5, 4, "snake"), { round: 2, draftSlot: 4 });
  assert.deepEqual(getDraftSlot(8, 4, "snake"), { round: 2, draftSlot: 1 });
});

test("linear drafts keep the same slot order", () => {
  assert.deepEqual(getDraftSlot(5, 4, "linear"), { round: 2, draftSlot: 1 });
});

test("pick location applies traded-pick ownership", () => {
  const tradedPicks = [
    {
      season: "2026",
      round: 2,
      roster_id: 40,
      previous_owner_id: 40,
      owner_id: 20,
    },
  ];
  assert.deepEqual(getPickLocation(draft, tradedPicks, 5), {
    pick_no: 5,
    round: 2,
    draft_slot: 4,
    original_roster_id: 40,
    owner_roster_id: 20,
  });
});

test("next-pick search respects snake order and traded picks", () => {
  const tradedPicks = [
    {
      season: "2026",
      round: 2,
      roster_id: 40,
      previous_owner_id: 40,
      owner_id: 20,
    },
  ];
  assert.equal(findNextPickForRoster(draft, tradedPicks, 4, 20)?.pick_no, 5);
  assert.equal(findNextPickForRoster(draft, tradedPicks, 8, 40)?.pick_no, 12);
  assert.equal(findNextPickForRoster(draft, tradedPicks, 12, 20), null);
});

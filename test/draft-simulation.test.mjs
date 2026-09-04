import test from "node:test";
import assert from "node:assert/strict";
import { simulateToNextPick } from "../dist/draft-simulation.js";

const candidate = (id, position, rank, score, deviation = 3) => ({
  player: { player_id: id, full_name: `${id} Player`, position },
  overall_score: score,
  rank,
  rank_source: "ffc_adp",
  adp_stdev: deviation,
  probability_available_next_pick: 0.5,
  replacement_player: null,
  score_components: { market_value: score, roster_fit: 50, value_over_replacement: 50, urgency: 50, health_multiplier: 1 },
  reasons: [],
});

const room = {
  upcoming_opponent_picks: 2,
  upcoming_roster_ids: [2, 3],
  position_pressure: { QB: 0.1, RB: 0.6, WR: 0.2, TE: 0.1 },
  recent_position_run: { QB: 0, RB: 1, WR: 0, TE: 0 },
  average_upcoming_manager_reach: 0,
  manager_profiles: [2, 3].map((rosterId) => ({
    roster_id: rosterId,
    picks_made: 1,
    upcoming_picks_before_user: 1,
    position_counts: { QB: 1 },
    open_starter_positions: { QB: 0, RB: 1, WR: 1, TE: 1 },
    position_preference: { QB: 0.1, RB: 0.6, WR: 0.2, TE: 0.1 },
    average_reach: 0,
    ranked_picks_observed: 1,
  })),
};

test("simulation compares current choices through the next user pick", () => {
  const result = simulateToNextPick({
    candidates: [
      candidate("rb-a", "RB", 1, 90), candidate("wr-a", "WR", 2, 88),
      candidate("rb-b", "RB", 3, 80), candidate("wr-b", "WR", 4, 78),
      candidate("te-a", "TE", 5, 70), candidate("qb-a", "QB", 6, 68),
      candidate("rb-c", "RB", 7, 65), candidate("wr-c", "WR", 8, 63),
    ],
    room,
    draftedCounts: { QB: 1 },
    starterTargets: { QB: 1, RB: 1, WR: 1, TE: 1 },
    flexSlots: 1,
    limit: 5,
    timeBudgetMs: 10000,
    maxRollouts: 300,
    seed: 42,
  });
  assert.equal(result.rollouts, 300);
  assert.equal(result.recommendations[0].player.player_id, "rb-a");
  assert.equal(result.recommendations[0].simulation.draft_equity_score, 100);
  assert.ok(result.recommendations[0].simulation.common_next_targets.length > 0);
  assert.equal(result.confidence, "low");
});

test("zero simulation budget returns the deterministic fallback", () => {
  const candidates = [candidate("a", "RB", 1, 90)];
  const result = simulateToNextPick({
    candidates, room, draftedCounts: {}, starterTargets: { RB: 1 }, flexSlots: 0,
    limit: 1, timeBudgetMs: 0, seed: 1,
  });
  assert.equal(result.rollouts, 0);
  assert.equal(result.confidence, "none");
  assert.equal(result.recommendations[0].simulation, undefined);
});

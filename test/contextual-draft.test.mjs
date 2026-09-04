import test from "node:test";
import assert from "node:assert/strict";
import { rankContextualDraftCandidates } from "../dist/contextual-draft.js";

const player = (id, position, rank, status = "Active") => ({
  player_id: id,
  first_name: id,
  last_name: "Player",
  full_name: `${id} Player`,
  display_position: position,
  position,
  team: "TEST",
  status,
  fantasy_positions: [position],
  search_full_name: `${id}player`,
  search_rank: rank,
});

const options = {
  currentPickNo: 20,
  nextPickNo: 41,
  teams: 10,
  draftedCounts: { RB: 1 },
  leagueDraftedCounts: { RB: 8, WR: 7 },
  starterTargets: { QB: 1, RB: 2, WR: 2, TE: 1 },
  flexSlots: 1,
  superFlexSlots: 0,
  strategy: "balanced",
  limit: 10,
  timeBudgetMs: 100,
};

test("contextual recommendations use projected points in replacement value", () => {
  const players = [player("rb1", "RB", 20), player("rb2", "RB", 21), player("rb3", "RB", 22)];
  const result = rankContextualDraftCandidates(players, [
    { player_id: "rb1", rank: 20, projected_points: 260 },
    { player_id: "rb2", rank: 21, projected_points: 200 },
    { player_id: "rb3", rank: 22, projected_points: 190 },
  ], { ...options, teams: 1, leagueDraftedCounts: { RB: 0 } });
  assert.equal(result.recommendations[0].player.player_id, "rb1");
  assert.ok(result.recommendations[0].score_components.value_over_replacement > 50);
});

test("survival estimate makes earlier-ranked players more urgent", () => {
  const result = rankContextualDraftCandidates(
    [player("early", "WR", 18), player("late", "WR", 55)], [], options,
  );
  const early = result.recommendations.find((item) => item.player.player_id === "early");
  const late = result.recommendations.find((item) => item.player.player_id === "late");
  assert.ok(early.probability_available_next_pick < late.probability_available_next_pick);
  assert.ok(early.score_components.urgency > late.score_components.urgency);
});

test("current unavailable status applies a bounded health penalty", () => {
  const result = rankContextualDraftCandidates(
    [player("healthy", "WR", 20), player("injured", "WR", 20, "Injured Reserve")], [], options,
  );
  const healthy = result.recommendations.find((item) => item.player.player_id === "healthy");
  const injured = result.recommendations.find((item) => item.player.player_id === "injured");
  assert.equal(healthy.score_components.health_multiplier, 1);
  assert.equal(injured.score_components.health_multiplier, 0.55);
  assert.ok(healthy.overall_score > injured.overall_score);
});

test("instant contextual calculation remains comfortably sub-second", () => {
  const players = Array.from({ length: 5000 }, (_, index) =>
    player(`p${index}`, ["QB", "RB", "WR", "TE"][index % 4], index + 1),
  );
  const result = rankContextualDraftCandidates(players, [], { ...options, timeBudgetMs: 250 });
  assert.ok(result.calculationMs < 250, `calculation took ${result.calculationMs}ms`);
  assert.ok(result.evaluated > 0);
  assert.equal(result.recommendations.length, 10);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlayerName } from "../dist/player-name.js";

test("player names normalize suffixes, punctuation, apostrophes, and accents", () => {
  assert.equal(normalizePlayerName("James Cook III"), normalizePlayerName("James Cook"));
  assert.equal(normalizePlayerName("Marvin Harrison Jr."), normalizePlayerName("Marvin Harrison"));
  assert.equal(normalizePlayerName("Amon-Ra St. Brown"), normalizePlayerName("Amon Ra St Brown"));
  assert.equal(normalizePlayerName("D’Andre Swift"), normalizePlayerName("DAndre Swift"));
  assert.equal(normalizePlayerName("José Núñez Sr."), normalizePlayerName("Jose Nunez"));
});

test("suffix-like text inside a name is preserved", () => {
  assert.equal(normalizePlayerName("Ivy Smith"), "ivysmith");
  assert.equal(normalizePlayerName("Junior Colson"), "juniorcolson");
});

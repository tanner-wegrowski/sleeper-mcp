import type {
  DraftPickLocation,
  SleeperDraft,
  SleeperTradedPick,
} from "./types.js";

export function getDraftSlot(
  pickNo: number,
  teams: number,
  draftType: SleeperDraft["type"],
): { round: number; draftSlot: number } {
  const round = Math.ceil(pickNo / teams);
  const positionInRound = ((pickNo - 1) % teams) + 1;
  const isSnakeReverse = draftType === "snake" && round % 2 === 0;
  return {
    round,
    draftSlot: isSnakeReverse ? teams - positionInRound + 1 : positionInRound,
  };
}

export function getPickLocation(
  draft: SleeperDraft,
  tradedPicks: SleeperTradedPick[],
  pickNo: number,
): DraftPickLocation {
  const { round, draftSlot } = getDraftSlot(
    pickNo,
    draft.settings.teams,
    draft.type,
  );
  const originalRosterId = draft.slot_to_roster_id?.[String(draftSlot)] ?? null;
  const trade = tradedPicks.find(
    (pick) =>
      pick.round === round &&
      pick.roster_id === originalRosterId &&
      pick.season === draft.season,
  );

  return {
    pick_no: pickNo,
    round,
    draft_slot: draftSlot,
    original_roster_id: originalRosterId,
    owner_roster_id: trade?.owner_id ?? originalRosterId,
  };
}

export function findNextPickForRoster(
  draft: SleeperDraft,
  tradedPicks: SleeperTradedPick[],
  afterPickNo: number,
  rosterId: number,
): DraftPickLocation | null {
  const totalPicks = draft.settings.teams * draft.settings.rounds;
  for (let pickNo = afterPickNo + 1; pickNo <= totalPicks; pickNo += 1) {
    const location = getPickLocation(draft, tradedPicks, pickNo);
    if (location.owner_roster_id === rosterId) return location;
  }
  return null;
}

import { describe, it, expect } from "vitest";
import {
  batchNote,
  boardEdgeIds,
  useSuccessionToday,
} from "~/composables/successions";
import { warsawDate } from "~~/shared/dates";
import type {
  CompanySuccessions,
  CurrentPost,
} from "~~/server/api/edges/successions.get";

function post(edgeId: string): CurrentPost {
  return {
    edgeId,
    personId: `p-${edgeId}`,
    personName: edgeId,
    parties: [],
    role: "Zarząd",
    start: "2024-04-12",
  };
}

function answer(current: CurrentPost[]): CompanySuccessions {
  return { successions: [], current, hidden: 0 };
}

/** The posts a company's history leaves out because „Obecny skład” draws them
 * as cards (Szymon, 2026-10-23). Read off the state the cards are drawn from,
 * so the page can never leave a post out of both. */
describe("boardEdgeIds", () => {
  it("names the edge of every post the board's cards draw", () => {
    expect(
      boardEdgeIds(answer([post("e-anna"), post("e-jan")]), "success"),
    ).toEqual(new Set(["e-anna", "e-jan"]));
  });

  it("names none before the first answer, so the history keeps every row", () => {
    expect(boardEdgeIds(null, "pending")).toEqual(new Set());
    expect(boardEdgeIds(undefined, "idle")).toEqual(new Set());
  });

  it("names none once the request has failed, whatever it answered before", () => {
    // The cards are not drawn on an error, so a post left out of the history
    // here would be on the page nowhere.
    expect(boardEdgeIds(answer([post("e-anna")]), "error")).toEqual(new Set());
  });

  it("keeps the board while a refresh is in flight, as the cards do", () => {
    expect(boardEdgeIds(answer([post("e-anna")]), "pending")).toEqual(
      new Set(["e-anna"]),
    );
  });

  it("names none for a company nobody holds an open post at", () => {
    expect(boardEdgeIds(answer([]), "success")).toEqual(new Set());
  });
});

/** One sentence for the „m.in.” on a company's board and the line under a
 * person's handover. Both used to say „zmieniło się 4 stanowisk”: the verb and
 * the noun follow the number in Polish. */
describe("batchNote", () => {
  const tail =
    " tej samej funkcji. Rejestr nie wskazuje, kto zajął czyje miejsce.";

  it("agrees the verb and the noun with two to four seats", () => {
    expect(batchNote(4)).toBe(`Tego dnia zmieniły się 4 stanowiska${tail}`);
    expect(batchNote(2)).toBe(`Tego dnia zmieniły się 2 stanowiska${tail}`);
    expect(batchNote(22)).toBe(`Tego dnia zmieniły się 22 stanowiska${tail}`);
  });

  it("takes the genitive from five, and through the teens", () => {
    expect(batchNote(5)).toBe(`Tego dnia zmieniło się 5 stanowisk${tail}`);
    expect(batchNote(12)).toBe(`Tego dnia zmieniło się 12 stanowisk${tail}`);
  });
});

describe("useSuccessionToday", () => {
  it("is the Warsaw day, one state for every part that measures a spell", () => {
    const today = useSuccessionToday();
    expect(today.value).toBe(warsawDate());

    // One key: a second caller reads the same day, so the board's cards and
    // the handover rows cannot measure to two different days.
    const again = useSuccessionToday();
    today.value = "2026-10-24";
    expect(again.value).toBe("2026-10-24");
  });
});

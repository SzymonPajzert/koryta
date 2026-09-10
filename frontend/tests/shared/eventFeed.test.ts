import { describe, it, expect } from "vitest";
import { interleaveByDate } from "../../shared/eventFeed";

type Item = { key: string; date: string };

const at = (key: string, date: string): Item => ({ key, date });

/** The feed's shape, which is all these tests are ever about. */
const keys = (items: Item[]) => items.map((item) => item.key);

describe("interleaveByDate", () => {
  it("puts a guest between the spine events it falls between", () => {
    const spine = [at("e1", "2026-09-10"), at("e2", "2026-09-01")];
    const guests = [at("g1", "2026-09-05")];

    expect(
      keys(interleaveByDate(spine, guests, { spineExhausted: false })),
    ).toEqual(["e1", "g1", "e2"]);
  });

  it("puts a guest above the spine events of its own day", () => {
    // Both readings are defensible; this one keeps the unusual card at the top
    // of its day rather than under a KRS batch that all filed that morning.
    const spine = [at("e1", "2026-09-05"), at("e2", "2026-09-05")];
    const guests = [at("g1", "2026-09-05")];

    expect(
      keys(interleaveByDate(spine, guests, { spineExhausted: false })),
    ).toEqual(["g1", "e1", "e2"]);
  });

  it("holds back a guest older than the last spine event", () => {
    // The one rule worth stating twice: the spine grows downwards as the
    // reader scrolls, so a guest drawn past its end would be correct now and
    // wrong on the next page - and it would visibly jump *up* the page to get
    // there.
    const spine = [at("e1", "2026-09-10")];
    const guests = [at("g1", "2026-08-01")];

    expect(
      keys(interleaveByDate(spine, guests, { spineExhausted: false })),
    ).toEqual(["e1"]);
  });

  it("draws the held-back guests once the spine has run out", () => {
    const spine = [at("e1", "2026-09-10")];
    const guests = [at("g1", "2026-08-02"), at("g2", "2026-08-01")];

    expect(
      keys(interleaveByDate(spine, guests, { spineExhausted: true })),
    ).toEqual(["e1", "g1", "g2"]);
  });

  it("draws a guest again in the same place once more spine arrives", () => {
    // The point of holding it back: the card lands where it will stay.
    const guests = [at("g1", "2026-09-05")];
    const firstPage = [at("e1", "2026-09-10")];
    const secondPage = [...firstPage, at("e2", "2026-09-01")];

    expect(
      keys(interleaveByDate(firstPage, guests, { spineExhausted: false })),
    ).toEqual(["e1"]);
    expect(
      keys(interleaveByDate(secondPage, guests, { spineExhausted: false })),
    ).toEqual(["e1", "g1", "e2"]);
  });

  it("orders the guests among themselves, whatever order they arrived in", () => {
    // They may come from several endpoints, so nobody upstream is in a
    // position to sort them against each other.
    const spine = [at("e1", "2026-09-01")];
    const guests = [
      at("g-old", "2026-09-03"),
      at("g-new", "2026-09-08"),
      at("g-mid", "2026-09-05"),
    ];

    expect(
      keys(interleaveByDate(spine, guests, { spineExhausted: false })),
    ).toEqual(["g-new", "g-mid", "g-old", "e1"]);
  });

  it("breaks a tie on the key rather than on arrival order", () => {
    // Otherwise a refetch that returns the same events could draw them in a
    // different order, and Vue would animate a feed nobody changed.
    const spine = [at("e1", "2026-09-01")];

    expect(
      keys(
        interleaveByDate(
          spine,
          [at("b", "2026-09-05"), at("a", "2026-09-05")],
          {
            spineExhausted: false,
          },
        ),
      ),
    ).toEqual(["a", "b", "e1"]);
  });

  it("leaves the spine in the order it was given", () => {
    // It is a paged stream and its order is the endpoint's, cursor and all.
    // Re-sorting here would hide a feed whose pages do not line up.
    const spine = [at("e1", "2026-09-01"), at("e2", "2026-09-09")];

    expect(keys(interleaveByDate(spine, [], { spineExhausted: true }))).toEqual(
      ["e1", "e2"],
    );
  });

  it("shows nothing but guests when the spine is empty and finished", () => {
    expect(
      keys(
        interleaveByDate([], [at("g1", "2026-09-05")], {
          spineExhausted: true,
        }),
      ),
    ).toEqual(["g1"]);
  });

  it("waits before drawing anything when the spine has not arrived yet", () => {
    // An empty spine with a cursor behind it is a feed still loading, not a
    // feed that ends here - so there is no last position to place a guest at.
    expect(
      keys(
        interleaveByDate([], [at("g1", "2026-09-05")], {
          spineExhausted: false,
        }),
      ),
    ).toEqual([]);
  });

  it("does not mutate what it was handed", () => {
    const guests = [at("g-old", "2026-09-01"), at("g-new", "2026-09-09")];

    interleaveByDate([], guests, { spineExhausted: true });

    expect(keys(guests)).toEqual(["g-old", "g-new"]);
  });
});

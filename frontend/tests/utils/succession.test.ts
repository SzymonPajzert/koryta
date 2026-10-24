import { describe, it, expect } from "vitest";
import { predecessorsByEdge } from "~/utils/succession";
import type { EdgeNode } from "~/composables/edges";
import type { PersonSuccession } from "~~/server/api/edges/successions.get";

function edge(extra: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "Rada Nadzorcza",
    source: "marzena",
    target: "phcrs",
    start_date: "2024-05-16",
    end_date: "2024-07-02",
    richNode: { id: "phcrs", type: "place", name: "PHCRS" },
    ...extra,
  } as EdgeNode;
}

function post(extra: Partial<PersonSuccession> = {}): PersonSuccession {
  return {
    companyId: "phcrs",
    companyName: "PHCRS",
    role: "Rada Nadzorcza",
    start: "2024-05-16",
    end: "2024-07-02",
    predecessor: {
      edgeId: "e-hubert",
      personId: "hubert",
      personName: "Hubert Grzegorczyk",
      parties: [],
      start: "2021-03-01",
      end: "2024-05-16",
      published: true,
      gapDays: 0,
    },
    successor: null,
    ...extra,
  };
}

describe("predecessorsByEdge", () => {
  it("matches a post to the row that holds the same seat", () => {
    expect(predecessorsByEdge([post()], [edge()])).toEqual({
      e1: post().predecessor,
    });
  });

  it("matches a role the register and the editor spelled differently", () => {
    // `shared/succession.ts` treats case and surrounding space as noise, and
    // the two halves of this join have to agree with it.
    const found = predecessorsByEdge(
      [post({ role: "Rada Nadzorcza" })],
      [edge({ label: " rada nadzorcza " })],
    );

    expect(Object.keys(found)).toEqual(["e1"]);
  });

  it.each([
    [
      "a hospital's rada społeczna",
      { supervisoryBody: "rada-spoleczna" },
      "Rada Społeczna",
    ],
    [
      "an association's komisja rewizyjna",
      { supervisoryOrgan: "komisja_rewizyjna" },
      "Komisja Rewizyjna",
    ],
  ])(
    "matches %s, which the endpoint names after the organ",
    (_, organ, role) => {
      // The row holds the "Rada Nadzorcza" every supervisory seat is stored as;
      // the endpoint names the post the way `displayRole` does.
      const found = predecessorsByEdge(
        [post({ role })],
        [
          edge({
            richNode: { id: "phcrs", type: "place", name: "PHCRS", ...organ },
          } as Partial<EdgeNode>),
        ],
      );

      expect(Object.keys(found)).toEqual(["e1"]);
    },
  );

  it("keeps two spells of the same company apart", () => {
    const rows = [
      edge({ id: "board", label: "Zarząd", start_date: "2024-05-17" }),
      edge({ id: "council", start_date: "2024-05-16" }),
    ];

    expect(predecessorsByEdge([post()], rows)).toEqual({
      council: post().predecessor,
    });
  });

  it("says nothing about a post whose row the card was not handed", () => {
    expect(predecessorsByEdge([post()], [edge({ target: "mpec" })])).toEqual(
      {},
    );
  });

  it("ignores a post with no predecessor", () => {
    expect(predecessorsByEdge([post({ predecessor: null })], [edge()])).toEqual(
      {},
    );
  });

  it("never claims a candidacy was taken over from somebody", () => {
    // An election edge carries a start date and a target too, and the row it
    // draws is in the same list.
    const candidacy = edge({ type: "election", label: "Rada Nadzorcza" });

    expect(predecessorsByEdge([post()], [candidacy])).toEqual({});
  });
});

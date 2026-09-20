import { describe, it, expect } from "vitest";
import {
  addsOnlyAnnotations,
  edgeDocumentId,
  edgeIdentity,
  edgeSemantics,
  edgeRelation,
  enrichedEdge,
  findEdgeMatches,
  findEdges,
  findEdge,
  type EdgeLike,
} from "../../../server/utils/edges";

const owns: EdgeLike = { source: "a", target: "b", type: "owns" };
const spell: EdgeLike = {
  source: "p",
  target: "c",
  type: "employed",
  name: "prezes",
  start_date: "2010-03-01",
};
const candidacy: EdgeLike = {
  source: "p",
  target: "teryt1465",
  type: "election",
  name: "kandydatura",
  position: "Samorząd",
  start_date: "2024-01-01",
};

describe("edgeIdentity", () => {
  it("ignores everything but the pair for a state edge", () => {
    // An `owns` tie holds or it does not; a stray date does not make a second
    // fact of it.
    expect(edgeIdentity({ ...owns, start_date: "2020-01-01" })).toBe(
      edgeIdentity(owns),
    );
  });

  it("separates two spells of employment by when they began", () => {
    // What "employed there again after a break" means.
    expect(edgeIdentity({ ...spell, start_date: "2015-06-01" })).not.toBe(
      edgeIdentity(spell),
    );
  });

  it("does not separate one spell by an end date learned later", () => {
    // end_date is a property of the spell, not part of which spell it is.
    expect(edgeIdentity({ ...spell, end_date: "2012-05-01" })).toBe(
      edgeIdentity(spell),
    );
  });

  it("treats a blank written by the edit form as an absent field", () => {
    // /api/edges/create writes "" and false where the ingest omits the field;
    // without this a hand-made edge could never match an ingested one.
    expect(
      edgeIdentity({ ...spell, party: "", committee: "", elected: false }),
    ).toBe(edgeIdentity(spell));
  });

  it("ignores fields that say nothing about what the edge asserts", () => {
    expect(edgeIdentity({ ...spell, revision_id: "rev-1" })).toBe(
      edgeIdentity(spell),
    );
  });
});

describe("edgeSemantics", () => {
  it("reads an unknown edge type as authored, so nothing merges it", () => {
    const unknown = edgeSemantics("mentioned_person");
    expect(unknown.kind).toBe("authored");
    expect(unknown.identicalMeansSame).toBe(false);
  });

  it("refuses to call two identical elections one fact", () => {
    // The office, the committee and the run-off round are stripped upstream, so
    // two different candidacies can be byte-identical.
    expect(edgeSemantics("election").identicalMeansSame).toBe(false);
  });
});

describe("edgeDocumentId", () => {
  it("keeps the plain form for a state edge, whatever else it carries", () => {
    // The scheme the region pipeline and the company ingest already use.
    expect(
      edgeDocumentId({ source: "teryt1061", target: "c1", type: "owns" }),
    ).toBe("edge_teryt1061_c1_owns");
    expect(edgeDocumentId({ ...owns, start_date: "2020-01-01" })).toBe(
      "edge_a_b_owns",
    );
  });

  it("gives two spells between the same pair different ids", () => {
    expect(edgeDocumentId(spell)).not.toBe(
      edgeDocumentId({ ...spell, start_date: "2015-06-01" }),
    );
  });

  it("gives a second indistinguishable candidacy an id of its own", () => {
    // Standing for burmistrz and for the rada in one town in 2024 stores two
    // identical rows; both are real, so both need a document.
    expect(edgeDocumentId(candidacy, 1)).not.toBe(edgeDocumentId(candidacy, 0));
  });

  it("leaves the first copy's id unchanged", () => {
    expect(edgeDocumentId(candidacy, 0)).toBe(edgeDocumentId(candidacy));
  });

  it("produces an id Firestore will accept", () => {
    const id = edgeDocumentId(candidacy, 2);
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(100);
  });
});

function dbWith(stored: EdgeLike[]) {
  return {
    collection: () => ({
      where: function () {
        return this;
      },
      get: async () => ({
        docs: stored.map((edge, index) => ({
          id: `stored-${index}`,
          data: () => edge,
        })),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore;
}

describe("findEdges", () => {
  it("finds an edge asserting the same thing", async () => {
    await expect(findEdge(dbWith([spell]), spell)).resolves.toBe("stored-0");
  });

  it("does not match a different spell", async () => {
    const other = { ...spell, start_date: "2015-06-01" };
    await expect(findEdge(dbWith([other]), spell)).resolves.toBeUndefined();
  });

  it("matches a state edge on the pair alone", async () => {
    const stored = { ...owns, start_date: "2020-01-01", name: "whatever" };
    await expect(findEdge(dbWith([stored]), owns)).resolves.toBe("stored-0");
  });

  it("returns every copy, so the n-th payload row can take the n-th", async () => {
    // Two indistinguishable candidacies already stored: re-sending the payload
    // has to map its two rows onto these two rather than create more.
    const found = await findEdges(dbWith([candidacy, candidacy]), candidacy);
    expect(found).toEqual(["stored-0", "stored-1"]);
  });
});

/** The same candidacy as `candidacy`, with the committee the pipeline has
 * started sending. Every one of the 10476 stored candidacies is the left-hand
 * side of this pair. */
const withCommittee: EdgeLike = {
  ...candidacy,
  committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
  party: "PiS",
};

describe("edgeRelation", () => {
  it("recognises a stored candidacy the payload now knows the committee of", () => {
    expect(edgeRelation(candidacy, withCommittee)).toBe("enriches");
  });

  it("calls it a conflict when the two disagree about what they both know", () => {
    // A Sejm bid is not a Samorząd one, however much else lines up.
    expect(
      edgeRelation({ ...candidacy, position: "Sejm" }, withCommittee),
    ).toBe("conflict");
    expect(
      edgeRelation(
        { ...candidacy, committee: "Komitet Wyborczy Nowa Lewica" },
        withCommittee,
      ),
    ).toBe("conflict");
  });

  it("calls it the same fact when there is nothing to add", () => {
    expect(edgeRelation(withCommittee, withCommittee)).toBe("same");
  });

  it("calls a hand-corrected edge the same fact, not a new one", () => {
    // The scrapers never send `term`. Reading their silence as "no term" would
    // mean an un-matchable edge - and an un-matchable edge is not left alone,
    // it gets a duplicate written beside it on every run.
    expect(
      edgeRelation({ ...withCommittee, term: "2024-2029" }, withCommittee),
    ).toBe("same");
  });

  it("still enriches an edge a reviewer has added a field to", () => {
    expect(
      edgeRelation({ ...candidacy, term: "2024-2029" }, withCommittee),
    ).toBe("enriches");
  });

  it("reads a committee spelled differently as the same committee", () => {
    // PKW writes it in whatever case and spacing the spreadsheet had, and
    // `committee_to_party` lists both wordings for that reason. Compared raw,
    // one re-scrape would store a second candidacy.
    expect(
      edgeRelation(
        {
          ...withCommittee,
          committee: "KOMITET  WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ",
        },
        withCommittee,
      ),
    ).toBe("same");
  });
});

describe("the result of a candidacy", () => {
  const won: EdgeLike = { ...candidacy, elected: true };

  it("enriches a stored candidacy without changing which one it is", () => {
    // Both at once, and they pull opposite ways: the result has to be worth
    // writing, and it must not move the edge to a different document id, or
    // every winning candidacy would be stored a second time.
    expect(edgeRelation(candidacy, won)).toBe("enriches");
    expect(edgeIdentity(won)).toBe(edgeIdentity(candidacy));
  });

  it("is a conflict where the stored edge says otherwise", () => {
    expect(edgeRelation({ ...candidacy, elected: true }, won)).toBe("same");
  });

  it("can be written out on its own, but not alongside a committee", () => {
    expect(addsOnlyAnnotations(candidacy, won)).toBe(true);
    expect(
      addsOnlyAnnotations(candidacy, { ...won, committee: "KWW Nasza Gmina" }),
    ).toBe(false);
    // Nothing to add is not "only annotations to add".
    expect(addsOnlyAnnotations(won, won)).toBe(false);
    // A type with no annotations never takes the shortcut.
    expect(
      addsOnlyAnnotations(spell, { ...spell, end_date: "2020-01-01" }),
    ).toBe(false);
  });
});

describe("enrichedEdge", () => {
  it("fills the blanks and touches nothing else", () => {
    // `createElection` restates `name` on every candidacy, so a plain merge
    // would reset a label a reviewer had rewritten.
    const stored = { ...candidacy, name: "kandydatura na burmistrza" };
    expect(enrichedEdge(stored, withCommittee)).toEqual({
      ...stored,
      committee: withCommittee.committee,
      party: "PiS",
    });
  });
});

describe("findEdgeMatches", () => {
  it("separates what already says this from what could be made to", async () => {
    const { same, enrichable } = await findEdgeMatches(
      dbWith([withCommittee, candidacy]),
      withCommittee,
    );
    expect(same).toEqual(["stored-0"]);
    expect(enrichable.map((c) => c.id)).toEqual(["stored-1"]);
  });

  it("hands back the stored document, not just its id", async () => {
    // The caller fills its blanks to build the revision; re-reading it would be
    // a second round trip against a collection this request has uncommitted
    // writes for.
    const stored = { ...candidacy, term: "2024-2029" };
    const { enrichable } = await findEdgeMatches(
      dbWith([stored]),
      withCommittee,
    );
    expect(enrichable[0]?.stored).toEqual(stored);
  });

  it("finds nothing to enrich once the committee is stored", async () => {
    // Re-running the pipeline must be a no-op, not a second revision per run.
    const { same, enrichable } = await findEdgeMatches(
      dbWith([withCommittee]),
      withCommittee,
    );
    expect(same).toEqual(["stored-0"]);
    expect(enrichable).toEqual([]);
  });

  it("orders candidates so two runs pick the same document", async () => {
    // Which of three indistinguishable candidacies gets which committee is
    // arbitrary; being arbitrary differently on a re-run is what would write a
    // second revision every night.
    const { enrichable } = await findEdgeMatches(
      dbWith([candidacy, candidacy, candidacy]),
      withCommittee,
    );
    expect(enrichable.map((c) => c.id)).toEqual([
      "stored-0",
      "stored-1",
      "stored-2",
    ]);
  });

  it("will not let a blank edge absorb an arbitrary candidacy", async () => {
    // /api/edges/create writes "" and null for every box the form left empty,
    // so a moderator noting "stood here, check which year" leaves an edge that
    // contradicts nothing at all.
    const blank = {
      source: "p",
      target: "teryt1465",
      type: "election" as const,
      content: "kandydował, do sprawdzenia",
      position: "",
      committee: "",
      start_date: null,
    };
    const { same, enrichable } = await findEdgeMatches(
      dbWith([blank as unknown as EdgeLike]),
      withCommittee,
    );
    expect(same).toEqual([]);
    expect(enrichable).toEqual([]);
  });

  it("leaves an employment alone whatever the payload adds", async () => {
    // The enrichment gate is per type, and the concurrency argument in
    // findEdgeOrCreate rests on it: employments are resolved through
    // Promise.all, where the claim cannot be made before the read.
    expect(edgeSemantics("employed").enrichable).toBe(false);
    const undated = { source: "p", target: "c", type: "employed" as const };
    const { same, enrichable } = await findEdgeMatches(dbWith([undated]), {
      ...undated,
      start_date: "2010-03-01",
    });
    expect(same).toEqual([]);
    expect(enrichable).toEqual([]);
  });

  it("reports every sibling, so a new edge is not created on top of one", async () => {
    const { ids } = await findEdgeMatches(
      dbWith([candidacy, withCommittee]),
      withCommittee,
    );
    expect(ids).toEqual(new Set(["stored-0", "stored-1"]));
  });
});

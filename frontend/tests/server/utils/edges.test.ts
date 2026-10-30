import { describe, it, expect } from "vitest";
import {
  addsOnlyAnnotations,
  addsOnlyRecordedFacts,
  edgeDocumentId,
  edgeIdentity,
  edgeSemantics,
  edgeRelation,
  enrichedEdge,
  findEdgeMatches,
  findEdges,
  findEdge,
  isSameRun,
  misfiledRunOf,
  misfiledSejmikRunOf,
  namesOffice,
  preferredCopy,
  unnamedLocal,
  withRecordedFacts,
  type EdgeCopy,
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

  it("gives a later copy of a state edge an id of its own", () => {
    // The pair's bare id can be held by an edge a split or a merge moved to
    // another page, and a new edge for the pair needs somewhere else to go.
    expect(edgeDocumentId(owns, 1)).toMatch(/^edge_a_b_owns_.{10}$/);
    expect(edgeDocumentId(owns, 2)).not.toBe(edgeDocumentId(owns, 1));
    expect(edgeDocumentId({ ...owns, start_date: "2020-01-01" }, 1)).toBe(
      edgeDocumentId(owns, 1),
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

  it("reads an office a reviewer narrowed down as the pipeline's candidacy", () => {
    // The pipeline sends „Samorząd" for every local candidacy. A reader who
    // has since said which council it was has not contradicted that, and a
    // conflict here would store the pipeline's row beside theirs on the next
    // run - the vague candidacy back, as a duplicate.
    const narrowed = { ...candidacy, position: "Rada gminy" } as EdgeLike;
    expect(edgeRelation(narrowed, candidacy)).toBe("same");
    expect(edgeRelation(narrowed, withCommittee)).toBe("enriches");
  });

  it("still tells a national office from the pipeline's local one", () => {
    expect(edgeRelation({ ...candidacy, position: "Senat" }, candidacy)).toBe(
      "conflict",
    );
  });

  it("reads a named office as filling in a stored „Samorząd”", () => {
    // This was a conflict while nothing but a reviewer named offices: a
    // „Samorząd" said nothing about which council. Now the pipeline names
    // them from PKW's files, and read as a conflict every one of the 12,941
    // stored „Samorząd" candidacies would be written again beside itself.
    expect(
      edgeRelation(candidacy, { ...candidacy, position: "Rada gminy" }),
    ).toBe("enriches");
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
    expect(addsOnlyAnnotations(owns, { ...owns, end_date: "2020-01-01" })).toBe(
      false,
    );
  });
});

describe("an office the pipeline names", () => {
  // Marcin Witko's 2010 council seat, stored as „Samorząd” before the pipeline
  // carried the office out of PKW's files.
  const named: EdgeLike = { ...candidacy, position: "Rada miasta" };

  it("fills in a stored „Samorząd” rather than standing beside it", () => {
    expect(edgeRelation(candidacy, named)).toBe("enriches");
    expect(enrichedEdge({ ...candidacy, committee: "KW PiS" }, named)).toEqual({
      ...candidacy,
      committee: "KW PiS",
      position: "Rada miasta",
    });
  });

  it("is a different candidacy from another named one", () => {
    // A council run and a mayoral run: two seats, two facts.
    expect(edgeRelation(named, { ...candidacy, position: "Prezydent" })).toBe(
      "conflict",
    );
  });

  it("never names a national candidacy, nor a local one national", () => {
    expect(edgeRelation(candidacy, { ...candidacy, position: "Sejm" })).toBe(
      "conflict",
    );
    expect(edgeRelation({ ...candidacy, position: "Sejm" }, named)).toBe(
      "conflict",
    );
  });

  it("is already said by a candidacy a reviewer named the same", () => {
    expect(edgeRelation(named, named)).toBe("same");
    expect(enrichedEdge({ ...named }, named)).toEqual(named);
  });

  it("can be written out with the result, but not with a committee", () => {
    // Both are what PKW records outright; recognising a committee is not.
    expect(addsOnlyRecordedFacts({ ...candidacy }, named)).toBe(true);
    expect(
      addsOnlyRecordedFacts({ ...candidacy }, { ...named, elected: true }),
    ).toBe(true);
    expect(
      addsOnlyRecordedFacts(
        { ...candidacy },
        { ...named, committee: "KWW Nasza Gmina" },
      ),
    ).toBe(false);
    expect(addsOnlyRecordedFacts({ ...named }, named)).toBe(false);
    expect(
      addsOnlyRecordedFacts({ ...candidacy }, { ...candidacy, elected: true }),
    ).toBe(true);
  });

  it("fills in a copy with no office where the year says which election it was", () => {
    const { position: _, ...bare } = candidacy;
    const of = (year: string) => ({ ...bare, start_date: `${year}-01-01` });
    // 2018 held only local elections, so a copy with no office is local.
    expect(addsOnlyRecordedFacts(of("2018"), { ...named, ...of("2018") })).toBe(
      true,
    );
    // 2024 held the European election as well.
    expect(addsOnlyRecordedFacts(of("2024"), named)).toBe(false);
    // Still not with a committee.
    expect(
      addsOnlyRecordedFacts(of("2018"), {
        ...named,
        ...of("2018"),
        committee: "KWW Nasza Gmina",
      }),
    ).toBe(false);
  });
});

describe("namesOffice", () => {
  const { position: _, ...bare } = candidacy;

  it("names a „Samorząd” copy's local office, never a national one", () => {
    expect(namesOffice(candidacy, { ...candidacy, position: "Wójt" })).toBe(
      true,
    );
    expect(namesOffice(candidacy, { ...candidacy, position: "Sejm" })).toBe(
      false,
    );
    expect(namesOffice(candidacy, candidacy)).toBe(false);
  });

  it("never renames an office already stored", () => {
    const named = { ...candidacy, position: "Rada gminy" } as EdgeLike;
    expect(namesOffice(named, { ...candidacy, position: "Wójt" })).toBe(false);
  });

  it("names a copy with no office only in a year of one kind of election", () => {
    const names = (year: string, position: string) =>
      namesOffice({ ...bare, start_date: `${year}-01-01` }, {
        ...candidacy,
        start_date: `${year}-01-01`,
        position,
      } as EdgeLike);
    expect(names("2018", "Prezydent")).toBe(true);
    expect(names("2023", "Sejm")).toBe(true);
    // Two kinds of election in each of these.
    expect(names("2024", "Prezydent")).toBe(false);
    expect(names("2019", "Sejm")).toBe(false);
  });

  it("is only about candidacies", () => {
    expect(namesOffice(spell, { ...spell, position: "Wójt" } as EdgeLike)).toBe(
      false,
    );
  });
});

describe("withRecordedFacts", () => {
  const kww = "KWW Nasza Gmina";

  it("writes in the office and the result, and leaves the committee out", () => {
    expect(
      withRecordedFacts(
        { ...candidacy },
        { ...candidacy, position: "Wójt", elected: true, committee: kww },
      ),
    ).toEqual({ ...candidacy, position: "Wójt", elected: true });
  });

  it("keeps everything the stored edge says", () => {
    expect(
      withRecordedFacts(
        { ...candidacy, name: "kandydatura na wójta", term: "2024-2029" },
        { ...candidacy, position: "Wójt" },
      ),
    ).toEqual({
      ...candidacy,
      name: "kandydatura na wójta",
      term: "2024-2029",
      position: "Wójt",
    });
  });

  it("is nothing when the payload records nothing new", () => {
    expect(
      withRecordedFacts({ ...candidacy }, { ...candidacy, committee: kww }),
    ).toBeUndefined();
    expect(
      withRecordedFacts(
        { ...candidacy, elected: true },
        { ...candidacy, elected: true },
      ),
    ).toBeUndefined();
  });

  it("leaves a 2024 copy's missing office missing, which could be the European run", () => {
    const { position: _, ...bare } = candidacy;
    expect(
      withRecordedFacts(
        { ...bare },
        { ...candidacy, position: "Wójt", elected: true },
      ),
    ).toEqual({ ...bare, elected: true });
  });
});

describe("preferredCopy", () => {
  const won: EdgeLike = { ...candidacy, elected: true };
  const committee = "Komitet Wyborczy Prawo i Sprawiedliwość";
  /** A stored copy, labelled the way `findEdgeMatches` labels it for `row`. */
  const copy = (
    id: string,
    stored: Record<string, unknown>,
    row: EdgeLike,
  ): EdgeCopy => ({
    id,
    stored,
    relation: edgeRelation(stored as EdgeLike, row) as EdgeCopy["relation"],
  });

  it("gives a won row the copy that says it was won, wherever it sorts", () => {
    const pick = preferredCopy(won, [
      copy("a", { ...candidacy }, won),
      copy("b", { ...won }, won),
    ]);

    expect(pick?.id).toBe("b");
  });

  it("gives a row that says nothing the copy that says nothing", () => {
    // It fits the won copy too, so position alone would hand it that.
    const pick = preferredCopy(candidacy, [
      copy("a", { ...won }, candidacy),
      copy("b", { ...candidacy }, candidacy),
    ]);

    expect(pick?.id).toBe("b");
  });

  it("takes the copy asserting exactly the row before one it would enrich", () => {
    const row: EdgeLike = { ...candidacy, committee };
    const pick = preferredCopy(row, [
      copy("a", { ...candidacy }, row),
      copy("b", { ...candidacy, committee }, row),
    ]);

    expect(pick?.id).toBe("b");
  });

  it("takes a live copy before a removed one", () => {
    const pick = preferredCopy(candidacy, [
      copy("a", { ...candidacy, deleted: true }, candidacy),
      copy("b", { ...candidacy }, candidacy),
    ]);

    expect(pick?.id).toBe("b");
  });

  it("still restates a removed copy that is the row's own", () => {
    // The result agrees with the removed one only: taking the live one would
    // write the win onto a copy a reviewer kept, beside the one they removed.
    const pick = preferredCopy(won, [
      copy("a", { ...won, deleted: true }, won),
      copy("b", { ...candidacy }, won),
    ]);

    expect(pick?.id).toBe("a");
  });

  it("falls back to the id, so a dry run predicts the real one", () => {
    const pick = preferredCopy(candidacy, [
      copy("b", { ...candidacy }, candidacy),
      copy("a", { ...candidacy }, candidacy),
    ]);

    expect(pick?.id).toBe("a");
    expect(preferredCopy(candidacy, [])).toBeUndefined();
  });
});

describe("the end of a spell of employment", () => {
  const ended: EdgeLike = { ...spell, end_date: "2026-08-25" };

  it("is learned onto the stored spell rather than making a second one", () => {
    // A job stored while it was held stays one job once the register closes
    // it, and the end is worth writing.
    expect(edgeIdentity(ended)).toBe(edgeIdentity(spell));
    expect(edgeRelation(spell, ended)).toBe("enriches");
    expect(addsOnlyAnnotations(spell, ended)).toBe(true);
  });

  it("never rewrites an end already stored", () => {
    // Somebody's correction, or an earlier run's reading, stands.
    expect(edgeRelation(ended, { ...spell, end_date: "2026-09-01" })).toBe(
      "conflict",
    );
    expect(
      addsOnlyAnnotations(ended, { ...spell, end_date: "2026-09-01" }),
    ).toBe(false);
  });

  it("is not reopened by a payload that has no end", () => {
    expect(edgeRelation(ended, spell)).toBe("same");
    expect(addsOnlyAnnotations(ended, spell)).toBe(false);
  });

  it("reads the edit form's blank end as no end", () => {
    // /api/edges/create writes "" for a box left empty.
    expect(addsOnlyAnnotations({ ...spell, end_date: "" }, ended)).toBe(true);
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

  it("keeps an office a reviewer narrowed down", () => {
    const stored = { ...candidacy, position: "Rada powiatu" };
    expect(enrichedEdge(stored, withCommittee)).toMatchObject({
      position: "Rada powiatu",
      committee: withCommittee.committee,
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

  it("finds the pipeline's candidacy in one a reviewer narrowed down", async () => {
    const { same, enrichable } = await findEdgeMatches(
      dbWith([{ ...candidacy, position: "Sejmik" } as EdgeLike]),
      candidacy,
    );
    expect(same).toEqual(["stored-0"]);
    expect(enrichable).toEqual([]);
  });

  it("reports every sibling, so a new edge is not created on top of one", async () => {
    const { ids } = await findEdgeMatches(
      dbWith([candidacy, withCommittee]),
      withCommittee,
    );
    expect(ids).toEqual(new Set(["stored-0", "stored-1"]));
  });

  it("matches a job learning its end exactly, and hands back its document", async () => {
    // Still `same`, not `enrichable`: which stored spell a row takes is decided
    // by the occurrence count, as for any exact match, and the caller fills the
    // end in on the one it takes.
    const { same, enrichable, documents } = await findEdgeMatches(
      dbWith([spell]),
      { ...spell, end_date: "2026-08-25" },
    );
    expect(same).toEqual(["stored-0"]);
    expect(enrichable).toEqual([]);
    expect(documents.get("stored-0")).toEqual(spell);
  });
});

describe("misfiledRunOf", () => {
  /** Michał Jerzy Sobczak's 2023 Sejm run as the pipeline places it now:
   * district 9, filed under łódzkie. */
  const inDistrict: EdgeLike = {
    source: "p",
    target: "teryt10",
    type: "election",
    name: "kandydatura",
    position: "Sejm",
    start_date: "2023-01-01",
    committee:
      "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI - POLSKIE STRONNICTWO LUDOWE",
  };
  /** The same run as the June upload filed it: under Łódź, where PKW's list
   * says he lives. */
  const atHome: EdgeLike = {
    source: "p",
    target: "teryt1061",
    type: "election",
    name: "kandydatura",
    position: "Sejm",
    start_date: "2023-01-01",
  };

  it("takes a Sejm run filed under the candidate's home for the district's", () => {
    expect(misfiledRunOf(atHome, "1061", inDistrict, "10")).toBe(true);
    // A gmina inside the województwo is as much a home as a powiat.
    expect(misfiledRunOf(atHome, "106101", inDistrict, "10")).toBe(true);
    expect(
      misfiledRunOf(
        { ...atHome, position: "Senat" },
        "1061",
        { ...inDistrict, position: "Senat" },
        "10",
      ),
    ).toBe(true);
  });

  it("leaves a copy filed under a województwo, where a district is", () => {
    expect(misfiledRunOf(atHome, "10", inDistrict, "10")).toBe(false);
    expect(misfiledRunOf(atHome, "14", inDistrict, "10")).toBe(false);
  });

  it("leaves a Sejm run at a home outside the district's województwo", () => {
    // Warszawa: a namesake's run as likely as this one, and two places in one
    // election for a reviewer to look at.
    expect(misfiledRunOf(atHome, "1465", inDistrict, "10")).toBe(false);
  });

  it("takes a European run from a home anywhere, as it always did", () => {
    // District 13 is lubuskie and zachodniopomorskie, filed under lubuskie,
    // where its seat is: a home in Szczecin lies outside that województwo
    // and inside the district.
    const european = {
      ...inDistrict,
      position: "Parlament Europejski",
      start_date: "2019-01-01",
    };
    const home = {
      ...atHome,
      position: "Parlament Europejski",
      start_date: "2019-01-01",
    };
    expect(misfiledRunOf(home, "3262", european, "08")).toBe(true);
  });

  it("never takes another office's run, nor another year's", () => {
    expect(
      misfiledRunOf(
        { ...atHome, position: "Samorząd" },
        "1061",
        inDistrict,
        "10",
      ),
    ).toBe(false);
    expect(
      misfiledRunOf(
        { ...atHome, start_date: "2019-01-01" },
        "1061",
        inDistrict,
        "10",
      ),
    ).toBe(false);
    // Nor anything for a local office, which a powiat is the place of.
    expect(
      misfiledRunOf(
        { ...atHome, position: "Samorząd", start_date: "2024-01-01" },
        "1061",
        { ...inDistrict, position: "Sejmik", start_date: "2024-01-01" },
        "10",
      ),
    ).toBe(false);
  });

  it("leaves a run another committee stood, and a removed copy", () => {
    expect(
      misfiledRunOf(
        { ...atHome, committee: "KOMITET WYBORCZY KONFEDERACJA" },
        "1061",
        inDistrict,
        "10",
      ),
    ).toBe(false);
    expect(
      misfiledRunOf(
        { ...atHome, deleted: true } as EdgeLike,
        "1061",
        inDistrict,
        "10",
      ),
    ).toBe(false);
  });

  it("takes a copy with no office only in a year that held nothing else", () => {
    const { position: _, ...officeless } = atHome;
    // 2023 had only the Sejm's and the Senate's: Hubert Papaj's bare run under
    // Jelenia Góra.
    expect(
      misfiledRunOf(
        officeless,
        "0261",
        { ...inDistrict, target: "teryt02" },
        "02",
      ),
    ).toBe(true);
    expect(
      misfiledRunOf({ ...officeless, position: "" }, "1061", inDistrict, "10"),
    ).toBe(true);
    // 2019 had the European one as well, so a bare 2019 run could be either.
    const sejm2019 = { ...inDistrict, start_date: "2019-01-01" };
    expect(
      misfiledRunOf(
        { ...officeless, start_date: "2019-01-01" },
        "1061",
        sejm2019,
        "10",
      ),
    ).toBe(false);
  });
});

describe("isSameRun", () => {
  const sejm: EdgeLike = {
    source: "p",
    target: "teryt10",
    type: "election",
    position: "Sejm",
    start_date: "2023-01-01",
  };

  it("is the same office in the same year, wherever it is filed", () => {
    expect(isSameRun({ ...sejm, target: "teryt1061" }, sejm)).toBe(true);
    expect(isSameRun({ ...sejm, position: "Senat" }, sejm)).toBe(false);
    expect(isSameRun({ ...sejm, start_date: "2019-01-01" }, sejm)).toBe(false);
  });

  it("takes a stated day for another date, as the identity does", () => {
    // A reviewer's correction is theirs to reconcile, not this rule's.
    expect(isSameRun({ ...sejm, start_date: "2023-10-15" }, sejm)).toBe(false);
  });
});

describe("misfiledSejmikRunOf", () => {
  /** Michał Jerzy Sobczak's 2024 sejmik run as the payload places it. */
  const sejmik: EdgeLike = {
    source: "p",
    target: "teryt10",
    type: "election",
    position: "Sejmik",
    start_date: "2024-01-01",
  };
  /** As his June upload stored it: „Samorząd”, under Łódź. */
  const atHome: EdgeLike = {
    ...sejmik,
    target: "teryt1061",
    position: "Samorząd",
  };

  it("takes a „Samorząd” copy at home inside the województwo", () => {
    expect(misfiledSejmikRunOf(atHome, "1061", sejmik, "10")).toBe(true);
  });

  it("never takes a named local run, nor one outside the województwo", () => {
    expect(
      misfiledSejmikRunOf(
        { ...atHome, position: "Rada miasta" },
        "1061",
        sejmik,
        "10",
      ),
    ).toBe(false);
    expect(misfiledSejmikRunOf(atHome, "1465", sejmik, "10")).toBe(false);
    expect(misfiledSejmikRunOf(atHome, "10", sejmik, "10")).toBe(false);
  });

  it("is only ever asked for a sejmik row", () => {
    expect(
      misfiledSejmikRunOf(
        atHome,
        "1061",
        { ...sejmik, position: "Sejm" },
        "10",
      ),
    ).toBe(false);
  });
});

describe("unnamedLocal", () => {
  it("reads „Samorząd” as saying no more than local", () => {
    expect(unnamedLocal({ ...candidacy })).toBe(true);
    expect(unnamedLocal({ ...candidacy, position: "Rada gminy" })).toBe(false);
  });

  it("reads no office as local only in a year with no other election", () => {
    const { position: _, ...bare } = candidacy;
    expect(unnamedLocal({ ...bare, start_date: "2018-01-01" })).toBe(true);
    // 2024 held the European election too.
    expect(unnamedLocal({ ...bare, start_date: "2024-01-01" })).toBe(false);
  });
});

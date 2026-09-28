import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { createError, getQuery } from "h3";
import NoteTriageCard from "../../app/components/note/TriageCard.vue";
import NoteTriageSubject from "../../app/components/note/TriageSubject.vue";
import type { NoteRow } from "~~/shared/model";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  key: "note-1:0",
  noteId: "note-1",
  sourceIndex: 0,
  nodeId: "node-1",
  nodeName: "Jan Testowy",
  nodeType: "person",
  userUid: "user-a",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: null,
  note: "brakuje spółki",
  url: "https://www.example.com/artykul?a=1",
  kind: "change_request",
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...overrides,
});

const mount = (overrides: Partial<NoteRow> = {}) =>
  mountSuspended(NoteTriageCard, {
    props: { row: row(overrides) },
    global: { stubs: { UserChip: true } },
  });

describe("NoteTriageCard", () => {
  it("shows the note beside the node and the source it came from", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Jan Testowy");
    expect(wrapper.text()).toContain("brakuje spółki");
    expect(wrapper.text()).toContain("Do poprawy");
    // The type is read off the source as much as the note, so the link opens
    // in its own tab rather than losing the reviewer's place in the queue.
    const link = wrapper.get("a.source-link");
    expect(link.attributes("href")).toBe("https://www.example.com/artykul?a=1");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.text()).toContain("example.com");
  });

  it("links the node's name to its page, in a tab of its own", async () => {
    // No hyphen in the id: the page's route reads the id off after the last
    // one, and the url asserted here should be one that resolves.
    const wrapper = await mount({ nodeId: "node1" });

    // A real anchor, so a click, a ctrl-click and a middle-click all reach the
    // page - the name once rendered as an unresolved <nuxtlink> tag with the
    // right url on it and nothing to follow it.
    const link = wrapper.get("a.node-name");
    expect(link.attributes("href")).toBe("/osoba/jan-testowy-node1");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.text()).toBe("Jan Testowy");
    expect(wrapper.find("nuxtlink").exists()).toBe(false);
    // The open-in-new icon is part of the same anchor: drawn beside it, it
    // was a second thing that looked like a link and did nothing.
    expect(link.find(".v-icon").exists()).toBe(true);
    expect(wrapper.findAll(".node-name ~ .v-icon")).toHaveLength(0);
  });

  it("says so when there is no source to read", async () => {
    const wrapper = await mount({ url: null });

    expect(wrapper.find("a.source-link").exists()).toBe(false);
    expect(wrapper.text()).toContain("Brak źródła");
  });

  it("still shows an entry written on a node with no name yet", async () => {
    // Notes are commonly written on nodes only proposed as a revision, which
    // resolve to no name - dropping the link must not drop the card.
    const wrapper = await mount({ nodeName: null, nodeType: null });

    expect(wrapper.text()).toContain("node-1");
    expect(wrapper.text()).toContain("brakuje spółki");
    expect(wrapper.find("a.node-name").exists()).toBe(false);
    expect(wrapper.find(".node-name .v-icon").exists()).toBe(false);
  });

  it("shows something readable for a url that is not one", async () => {
    const wrapper = await mount({ url: "gazeta, strona 3" });

    expect(wrapper.text()).toContain("gazeta, strona 3");
  });
});

/** Jan Testowy as the section reads him: the node on its own, and the local
 * graph around it - a post and a candidacy, whose far ends are a company and
 * the town he stood in. The graph files each node under a canvas shape, with
 * the kind in `entityType`, which is what `useEdges` turns back. */
const JAN = {
  id: "osoba1",
  type: "person",
  name: "Jan Testowy",
  parties: ["PiS"],
  birthDate: "1970-01-02",
};

/** The query the node was asked for with, set by the endpoint below. */
let nodeQuery: Record<string, unknown> = {};

registerEndpoint("/api/nodes/osoba1", (event) => {
  nodeQuery = getQuery(event);
  return { node: JAN };
});
registerEndpoint("/api/graph/local/osoba1", () => ({
  nodes: {
    osoba1: { ...JAN, type: "circle", entityType: "person" },
    wodkal: {
      id: "wodkal",
      name: "Wodociągi Miejskie (Kalisz)",
      type: "rect",
      entityType: "place",
    },
    kalisz: {
      id: "kalisz",
      name: "Kalisz",
      type: "document",
      entityType: "region",
    },
  },
  edges: [
    {
      id: "job1",
      source: "osoba1",
      target: "wodkal",
      type: "employed",
      name: "Prezes zarządu",
      start_date: "2021-05-01",
    },
    {
      id: "run1",
      source: "osoba1",
      target: "kalisz",
      type: "election",
      name: "kandydatura",
      position: "Rada miasta",
      party: "PiS",
      start_date: "2024-04-07",
    },
  ],
}));

/** A person somebody has only proposed: the node answers from its revision,
 * and the graph knows neither it nor any relation of it. */
registerEndpoint("/api/nodes/propozycja1", () => ({
  node: {
    id: "propozycja1",
    type: "person",
    name: "Piotr Proponowany",
    birthDate: "1981-03-04",
    published: false,
  },
}));
registerEndpoint("/api/graph/local/propozycja1", () => ({
  nodes: {},
  edges: [],
}));

/** A company, whose relations are the people on it. */
registerEndpoint("/api/nodes/szpital1", () => ({
  node: { id: "szpital1", type: "place", name: "Szpital Miejski" },
}));
registerEndpoint("/api/graph/local/szpital1", () => ({
  nodes: {
    szpital1: {
      id: "szpital1",
      name: "Szpital Miejski",
      type: "rect",
      entityType: "place",
    },
    osoba2: {
      id: "osoba2",
      name: "Anna Nowak",
      type: "circle",
      entityType: "person",
    },
  },
  edges: [
    {
      id: "job2",
      source: "osoba2",
      target: "szpital1",
      type: "employed",
      name: "Dyrektor",
      start_date: "2019-01-01",
    },
  ],
}));

/** Two nodes with nothing to add to the card: one that resolves to nothing,
 * and a company nobody has linked anyone to. */
registerEndpoint("/api/nodes/brak1", () => {
  throw createError({ statusCode: 404 });
});
registerEndpoint("/api/graph/local/brak1", () => ({ nodes: {}, edges: [] }));
registerEndpoint("/api/nodes/pusta1", () => ({
  node: { id: "pusta1", type: "place", name: "Pusta Spółka" },
}));
registerEndpoint("/api/graph/local/pusta1", () => ({
  nodes: {
    pusta1: {
      id: "pusta1",
      name: "Pusta Spółka",
      type: "rect",
      entityType: "place",
    },
  },
  edges: [],
}));

const mountSubject = async (nodeId: string) => {
  const section = await mountSuspended(NoteTriageSubject, {
    props: { nodeId },
  });
  await flushPromises();
  return section;
};

/** The record under the queue's choices, so that whoever categorizes on a
 * phone can read who a note is about without switching to the table. */
describe("NoteTriageSubject", () => {
  beforeEach(() => clearNuxtData());

  it("shows who the note is about: parties, record and relations", async () => {
    const section = await mountSubject("osoba1");

    expect(section.get("h2").text()).toBe("Kogo dotyczy notatka");
    expect(section.text()).toContain("Jan Testowy");
    expect(section.text()).toContain("PiS");
    expect(section.text()).toContain("1970-01-02");
    // What a note is judged against: whether the post or the candidacy it
    // names is already on record.
    expect(section.text()).toContain("Wodociągi Miejskie (Kalisz)");
    expect(section.text()).toContain("Prezes zarządu");
    expect(section.text()).toContain("Rada miasta");
    // `latest`, so a node only proposed so far still has a record to show.
    expect(nodeQuery.latest).toBe("true");
  });

  it("opens a relation in a tab of its own, so the queue keeps its place", async () => {
    const section = await mountSubject("osoba1");

    const rows = section.findAll(".history-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.attributes("target")).toBe("_blank");
    }
  });

  it("searches the person in the town they stood and work in", async () => {
    // Kalisz twice over - the candidacy's region and the town in the
    // employer's name - read off the relations rather than out of the region
    // collection, and searched once.
    const section = await mountSubject("osoba1");

    const queries = section
      .findAll(".v-btn")
      .map((button) => button.text().trim());
    expect(queries.filter((q) => q === "Jan Testowy Kalisz")).toHaveLength(1);
  });

  it("still shows a person only proposed so far, who has no relations yet", async () => {
    const section = await mountSubject("propozycja1");

    expect(section.get("h2").text()).toBe("Kogo dotyczy notatka");
    expect(section.text()).toContain("Piotr Proponowany");
    expect(section.text()).toContain("1981-03-04");
    expect(section.find(".history-row").exists()).toBe(false);
  });

  it("lists a company's relations under its name", async () => {
    const section = await mountSubject("szpital1");

    expect(section.get("h2").text()).toBe("Czego dotyczy notatka");
    const title = section.get(".v-card-title a");
    expect(title.text()).toBe("Szpital Miejski");
    expect(title.attributes("href")).toBe(
      "/instytucja/szpital-miejski-szpital1",
    );
    expect(title.attributes("target")).toBe("_blank");
    const row = section.get(".history-row");
    expect(row.text()).toContain("Anna Nowak");
    expect(row.text()).toContain("Dyrektor");
  });

  it("draws nothing for a node with nothing to add to the card", async () => {
    for (const nodeId of ["brak1", "pusta1"]) {
      const section = await mountSubject(nodeId);

      expect(section.find("[data-testid='triage-subject']").exists()).toBe(
        false,
      );
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { getQuery } from "h3";
import { VBtn } from "vuetify/components";
import PersonChanges from "../../../app/components/succession/PersonChanges.vue";
import type {
  PersonSuccession,
  PersonSuccessions,
  SuccessionSide,
} from "../../../server/api/edges/successions.get";

/** What the endpoint will answer with, set by each test before it mounts. */
let response: PersonSuccessions = { posts: [], hidden: 0 };

/** How many times it was asked, so the empty case can tell "the answer was
 * nothing" from "the request has not landed yet". */
let served = 0;

/** The query the component actually sent, which is where the redaction gate is
 * decided - see the `latest` tests at the bottom. */
let lastQuery: Record<string, unknown> = {};

registerEndpoint("/api/edges/successions", (event) => {
  served += 1;
  lastQuery = getQuery(event);
  return response;
});

function side(
  name: string,
  extra: Partial<SuccessionSide & { gapDays: number }> = {},
): SuccessionSide & { gapDays: number } {
  return {
    edgeId: `e-${name}`,
    personId: `p-${name}`,
    personName: name,
    parties: [],
    start: null,
    end: null,
    published: true,
    gapDays: 0,
    ...extra,
  };
}

function post(extra: Partial<PersonSuccession> = {}): PersonSuccession {
  return {
    companyId: "tauron",
    companyName: "Tauron Dystrybucja",
    role: "Zarząd",
    start: "2024-05-16",
    end: "2024-07-02",
    predecessor: null,
    successor: null,
    ...extra,
  };
}

/** Mounts and waits for the fetch to land.
 *
 * The component does not await its own `authFetch` - Nuxt settles it before
 * serialising a server rendered page, and awaiting would hold a client-side
 * navigation on this one section - so `mountSuspended` returns before the
 * answer is in, and on this component there is nothing on screen until it is.
 */
async function mountChanges(props: Record<string, unknown> = {}) {
  const before = served;
  const wrapper = await mountSuspended(PersonChanges, {
    props: { personId: "marzena", personName: "Marzena Słomka", ...props },
  });
  await vi.waitUntil(() => served > before, { timeout: 5000 });
  await flushPromises();
  return wrapper;
}

describe("SuccessionPersonChanges", () => {
  beforeEach(() => {
    response = { posts: [], hidden: 0 };
    // One Nuxt app serves the whole file, so the previous test's answer is
    // still in the payload and the next mount would re-serve it without
    // asking for anything.
    clearNuxtData();
  });

  it("names who held the seat before this person", async () => {
    response = {
      posts: [
        post({
          companyName: "Pomorskie Hurtowe Centrum Rolno-Spożywcze",
          role: "Rada Nadzorcza",
          predecessor: side("Hubert Grzegorczyk", {
            parties: ["PiS"],
            start: "2021-03-01",
            end: "2024-05-16",
          }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();
    const card = wrapper.get('[data-testid="succession-predecessor"]');

    expect(card.text()).toContain("Wcześniej na tym stanowisku");
    expect(card.text()).toContain("Hubert Grzegorczyk");
    expect(card.text()).toContain("PiS");
    // The person whose page this is, on the other side of the arrow.
    expect(card.text()).toContain("Ta osoba");
    expect(card.text()).toContain("Marzena Słomka");
    expect(card.text()).toContain("Pomorskie Hurtowe Centrum Rolno-Spożywcze");
    expect(card.text()).toContain("Rada Nadzorcza");
    // `gapLabel` from shared/succession.ts, so the page and the score agree.
    expect(card.text()).toContain("tego samego dnia");
    const links = card.findAll("a").map((a) => a.attributes("href"));
    expect(links[0]).toContain("/instytucja/");
    expect(links[1]).toContain("/osoba/hubert-grzegorczyk-");
    // This person's own name is not a link back to the page they are on.
    expect(links).toHaveLength(2);
  });

  it("names who took the seat over from them", async () => {
    response = {
      posts: [
        post({
          successor: side("Mirosław Antoni Gornowicz", {
            start: "2024-07-02",
            gapDays: 38,
          }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();
    const card = wrapper.get('[data-testid="succession-successor"]');

    expect(card.text()).toContain("Następnie na tym stanowisku");
    expect(card.text()).toContain("Mirosław Antoni Gornowicz");
    expect(card.text()).toContain("po 38 dniach przerwy");
    expect(
      wrapper.find('[data-testid="succession-predecessor"]').exists(),
    ).toBe(false);
  });

  it("offers the chain explorer from the heading", async () => {
    response = {
      posts: [
        post({
          predecessor: side("Hubert Grzegorczyk", { end: "2024-05-16" }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    const explore = wrapper.get('[data-testid="person-successions-explore"]');
    expect(explore.text()).toContain("Zobacz łańcuch");

    // Read off the prop rather than off the rendered `href`. `v-btn` resolves
    // `to` through `resolveDynamicComponent("RouterLink")`, which answers with
    // the bare string in this environment - so the anchor comes out with no
    // `href` at all, whatever `to` says. Everything this assertion is actually
    // about is in the prop: `parseEntityUrlSlug` takes the id to be the last
    // dash-separated segment, so the slug has to sit in front of the id and
    // the id itself must carry no dash. That the browser really navigates
    // there is `tests/e2e/sukcesje.spec.ts`'s job.
    const button = wrapper
      .findAllComponents(VBtn)
      .find(
        (btn) => btn.attributes("data-testid") === "person-successions-explore",
      );
    expect(button?.props("to")).toBe(
      "/eksploruj/sukcesje/marzena-slomka-marzena",
    );
  });

  it("says how much of the history the section covers", async () => {
    response = {
      posts: [
        post({
          predecessor: side("Hubert Grzegorczyk", { end: "2024-05-16" }),
        }),
        post({
          companyId: "mpec",
          companyName: "MPEC",
          start: "2006-12-15",
          end: "2008-12-05",
          predecessor: side("Mirosław Gornowicz", { end: "2006-12-15" }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges({ relationCount: 8 });

    const coverage = wrapper
      .get('[data-testid="person-successions-coverage"]')
      .text();
    expect(coverage).toContain("2 z 8 powiązań");
    // The claim the section must not make by omission: a row without a card is
    // far more often a missing filing than a newly created seat.
    expect(coverage).toContain("Brak wpisu nie znaczy");
  });

  it("counts a seat once even when both of its neighbours are known", async () => {
    // The endpoint answers per handover, so one seat this person both took over
    // and handed on arrives as two posts - and "2 z 8" would be counting one
    // relation twice against the history above.
    response = {
      posts: [
        post({
          predecessor: side("Hubert Grzegorczyk", { end: "2024-05-16" }),
        }),
        post({
          successor: side("Mirosław Gornowicz", { start: "2024-07-02" }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges({ relationCount: 8 });

    expect(
      wrapper.get('[data-testid="person-successions-coverage"]').text(),
    ).toContain("1 z 8 powiązań");
    // Both directions are still drawn.
    expect(wrapper.findAll("article")).toHaveLength(2);
  });

  it("renders nothing at all when there is nothing to say", async () => {
    response = { posts: [], hidden: 0 };

    const wrapper = await mountChanges({ relationCount: 8 });

    expect(wrapper.find('[data-testid="person-successions"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toBe("");
  });

  it("says how many handovers it found but will not name", async () => {
    // 896 of 6,592 people in the register have a page, so a section that showed
    // two of fifteen handovers and said nothing would read as a bug.
    response = { posts: [], hidden: 3 };

    const wrapper = await mountChanges({ relationCount: 8 });

    const note = wrapper.get('[data-testid="person-successions-hidden"]');
    expect(note.text()).toContain("3 zmian");
    expect(note.text()).toContain("brakuje strony jednej z osób");
    // The heading is still there: the reader is being told why the list is
    // short, not shown an empty section.
    expect(wrapper.text()).toContain("Zmiany na stanowisku");
  });

  it("says what is missing rather than printing a null date", async () => {
    response = {
      posts: [
        post({
          start: null,
          end: null,
          predecessor: side("Hubert Grzegorczyk", { end: null }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(wrapper.text()).toContain("koniec kadencji nieznany");
    expect(wrapper.text()).toContain("brak dat kadencji");
    expect(wrapper.text()).not.toContain("null");
  });
});

/** The query the section sends.
 *
 * Note what this canNOT check: `authFetch` also appends `latest` from an
 * `onRequest` that returns early on the server, and in a component test there
 * is no server - so a signed in user gets the flag here whether or not the
 * component asks for it itself. The bug that made a logged in reader see
 * "nie pokazujemy jeszcze N zmian" lives entirely in the SSR-to-hydration
 * handover, and the guard for it is `tests/e2e/succession.spec.ts`.
 */
describe("PersonChanges request", () => {
  beforeEach(() => {
    lastQuery = {};
    // One Nuxt app serves the whole file, and `usePersonSuccessions` keys its
    // request on the person - so without this the next mount reads the last
    // one's payload and never asks for anything.
    clearNuxtData();
  });

  it("asks about the person it was given, and nothing else", async () => {
    response = { posts: [], hidden: 2 };

    await mountSuspended(PersonChanges, {
      props: { personId: "p1", personName: "Anna Nowak" },
    });
    await flushPromises();

    expect(lastQuery.personId).toBe("p1");
  });
});

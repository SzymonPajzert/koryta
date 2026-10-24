import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { createError, getQuery } from "h3";
import PersonChanges from "../../../app/components/succession/PersonChanges.vue";
import { useSuccessionToday } from "~/composables/successions";
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

/** The person whose request fails, for the error line. */
const BROKEN = "zepsuty";

registerEndpoint("/api/edges/successions", (event) => {
  served += 1;
  lastQuery = getQuery(event);
  if (lastQuery.personId === BROKEN) {
    throw createError({ statusCode: 500 });
  }
  return response;
});

// The (i) opens a tooltip teleported to <body>, which outlives its component:
// one left open by a test would still be in the document for the next.
enableAutoUnmount(afterEach);

/** The day every spell below is measured to. */
const TODAY = "2026-10-24";

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
    batchSize: 1,
    ...extra,
  };
}

/** `count` handovers at as many companies, each with a predecessor. */
function posts(count: number): PersonSuccession[] {
  return Array.from({ length: count }, (_, i) =>
    post({
      companyId: `c${i}`,
      companyName: `Spółka ${i}`,
      predecessor: side(`Osoba ${i}`, { end: "2024-05-16" }),
    }),
  );
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

type Wrapper = Awaited<ReturnType<typeof mountChanges>>;

/** Opens the (i) - the heading's, or the withheld line's - and hands back
 * the tooltip's text by testid. The tooltip is teleported to <body>. */
async function openInfo(wrapper: Wrapper) {
  await wrapper.get('[data-testid="section-info"]').trigger("click");
  await flushPromises();
  return (testid: string) =>
    document.querySelector(`[data-testid="${testid}"]`)?.textContent.trim();
}

describe("SuccessionPersonChanges", () => {
  beforeEach(() => {
    response = { posts: [], hidden: 0 };
    // One Nuxt app serves the whole file, so the previous test's answer is
    // still in the payload and the next mount would re-serve it without
    // asking for anything.
    clearNuxtData();
    useSuccessionToday().value = TODAY;
  });

  it("draws who held the seat before this person, then this person taking it", async () => {
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

    // The card's own head: the company and the role, which tell one of a
    // person's cards from the next.
    expect(card.get(".succ__company").text()).toBe(
      "Pomorskie Hurtowe Centrum Rolno-Spożywcze",
    );
    // The comma before the role is visually hidden: it is for a reader of the
    // text, which ran the company into the role.
    expect(card.get(".succ__role .visually-hidden").text()).toBe(",");
    expect(card.get(".succ__role").text()).toBe(", Rada Nadzorcza");
    // The row a company's page draws too: the labels are on the sides, so the
    // row reads the way the seat moved, whichever side this person is on.
    const left = card.get('[data-testid="handover-left"]');
    expect(left.text()).toContain("Ustępuje");
    expect(left.text()).toContain("Hubert Grzegorczyk");
    expect(left.text()).toContain("PiS");
    expect(left.get(".handover__period").text()).toBe(
      "01.03.2021 - 16.05.2024 · 3 lata 2 mies.",
    );
    const right = card.get('[data-testid="handover-right"]');
    expect(right.text()).toContain("Obejmuje stanowisko");
    expect(right.text()).toContain("Marzena Słomka");
    expect(right.get(".handover__period").text()).toBe(
      "16.05.2024 - 02.07.2024 · 1 mies.",
    );
    // `gapLabel` from shared/succession.ts, so the page and the score agree.
    expect(card.get('[data-testid="handover-gap"]').text()).toBe(
      "tego samego dnia",
    );
    const links = card.findAll("a").map((a) => a.attributes("href"));
    expect(links[0]).toContain("/instytucja/");
    expect(links[1]).toContain("/osoba/hubert-grzegorczyk-");
    // This person's own name is not a link back to the page they are on.
    expect(links).toHaveLength(2);
  });

  it("draws this person leaving, then who took the seat over from them", async () => {
    response = {
      posts: [
        post({
          successor: side("Mirosław Antoni Gornowicz", {
            start: "2024-08-09",
            gapDays: 38,
          }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();
    const card = wrapper.get('[data-testid="succession-successor"]');

    expect(card.get('[data-testid="handover-left"]').text()).toContain(
      "Marzena Słomka",
    );
    const right = card.get('[data-testid="handover-right"]');
    expect(right.text()).toContain("Obejmuje stanowisko");
    expect(right.text()).toContain("Mirosław Antoni Gornowicz");
    expect(right.get(".handover__period").text()).toBe(
      "od 09.08.2024 · 2 lata 2 mies.",
    );
    expect(card.get('[data-testid="handover-gap"]').text()).toBe(
      "po 38 dniach przerwy",
    );
    expect(
      wrapper.find('[data-testid="succession-predecessor"]').exists(),
    ).toBe(false);
  });

  it("puts this person's own parties on their side, and flags a party change", async () => {
    // The endpoint names the other side's parties only; the page hands this
    // person's in. A person's page used to flag no change at all.
    response = {
      posts: [
        post({
          predecessor: side("Hubert Grzegorczyk", { parties: ["PO"] }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges({ personParties: ["PiS"] });

    expect(wrapper.get('[data-testid="handover-right"]').text()).toContain(
      "PiS",
    );
    expect(wrapper.get('[data-testid="handover-party-change"]').text()).toBe(
      "zmiana afiliacji",
    );
  });

  it("heads the cards with how many it shows", async () => {
    response = { posts: posts(2), hidden: 0 };

    const wrapper = await mountChanges();

    const section = wrapper.get('[data-testid="person-successions"]');
    expect(section.get("h2").text()).toBe("Zmiany na stanowisku");
    expect(wrapper.get('[data-testid="person-successions-count"]').text()).toBe(
      "2 zmiany",
    );
  });

  it("declines the count beside the heading", async () => {
    const caption = async (count: number) => {
      clearNuxtData();
      response = { posts: posts(count), hidden: 0 };
      const wrapper = await mountChanges();
      return wrapper.get('[data-testid="person-successions-count"]').text();
    };

    expect(await caption(1)).toBe("1 zmiana");
    expect(await caption(5)).toBe("5 zmian");
    expect(await caption(12)).toBe("12 zmian");
    expect(await caption(22)).toBe("22 zmiany");
  });

  it("says behind the (i) how much of the history the section covers", async () => {
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

    // The five lines of method that stood under the heading pushed the first
    // card off a phone's screen; the count beside it is all that stays.
    expect(wrapper.text()).not.toContain("Brak wpisu");
    const info = await openInfo(wrapper);
    const coverage = info("person-successions-coverage");
    expect(coverage).toContain("2 z 8 powiązań");
    // The claim the section must not make by omission: a row without a card is
    // far more often a missing filing than a newly created seat.
    expect(coverage).toContain("Brak wpisu nie znaczy");
    // Nothing withheld, so nothing said about it.
    expect(info("person-successions-hidden")).toBeUndefined();
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

    const info = await openInfo(wrapper);
    expect(info("person-successions-coverage")).toContain("1 z 8 powiązań");
    // Both directions are still drawn.
    expect(wrapper.findAll("article")).toHaveLength(2);
  });

  it("says how many it withholds beside the count, and why behind the (i)", async () => {
    response = { posts: posts(1), hidden: 3 };

    const wrapper = await mountChanges({ relationCount: 8 });

    expect(wrapper.get('[data-testid="person-successions-count"]').text()).toBe(
      "1 zmiana · 3 pominięte",
    );
    const info = await openInfo(wrapper);
    expect(info("person-successions-hidden")).toBe(
      "Nie pokazujemy jeszcze 3 zmian\u00a0- brakuje strony jednej z osób, więc nie nazywamy jej tutaj.",
    );
  });

  it("renders nothing at all when there is nothing to say", async () => {
    response = { posts: [], hidden: 0 };

    const wrapper = await mountChanges({ relationCount: 8 });

    expect(wrapper.find('[data-testid="person-successions"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toBe("");
  });

  it("says in one line how many handovers it found but will not name", async () => {
    // 896 of 6,592 people in the register have a page, so withholding them
    // all and saying nothing would read as a bug - and a heading over a
    // sentence that says there is nothing under it is a section of nothing.
    response = { posts: [], hidden: 3 };

    const wrapper = await mountChanges({ relationCount: 8 });

    const note = wrapper.get('[data-testid="person-successions-note"]');
    expect(note.text()).toBe("Zmiany na stanowiskach: 3 pominięte");
    expect(note.classes()).toContain("k-absent");
    expect(wrapper.find('[data-testid="person-successions"]').exists()).toBe(
      false,
    );
    expect(wrapper.find("h2").exists()).toBe(false);
    // Why none are shown, then what the section would cover.
    const info = await openInfo(wrapper);
    expect(info("person-successions-hidden")).toContain("3 zmian");
    expect(info("person-successions-hidden")).toContain(
      "brakuje strony jednej z osób",
    );
    expect(info("person-successions-coverage")).toContain("0 z 8 powiązań");
  });

  it("declines the withheld count, agreeing with „zmiana”", async () => {
    const note = async (hidden: number) => {
      clearNuxtData();
      response = { posts: [], hidden };
      const wrapper = await mountChanges();
      return wrapper.get('[data-testid="person-successions-note"]').text();
    };

    expect(await note(1)).toBe("Zmiany na stanowiskach: 1 pominięta");
    expect(await note(2)).toBe("Zmiany na stanowiskach: 2 pominięte");
    expect(await note(5)).toBe("Zmiany na stanowiskach: 5 pominiętych");
    expect(await note(12)).toBe("Zmiany na stanowiskach: 12 pominiętych");
    expect(await note(22)).toBe("Zmiany na stanowiskach: 22 pominięte");
  });

  it("hedges the name where a whole board changed that day", async () => {
    response = {
      posts: [
        post({
          predecessor: side("Hubert Grzegorczyk", { end: "2024-05-16" }),
          batchSize: 4,
        }),
        post({
          companyId: "mpec",
          companyName: "MPEC",
          predecessor: side("Mirosław Gornowicz", { end: "2024-05-16" }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    // Which of the four departing members this person followed is not
    // something the register says, so the card admits as much - once, under
    // the row, and only on that card.
    const notes = wrapper.findAll('[data-testid="succession-batch-note"]');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text()).toBe(
      "Tego dnia zmieniły się 4 stanowiska tej samej funkcji. Rejestr nie wskazuje, kto zajął czyje miejsce.",
    );
  });

  it("says what is missing rather than printing a null date", async () => {
    response = {
      posts: [
        post({
          start: null,
          end: null,
          role: " ",
          predecessor: side("Hubert Grzegorczyk", { end: null }),
        }),
      ],
      hidden: 0,
    };

    const wrapper = await mountChanges();

    expect(
      wrapper.findAll(".handover__period").map((period) => period.text()),
    ).toEqual(["brak dat kadencji", "brak dat kadencji"]);
    // A hand-made edge cannot leave the seat a blank.
    expect(wrapper.get(".succ__role").text()).toBe(
      ", funkcja niepodana w rejestrze",
    );
    expect(wrapper.text()).not.toContain("null");
  });

  it("says so when the request fails, rather than nothing", async () => {
    const wrapper = await mountChanges({ personId: BROKEN });

    expect(wrapper.get('[data-testid="person-successions-error"]').text()).toBe(
      "Nie udało się wczytać zmian na stanowiskach. Odśwież stronę.",
    );
    expect(wrapper.find('[data-testid="person-successions"]').exists()).toBe(
      false,
    );
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

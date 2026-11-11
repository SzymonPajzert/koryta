import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount } from "@vue/test-utils";
import { Comment, h } from "vue";
import SeatCard from "../../../app/components/succession/SeatCard.vue";

enableAutoUnmount(afterEach);

/** Whoever holds the seat, as the company page hands them over. */
const holder = {
  name: "Marcin Marzyński",
  url: "/osoba/marcin-marzynski-p1",
  published: true,
  parties: ["PiS", "Suwerenna Polska"],
};

function mountCard(
  props: Record<string, unknown> = {},
  options: {
    slots?: Record<string, () => unknown>;
    attrs?: Record<string, unknown>;
  } = {},
) {
  return mountSuspended(SeatCard, {
    props: { ...holder, ...props },
    ...options,
  });
}

type Wrapper = Awaited<ReturnType<typeof mountCard>>;

/** The rows of the card's text, top to bottom: the name's line, the pill's,
 * and whatever the caller adds under them. */
function rows(card: Wrapper): Element[] {
  return [...card.get(".board-card__text").element.children];
}

/** The board card of the company page's „Obecny skład”, which a region's
 * „Władze” draws its head with too. */
describe("SuccessionSeatCard", () => {
  it("names the holder, links their page and lists their parties", async () => {
    const card = await mountCard();

    const link = card.get(".board-card__text a");
    expect(link.text()).toBe("Marcin Marzyński");
    expect(link.attributes("href")).toBe("/osoba/marcin-marzynski-p1");
    expect(link.attributes("rel")).toBeUndefined();
    expect(card.get(".board-card__avatar").text()).toBe("MM");
    expect(card.findAll(".chip").map((chip) => chip.text())).toEqual([
      "PiS",
      "Suwerenna Polska",
    ]);
    expect(card.find('[data-testid="hidden-party"]').exists()).toBe(false);
  });

  it("tells a crawler not to follow a page nobody published, and stands a chip in for a party it is not told", async () => {
    const card = await mountCard({
      published: false,
      parties: [],
      partyHidden: true,
    });

    expect(card.get(".board-card__text a").attributes("rel")).toBe("nofollow");
    expect(card.findAll('[data-testid="hidden-party"]')).toHaveLength(1);
  });

  it("says since when in the pill, with what the caller adds on its line", async () => {
    const card = await mountCard(
      { since: "od 12.04.2024" },
      {
        slots: {
          "after-pill": () =>
            h("span", { class: "tenure" }, "2 lata na stanowisku"),
        },
      },
    );

    const pill = card.get(".now-pill");
    expect(pill.text()).toBe("od 12.04.2024");
    // Inline, right after the pill, on the pill's own line.
    expect(pill.element.nextElementSibling?.className).toBe("tenure");
    expect(rows(card)).toHaveLength(2);
  });

  it("draws the pill's line for what the caller adds even without a pill", async () => {
    const card = await mountCard(
      {},
      { slots: { "after-pill": () => h("span", { class: "tenure" }) } },
    );

    expect(card.find(".now-pill").exists()).toBe(false);
    expect(rows(card)[1]?.querySelector(".tenure")).not.toBeNull();
  });

  it("leaves the pill's line out when there is neither a pill nor anything after it", async () => {
    // A caller that passes no slot, and one whose content came out empty: a
    // `v-if` that is false leaves only its comment.
    const callers: Record<string, () => unknown>[] = [
      {},
      { "after-pill": () => [h(Comment, "v-if")] },
    ];
    for (const slots of callers) {
      const card = await mountCard({}, { slots });

      expect(rows(card)).toHaveLength(1);
      expect(card.find(".mt-2").exists()).toBe(false);
    }
  });

  it("puts the details under the pill's line", async () => {
    const card = await mountCard(
      { since: "od 12.04.2024" },
      {
        slots: {
          details: () => h("div", { class: "committee" }, "z listy KWW"),
        },
      },
    );

    const [name, pill, details] = rows(card);
    expect(name?.querySelector("a")).not.toBeNull();
    expect(pill?.querySelector(".now-pill")).not.toBeNull();
    expect(details?.className).toBe("committee");
  });

  it("keeps a column for the tools only when asked, with the slot's content standing in it", async () => {
    const tools = () => h("button", { class: "fix" }, "Popraw");

    const withTools = await mountCard({ tools: true }, { slots: { tools } });
    expect(withTools.get(".board-card").classes()).toContain(
      "board-card--tools",
    );
    // No box of the card's own around it: the grid places the slot's content
    // in the tools column itself.
    expect(withTools.find(".board-card > .fix").exists()).toBe(true);

    const without = await mountCard();
    expect(without.get(".board-card").classes()).not.toContain(
      "board-card--tools",
    );
  });

  it("hands the caller's attributes to the card's outer box", async () => {
    const card = await mountCard(
      {},
      { attrs: { "data-testid": "region-head", "aria-current": "true" } },
    );

    const box = card.get('[data-testid="region-head"]');
    expect(box.classes()).toContain("k-card");
    expect(box.element).toBe(card.get(".board-card").element.parentElement);
    expect(box.attributes("aria-current")).toBe("true");
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import BlogBody from "../../../app/components/blog/Body.vue";
import BlogChart from "../../../app/components/blog/Chart.vue";
import BlogEntity from "../../../app/components/blog/Entity.vue";
import BlogStats from "../../../app/components/blog/Stats.vue";
import type { BlogPost } from "../../../shared/blog";

// The embeds are given their props the way the renderer gives them: as
// attributes, already decoded from the JSON MDC stores a YAML block as.
// `apexchart` is stubbed, as everywhere in the suite: it measures a real
// element on mount, which happy-dom does not have.
const global = { stubs: { apexchart: true } };

registerEndpoint("/api/nodes/1", () => ({
  node: { id: "1", type: "person", name: "Jan Kowalski", published: true },
}));
registerEndpoint("/api/nodes/ukryty", () => {
  throw createError({ statusCode: 404 });
});

describe("BlogStats", () => {
  it("draws a tile per number", async () => {
    const wrapper = await mountSuspended(BlogStats, {
      attrs: {
        items: [
          { label: "Osoby", value: 5086 },
          { label: "Odsetek", value: 4.8, unit: "%" },
        ],
      },
    });
    const values = wrapper.findAll(".stat-tile__value").map((v) => v.text());
    expect(values).toEqual(["5086", "4,8%"]);
    // The items are not written onto the element as an html attribute.
    expect(wrapper.html()).not.toContain("items=");
  });

  it("says it could not draw itself, rather than drawing nothing", async () => {
    const wrapper = await mountSuspended(BlogStats, {
      attrs: { items: [{ label: "Osoby", value: "5 086" }] },
    });
    expect(wrapper.find("[data-testid=blog-embed-error]").text()).toContain(
      "items.0.value",
    );
  });
});

describe("BlogChart", () => {
  it("has the table of its numbers behind the toggle", async () => {
    const wrapper = await mountSuspended(BlogChart, {
      global,
      attrs: {
        title: "Osoby według branży",
        categories: ["Energetyka", "Transport"],
        series: [{ name: "Osoby", data: [1200, 64] }],
      },
    });
    expect(wrapper.text()).toContain("Osoby według branży");

    await wrapper.get('[aria-label="Tabela z liczbami"]').trigger("click");
    const rows = wrapper
      .findAll("tbody tr")
      .map((row) => row.findAll("td").map((cell) => cell.text()));
    expect(rows).toEqual([
      ["Energetyka", "1200"],
      ["Transport", "64"],
    ]);
  });

  it("prints where the numbers come from", async () => {
    const wrapper = await mountSuspended(BlogChart, {
      global,
      attrs: {
        title: "Wykres",
        source: "KRS",
        categories: ["A"],
        series: [{ name: "X", data: [1] }],
      },
    });
    expect(wrapper.get("figcaption").text()).toBe("Źródło: KRS");
  });
});

describe("BlogEntity", () => {
  it("links the words to the page as it is named now", async () => {
    const wrapper = await mountSuspended(BlogEntity, {
      attrs: { id: "1" },
      slots: { default: () => "Janem Kowalskim" },
    });
    await flushPromises();
    const link = wrapper.get("a");
    expect(link.attributes("href")).toBe("/osoba/jan-kowalski-1");
    expect(link.text()).toBe("Janem Kowalskim");
  });

  it("leaves the words as text when the page cannot be read", async () => {
    const wrapper = await mountSuspended(BlogEntity, {
      attrs: { id: "ukryty" },
      slots: { default: () => "Ktoś" },
    });
    await flushPromises();
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toBe("Ktoś");
  });
});

describe("BlogBody", () => {
  it("draws a post's embeds with the blog's components", async () => {
    const post: BlogPost = {
      slug: "test",
      path: "/blog/test",
      title: "Test",
      description: "Opis",
      date: "2026-10-11",
      authors: ["Autor"],
      draft: false,
      readingMinutes: 1,
      body: {
        type: "minimark",
        value: [
          ["p", {}, "Wstęp."],
          ["stats", { ":items": '[{"label":"Osoby","value":3}]' }],
          ["callout", { title: "Metodologia" }, ["p", {}, "Jak liczyliśmy."]],
        ],
      },
    };
    const wrapper = await mountSuspended(BlogBody, { global, props: { post } });
    await flushPromises();
    expect(wrapper.find("[data-testid=blog-stats]").exists()).toBe(true);
    expect(wrapper.get("[data-testid=blog-callout]").text()).toContain(
      "Jak liczyliśmy.",
    );
  });
});

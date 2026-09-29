import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import GrayLayout from "../../app/layouts/gray.vue";

const vuetify = createVuetify({ components });

// mockNuxtImport is hoisted above the module body, so the route has to be too.
// Each test sets the meta before it mounts.
const route = vi.hoisted(() => ({
  path: "/",
  meta: {} as Record<string, unknown>,
}));
mockNuxtImport("useRoute", () => () => route);

function mountLayout() {
  return mount(GrayLayout, {
    global: {
      plugins: [vuetify],
      // The default layout around it - app bar, footer, toolbar - is not what
      // is under test, only the sheet this one puts inside it.
      stubs: { NuxtLayout: { template: "<div><slot /></div>" } },
    },
    slots: { default: "<p>Treść</p>" },
  });
}

describe("GrayLayout", () => {
  beforeEach(() => {
    route.meta = {};
  });

  it("puts the page on a white sheet 1200px wide at most", () => {
    const sheet = mountLayout().get(".v-sheet");

    expect(sheet.text()).toBe("Treść");
    expect(sheet.attributes("style")).toContain("max-width: 1200px");
  });

  it("takes a narrower sheet from the page's maxWidth", () => {
    // What /plik asks for: a legal text is read line by line, and at 1200 the
    // regulamin's lines average 100 characters.
    route.meta = { layout: "gray", fullWidth: true, maxWidth: 860 };

    const sheet = mountLayout().get(".v-sheet");

    expect(sheet.attributes("style")).toContain("max-width: 860px");
  });
});

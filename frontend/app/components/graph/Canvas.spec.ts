import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { GraphCanvas } from "#components";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

describe("GraphCanvas", () => {
  it("can mount some component", async () => {
    const component = await mountSuspended(GraphCanvas, {
      global: { plugins: [vuetify] },
    });
    expect(component.text()).toMatchInlineSnapshot(`"Ładuję..."`);
  });
});

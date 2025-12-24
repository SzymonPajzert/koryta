import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Card from "../../../app/components/home/Card.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

describe("Card", () => {
    it("renders default slot content", () => {
        const wrapper = mount(Card, {
            global: { plugins: [vuetify] },
            slots: { default: "Content" }
        });
        expect(wrapper.text()).toContain("Content");
    });

    it("renders header slot content", () => {
        const wrapper = mount(Card, {
            global: { plugins: [vuetify] },
            slots: { 
                default: "Content",
                header: "Header Title"
            }
        });
        expect(wrapper.text()).toContain("Header Title");
        expect(wrapper.find("h2").text()).toBe("Header Title");
    });

    it("does not render header markup if slot missing", () => {
         const wrapper = mount(Card, {
            global: { plugins: [vuetify] },
            slots: { default: "Content" }
        });
        expect(wrapper.find("h2").exists()).toBe(false);
    });
});

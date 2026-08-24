import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import TargetCell from "../../../app/components/revision/TargetCell.vue";
import type { Proposal } from "~~/shared/proposals";

const vuetify = createVuetify({ components, directives });

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: "" } },
  setup(props, { slots }) {
    return () => h("a", { href: String(props.to) }, slots.default?.());
  },
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "rev1",
  targetId: "n1",
  targetCollection: "nodes",
  targetName: "Jan Kowalski",
  targetType: "person",
  targetPath: "/osoba/n1",
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [],
  changeCount: 1,
  updateTime: "2026-08-20T10:00:00.000Z",
  updateUser: "u1",
  author: null,
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  stale: false,
  ...over,
});

const mountCell = (over: Partial<Proposal> = {}) =>
  mount(TargetCell, {
    props: { proposal: proposal(over) },
    global: { plugins: [vuetify], stubs: { NuxtLink: NuxtLinkStub } },
  });

describe("RevisionTargetCell", () => {
  it("renders the entry name as body text, not as a browser-default link", () => {
    const wrapper = mountCell();

    // The same class the profile card uses. The queue and the profile render
    // the same proposal, and `shared/proposals.ts` is explicit that the two
    // sides must not disagree by a rendering difference - which a column of
    // blue anchors on one and plain text on the other would be.
    expect(wrapper.get('a[href="/osoba/n1"]').classes()).toContain(
      "link-plain",
    );
  });

  it("renders a target with no page as plain text rather than a dead link", () => {
    const wrapper = mountCell({ targetPath: null, targetName: "Powiązanie" });

    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toContain("Powiązanie");
  });
});

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ReviewActions from "../../../app/components/revision/ReviewActions.vue";
import type { Proposal } from "~~/shared/proposals";

const vuetify = createVuetify({ components, directives });

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "rev1",
  targetId: "n1",
  targetCollection: "nodes",
  targetName: "Jan Kowalski",
  targetType: "person",
  targetPath: "/osoba/n1",
  targetExists: true,
  published: false,
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

const mountActions = (over: Partial<Proposal> = {}) =>
  mount(ReviewActions, {
    props: { proposal: proposal(over), reviewable: true },
    global: { plugins: [vuetify] },
  });

describe("RevisionReviewActions", () => {
  it("offers to publish an unpublished page along with the approval", async () => {
    const wrapper = mountActions();

    await wrapper.get('[data-testid="approve-publish-rev1"]').trigger("click");

    expect(wrapper.emitted("approve")).toEqual([[{ publish: true }]]);
  });

  it("does not offer to publish the page a removal deletes", () => {
    // It was the prominent button on every removal of a draft, and approving
    // with it filed a publication of a page nobody can open.
    const wrapper = mountActions({ kind: "removal", deleteReason: "duplikat" });

    expect(wrapper.find('[data-testid="approve-publish-rev1"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="approve-rev1"]').exists()).toBe(true);
  });
});

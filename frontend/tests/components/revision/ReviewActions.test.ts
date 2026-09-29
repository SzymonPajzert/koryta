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
    props: { proposal: proposal(over) },
    global: { plugins: [vuetify] },
  });

describe("RevisionReviewActions", () => {
  it("offers the decisions and nothing else", () => {
    // It used to end in "Porównanie" and a copy-link icon too, and the owner
    // asked why a row had two kinds of button - one deciding here, one going
    // somewhere else, present on some rows and not on others.
    const wrapper = mountActions();

    expect(
      wrapper.findAll("button, a").map((el) => el.text().replace(/\s+/g, " ")),
    ).toEqual(["Zatwierdź", "Zatwierdź i opublikuj", "Odrzuć"]);
    expect(wrapper.find("a").exists()).toBe(false);
  });

  it("leaves rejecting out where it would only overwrite the record", () => {
    const wrapper = mount(ReviewActions, {
      props: { proposal: proposal({ status: "approved" }), rejectable: false },
      global: { plugins: [vuetify] },
    });

    expect(wrapper.find('[data-testid="reject-rev1"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="approve-rev1"]').exists()).toBe(true);
  });

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

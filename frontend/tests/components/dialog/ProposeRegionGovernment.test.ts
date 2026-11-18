import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import ProposeRegionGovernment from "../../../app/components/dialog/ProposeRegionGovernment.vue";
import {
  governmentSections,
  type GovernmentView,
} from "../../../shared/regionAuthorities";
import { authRequest } from "~/composables/auth";

vi.mock("~/composables/auth", () => ({
  authRequest: vi.fn(async () => ({ id: "rev-1", node_id: "teryt1005011" })),
}));
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useFirestore: vi.fn(() => ({})),
  useCollection: vi.fn(() => ref([])),
  useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
  useCurrentUser: vi.fn(() => ref({ uid: "u1" })),
  useIsCurrentUserLoaded: vi.fn(() => ref(true)),
}));

enableAutoUnmount(afterEach);

/** Gmina Łowicz, as a signed in reader's page holds it: every page linked. */
const view: GovernmentView = {
  election: "local-2024",
  head: {
    office: "Burmistrz",
    name: "Mariusz Siewiera",
    committee: "KWW ŁOWICKIE.PL",
    member: "Prawo i Sprawiedliwość",
    page: { id: "siewiera", published: false, parties: [] },
  },
  councils: [
    {
      office: "Rada miasta",
      seats: 21,
      members: [
        {
          name: "Jakub Wolski",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          committeeParties: ["PiS"],
          page: { id: "wolski", published: true, parties: ["PiS"] },
        },
        { name: "Hubert Krajewski", committee: "KWW ŁOWICKIE.PL" },
      ],
    },
  ],
};

async function open() {
  const dialog = await mountSuspended(ProposeRegionGovernment, {
    props: {
      regionId: "teryt1005011",
      view,
      sections: governmentSections(view, "gmina"),
    },
    attachTo: document.body,
  });
  await dialog.get('[data-testid="region-propose-change"]').trigger("click");
  await flushPromises();
  return dialog;
}

function field(testid: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    `[data-testid="${testid}"] input`,
  )!;
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function submit() {
  document
    .querySelector<HTMLElement>('[data-testid="region-government-submit"]')!
    .click();
  await flushPromises();
  return vi.mocked(authRequest).mock.calls.at(-1)![1] as {
    body: { node_id: string; authorities: Record<string, unknown> };
  };
}

beforeEach(() => vi.mocked(authRequest).mockClear());

describe("DialogProposeRegionGovernment", () => {
  it("proposes the record as it stands with the one change, a new head unlinked", async () => {
    await open();
    expect(document.body.textContent).toContain("Władze gminy");
    await type(field("region-government-head-name"), "Anna Nowa");

    const { body } = await submit();
    expect(body.node_id).toBe("teryt1005011");
    expect(body.authorities).toEqual({
      election: "local-2024",
      // Somebody else: not Siewiera's page, nor PKW's word on his party.
      head: {
        office: "Burmistrz",
        name: "Anna Nowa",
        committee: "KWW ŁOWICKIE.PL",
      },
      councils: [
        {
          office: "Rada miasta",
          seats: 21,
          members: [
            {
              name: "Jakub Wolski",
              personId: "wolski",
              committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
              committeeParties: ["PiS"],
            },
            { name: "Hubert Krajewski", committee: "KWW ŁOWICKIE.PL" },
          ],
        },
      ],
    });
  });

  it("adds a councillor in a council's tab, without a page", async () => {
    await open();
    document
      .querySelector<HTMLElement>(
        '[data-testid="region-government-tab-rada-0"]',
      )!
      .click();
    await flushPromises();
    document
      .querySelector<HTMLElement>(
        '[data-testid="region-government-add-member"]',
      )!
      .click();
    await flushPromises();
    const row = document.querySelector(
      '[data-testid="region-government-member-0-2"]',
    )!;
    await type(row.querySelector("input")!, "Ewa Nowa");

    const { body } = await submit();
    const [council] = body.authorities.councils as {
      members: { name: string }[];
    }[];
    expect(council!.members.map((member) => member.name)).toEqual([
      "Jakub Wolski",
      "Hubert Krajewski",
      "Ewa Nowa",
    ]);
    expect(council!.members[2]).toEqual({ name: "Ewa Nowa" });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import PlaceClash from "../../../app/components/chip/PlaceClash.vue";
import { useAuthState } from "~/composables/auth";
import type { EdgeNode } from "../../../app/composables/edges";
import type { PlaceClash as Clash } from "../../../shared/twoPlaces";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
  authRequest: vi.fn(),
  authFetch: vi.fn(),
}));

/** A 2002 run of one person's in the region with this TERYT code. */
function run(teryt: string, name: string): EdgeNode {
  return {
    id: `run-${teryt}`,
    type: "election",
    label: "kandydatura",
    source: "kowalski",
    target: `teryt${teryt}`,
    start_date: "2002-01-01",
    position: "Samorząd",
    richNode: { id: `teryt${teryt}`, type: "region", name },
  } as EdgeNode;
}

const sejmik = run("30", "wielkopolskie");
const gniezno = run("3003", "Powiat gnieźnieński");
const kozienice = run("1407", "Powiat kozienicki");

const clash: Clash<EdgeNode> = {
  personId: "kowalski",
  year: "2002",
  position: "Samorząd",
  rows: [sejmik, gniezno, kozienice],
};

const mountChip = (
  props: { edge: EdgeNode; clash?: Clash<EdgeNode> },
  signedIn = true,
) => {
  (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: ref(signedIn ? { uid: "u" } : null),
    isAdmin: ref(false),
  });
  return mountSuspended(PlaceClash, { props });
};

/** The tooltip's words, which Vuetify renders only once it opens. */
async function tooltip(wrapper: Awaited<ReturnType<typeof mountChip>>) {
  await wrapper
    .find("[data-testid^='place-clash-chip-']")
    .trigger("mouseenter");
  await new Promise((resolve) => setTimeout(resolve, 50));
  return document.body.querySelector(".v-tooltip")?.textContent ?? "";
}

describe("ChipPlaceClash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("marks a candidacy whose election has another place in it", async () => {
    const wrapper = await mountChip({ edge: kozienice, clash });
    expect(wrapper.text()).toContain("dwa miejsca");
  });

  it("says nothing on a candidacy with no clash", async () => {
    const wrapper = await mountChip({ edge: gniezno });
    expect(wrapper.text()).not.toContain("dwa miejsca");
  });

  it("stays silent for a logged out visitor", async () => {
    // A guess about a namesake is not something to print on a public profile.
    const wrapper = await mountChip({ edge: kozienice, clash }, false);
    expect(wrapper.text()).not.toContain("dwa miejsca");
  });

  it("names the other places, but not one this run sits inside", async () => {
    // The sejmik's województwo contains powiat gnieźnieński, so for that run
    // the only other place is powiat kozienicki.
    const wrapper = await mountChip({ edge: gniezno, clash });
    const words = await tooltip(wrapper);
    expect(words).toContain("(2002, Samorząd): Powiat kozienicki.");
    expect(words).not.toContain("wielkopolskie");
  });

  it("names every place that disagrees with this one", async () => {
    const wrapper = await mountChip({ edge: kozienice, clash });
    expect(await tooltip(wrapper)).toContain(
      "wielkopolskie, Powiat gnieźnieński.",
    );
  });
});

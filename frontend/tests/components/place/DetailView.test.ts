import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import PlaceDetailView from "../../../app/components/place/DetailView.vue";
import CompanySummary from "../../../app/components/card/CompanySummary.vue";
import { authFetch } from "~/composables/auth";
import { useEdges, type EdgeNode } from "~/composables/edges";
import type { EdgeType, Node } from "../../../shared/model";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref(null), isAdmin: ref(false) })),
  authFetch: vi.fn(),
}));

vi.mock("~/composables/edges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/edges")>()),
  useEdges: vi.fn(),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const COMPANY = "skm";

/** An edge into the company from a region or a company, the shape `useEdges`
 * hands the page. */
function into(
  id: string,
  type: EdgeType,
  from: { id: string; name: string; type: "region" | "place" },
): EdgeNode {
  return {
    id,
    type,
    source: from.id,
    target: COMPANY,
    label: type,
    visibility: true,
    richNode: { ...from } as unknown as Node,
  };
}

const GDYNIA = { id: "teryt2262", name: "Gdynia", type: "region" as const };
const GDANSK = {
  id: "teryt2261011",
  name: "Gmina Gdańsk",
  type: "region" as const,
};

async function mountWith(sources: EdgeNode[]) {
  vi.mocked(authFetch).mockReturnValue({
    data: ref({
      node: { id: COMPANY, type: "place", name: "PKP SKM", published: true },
    }),
    status: ref("success"),
    refresh: vi.fn(),
  } as never);
  vi.mocked(useEdges).mockResolvedValue({
    sources: ref(sources),
    targets: ref([]),
    referencedIn: ref([]),
    refresh: vi.fn(),
  } as never);
  return mountSuspended(PlaceDetailView, {
    props: { nodeId: COMPANY },
    // Every child stubbed: the lists, the graph and the comments each fetch on
    // their own, and what is under test is what the page hands them. The
    // card's content is still drawn, since the lists sit inside it.
    shallow: true,
    global: { renderStubDefaultSlot: true },
  });
}

describe("place/DetailView", () => {
  it("reads the location off the seat, not off a region that owns the company", async () => {
    // PKP SKM is registered in Gdynia and part owned by Gmina Gdańsk, whose
    // `owns` edge came back first - and was printed as „Lokalizacja".
    const page = await mountWith([
      into("edge_teryt2261011_skm_owns", "owns", GDANSK),
      into("seat1", "seat", GDYNIA),
    ]);
    expect(page.findComponent(CompanySummary).props("location")).toBe("Gdynia");
  });

  it("prints no location for a company with a gmina owner and no seat", async () => {
    const page = await mountWith([
      into("edge_teryt2261011_skm_owns", "owns", GDANSK),
    ]);
    expect(page.findComponent(CompanySummary).props("location")).toBe(
      undefined,
    );
  });
});

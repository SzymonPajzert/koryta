import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import RequestButton from "../../../app/components/jobs/RequestButton.vue";
import type { JobRun } from "../../../shared/jobs";

const { mockAuthRequest, claims } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  claims: { datascience: true },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: ref({ uid: "analyst" }),
    isAdmin: ref(false),
    isDatascience: ref(claims.datascience),
  }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const queued = (id: string, fields: Partial<JobRun> = {}): JobRun => ({
  id,
  job: "people_request",
  state: "queued",
  trigger: "request",
  host: null,
  startedAt: "2026-10-06T10:00:00.000Z",
  heartbeatAt: "2026-10-06T10:00:00.000Z",
  finishedAt: null,
  progress: null,
  counters: {},
  phase: null,
  stopReason: null,
  errors: [],
  exitCode: null,
  summaryPath: null,
  version: null,
  title: "Wodociągi Miejskie",
  link: "/instytucja/wodociagi-miejskie-place1",
  request: {
    target: "company",
    nodeId: "place1",
    name: "Wodociągi Miejskie",
    krs: "0000000001",
    rejestrIo: null,
    dryRun: false,
    by: "analyst",
    byName: null,
    at: "2026-10-06T10:00:00.000Z",
  },
  dispatch: { mode: "vm", at: "2026-10-06T10:00:01.000Z", ok: true },
  ...fields,
});

const inDialog = (selector: string) =>
  document.querySelector<HTMLElement>(
    `[data-testid="job-request-dialog"] ${selector}`,
  );

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

async function mountButton(
  props: Record<string, unknown> = {
    nodeId: "place1",
    name: "Wodociągi Miejskie",
    target: "company",
  },
) {
  wrapper = await mountSuspended(RequestButton, { props });
  await flushPromises();
  return wrapper;
}

async function openDialog() {
  await wrapper!.get('[data-testid="job-request-open"]').trigger("click");
  await flushPromises();
}

describe("JobsRequestButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claims.datascience = true;
    mockAuthRequest.mockImplementation(
      async (url: string, options: { method?: string }) => {
        if (options.method === "GET") return { runs: [] };
        return {
          run: queued("r1"),
          reused: false,
          link: "/admin/procesy#przebieg-r1",
        };
      },
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("is only there for the datascience group", async () => {
    claims.datascience = false;
    const page = await mountButton();

    expect(page.find('[data-testid="job-request-open"]').exists()).toBe(false);
    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it("asks nothing until it is opened, then shows the page's last runs", async () => {
    mockAuthRequest.mockImplementation(async () => ({
      runs: [queued("r0", { state: "succeeded" })],
    }));
    await mountButton();
    expect(mockAuthRequest).not.toHaveBeenCalled();

    await openDialog();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/ops/jobs/requests", {
      method: "GET",
      query: { node: "place1" },
    });
    expect(inDialog('[data-testid="job-request-runs"]')?.textContent).toContain(
      "udany",
    );
    expect(inDialog('[data-run="r0"] a')?.getAttribute("href")).toBe(
      "/admin/procesy#przebieg-r0",
    );
  });

  it("queues a company's people and links to where it can be followed", async () => {
    await mountButton();
    await openDialog();
    expect(inDialog(".v-card-text")?.textContent).toContain(
      "nowe, nieopublikowane strony",
    );

    inDialog('[data-testid="job-request-confirm"]')!.click();
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/ops/jobs/requests", {
      method: "POST",
      body: { nodeId: "place1", dryRun: false },
    });
    const done = inDialog('[data-testid="job-request-done"]')!;
    expect(done.textContent).toContain("Zlecone.");
    expect(done.textContent).toContain("Maszyna się uruchamia.");
    expect(
      inDialog('[data-testid="job-request-follow"]')?.getAttribute("href"),
    ).toBe("/admin/procesy#przebieg-r1");
  });

  it("asks for a count alone when told to", async () => {
    await mountButton();
    await openDialog();

    inDialog('[data-testid="job-request-dry-run"] input')!.click();
    await flushPromises();
    expect(
      inDialog('[data-testid="job-request-confirm"]')?.textContent.trim(),
    ).toBe("Policz");
    inDialog('[data-testid="job-request-confirm"]')!.click();
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/ops/jobs/requests", {
      method: "POST",
      body: { nodeId: "place1", dryRun: true },
    });
  });

  it("says a run already waiting is the one handed back", async () => {
    mockAuthRequest.mockImplementation(
      async (url: string, options: { method?: string }) =>
        options.method === "GET"
          ? { runs: [] }
          : {
              run: queued("r0"),
              reused: true,
              link: "/admin/procesy#przebieg-r0",
            },
    );
    await mountButton();
    await openDialog();

    inDialog('[data-testid="job-request-confirm"]')!.click();
    await flushPromises();

    expect(inDialog('[data-testid="job-request-done"]')?.textContent).toContain(
      "To zlecenie już czeka albo trwa",
    );
  });

  it("shows what the server refused with", async () => {
    mockAuthRequest.mockImplementation(
      async (url: string, options: { method?: string }) => {
        if (options.method === "GET") return { runs: [] };
        throw Object.assign(new Error("400"), {
          data: { message: "Ta firma nie ma numeru KRS." },
        });
      },
    );
    await mountButton();
    await openDialog();

    inDialog('[data-testid="job-request-confirm"]')!.click();
    await flushPromises();

    expect(
      inDialog('[data-testid="job-request-error"]')?.textContent.trim(),
    ).toBe("Ta firma nie ma numeru KRS.");
    expect(inDialog('[data-testid="job-request-done"]')).toBeNull();
  });

  it("tells a person's page it creates no page", async () => {
    await mountButton({
      nodeId: "p1",
      name: "Anna Nowak",
      target: "person",
      variant: "icon",
    });
    await openDialog();

    expect(inDialog(".v-card-title")?.textContent).toContain(
      "Wyślij dane tej osoby",
    );
    expect(inDialog(".v-card-text")?.textContent).toContain(
      "Nowej strony nie zakładamy",
    );
  });
});

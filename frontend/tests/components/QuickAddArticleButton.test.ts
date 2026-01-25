import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import QuickAddArticleButton from "../../app/components/QuickAddArticleButton.vue";

// Mocks must be hoisted or at top
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(),
  getApp: vi.fn(() => ({ options: {} })),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  initializeAuth: vi.fn(() => ({})),
  indexedDBLocalPersistence: { type: "indexedDB", dummy: true },
  browserLocalPersistence: { type: "browserLocal", dummy: true },
  browserSessionPersistence: { type: "browserSession", dummy: true },
}));

const mockHttpsCallable = vi.fn();
const mockHttpsCallableFromURL = vi.fn();
const mockConnectFunctionsEmulator = vi.fn();
const mockGetFunctions = vi.fn();

vi.mock("firebase/functions", async () => {
  return {
    getFunctions: (...args: unknown[]) => mockGetFunctions(...args),
    httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
    httpsCallableFromURL: (...args: unknown[]) =>
      mockHttpsCallableFromURL(...args),
    connectFunctionsEmulator: (...args: unknown[]) =>
      mockConnectFunctionsEmulator(...args),
  };
});

// Mock vuefire completely to avoid real Firebase init
vi.mock("vuefire", () => ({
  useFirebaseApp: vi.fn(() => ({ options: { projectId: "test-project" } })),
  useFirestore: vi.fn(),
  useDatabase: vi.fn(),
  useCurrentUser: vi.fn(),
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: () => ({ idToken: { value: "mock-token" } }),
}));

// Mock $fetch
const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);
vi.stubGlobal("useRuntimeConfig", () => ({ public: { isLocal: true } }));

describe.skip("QuickAddArticleButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders button", () => {
    const wrapper = mount(QuickAddArticleButton, {
      props: { nodeId: "123" },
      shallow: true,
      global: {
        stubs: {
          VBtn: {
            template: "<button @click=\"$emit('click')\"><slot /></button>",
          },
          VExpandTransition: { template: "<div><slot /></div>" },
          VCard: { template: "<div><slot /></div>" },
          VTextField: { template: "<input />" },
          VIcon: true,
        },
      },
    });
    expect(wrapper.text()).toContain("Dodaj artykuł");
  });

  it("opens expand on click", async () => {
    const wrapper = mount(QuickAddArticleButton, {
      props: { nodeId: "123" },
      shallow: true,
      global: {
        stubs: {
          VBtn: {
            template:
              '<button class="btn-main" @click="$emit(\'click\')"><slot /></button>',
          },
          VExpandTransition: { template: "<div><slot /></div>" },
          VCard: { template: '<div class="card-content"><slot /></div>' },
          VTextField: { template: "<input />" },
          VIcon: true,
        },
      },
    });

    await wrapper.find(".btn-main").trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".card-content").exists()).toBe(true);
  });

  it("calls getPageTitle and creates article on add", async () => {
    // Setup mock response for getPageTitle
    const mockGetPageTitleFn = vi
      .fn()
      .mockResolvedValue({ data: { title: "Mock Title" } });

    // Mock getPageTitle for both cases
    mockHttpsCallableFromURL.mockReturnValue(mockGetPageTitleFn);
    mockHttpsCallable.mockReturnValue(mockGetPageTitleFn);

    // Mock API calls
    mockFetch.mockResolvedValueOnce({ id: "new-article-id" }); // /api/nodes/create
    mockFetch.mockResolvedValueOnce({}); // /api/revisions/create

    const wrapper = mount(QuickAddArticleButton, {
      props: { nodeId: "123" },
      shallow: true,
      global: {
        stubs: {
          VBtn: {
            template:
              '<button class="btn-action" @click="$emit(\'click\')" :disabled="disabled"><slot /></button>',
            props: ["disabled"],
          },
          VExpandTransition: { template: "<div><slot /></div>" },
          VCard: { template: "<div><slot /></div>" },
          VTextField: {
            template:
              '<input class="input-url" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["modelValue"],
          },
          VIcon: true,
        },
      },
    });

    // Expand
    await wrapper.findAll(".btn-action")[0].trigger("click");
    await wrapper.vm.$nextTick();

    // Enter URL
    const input = wrapper.find("input.input-url");
    expect(input.exists()).toBe(true);
    await input.setValue("https://example.com");

    // Click Add
    const addBtn = wrapper.findAll(".btn-action")[1];
    expect(addBtn.element.disabled).toBe(false);
    await addBtn.trigger("click");

    expect(mockGetPageTitleFn).toHaveBeenCalledWith({
      url: "https://example.com",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/nodes/create",
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/revisions/create",
      expect.anything(),
    );
  });
});

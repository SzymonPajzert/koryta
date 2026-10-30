import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import OswiadczeniaPage from "../../app/pages/oswiadczenia/index.vue";
import type {
  DeclarationQueue,
  DeclarationTask,
} from "../../shared/declarations";

/** Every request the page makes for a signed-in reader goes through
 * `authRequest`, which is what puts the token on it. */
const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));
vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

/** A signed-in reader, with the `metadata` the app's sign-in counter reads
 * (app/plugins/login-tracking.client.ts): it watches the same user. */
const READER = { uid: "me", metadata: {} };

/** Who is signed in. A ref, because the page watches it: signing in from the
 * app bar's dialog changes the reader under a page that is already open. */
const currentUser = ref<typeof READER | null>(null);
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => currentUser,
  useIsCurrentUserLoaded: () => ref(true),
}));

// Vuetify's tooltip behind the (i) observes its activator, and happy-dom
// ships no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** Where this browser keeps the id of its readings without an account. */
const READER_KEY = "koryta:declaration-reader";

const crop = (id: string): DeclarationTask => ({
  id,
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy",
  declarationYear: 2019,
  images: { date: `data:image/png;base64,${id}`, name: null },
  imageSize: { date: { width: 950, height: 105 }, name: null },
});

const served = (
  ids: string[],
  mine: DeclarationQueue["mine"],
): DeclarationQueue => ({
  task: crop(ids[0]!),
  upcoming: ids.slice(1).map(crop),
  open: 40,
  mine,
});

/** What reached the server, in order. Through `authRequest` a request
 * carries the reader's token; without an account it is a plain `$fetch`
 * with this browser's reader id, served below so the header is the one that
 * went out. */
type Asked = {
  url: string;
  method: string;
  token: boolean;
  readerId: string | null;
  body?: unknown;
};
let asked: Asked[] = [];

/** The claim's answer: at once, unless a test holds it back to see what the
 * page does while the claim is on its way. */
let claimAnswer: Promise<{ claimed: number }>;

/** Holds the claim's answer back; the returned function lets it land. */
function holdClaim() {
  let land!: (answer: { claimed: number }) => void;
  claimAnswer = new Promise((resolve) => {
    land = resolve;
  });
  return () => land({ claimed: 2 });
}

registerEndpoint("/api/declarations/next", (event) => {
  asked.push({
    url: "/api/declarations/next",
    method: event.method,
    token: event.headers.has("authorization"),
    readerId: event.headers.get("x-reader-id"),
  });
  return served(["a1", "a2", "a3"], { today: 0, total: 0 });
});

beforeEach(() => {
  asked = [];
  currentUser.value = null;
  claimAnswer = Promise.resolve({ claimed: 2 });
  window.localStorage.setItem(READER_KEY, "reader-1");
  mockAuthRequest.mockReset();
  mockAuthRequest.mockImplementation(
    async (url: string, options: { method: string; body?: unknown }) => {
      asked.push({
        url,
        method: options.method,
        token: true,
        readerId: null,
        ...(options.body === undefined ? {} : { body: options.body }),
      });
      if (url === "/api/declarations/claim") return claimAnswer;
      // The account's own queue, with the two readings it just claimed.
      return served(["b1", "b2", "b3"], { today: 2, total: 2 });
    },
  );
});

const mounted: { unmount: () => void }[] = [];

// A page left mounted would go on watching the reader, and claim and ask in
// the next test's name.
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  window.localStorage.removeItem(READER_KEY);
});

const mountPage = async () => {
  const wrapper = await mountSuspended(OswiadczeniaPage);
  mounted.push(wrapper);
  return wrapper;
};

/** Until a crop is on the card: `<ClientOnly>` draws the work once mounted,
 * and the crops arrive after. */
const cropShown = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  vi.waitFor(() =>
    expect(wrapper.find('[data-testid="declaration-task"]').exists()).toBe(
      true,
    ),
  );

const CLAIM = {
  url: "/api/declarations/claim",
  method: "POST",
  token: true,
  readerId: null,
  body: { readerId: "reader-1" },
};
const ACCOUNT_QUEUE = {
  url: "/api/declarations/next",
  method: "GET",
  token: true,
  readerId: null,
};

/** /oswiadczenia is open to readers without an account (Szymon, round
 * bip-czytanie-r1), whose readings are filed under this browser's reader id
 * and count once an account claims them. The claim has to reach the server
 * before the account's queue is asked for, or the queue would hand the
 * account the crops it has just read once more. */
describe("/oswiadczenia", () => {
  it("claims what was read without an account when the reader signs in, before asking for the account's queue", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    expect(asked).toEqual([
      {
        url: "/api/declarations/next",
        method: "GET",
        token: false,
        readerId: "reader-1",
      },
    ]);
    expect(wrapper.find('[data-testid="declaration-login"]').exists()).toBe(
      true,
    );

    const landClaim = holdClaim();
    currentUser.value = READER;
    await flushPromises();

    // The claim is out, with the token and the id this browser read under,
    // and nothing else until it lands. The id is kept until the server has
    // the readings.
    expect(asked.slice(1)).toEqual([CLAIM]);
    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");

    landClaim();
    await vi.waitFor(() => expect(asked).toHaveLength(3));

    expect(asked.slice(1)).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
    // The account's queue and its count, and no banner asking to sign in.
    await vi.waitFor(() =>
      expect(
        wrapper.get('[data-testid="declaration-progress"]').text(),
      ).toMatch(/razem\s+2/),
    );
    expect(wrapper.find('[data-testid="declaration-login"]').exists()).toBe(
      false,
    );
  });

  it("claims a stored id for a reader already signed in when the page opens, before asking for the queue", async () => {
    currentUser.value = READER;
    const landClaim = holdClaim();

    const wrapper = await mountPage();
    await flushPromises();

    expect(asked).toEqual([CLAIM]);
    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");

    landClaim();
    await cropShown(wrapper);

    expect(asked).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
  });
});

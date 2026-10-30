import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick, onMounted, ref, watch } from "vue";
import { flushPromises, renderToString } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import OswiadczeniaPage from "../../app/pages/oswiadczenia/index.vue";
import DialogLogin from "../../app/components/dialog/Login.vue";
import { useSignInMethod } from "../../app/composables/signInMethod";
import { newsletterAnswerNote } from "../../shared/campaigns";
import type {
  DeclarationAnswerResult,
  DeclarationQueue,
  DeclarationTask,
} from "../../shared/declarations";
import {
  failedWith,
  noAnswer,
  PAGE_SAYS,
  refuse,
  REFUSED,
  type Refusing,
} from "../serverRefusals";

/** Every request the page makes for a signed-in reader goes through
 * `authRequest`, which is what puts the token on it. */
const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));
vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

/** A signed-in reader, with the `metadata` the app's sign-in counter reads
 * (app/plugins/login-tracking.client.ts): it watches the same user. */
const READER = { uid: "me", metadata: {} };

/** Who is signed in. A ref, because the page watches it: signing in from the
 * app bar's dialog changes the reader under a page that is already open.
 * `getIdToken(true)` is Firebase being asked for a fresh token. */
const currentUser = ref<
  | (typeof READER & {
      getIdToken?: (forceRefresh?: boolean) => Promise<string>;
    })
  | null
>(null);
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

/** How the endpoints below turn a reader without an account down, by path,
 * if a test says so (`refuse`, the server's own way): every request until
 * the test takes it back, as a day's limit holds. */
const refusing = new Map<string, Refusing>();

/** What a stranger has read before, as their queue says: nothing unless a
 * test that signs in from the tally gives them a reading, which is what puts
 * the tally and its „Zaloguj się” on the page. */
let strangerMine: DeclarationQueue["mine"] = { today: 0, total: 0 };

/** What a signed-in reader's request fails with, by url, if a test says so:
 * an error `$fetch` failed with (`failedWith`). */
const failing = new Map<string, unknown>();

registerEndpoint("/api/declarations/next", (event) => {
  asked.push({
    url: "/api/declarations/next",
    method: event.method,
    token: event.headers.has("authorization"),
    readerId: event.headers.get("x-reader-id"),
  });
  const refusal = refusing.get("/api/declarations/next");
  if (refusal) return refuse(event, refusal);
  return served(["a1", "a2", "a3"], strangerMine);
});
registerEndpoint("/api/declarations/a1/answer", {
  method: "POST",
  handler: (event) => {
    asked.push({
      url: "/api/declarations/a1/answer",
      method: event.method,
      token: event.headers.has("authorization"),
      readerId: event.headers.get("x-reader-id"),
    });
    const refusal = refusing.get("/api/declarations/a1/answer");
    if (refusal) return refuse(event, refusal);
    return {
      ...served(["a2", "a3"], { today: 1, total: 1 }),
      settled: false,
      answered: {
        id: "a1",
        documentUrl: "https://bip.gmina-testowa.example/oswiadczenie-a1.pdf",
        host: "bip.gmina-testowa.example",
      },
    } satisfies DeclarationAnswerResult;
  },
});

/** Renders what the page tells its failure line, in place, with the
 * timeout it gives it: the real snackbar is an overlay teleported out of the
 * wrapper and closed on a timer. */
const SnackbarStub = defineComponent({
  props: { modelValue: Boolean, timeout: { type: [Number, String] } },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h(
            "div",
            { "data-snackbar": "", "data-timeout": String(props.timeout) },
            slots.default?.(),
          )
        : null;
  },
});

/** Renders what the page tells its sign-in dialog, in place: open or not,
 * and on which form. The real one is an overlay over a form that signs in
 * with Firebase; what the page does once somebody has signed in is what
 * `currentUser` stands for here. Like the real one, it takes focus into
 * itself once open, so that closing it leaves focus nowhere. */
const SignInStub = defineComponent({
  props: { modelValue: Boolean, form: String },
  emits: ["update:modelValue"],
  setup(props) {
    const email = ref<HTMLInputElement | null>(null);
    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) return;
        await nextTick();
        email.value?.focus();
      },
    );
    return () =>
      props.modelValue
        ? h("div", { "data-sign-in": props.form ?? "" }, [
            h("input", { ref: email }),
          ])
        : null;
  },
});

/** Where the page notes, for the tab's life, that it has said why a claim
 * was turned down. */
const CLAIM_REFUSED_KEY = "koryta:declaration-claim-refused";

beforeEach(() => {
  asked = [];
  strangerMine = { today: 0, total: 0 };
  refusing.clear();
  failing.clear();
  currentUser.value = null;
  newsletterAsked = true;
  claimAnswer = Promise.resolve({ claimed: 2 });
  window.localStorage.setItem(READER_KEY, "reader-1");
  window.sessionStorage.removeItem(CLAIM_REFUSED_KEY);
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
      if (failing.has(url)) throw failing.get(url);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** An account made a moment ago with an e-mail address, which nobody has
 * confirmed yet: what the registration form, which takes only e-mail, makes. */
const NEW_ACCOUNT = {
  uid: "nowe-konto",
  metadata: {},
  email: "nowe.konto@example.com",
  emailVerified: false,
};

/** Renders the dialog's content in place while it is open: the real one is
 * an overlay teleported out of the wrapper. */
const DialogStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-dialog": "" }, slots.default?.())
        : null;
  },
});

/** The registration form: one button that makes `NEW_ACCOUNT` and signs it
 * in, as `register()` does once Firebase has made the account. */
const SignUpFormStub = defineComponent({
  props: { isLogin: Boolean },
  emits: ["success"],
  setup(props, { emit }) {
    const method = useSignInMethod();
    return () =>
      h(
        "button",
        {
          type: "button",
          "data-sign-up": props.isLogin ? "login" : "signup",
          onClick: () => {
            method.value = "email-signup";
            currentUser.value = NEW_ACCOUNT;
            emit("success");
          },
        },
        "Stwórz konto",
      );
  },
});

/** Whether the dialog's newsletter step asks its question, as it does an
 * account that never answered it. */
let newsletterAsked = true;

/** The dialog's newsletter step (MailNewsletterSignInStep): the question,
 * whose „Nie, dziękuję” closes the dialog with the answer's note; or, not
 * asked, the note that the confirmation link went out, at once. */
const NewsletterStepStub = defineComponent({
  props: { signedUp: Boolean },
  emits: ["done"],
  setup(_, { emit }) {
    onMounted(() => {
      if (newsletterAsked) return;
      emit(
        "done",
        `Konto założone. Link potwierdzający wysłaliśmy na ${NEW_ACCOUNT.email}.`,
      );
    });
    return () =>
      newsletterAsked
        ? h("section", { "data-newsletter-question": "" }, [
            h(
              "button",
              {
                type: "button",
                "data-newsletter-no": "",
                onClick: () =>
                  emit(
                    "done",
                    newsletterAnswerNote({
                      yes: false,
                      awaitingConfirmation: false,
                      email: NEW_ACCOUNT.email,
                    }),
                  ),
              },
              "Nie, dziękuję",
            ),
          ])
        : h("div");
  },
});

/** The real sign-in dialog, its overlay, form and newsletter step stubbed:
 * what is under test is what it shows, and when, beside the page's line. */
const REAL_SIGN_IN = {
  VSnackbar: SnackbarStub,
  VDialog: DialogStub,
  FormLoginForm: SignUpFormStub,
  MailNewsletterSignInStep: NewsletterStepStub,
};

/** `attached` puts the page in the document, which is where an element can
 * take focus. `realSignIn` mounts the real sign-in dialog (`REAL_SIGN_IN`)
 * in place of `SignInStub`. */
const mountPage = async ({ attached = false, realSignIn = false } = {}) => {
  const wrapper = await mountSuspended(OswiadczeniaPage, {
    global: {
      stubs: realSignIn
        ? REAL_SIGN_IN
        : { VSnackbar: SnackbarStub, DialogLogin: SignInStub },
    },
    ...(attached ? { attachTo: document.body } : {}),
  });
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

/** The tally's two lines, label and figure, as a reader reads them. */
const tallyRows = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  wrapper
    .findAll("[data-tally-row]")
    .map((row) =>
      `${row.get("dt").text()} ${row.get("dd").text()}`.replace(/\s+/g, " "),
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

/** What the reader has read so far, at the top of the page, once they have
 * read something and never before (Szymon, round bip-czytanie-r3): how many
 * people, how many of them in companies when the server says, and for a
 * reader without an account the sign-in that keeps it. It takes the place
 * of the banner under the work. */
describe("/oswiadczenia, the tally at the top", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const sendDate = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
  };

  it("says nothing before the reader has read anything, nor asks them to sign in", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);

    expect(wrapper.find('[data-testid="declaration-tally"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="declaration-tally-login"]').exists(),
    ).toBe(false);
  });

  it("says what a stranger read once they saved a date, and offers the sign-in in place of the banner", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);

    await sendDate(wrapper);

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="declaration-tally"]').exists()).toBe(
        true,
      ),
    );
    // Two lines, as Szymon laid them out: what was read, and what was found,
    // none until the server has found anybody.
    expect(tallyRows(wrapper)).toEqual(["Sprawdzono 1", "Znaleziono 0"]);
    expect(
      wrapper
        .get('[data-testid="declaration-tally"]')
        .text()
        .replace(/\s+/g, " "),
    ).toContain("Zaloguj się, by zapisać znalezione daty");
    expect(wrapper.find('[data-testid="declaration-login"]').exists()).toBe(
      false,
    );

    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-sign-in]").attributes("data-sign-in")).toBe(
      "login",
    );
  });

  it("says how many of them it found in companies when the server counts them", async () => {
    const unregister = registerEndpoint("/api/declarations/a1/answer", {
      method: "POST",
      handler: () =>
        ({
          ...served(["a2", "a3"], { today: 3, total: 5, inCompanies: 2 }),
          settled: false,
          answered: {
            id: "a1",
            documentUrl:
              "https://bip.gmina-testowa.example/oswiadczenie-a1.pdf",
            host: "bip.gmina-testowa.example",
          },
        }) satisfies DeclarationAnswerResult,
    });
    try {
      const wrapper = await mountPage();
      await cropShown(wrapper);

      await sendDate(wrapper);

      await vi.waitFor(() =>
        expect(wrapper.find('[data-testid="declaration-tally"]').exists()).toBe(
          true,
        ),
      );
      expect(tallyRows(wrapper)).toEqual(["Sprawdzono 5", "Znaleziono 2"]);
    } finally {
      unregister();
    }
  });
});

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
    // The account's queue and its tally, and nothing asking to sign in.
    await vi.waitFor(() => expect(tallyRows(wrapper)[0]).toBe("Sprawdzono 2"));
    expect(
      wrapper.find('[data-testid="declaration-tally-login"]').exists(),
    ).toBe(false);
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

/** Until the page says the queue could not load. */
const loadFailed = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  vi.waitFor(() =>
    expect(wrapper.find('[data-testid="declaration-error"]').exists()).toBe(
      true,
    ),
  );

/** When the server turns a reader down it says why, in words written for
 * them; the page says it in their place rather than its own lines, which
 * stay for a failure it gave no reason for. What the page decides is
 * whether asking again can help, and what to tell a reader whose claim it
 * turned down. */
describe("/oswiadczenia turned down by the server", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("says why it hands a reader without an account no crops, offers no retry, and starts again by itself once they sign in", async () => {
    refusing.set("/api/declarations/next", {
      status: 429,
      message: REFUSED.noAccount,
    });

    const wrapper = await mountPage();
    await loadFailed(wrapper);

    expect(wrapper.get('[data-testid="declaration-error"]').text()).toBe(
      REFUSED.noAccount,
    );
    // Asked once, not again by itself: every ask takes from the day's room.
    expect(asked).toEqual([
      {
        url: "/api/declarations/next",
        method: "GET",
        token: false,
        readerId: "reader-1",
      },
    ]);
    // Asked again, the server would say the same until tomorrow: the way on
    // is a sign-in, from the app bar.
    expect(wrapper.find('[data-testid="declaration-retry"]').exists()).toBe(
      false,
    );

    // Signed in from the app bar: the queue starts again as the account's.
    currentUser.value = READER;
    await cropShown(wrapper);

    expect(asked.filter((request) => request.token)).toEqual([
      CLAIM,
      ACCOUNT_QUEUE,
    ]);
    expect(wrapper.find('[data-testid="declaration-error"]').exists()).toBe(
      false,
    );
  });

  // The address confirmed since shows in a fresh token only: the server
  // reads it off the token, which can be an hour old.
  it("says why it hands an account nobody confirmed no crops, and asks again on a fresh token when told to", async () => {
    window.localStorage.removeItem(READER_KEY);
    const getIdToken = vi.fn(async (_force?: boolean) => "token");
    currentUser.value = { ...READER, getIdToken };
    failing.set(
      "/api/declarations/next",
      await failedWith(429, REFUSED.notConfirmed),
    );

    const wrapper = await mountPage();
    await loadFailed(wrapper);

    expect(wrapper.get('[data-testid="declaration-error"]').text()).toContain(
      REFUSED.notConfirmed,
    );
    // Never „e-” at the end of one line and „mail” at the start of the next.
    expect(
      wrapper
        .findAll('[data-testid="declaration-error"] .text-no-wrap')
        .map((word) => word.text()),
    ).toEqual(["e-mail"]);
    expect(getIdToken).not.toHaveBeenCalled();

    failing.delete("/api/declarations/next");
    await wrapper.get('[data-testid="declaration-retry"]').trigger("click");
    await cropShown(wrapper);

    expect(getIdToken).toHaveBeenCalledExactlyOnceWith(true);
    expect(asked).toEqual([ACCOUNT_QUEUE, ACCOUNT_QUEUE]);
  });

  it("keeps its own line and the retry when the queue failed to load for no reason it was given", async () => {
    refusing.set("/api/declarations/next", { status: 503 });

    const wrapper = await mountPage();
    await loadFailed(wrapper);

    expect(wrapper.get('[data-testid="declaration-error"]').text()).toContain(
      "Nie udało się wczytać wycinków do odczytania.",
    );
    expect(wrapper.find('[data-testid="declaration-retry"]').exists()).toBe(
      true,
    );
  });

  it("puts a stranger's answer the day turned down back in its field, with the server's reason in the failure line", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: REFUSED.noAccount,
    });

    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-snackbar]").exists()).toBe(true),
    );

    expect(wrapper.get("[data-snackbar]").text()).toBe(REFUSED.noAccount);
    const field = wrapper.get('[data-testid="declaration-date-input"]');
    expect((field.element as HTMLInputElement).value).toBe("15.07.1979");
    expect(
      wrapper.get('[data-testid="declaration-crop-date"]').attributes("src"),
    ).toBe("data:image/png;base64,a1");
    // Long enough to read two sentences: 70 ms a character, not the 5 s
    // the page's own one-line failure gets.
    expect(
      Number(wrapper.get("[data-snackbar]").attributes("data-timeout")),
    ).toBe(REFUSED.noAccount.length * 70);
  });

  // Moved now, the readings would never vote: they wait under the id for a
  // signed-in visit after the address is confirmed.
  it("says why the server turned a claim down, and keeps the reader id for a later visit", async () => {
    currentUser.value = READER;
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );

    const wrapper = await mountPage();
    await cropShown(wrapper);

    expect(asked).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(wrapper.get("[data-snackbar]").text()).toBe(
      REFUSED.claimNotConfirmed,
    );
    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");
  });

  // The id is made with the first ask for crops, answered or not. The server
  // turns a claim down only where there are readings to move, and answers 0
  // for a browser that only looked: a line saying its readings will move
  // would be untrue.
  it("says nothing of readings to move for a browser that only looked, signed in with an address nobody confirmed, and lets the id go", async () => {
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

    claimAnswer = Promise.resolve({ claimed: 0 });
    currentUser.value = READER;
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    await cropShown(wrapper);
    await flushPromises();

    expect(asked.slice(1)).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(wrapper.find("[data-snackbar]").exists()).toBe(false);
    expect(window.localStorage.getItem(READER_KEY)).toBeNull();
  });
});

/** Signing in from the banner under the work keeps the page (Szymon's CUJ
 * for round r3): a crop that came back with what a stranger typed into it is
 * the account's to send, and leaving for /login would take it with the
 * page. */
describe("/oswiadczenia, signed in from its tally", () => {
  beforeEach(() => {
    // A reading before, so the tally and its „Zaloguj się” are there.
    strangerMine = { today: 1, total: 1 };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("opens the sign-in on the page from the tally, and goes nowhere", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    const router = useRouter();
    const before = router.currentRoute.value.fullPath;
    const login = wrapper.get('[data-testid="declaration-tally-login"]');
    // A button that opens a dialog, not a link somewhere else.
    expect(login.element.tagName).toBe("BUTTON");
    expect(wrapper.find("[data-sign-in]").exists()).toBe(false);

    await login.trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-sign-in]").attributes("data-sign-in")).toBe(
      "login",
    );
    expect(router.currentRoute.value.fullPath).toBe(before);
  });

  it("keeps the crop that came back with what a stranger typed first through the sign-in, and lets their line go", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: REFUSED.noAccount,
    });
    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-snackbar]").text()).toBe(REFUSED.noAccount),
    );

    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-sign-in]").attributes("data-sign-in")).toBe(
      "login",
    );
    // Signed in, in the dialog.
    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    await flushPromises();

    // The account's queue, with the crop the stranger typed into first and
    // the date still in its field, to send as the account's.
    expect(
      wrapper.get('[data-testid="declaration-crop-date"]').attributes("src"),
    ).toBe("data:image/png;base64,a1");
    expect(
      (
        wrapper.get('[data-testid="declaration-date-input"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("15.07.1979");
    expect(tallyRows(wrapper)[0]).toBe("Sprawdzono 2");
    // „Zaloguj się albo załóż konto” said to a reader who just did.
    expect(wrapper.find("[data-snackbar]").exists()).toBe(false);
    expect(wrapper.find('[data-testid="declaration-login"]').exists()).toBe(
      false,
    );
  });

  it("says only why the claim was turned down once the stranger has signed in", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: REFUSED.noAccount,
    });
    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-snackbar]").text()).toBe(REFUSED.noAccount),
    );
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );

    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    await flushPromises();

    expect(wrapper.get("[data-snackbar]").text()).toBe(
      REFUSED.claimNotConfirmed,
    );
  });

  // The dialog has no activator of its own to give focus back to: left
  // alone, focus falls to the page's body, where a reader on a keyboard has
  // to find their way back to the work from the top of the page.
  it("gives focus back to the button that opened the sign-in when it is closed without one", async () => {
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    const signup = wrapper.get('[data-testid="declaration-tally-login"]');
    (signup.element as HTMLElement).focus();

    await signup.trigger("click");
    await flushPromises();
    expect(document.activeElement?.closest("[data-sign-in]")).not.toBeNull();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(document.activeElement).toBe(signup.element);
  });

  it("puts the caret where the typed answer waits once the reader has signed in and the dialog closes", async () => {
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    refusing.set("/api/declarations/a1/answer", {
      status: 429,
      message: REFUSED.noAccount,
    });
    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-snackbar]").exists()).toBe(true),
    );
    const login = wrapper.get('[data-testid="declaration-tally-login"]');
    (login.element as HTMLElement).focus();
    await login.trigger("click");
    await flushPromises();

    // Signed in, in the dialog, which shuts once it is done.
    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    // The real dialog holds focus in itself while it is open (Vuetify's
    // focus trap): the card that came back with the account's queue cannot
    // take it before the dialog shuts.
    (wrapper.get("[data-sign-in] input").element as HTMLElement).focus();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    const date = wrapper.get('[data-testid="declaration-date-input"]');
    expect((date.element as HTMLInputElement).value).toBe("15.07.1979");
    expect(document.activeElement).toBe(date.element);
    // In the middle of the window, not at its edge under the app bar.
    expect(scrolled.mock.contexts).toEqual([date.element]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
  });

  // A phone's keyboard would cover the crop of a reader who has not answered
  // yet (`autofocus`): the crop comes back into the window, without the
  // caret.
  it("brings a phone back to the crop after a sign-in, without the caret, where the reader has not answered yet", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    const login = wrapper.get('[data-testid="declaration-tally-login"]');
    (login.element as HTMLElement).focus();
    await login.trigger("click");
    await flushPromises();

    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    (wrapper.get("[data-sign-in] input").element as HTMLElement).focus();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    const date = wrapper.get('[data-testid="declaration-date-input"]').element;
    expect(scrolled.mock.contexts).toEqual([date]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).not.toBe(date);
  });

  // An address nobody confirmed reads from the same room for the day as the
  // stranger did, so where that turned the stranger down, it turns the
  // account's queue down too: no date field to go back to.
  it("gives „Spróbuj ponownie” focus once the dialog closes, where the account's queue was turned down", async () => {
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    await strangerTurnedDown(wrapper);
    failing.set(
      "/api/declarations/next",
      await failedWith(429, REFUSED.notConfirmed),
    );
    const login = wrapper.get('[data-testid="declaration-tally-login"]');
    (login.element as HTMLElement).focus();
    await login.trigger("click");
    await flushPromises();

    currentUser.value = READER;
    await loadFailed(wrapper);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    (wrapper.get("[data-sign-in] input").element as HTMLElement).focus();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="declaration-retry"]').element,
    );
    // The alert in the middle of the window: the banner went with the
    // sign-in, and the page left a phone at its foot.
    expect(scrolled.mock.contexts).toEqual([
      wrapper.get('[data-testid="declaration-error"]').element,
    ]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
  });

  it("gives the work focus once the account's queue has answered, where the dialog closed first", async () => {
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    await strangerTurnedDown(wrapper);
    failing.set(
      "/api/declarations/next",
      await failedWith(429, REFUSED.notConfirmed),
    );
    const login = wrapper.get('[data-testid="declaration-tally-login"]');
    (login.element as HTMLElement).focus();
    await login.trigger("click");
    await flushPromises();

    // The claim, and the queue after it, still on their way as the dialog
    // shuts.
    const landClaim = holdClaim();
    currentUser.value = READER;
    await flushPromises();
    (wrapper.get("[data-sign-in] input").element as HTMLElement).focus();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(wrapper.find('[data-testid="declaration-retry"]').exists()).toBe(
      false,
    );

    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    landClaim();
    await loadFailed(wrapper);
    await flushPromises();

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="declaration-retry"]').element,
    );
    expect(scrolled.mock.contexts).toEqual([
      wrapper.get('[data-testid="declaration-error"]').element,
    ]);
  });
});

type Mounted = Awaited<ReturnType<typeof mountPage>>;

/** Every snackbar on screen, the page's and a sign-in dialog's, by what it
 * says. */
const snackbars = (wrapper: Pick<Mounted, "findAll">) =>
  wrapper.findAll("[data-snackbar]").map((bar) => bar.text());

/** Lets the sign-in dialog's note go, as Vuetify does once its 6 s are up. */
async function noteGoes(wrapper: Pick<Mounted, "findAllComponents">) {
  const note = wrapper
    .findAllComponents(SnackbarStub)
    .find((bar) => "data-login-snackbar" in bar.vm.$attrs);
  if (!note) throw new Error("no sign-in dialog in this wrapper");
  note.vm.$emit("update:modelValue", false);
  await flushPromises();
}

/** A stranger's answer the day turned down for want of an account: the crop
 * back first with 15.07.1979 in its field, and the server's reason in the
 * failure line. */
async function strangerTurnedDown(wrapper: Mounted) {
  refusing.set("/api/declarations/a1/answer", {
    status: 429,
    message: REFUSED.noAccount,
  });
  await wrapper
    .get('[data-testid="declaration-date-input"]')
    .setValue("15.07.1979");
  await wrapper.get('[data-testid="declaration-task"] form').trigger("submit");
  await vi.waitFor(() =>
    expect(snackbars(wrapper)).toEqual([REFUSED.noAccount]),
  );
}

/** Signs up in the open dialog: over to its registration form by its own
 * link (the tally's button opens it on the sign-in), then the form. Waits
 * for what the dialog does next: ask the newsletter question, or close with
 * its note. It waits half a second for Firebase before either. */
async function signUp(wrapper: Pick<Mounted, "get" | "find" | "findAll">) {
  if (wrapper.find('[data-sign-up="login"]').exists()) {
    const toRegister = wrapper
      .findAll("[data-dialog] a")
      .find((link) => link.text().includes("Zarejestruj się"));
    await toRegister!.trigger("click");
  }
  await wrapper.get('[data-sign-up="signup"]').trigger("click");
  await vi.waitFor(
    () =>
      expect(
        wrapper
          .find("[data-newsletter-question], [data-login-snackbar]")
          .exists(),
      ).toBe(true),
    { timeout: 3000 },
  );
}

const typed = (wrapper: Mounted) =>
  (
    wrapper.get('[data-testid="declaration-date-input"]')
      .element as HTMLInputElement
  ).value;

/** What the dialog closes with after „Nie, dziękuję”. */
const SAID_NO = newsletterAnswerNote({
  yes: false,
  awaitingConfirmation: false,
  email: NEW_ACCOUNT.email,
});
/** What it closes with when it asks nothing of a new account. */
const LINK_SENT = `Konto założone. Link potwierdzający wysłaliśmy na ${NEW_ACCOUNT.email}.`;

/** A stranger who signs up in a sign-in dialog, as the banner's
 * „Rejestracja” invites, makes the only kind of account the registration
 * form makes: an e-mail address nobody has confirmed yet. The account exists
 * before the dialog is done with it, so the claim is turned down (403) while
 * the dialog still asks the newsletter question, and the dialog then closes
 * with a note of its own at the bottom of the window, where the page's line
 * goes. A line opened later sits on top: over the dialog, and over the note,
 * which it hides. One line at a time. */
describe("/oswiadczenia, signed up in a sign-in dialog", () => {
  beforeEach(() => {
    // A reading before, so the tally and its „Zaloguj się” are there.
    strangerMine = { today: 1, total: 1 };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("says nothing over the newsletter question, then the dialog's note alone, then why the claim was turned down", async () => {
    const wrapper = await mountPage({ realSignIn: true });
    await cropShown(wrapper);
    await strangerTurnedDown(wrapper);
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );

    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    // The stranger's line goes as the sign-in opens: they are doing what it
    // asked.
    expect(wrapper.find("[data-dialog]").exists()).toBe(true);
    expect(snackbars(wrapper)).toEqual([]);

    await signUp(wrapper);

    expect(wrapper.find("[data-newsletter-question]").exists()).toBe(true);
    expect(asked.filter((request) => request.token)).toEqual([
      CLAIM,
      ACCOUNT_QUEUE,
    ]);
    expect(snackbars(wrapper)).toEqual([]);
    // Not said yet, so not noted as said.
    expect(window.sessionStorage.getItem(CLAIM_REFUSED_KEY)).toBeNull();

    await wrapper.get("[data-newsletter-no]").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-dialog]").exists()).toBe(false);
    expect(snackbars(wrapper)).toEqual([SAID_NO]);
    expect(window.sessionStorage.getItem(CLAIM_REFUSED_KEY)).toBeNull();

    await noteGoes(wrapper);

    expect(snackbars(wrapper)).toEqual([REFUSED.claimNotConfirmed]);
    expect(window.sessionStorage.getItem(CLAIM_REFUSED_KEY)).not.toBeNull();
    // Behind it, the crop the stranger typed into, first, with the date.
    expect(typed(wrapper)).toBe("15.07.1979");
  });

  it("says why the claim was turned down only once the note the dialog closed with has gone, where it asks nothing", async () => {
    newsletterAsked = false;
    const wrapper = await mountPage({ realSignIn: true });
    await cropShown(wrapper);
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();

    await signUp(wrapper);
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await flushPromises();

    expect(wrapper.find("[data-dialog]").exists()).toBe(false);
    expect(snackbars(wrapper)).toEqual([LINK_SENT]);

    await noteGoes(wrapper);

    expect(snackbars(wrapper)).toEqual([REFUSED.claimNotConfirmed]);
  });

  // Said once a browser session, and noted as said only once it has been:
  // a reader who left while the note was up has not seen it.
  it("says why the claim was turned down on the next visit when the reader left before the dialog's note had gone", async () => {
    newsletterAsked = false;
    const first = await mountPage({ realSignIn: true });
    await cropShown(first);
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    await first.get('[data-testid="declaration-tally-login"]').trigger("click");
    await flushPromises();
    await signUp(first);
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    expect(snackbars(first)).toEqual([LINK_SENT]);
    first.unmount();
    mounted.splice(0);

    expect(window.sessionStorage.getItem(CLAIM_REFUSED_KEY)).toBeNull();

    asked = [];
    const next = await mountPage({ realSignIn: true });
    await cropShown(next);
    await flushPromises();

    expect(asked).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(snackbars(next)).toEqual([REFUSED.claimNotConfirmed]);
  });

  it("lets a stranger's line go as the sign-in opens, and does not bring it back when the dialog is closed without one", async () => {
    const wrapper = await mountPage({ realSignIn: true });
    await cropShown(wrapper);
    await strangerTurnedDown(wrapper);

    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-dialog]").exists()).toBe(true);
    expect(snackbars(wrapper)).toEqual([]);

    // The dialog's close button.
    await wrapper.get("[data-dialog] .v-card-title button").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-dialog]").exists()).toBe(false);
    expect(snackbars(wrapper)).toEqual([]);
    expect(typed(wrapper)).toBe("15.07.1979");
  });

  // The answer's line is the one to say then: its crop came back with what
  // was typed. The claim's is for a later visit, which claims again.
  it("holds a line that comes while the dialog's note is up until the note has gone, and leaves the claim's for a later visit", async () => {
    newsletterAsked = false;
    const wrapper = await mountPage({ realSignIn: true });
    await cropShown(wrapper);
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    await signUp(wrapper);
    // The account's own queue, under the note.
    await vi.waitFor(() =>
      expect(
        wrapper.get('[data-testid="declaration-crop-date"]').attributes("src"),
      ).toBe("data:image/png;base64,b1"),
    );
    failing.set("/api/declarations/b1/answer", await failedWith(503));

    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() => {
      expect(
        asked.filter(
          (request) => request.url === "/api/declarations/b1/answer",
        ),
      ).toHaveLength(1);
      expect(typed(wrapper)).toBe("15.07.1979");
    });
    await flushPromises();

    expect(snackbars(wrapper)).toEqual([LINK_SENT]);

    await noteGoes(wrapper);

    expect(snackbars(wrapper)).toEqual([
      "Nie udało się zapisać odpowiedzi. Wycinek wrócił na początek kolejki.",
    ]);
    expect(window.sessionStorage.getItem(CLAIM_REFUSED_KEY)).toBeNull();
  });

  // The app bar keeps a sign-in dialog of its own on every page, and the
  // page claims after a sign-in there just the same.
  it("holds why the claim was turned down for a sign-up in the app bar's dialog too", async () => {
    const page = await mountPage({ realSignIn: true });
    await cropShown(page);
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    const appBar = await mountSuspended(DialogLogin, {
      props: { hideActivator: true, modelValue: false },
      global: { stubs: REAL_SIGN_IN },
    });
    mounted.push(appBar);
    await appBar.setProps({ modelValue: true });
    // „Nie masz konta? Zarejestruj się”
    await appBar.get("[data-dialog] .v-card-text .mb-4 a").trigger("click");

    await signUp(appBar);

    expect(appBar.find("[data-newsletter-question]").exists()).toBe(true);
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    expect(snackbars(page)).toEqual([]);

    await appBar.get("[data-newsletter-no]").trigger("click");
    await flushPromises();

    expect(snackbars(appBar)).toEqual([SAID_NO]);
    expect(snackbars(page)).toEqual([]);

    await noteGoes(appBar);

    expect(snackbars(page)).toEqual([REFUSED.claimNotConfirmed]);
  });
});

/** The claim's other ways to fail, and its refusal on the visits after. */
describe("/oswiadczenia, a claim that does not go through", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // Nothing the reader can do about it, and the id is kept for the next
  // signed-in visit to claim again.
  it.each([
    ["a 503", () => failedWith(503)],
    ["no answer at all", noAnswer],
  ])(
    "says nothing of a claim that failed with %s, keeps the reader id and loads the queue",
    async (_, failure) => {
      currentUser.value = READER;
      failing.set("/api/declarations/claim", await failure());

      const wrapper = await mountPage();
      await cropShown(wrapper);
      await flushPromises();

      expect(asked).toEqual([CLAIM, ACCOUNT_QUEUE]);
      expect(wrapper.find("[data-snackbar]").exists()).toBe(false);
      expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");
    },
  );

  // Until the address is confirmed every signed-in visit claims, and is
  // turned down: said every time, the line would stand over a phone's date
  // field and „Zapisz” for seconds of each visit.
  it("says why a claim was turned down once a browser session, and claims again on the next visit all the same", async () => {
    currentUser.value = READER;
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    const first = await mountPage();
    await cropShown(first);
    expect(first.get("[data-snackbar]").text()).toBe(REFUSED.claimNotConfirmed);
    first.unmount();
    mounted.splice(0);
    asked = [];

    const next = await mountPage();
    await cropShown(next);
    await flushPromises();

    expect(asked).toEqual([CLAIM, ACCOUNT_QUEUE]);
    expect(next.find("[data-snackbar]").exists()).toBe(false);
    expect(window.localStorage.getItem(READER_KEY)).toBe("reader-1");
  });
});

/** A token the server will not take, from a sign-in that lapsed or was ended
 * elsewhere: the server's words for it speak of a token. */
describe("/oswiadczenia, a sign-in that lapsed", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.localStorage.removeItem(READER_KEY);
  });

  it("says so in its own words when the queue is turned down, and offers to ask again", async () => {
    currentUser.value = { ...READER, getIdToken: async () => "token" };
    failing.set(
      "/api/declarations/next",
      await failedWith(401, REFUSED.badToken),
    );

    const wrapper = await mountPage();
    await loadFailed(wrapper);

    const alert = wrapper.get('[data-testid="declaration-error"]').text();
    expect(alert).toContain(PAGE_SAYS.signedOut);
    expect(alert).not.toMatch(/token/i);
    expect(wrapper.find('[data-testid="declaration-retry"]').exists()).toBe(
      true,
    );
  });

  it("says so in its own words when an answer is turned down, with the crop back first", async () => {
    currentUser.value = READER;
    const wrapper = await mountPage();
    await cropShown(wrapper);
    failing.set(
      "/api/declarations/b1/answer",
      await failedWith(401, REFUSED.badToken),
    );

    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");
    await wrapper
      .get('[data-testid="declaration-task"] form')
      .trigger("submit");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-snackbar]").exists()).toBe(true),
    );

    expect(wrapper.get("[data-snackbar]").text()).toBe(PAGE_SAYS.signedOut);
    expect(
      (
        wrapper.get('[data-testid="declaration-date-input"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("15.07.1979");
  });
});

/** The page as the server renders it: its setup and its template run, and
 * nothing that waits for the page to be mounted, which only a browser does.
 * The app's components, directives and what it provides are the test
 * environment's Nuxt app's, as `mountSuspended` hands them to a mount. */
async function renderedOnServer() {
  const { vueApp } = useNuxtApp();
  return await renderToString(OswiadczeniaPage, {
    global: {
      provide: vueApp._context.provides,
      components: vueApp._context.components,
      directives: vueApp._context.directives,
      stubs: { VSnackbar: SnackbarStub, DialogLogin: SignInStub },
    },
  });
}

/** Every crop is fetched in the browser, with the reader's token or this
 * browser's reader id: the server has neither, and a request it sent would
 * only be turned down (401) and logged as a failure, on every visit. */
describe("/oswiadczenia on the server", () => {
  it.each([
    ["nobody", null],
    ["a reader", READER],
  ])(
    "asks for no crops and claims nothing while it renders the page for %s",
    async (_, reader) => {
      currentUser.value = reader;

      const html = await renderedOnServer();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(html).toContain("Odczytaj datę urodzenia");
      expect(asked).toEqual([]);
    },
  );
});

/** A private window can refuse storage outright. The page still says why a
 * claim was turned down only once, for as long as it is open.
 *
 * Last in the file: the note lives in the module, as it does in the page. */
describe("/oswiadczenia in a browser that refuses storage", () => {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  const refusing = {
    length: 0,
    key: refuse,
    clear: refuse,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
  } satisfies Storage;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says why a claim was turned down once while the page is open", async () => {
    currentUser.value = READER;
    failing.set(
      "/api/declarations/claim",
      await failedWith(403, REFUSED.claimNotConfirmed),
    );
    vi.stubGlobal("sessionStorage", refusing);

    const first = await mountPage();
    await cropShown(first);
    expect(first.get("[data-snackbar]").text()).toBe(REFUSED.claimNotConfirmed);
    first.unmount();
    mounted.splice(0);

    const next = await mountPage();
    await cropShown(next);
    await flushPromises();

    expect(next.find("[data-snackbar]").exists()).toBe(false);
  });
});

describe("/oswiadczenia, a click that leaves focus on nothing (WebKit, Firefox on macOS)", () => {
  beforeEach(() => {
    // A reading before, so the tally and its „Zaloguj się” are there.
    strangerMine = { today: 1, total: 1 };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("brings the work back after a sign-in when the banner's button never took focus", async () => {
    const wrapper = await mountPage({ attached: true });
    await cropShown(wrapper);
    await strangerTurnedDown(wrapper);
    // WebKit blurs what had focus when a button is clicked and focuses
    // nothing: buttons are not mouse-focusable on Apple platforms.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();

    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    (wrapper.get("[data-sign-in] input").element as HTMLElement).focus();
    wrapper.findComponent(SignInStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    const date = wrapper.get('[data-testid="declaration-date-input"]');
    expect(scrolled.mock.contexts).toEqual([date.element]);
    expect(document.activeElement).toBe(date.element);
  });
});

describe("/oswiadczenia, an answer still on its way when the stranger signs in", () => {
  beforeEach(() => {
    // A reading before, so the tally and its „Zaloguj się” are there.
    strangerMine = { today: 1, total: 1 };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not tell the signed-in reader the stranger's refusal once the dialog has gone", async () => {
    const wrapper = await mountPage({ realSignIn: true });
    await cropShown(wrapper);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unregister = registerEndpoint("/api/declarations/a1/answer", {
      method: "POST",
      handler: async (event) => {
        asked.push({
          url: "/api/declarations/a1/answer",
          method: event.method,
          token: event.headers.has("authorization"),
          readerId: event.headers.get("x-reader-id"),
        });
        await held;
        return refuse(event, { status: 429, message: REFUSED.noAccount });
      },
    });
    try {
      await wrapper
        .get('[data-testid="declaration-date-input"]')
        .setValue("15.07.1979");
      await wrapper
        .get('[data-testid="declaration-task"] form')
        .trigger("submit");
      await vi.waitFor(() =>
        expect(
          asked.filter((r) => r.url === "/api/declarations/a1/answer"),
        ).toHaveLength(1),
      );

      await wrapper
        .get('[data-testid="declaration-tally-login"]')
        .trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-dialog]").exists()).toBe(true);

      // Signed in, in the dialog (Google, say): the claim, then the account's queue.
      currentUser.value = READER;
      await vi.waitFor(() =>
        expect(asked.filter((request) => request.token)).toEqual([
          CLAIM,
          ACCOUNT_QUEUE,
        ]),
      );
      await cropShown(wrapper);

      // The stranger's answer comes back now, turned down for want of an account.
      release();
      await vi.waitFor(() => expect(typed(wrapper)).toBe("15.07.1979"));
      await flushPromises();

      // The reader closes the dialog.
      await wrapper.get("[data-dialog] .v-card-title button").trigger("click");
      await flushPromises();

      expect(snackbars(wrapper)).not.toContain(REFUSED.noAccount);
    } finally {
      unregister();
    }
  });
});

describe("/oswiadczenia, a date typed but not sent when the reader signs in", () => {
  beforeEach(() => {
    // A reading before, so the tally and its „Zaloguj się” are there.
    strangerMine = { today: 1, total: 1 };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps it on the crop it was typed into", async () => {
    const wrapper = await mountPage();
    await cropShown(wrapper);
    await wrapper
      .get('[data-testid="declaration-date-input"]')
      .setValue("15.07.1979");

    await wrapper
      .get('[data-testid="declaration-tally-login"]')
      .trigger("click");
    await flushPromises();
    currentUser.value = READER;
    await vi.waitFor(() =>
      expect(asked.filter((request) => request.token)).toEqual([
        CLAIM,
        ACCOUNT_QUEUE,
      ]),
    );
    await cropShown(wrapper);
    await flushPromises();

    expect(typed(wrapper)).toBe("15.07.1979");
  });
});

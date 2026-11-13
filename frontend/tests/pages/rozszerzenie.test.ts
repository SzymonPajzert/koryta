import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { useCurrentUser } from "vuefire";
import RozszerzeniePage from "../../app/pages/rozszerzenie.vue";
import { networkRequestFailed } from "../networkFailure";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
// For the page's `auth` middleware, which the route goes through.
mockNuxtImport("getCurrentUser", () => getCurrentUser);

/** Somebody signed in whose claim reads go as `results` say, in turn. */
function signedIn(...results: Array<() => Promise<unknown>>) {
  const getIdTokenResult = vi.fn();
  for (const result of results) getIdTokenResult.mockImplementationOnce(result);
  const user = { uid: "u1", email: "ktos@example.com", getIdTokenResult };
  vi.mocked(useCurrentUser).mockReturnValue(
    ref(user) as unknown as ReturnType<typeof useCurrentUser>,
  );
  getCurrentUser.mockResolvedValue(user);
  return getIdTokenResult;
}

/** The warning for an account outside the datascience group. */
const NOT_ALLOWED = "nie ma uprawnień do wysyłania artykułów";

/** The page reads the datascience claim when it is mounted. `?silent=1` is
 * the extension asking for a new token in a background tab, and for the
 * group the page sends it without a click. */
describe("/rozszerzenie", () => {
  let postMessage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  });

  afterEach(() => {
    postMessage.mockRestore();
  });

  it("warns an account outside the datascience group", async () => {
    signedIn(async () => ({ claims: {} }));
    const wrapper = await mountSuspended(RozszerzeniePage, {
      route: "/rozszerzenie",
    });
    await flushPromises();

    expect(wrapper.text()).toContain(NOT_ALLOWED);
  });

  // Firebase out of reach on both tries: the claim is unknown, not absent,
  // so a member of the group is not told they lack it, and nothing is sent
  // without the claim having been read.
  it("neither warns nor sends when the token cannot be refreshed", async () => {
    const getIdTokenResult = signedIn(
      () => Promise.reject(networkRequestFailed()),
      () => Promise.reject(networkRequestFailed()),
    );
    const wrapper = await mountSuspended(RozszerzeniePage, {
      route: "/rozszerzenie?silent=1",
    });
    await flushPromises();

    expect(getIdTokenResult).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain(NOT_ALLOWED);
    expect(getIdTokenResult).not.toHaveBeenCalledWith(true);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

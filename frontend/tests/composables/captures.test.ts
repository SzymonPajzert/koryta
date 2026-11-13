import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useCurrentUser } from "vuefire";
import { useCanCapture } from "../../app/composables/captures";
import { networkRequestFailed } from "../networkFailure";

/** `useCanCapture` in a component for somebody signed in whose claim reads
 * go through `getIdTokenResult`, with an error handler where the app has the
 * one that hands an error on to Sentry. */
function mountCanCapture(getIdTokenResult: () => Promise<unknown>) {
  vi.mocked(useCurrentUser).mockReturnValueOnce(
    ref({ getIdTokenResult }) as unknown as ReturnType<typeof useCurrentUser>,
  );
  const errorHandler = vi.fn();
  let canCapture: Ref<boolean> | undefined;
  mount(
    defineComponent({
      setup() {
        canCapture = useCanCapture();
        return () => h("div");
      },
    }),
    { global: { config: { errorHandler } } },
  );
  return { canCapture: canCapture!, errorHandler };
}

/** Whether /zrodla offers the datascience group a capture. The claim comes
 * off the token, and an expired token is refreshed first: offline the
 * refresh failed, and the watcher handed the error to the app. */
describe("useCanCapture", () => {
  it("lets the datascience group capture", async () => {
    const { canCapture } = mountCanCapture(async () => ({
      claims: { datascience: true },
    }));
    await flushPromises();

    expect(canCapture.value).toBe(true);
  });

  it("counts a token that could not be refreshed as no claim, and reports nothing", async () => {
    const getIdTokenResult = vi.fn().mockRejectedValue(networkRequestFailed());
    const { canCapture, errorHandler } = mountCanCapture(getIdTokenResult);
    await flushPromises();

    expect(canCapture.value).toBe(false);
    expect(getIdTokenResult).toHaveBeenCalledTimes(2);
    expect(errorHandler).not.toHaveBeenCalled();
  });
});

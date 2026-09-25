import { computed, readonly, ref, type Ref } from "vue";
import type { User } from "firebase/auth";
import { useCurrentUser } from "vuefire";
import type { NuxtApp } from "#app";

/** One flag per app: per request on the server, where it never turns true,
 * and one for the page's life in the browser. */
const flags = new WeakMap<NuxtApp, Ref<boolean>>();

/**
 * False until the server's html has been hydrated, true from then on - and
 * true straight away on a client-side navigation, where there is nothing to
 * hydrate.
 *
 * What a render may depend on the reader through. The server renders for
 * nobody, and the first client render has to agree with it; but nothing orders
 * firebase's session restore after hydration, and on a slow hydration it
 * lands first. A page that read `useCurrentUser()` directly then hydrated as a
 * signed-in reader over the anonymous html: mismatches, a component ref left
 * pointing at a comment node, and /eksploruj/umowy replaced by the 500 page.
 */
export function useHydrated(): Readonly<Ref<boolean>> {
  const nuxtApp = useNuxtApp();
  let flag = flags.get(nuxtApp);
  if (!flag) {
    const hydrated = ref(import.meta.client && !nuxtApp.isHydrating);
    if (import.meta.client && nuxtApp.isHydrating) {
      nuxtApp.hooks.hookOnce("app:suspense:resolve", () => {
        hydrated.value = true;
      });
    }
    flags.set(nuxtApp, hydrated);
    flag = hydrated;
  }
  return readonly(flag);
}

/** `useCurrentUser()` as a render may read it: `undefined` - nobody known yet -
 * until hydration is over, whatever firebase has restored by then. */
export function useRenderedUser() {
  const user = useCurrentUser();
  const hydrated = useHydrated();
  return computed<User | null | undefined>(() =>
    hydrated.value ? user.value : undefined,
  );
}

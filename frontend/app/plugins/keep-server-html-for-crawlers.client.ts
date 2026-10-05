import { START_LOCATION, type Router } from "vue-router";

/** Leave a crawler the page the server sent when the client cannot load it.
 *
 * Google renders what it crawls, but not straight away - the render can come
 * days after the fetch. A rollout in between drops every chunk the fetched HTML
 * names, the route's own chunk 404s, and the client's first navigation fails.
 * Nuxt means for a crawler to keep the server-rendered HTML then, and declines
 * to show it the error page - but it still mounts the app, on the route it
 * never left: vue-router's START_LOCATION, which is `/`. Hydration empties the
 * page, and the head is re-rendered from that route, so nuxt-seo-utils writes
 * the homepage into the canonical and og:url and the title falls back to the
 * site name. Google indexes an empty page that names the homepage as canonical.
 *
 * Search Console had exactly that on 2026-09-24: company, person and article
 * pages crawled between 09-17 and 09-23 declared https://koryta.pl/, and Google
 * filed the empty shells as duplicates of one another under a person page they
 * have nothing to do with. Googlebot's requests for `/_nuxt/` had 404ed 1,262
 * times in the ten days before, in waves a few days after each rollout.
 *
 * Reloading is what repairs this for a reader (`chunk-reload.client.ts`), and
 * it did not repair it for Google: that plugin and Nuxt's own crawler reload
 * both fire on this path already, and the pages above were indexed broken all
 * the same. So once the first navigation has failed without an error page -
 * the crawler branch - this vetoes every head render and the mount, and the
 * page stays what the server sent, which was complete.
 */
export default defineNuxtPlugin({
  name: "keep-server-html-for-crawlers",
  // After the head exists, so its renders can be vetoed, and before the router
  // makes its first navigation, because the failure re-renders the head from
  // inside that navigation.
  order: -21,
  dependsOn: ["nuxt:head"],
  setup(nuxtApp) {
    const error = useError();
    // `useRouter()` is only provided once the router plugin returns, after the
    // first navigation; `$router` is set before that navigation starts.
    const router = () =>
      nuxtApp.vueApp.config.globalProperties.$router as Router | undefined;
    // A reader whose navigation fails is shown the error page, which sets
    // `error`; a crawler is not. That difference is Nuxt's own decision about
    // who is a crawler, so this does not keep a second list of user agents.
    const stranded = () =>
      router()?.currentRoute.value === START_LOCATION && !error.value;

    // Latched, because the throw below sets `error` on its way out.
    let keepServerHtml = false;
    injectHead().hooks?.hook("dom:beforeRender", (context) => {
      if (keepServerHtml || stranded()) context.shouldRender = false;
    });

    nuxtApp.hook("app:beforeMount", () => {
      if (!stranded()) return;
      keepServerHtml = true;
      // Nuxt's entry catches this and skips `vueApp.mount`, which is the point:
      // there is nothing to hydrate the server's markup with.
      throw new Error(
        "Initial navigation failed for a crawler; keeping the server-rendered page",
      );
    });
  },
});

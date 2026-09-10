import { computed, onMounted, shallowRef } from "vue";

/** The height of the app bar in `layouts/default.vue`, in pixels.
 *
 * Vuetify's own default, declared here rather than left implicit because the
 * server has to know it before anything has been measured - see
 * `useSsrLayoutTop`. It is passed to `v-app-bar` as well, so the number the
 * server assumes and the number the browser lays out cannot drift apart. */
export const APP_BAR_HEIGHT = 64;

/** A `style` binding for `v-main` that holds the page still while it hydrates.
 *
 * `v-main` is offset from the top by `--v-layout-top`, which Vuetify derives
 * from the app bar's measured height:
 *
 *     const height = vToolbarRef.value?.contentHeight ?? 0
 *
 * `vToolbarRef` is a template ref, so on the server it is null and that `?? 0`
 * is what wins. The server sends `--v-layout-top: 0px`, the browser measures
 * 64px on mount, and every page's content drops 64px the moment it hydrates.
 * That single shift was essentially the whole of the site's Cumulative Layout
 * Shift on 2026-09-10: 0.312 of the home page's 0.358 and 0.282 of a person
 * page's 0.283, where Google's "poor" band starts at 0.25.
 *
 * `VMain` renders `style: [mainStyles, ssrBootStyles, dimensionStyles,
 * props.style]` - a style passed in from outside comes last and therefore
 * wins - so this supplies the offset Vuetify cannot know yet, and then gets
 * out of the way on mount so that scroll behaviour, an extension or a changed
 * density are still Vuetify's to decide.
 */
export function useSsrLayoutTop() {
  const mounted = shallowRef(false);
  onMounted(() => {
    mounted.value = true;
  });

  return computed(() =>
    mounted.value ? undefined : { "--v-layout-top": `${APP_BAR_HEIGHT}px` },
  );
}

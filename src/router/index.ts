/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHistory } from "vue-router/auto";
import type { RouteRecordRaw } from "vue-router";
import { setupLayouts } from "virtual:generated-layouts";
import { routes } from "vue-router/auto-routes";

// This is a hotfix for unplugin-vue-router issue that makes /(zobacz) path
// navigable and as such overrides / path
// See more at https://github.com/posva/unplugin-vue-router/issues/667
const removeBaseGroups = (routes: RouteRecordRaw[]) => {
  [routes[0], routes[1]] = [routes[1], routes[0]];
  return routes;
};

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts(removeBaseGroups(routes)),
});

// Workaround for https://github.com/vitejs/vite/issues/11804
router.onError((err, to) => {
  if (err?.message?.includes?.("Failed to fetch dynamically imported module")) {
    if (localStorage.getItem("vuetify:dynamic-reload")) {
      console.error("Dynamic import error, reloading page did not fix it", err);
    } else {
      console.debug("Reloading page to fix dynamic import error");
      localStorage.setItem("vuetify:dynamic-reload", "true");
      location.assign(to.fullPath);
    }
  } else {
    console.error(err);
  }
});

router.isReady().then(() => {
  localStorage.removeItem("vuetify:dynamic-reload");
});

const defaultTitle = "Koryta.pl";

router.afterEach((to) => {
  // Check if the route has a title meta field
  if (to.meta.title) {
    // If it's a function, call it with the route object
    if (typeof to.meta.title === "function") {
      document.title = to.meta.title(to) || defaultTitle;
    } else if (typeof to.meta.title === "string") {
      // Otherwise, use the static string
      document.title = to.meta.title;
    }
  } else {
    // Fallback to a default title if none is provided
    document.title = defaultTitle;
  }
});

export default router;

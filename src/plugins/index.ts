/**
 * plugins/index.ts
 *
 * Automatically included in `./src/main.ts`
 */

// Plugins
import vuetify from "./vuetify";
import pinia from "../stores";
import router from "../router";
import VueApexCharts from "vue3-apexcharts";
import VNetworkGraph from "v-network-graph";
import "v-network-graph/lib/style.css";
import { type Plugin } from "vue";

// Types
import type { App } from "vue";

export function registerPlugins(app: App) {
  app
    .use(vuetify)
    .use(router)
    .use(pinia)
    .use(VNetworkGraph)
    .use(VueApexCharts as Plugin);
}

/** The home explorer's panels, and what each is called in the url.
 *
 * Here rather than in `HomeExplorer` because the home page reads them too: a
 * link to a panel keeps its `?widok=` in the page's og:url.
 */

export const HOME_PANELS = ["map", "graph", "oswiadczenia"] as const;

export type HomePanel = (typeof HOME_PANELS)[number];

/** Each panel's name in the url, the tab's own label: `/?widok=stanowiska` is
 * a link to the chart. `widok`, as on /qa and /admin/zadania. */
export const HOME_PANEL_SLUGS: Record<HomePanel, string> = {
  map: "mapa",
  graph: "stanowiska",
  oswiadczenia: "oswiadczenia",
};

/** The panel a `?widok=` value names, or null when it names none. */
export function panelNamedBy(value: unknown): HomePanel | null {
  const slug = Array.isArray(value) ? value[0] : value;
  return HOME_PANELS.find((panel) => HOME_PANEL_SLUGS[panel] === slug) ?? null;
}

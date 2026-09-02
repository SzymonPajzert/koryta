import {
  mdiCalendarClock,
  mdiMapSearchOutline,
  mdiPuzzleOutline,
  mdiSchoolOutline,
  mdiViewGridOutline,
} from "@mdi/js";

/** The icon a game is drawn with, kept apart from `shared/games/registry.ts`.
 *
 * The registry is imported by server routes; @mdi/js is a client concern, and
 * an icon path has no business travelling into a Firestore handler. Anything
 * missing falls back to a puzzle piece rather than throwing - a game listed
 * without its icon still works, a hub that crashes over one does not. */
const icons: Record<string, string> = {
  polaczenia: mdiViewGridOutline,
  korytle: mdiMapSearchOutline,
  studia: mdiSchoolOutline,
  kiedy: mdiCalendarClock,
};

export function gameIcon(slug: string): string {
  return icons[slug] ?? mdiPuzzleOutline;
}

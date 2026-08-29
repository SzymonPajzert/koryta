/** What a relation is called on screen, when it has no name of its own.
 *
 * In `shared/` rather than beside `useEdges`, because both sides need it: the
 * entity pages and the admin dialogs render it, and so does the audit log,
 * which describes a relation server-side. `app/composables/edges.ts` reaches
 * for Nuxt's auto-imports, so importing this from there would have pulled
 * `computed` and `useAuthState` into the server build.
 */
export const edgeTypeLabels: Record<string, string> = {
  employed: "Zatrudniony/a w",
  owns: "Właściciel",
  seat: "Siedziba",
  connection: "Powiązanie z",
  mentions: "Wspomina o",
  comment: "Komentarz",
  election: "Kandydował/a w",
  tagged: "Dotyczy tematu",
};

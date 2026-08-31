/** Whether a date typed onto a relation is one the site and Firestore can read.
 *
 * A year, a year and a month, or a full day - the three lengths the registers
 * actually give: KRS a day, PKW an election year, a press cutting often only a
 * month. Empty passes, because clearing a date that turned out to be wrong is a
 * legitimate edit.
 *
 * The same rule as `relationDate` in `shared/api.ts`, which is what the server
 * enforces; this one exists so the form says so before the request rather than
 * after it, and returns Vuetify's `true | string`.
 */
export function relationDateRule(value: string | undefined): true | string {
  if (!value) return true;
  return (
    /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) ||
    "Format: RRRR, RRRR-MM albo RRRR-MM-DD"
  );
}

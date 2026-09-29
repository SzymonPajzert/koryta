/** Whose report it is, as much as an agent needs to know - and as a task made
 * from a report tells it (`shared/reportTasks.ts`), since agents read what is
 * on the owner's list as his.
 *
 * Here rather than with the MCP tools (`scripts/mcp/feedback.ts`, which gives
 * every report one of these labels) so that the page can say the same thing
 * in the same words. */
export type Reporter = "owner" | "trusted" | "signed-in" | "anonymous";

/** The site owner, whose reports are requests to act on, and a reviewer whose
 * reports the owner wants worked before the rest. Both are admins in
 * data/pipelines/src/set_auth_claims.py. */
const REPORTERS: Readonly<Record<string, Reporter>> = {
  of0BKlwqWLX21Cuml4NMHZ18xoC3: "owner",
  REdyYP4uvMSgCEjdSoiEHqy360G3: "trusted",
};

export function reporterOf(uid: unknown): Reporter {
  if (typeof uid !== "string" || uid === "") return "anonymous";
  return REPORTERS[uid] ?? "signed-in";
}

/** The same, in the site's words. */
export const reporterLabels: Record<Reporter, string> = {
  owner: "właściciel serwisu",
  trusted: "zaufany recenzent",
  "signed-in": "zalogowany użytkownik",
  anonymous: "ktoś niezalogowany",
};

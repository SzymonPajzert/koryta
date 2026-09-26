import { getApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { QA_ITEMS, type QaItem } from "~~/shared/qa";

/** When each entry of the QA changelog reached the people using the site.
 *
 * An entry carries no date on purpose (see `QA_ITEMS`), and the commit that
 * added it is no substitute: koryta.pl is rolled out by hand, so a change can
 * sit on main for a week before anybody sees it - everything merged between
 * the 2026-09-18 and 2026-09-25 rollouts went live at once. What does know is
 * the server running the build. An entry it serves that nothing has dated yet
 * went live with it, and the first process of a rollout writes that down.
 *
 * One document per backend, because `autopush` rolls out on every push to
 * main and reads the same database: sharing one record, it would date every
 * entry for koryta.pl days early.
 */
const COLLECTION = "qaReleases";

/** What `qaReleases/<backend>` holds: the instant each entry went live, keyed
 * by entry id. Written only by `recordQaReleases`, never edited. */
export type QaReleaseRecord = { items?: Record<string, string> };

/** The Cloud Run service this process runs as - `prod` or `autopush` on App
 * Hosting, which is also how `noindex-autopush` tells them apart - and `local`
 * anywhere else, the emulators included. */
export function releaseBackend(): string {
  return process.env.K_SERVICE || "local";
}

/** koryta.pl's rollouts from before the record existed, newest first, off the
 * App Hosting build logs as of 2026-09-26: each went live at `at`, when its
 * build finished, with every entry from `newest` down to the next rollout's
 * `newest`. That split is the array order of `QA_ITEMS` - every rollout's new
 * entries turned out to be one unbroken run at the top of the list it
 * shipped - so the order is all this has to rely on.
 *
 * The last one is a floor rather than a rollout. Build logs are kept for 30
 * days, so the 31 entries live after the 2026-08-26 rollout went live then or
 * earlier, and nothing says which. `null` keeps them off the feed, which never
 * looks back that far anyway.
 *
 * Frozen: a rollout from here on is in the record, not here. */
export const ROLLOUTS_BEFORE_RECORD: readonly {
  newest: string;
  at: string | null;
}[] = [
  { newest: "aktywnosc-wykres-30-dni", at: "2026-09-25T13:45:39.000Z" },
  { newest: "person-birth-date-from-register", at: "2026-09-18T21:30:20.000Z" },
  { newest: "fakt-do-notatki", at: "2026-09-10T17:46:16.000Z" },
  {
    newest: "okragly-staz-w-instytucjach-publicznych",
    at: "2026-09-09T22:24:58.000Z",
  },
  { newest: "strona-glowna-ma-koniec", at: "2026-09-09T12:14:32.000Z" },
  { newest: "poprawianie-powiazan", at: "2026-09-02T13:00:36.000Z" },
  { newest: "statystyki-bez-migracji", at: "2026-08-31T21:16:24.000Z" },
  { newest: "szpitale-na-telefonie", at: "2026-08-31T13:32:16.000Z" },
  { newest: "tabela-kontrast-i-kolory", at: "2026-08-30T10:17:41.000Z" },
  { newest: "tabela-firmy-wszystkich-wierszy", at: null },
];

/** The date each entry covered by `rollouts` went live, `null` for the ones
 * under the floor. An entry newer than the newest rollout is not in the map:
 * it is the record's to date. */
export function historyDates(
  items: readonly Pick<QaItem, "id">[],
  rollouts: readonly {
    newest: string;
    at: string | null;
  }[] = ROLLOUTS_BEFORE_RECORD,
): Map<string, string | null> {
  const starts = rollouts
    .map((rollout) => ({
      at: rollout.at,
      start: items.findIndex((item) => item.id === rollout.newest),
    }))
    // A rollout whose entry has left the list would leave its run undated and
    // so recorded as new; the unit test on this list is what stops that.
    .filter((rollout) => rollout.start >= 0);

  const dates = new Map<string, string | null>();
  starts.forEach(({ at, start }, index) => {
    const end = starts[index + 1]?.start ?? items.length;
    for (const item of items.slice(start, end)) dates.set(item.id, at);
  });
  return dates;
}

/** Writes down every entry `items` holds that neither the history nor the
 * record dates yet, as live since `liveSince`, and returns the record as it
 * then stands.
 *
 * A transaction, because every instance of a new rollout starts at about the
 * same moment and each would otherwise stamp the new entries with a start of
 * its own. Only the missing ids are written, merged into the map, so an entry
 * that has since left the list keeps its date. */
export async function recordQaReleases(
  db: Firestore,
  backend: string,
  items: readonly Pick<QaItem, "id">[],
  liveSince: string,
): Promise<Record<string, string>> {
  const ref = db.collection(COLLECTION).doc(backend);
  const history = historyDates(items);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const recorded = {
      ...(snapshot.data() as QaReleaseRecord | undefined)?.items,
    };
    const added: Record<string, string> = {};
    for (const item of items) {
      if (!history.has(item.id) && !(item.id in recorded)) {
        added[item.id] = liveSince;
      }
    }
    if (Object.keys(added).length > 0) {
      transaction.set(ref, { items: added }, { merge: true });
    }
    return { ...recorded, ...added };
  });
}

/** When this process started, which is when every entry it is the first to
 * record went live on this backend. Module scope, so it is the moment the
 * server loaded rather than the moment somebody first asked. */
const processStart = new Date().toISOString();

let recording: Promise<Record<string, string>> | null = null;

/** The record, written once per process: the entries a build serves cannot
 * change while it runs, and once each of them is dated the date never moves.
 * The server plugin calls this at startup, so a rollout is dated as it goes
 * live rather than when somebody next opens /aktywnosc; a failure there leaves
 * it to the next caller to try again. */
export function qaReleaseRecord(): Promise<Record<string, string>> {
  recording ??= recordQaReleases(
    getFirestore(getApp(), "koryta-pl"),
    releaseBackend(),
    QA_ITEMS,
    processStart,
  ).catch((error: unknown) => {
    recording = null;
    throw error;
  });
  return recording;
}

/** A changelog entry with the instant it went live on this backend. */
export type QaRelease = { item: QaItem; at: string };

/** Every entry this build serves, with when it went live, newest first. The
 * ones under the history's floor are left out: when they went live is not
 * known, only that it is past any window the feed shows. */
export async function qaReleases(): Promise<QaRelease[]> {
  const recorded = await qaReleaseRecord();
  const history = historyDates(QA_ITEMS);
  return QA_ITEMS.flatMap((item): QaRelease[] => {
    const at = history.has(item.id)
      ? history.get(item.id)
      : (recorded[item.id] ?? processStart);
    return at ? [{ item, at }] : [];
  }).sort((a, b) => b.at.localeCompare(a.at));
}

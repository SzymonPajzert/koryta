import type { Firestore } from "firebase-admin/firestore";
import type { H3Event } from "h3";
import { publishLimitOf } from "~~/shared/declarations";
import { matchAndDrain } from "./declarationPublish";

/**
 * What follows when a reader's request settles crops on a full date, be it
 * their answer (`/api/declarations/<id>/answer`) or the answers their account
 * claimed (`/api/declarations/claim`): the crops meet their pages, and the
 * publication queue is taken up under the configured limit (`matchAndDrain`),
 * `maxPages` pages of it at most, as the reader is waiting.
 *
 * Never at the reader's expense: the answers are stored and the crops settled
 * whatever happens here, and the sweep the job calls after every upload
 * compares a crop this did not.
 */
export async function compareSettled(
  event: H3Event,
  db: Firestore,
  extractIds: readonly string[],
  maxPages: number,
): Promise<void> {
  if (extractIds.length === 0) return;
  try {
    const { drain } = await matchAndDrain(
      db,
      extractIds,
      new Date(),
      publishLimitOf(useRuntimeConfig(event)),
      { maxPages },
    );
    if (drain.published.length > 0) {
      await useStorage("cache").clear("nitro:handlers");
    }
  } catch (error) {
    console.error(
      `[declarations] comparing ${extractIds.join(", ")} failed`,
      error,
    );
  }
}

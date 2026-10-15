import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from "firebase-admin/firestore";
import { z } from "zod";
import { recordAudit } from "../../server/utils/audit";
import { removeEdgeInBatch } from "../../server/utils/edgeRemoval";
import { edgeRevisions } from "../../server/utils/edgePublication";
import { edgeDocumentId, edgeIdentity } from "../../server/utils/edges";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "../../server/utils/revisions";
import type { EdgeLike } from "../../server/utils/edges";
import { reportRemaining } from "./remaining";

/**
 * Take the jobs of a namesake's register entry off the person pages that hold
 * them, from a list somebody has reviewed page by page.
 *
 * Until 2026-10-07 `people_merged` joined the rejestr.io entries of one name and
 * birth year into one row - Tadeusz Rozpara the Bełchatów president and the
 * Tadeusz Rozpara of Kraków two years older were one row, `['1220490',
 * '670747']` - and the row's payload carried both men's posts to whichever page
 * it reached. The cause is gone: one entry is one row since d547eda5
 * (nightly-test-failures), and the ingest never matches a page that links
 * another entry (`linksAnotherEntry` in `server/api/ingest/person.post.ts`).
 * What the old rows wrote is still on the pages. The audit of 2026-10-14 (task
 * audit-pages-from-collapsed-register-rows) found 199 such jobs on 93 pages,
 * 142 of them proven by the KRS odpis filing the seat under the other entry's
 * PESEL; this repairs the 88 pages no other task already covers.
 *
 * NOTHING HERE DECIDES WHOSE A JOB IS. Relations carry no record of the entry
 * they were read off (see `/api/nodes/split`), so that is a reviewer's
 * judgement, and the plan file is where it is written down: per page, the link
 * it should carry and every job to remove or move, with the reason. The plan
 * names people, so it is kept out of the repository; it is built from the
 * export by the audit's scripts in `~/.cache/koryta/` on the dev box.
 *
 * Per page, in one batch, so no page is left half done:
 *   - `set_link`: an approved revision giving the page the register link of the
 *     person it is about - where the review found the page's own link to be
 *     the namesake's (a pre-08-31 name match overwrote it) or missing. Not
 *     where another live page already links that entry: that is a merge.
 *   - `remove`: the soft delete an administrator's „Usuń powiązanie” makes
 *     (`removeEdgeInBatch`, shared with `/api/edges/delete`), with the reason.
 *   - `move`: the job removed here and written, approved and unpublished, on
 *     the page of the entry it belongs to. A copy rather than a re-pointed
 *     `source`: the edge's pending revisions still say the old page, and
 *     approving one of those would move it back (`applyRevision` writes the
 *     revision's data over the document). Where that page already says it,
 *     the job is only removed here.
 *   - `new_pages`: a draft page - name, link, birth date - for an entry that
 *     has none, to take its moved jobs, where the review judged the record
 *     worth keeping on the site before a night gets round to the entry. A
 *     second run finds it by its link and makes no other.
 *
 * WHAT IT WILL NOT DO, each reported and skipped rather than guessed:
 *   - touch a page whose link is not the one the review saw - somebody has
 *     changed it since, so the review is out of date;
 *   - touch a job that has moved, changed company, or carries a revision a
 *     person wrote: a reviewer's own edit outranks this list;
 *   - remove a job again, or write a link the page already has. A second run
 *     writes nothing.
 *
 * Every write is signed `migration:remove-namesake-jobs` (`isMigrationUid`).
 * Each removed or created relation fires `onEdgeWritten`, which recomputes its
 * page's stats - a few hundred of those. And like every script here it cannot
 * clear the Nitro handler cache that `/api/edges/delete` clears: a published
 * page can show a removed job for up to six hours, until the next admin action
 * or upload clears it.
 *
 * The run needs Nuxt's server tsconfig, for the `~~/` imports of the shared
 * server code (`npx nuxt prepare` once in a fresh checkout):
 *
 *   npx tsx --tsconfig .nuxt/tsconfig.server.json \
 *     scripts/migrate/remove-namesake-jobs.ts --input plan.json          # dry run, emulator
 *   ... --input plan.json --commit                                       # apply, emulator
 *   ... --input plan.json --prod                                         # dry run, PRODUCTION
 *   ... --input plan.json --prod --commit                                # apply, PRODUCTION
 *
 * `--page <id>` does that one page, `--limit N` the first N of the plan, and
 * `--verbose` prints what the shared server code logs as it files each write.
 */

const AUTHOR = { uid: "migration:remove-namesake-jobs" };

const removal = z.object({
  edge: z.string().min(1),
  /** The company the job is at, as the review saw it. */
  target: z.string().min(1),
  /** The register entry whose post it is. */
  entry: z.string().min(1),
  reason: z.string().trim().min(1),
  /** The same job on its entry's own page, when the review found one there. */
  duplicate_of: z.string().min(1).optional(),
});

const move = z.object({
  edge: z.string().min(1),
  target: z.string().min(1),
  entry: z.string().min(1),
  /** The entry's own page, which gets the job; left out for the page this run
   * creates for it (`new_pages`). */
  to: z.string().min(1).optional(),
  reason: z.string().trim().min(1),
});

/** A draft page for an entry that has none, made to take its jobs. */
const newPage = z.object({
  entry: z.string().min(1),
  name: z.string().trim().min(1),
  birthDate: z.string().min(1).optional(),
});

export const planSchema = z.object({
  pages: z.array(
    z
      .object({
        page: z.string().min(1),
        /** The register link the page carried when it was reviewed. */
        expect_link: z.string().nullable(),
        set_link: z.string().min(1).optional(),
        remove: z.array(removal).default([]),
        move: z.array(move).default([]),
        new_pages: z.array(newPage).default([]),
      })
      .refine(
        (step) =>
          step.move.every(
            (item) =>
              item.to !== undefined ||
              step.new_pages.some((page) => page.entry === item.entry),
          ),
        "A move with no page to go to needs a new page for its entry.",
      ),
  ),
});

export type Plan = z.infer<typeof planSchema>;
export type PageStep = Plan["pages"][number];
export type NewPage = z.infer<typeof newPage>;

export function registerLink(entry: string): string {
  return `https://rejestr.io/osoby/${entry}`;
}

/** A page made for an entry the way `/api/nodes/split` makes one for the
 * second person of a page: the person's name, link and date, nothing else -
 * the night fills in the rest from the entry's own row once it reads the link.
 */
export function newPerson(page: NewPage): Record<string, unknown> {
  return {
    type: "person",
    name: page.name,
    parties: [],
    rejestrIo: registerLink(page.entry),
    ...(page.birthDate ? { birthDate: page.birthDate } : {}),
  };
}

/** `registerEntry` of the person ingest: the number in a rejestr.io link, else
 * the link. Compared by number, as the ingest compares them, because a link
 * pasted from a browser carries the person's name after it. */
export function entryOf(link: unknown): string | undefined {
  if (typeof link !== "string" || !link) return undefined;
  return /rejestr\.io\/osoby\/(\d+)/.exec(link)?.[1] ?? link;
}

export type PageVerdict =
  { ok: true; linkToWrite: string | undefined } | { ok: false; why: string };

/** Whether a page is still the one the review saw, and whether its link still
 * needs writing. */
export function checkPage(
  stored: Record<string, unknown> | undefined,
  step: PageStep,
): PageVerdict {
  if (!stored) return { ok: false, why: "no such page" };
  if (stored.type !== "person") return { ok: false, why: "not a person" };
  if (stored.deleted === true || typeof stored.merged_into === "string") {
    return { ok: false, why: "removed or merged away since the review" };
  }
  const now = entryOf(stored.rejestrIo);
  if (step.set_link && now === entryOf(step.set_link)) {
    return { ok: true, linkToWrite: undefined };
  }
  if (now !== entryOf(step.expect_link ?? undefined)) {
    return {
      ok: false,
      why:
        `links ${String(stored.rejestrIo ?? "nothing")} now, the review saw ` +
        `${step.expect_link ?? "nothing"}: re-review it`,
    };
  }
  return { ok: true, linkToWrite: step.set_link };
}

export type EdgeVerdict =
  { act: true } | { act: false; done: boolean; why: string };

/** Whether a listed job can be taken off the page now: it is still there, at
 * the company the review saw, and nobody but a pipeline has written it. */
export function checkEdge(
  stored: Record<string, unknown> | undefined,
  pageId: string,
  target: string,
  revisions: readonly { update_automatic?: unknown; update_user?: unknown }[],
): EdgeVerdict {
  if (!stored) return { act: false, done: false, why: "no such relation" };
  if (stored.deleted === true) {
    return { act: false, done: true, why: "already removed" };
  }
  if (stored.type !== "employed") {
    return { act: false, done: false, why: `a ${String(stored.type)} edge` };
  }
  if (stored.source !== pageId) {
    return {
      act: false,
      done: false,
      why: `now on ${String(stored.source)}, not this page`,
    };
  }
  if (stored.target !== target) {
    return {
      act: false,
      done: false,
      why: `now at ${String(stored.target)}, the review saw ${target}`,
    };
  }
  const human = revisions.find(
    (revision) =>
      revision.update_automatic !== true && revision.update_user !== AUTHOR.uid,
  );
  if (human) {
    return {
      act: false,
      done: false,
      why: `a person wrote it (${String(human.update_user)}): theirs to remove`,
    };
  }
  return { act: true };
}

/** A moved job as it is written on the other entry's page: the same fields,
 * that page as its source, nothing the document owns rather than says. */
export function movedCopy(
  stored: Record<string, unknown>,
  to: string,
): Record<string, unknown> {
  return { ...withoutInternalFields(stored), source: to };
}

type Counts = {
  remove: number;
  move: number;
  link: number;
  pages: number;
  done: number;
  refused: number;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function say(line: string) {
  console.log(line);
}

/** Every page of the given person entry other than `except`. */
async function pagesLinking(
  db: Firestore,
  link: string,
  except: string,
): Promise<string[]> {
  const snapshot = await db
    .collection("nodes")
    .where("rejestrIo", "==", link)
    .get();
  return snapshot.docs
    .filter((doc) => {
      const data = doc.data();
      return (
        doc.id !== except &&
        data.type === "person" &&
        data.deleted !== true &&
        typeof data.merged_into !== "string"
      );
    })
    .map((doc) => doc.id);
}

/** One page of the plan, in one batch. Returns what it did (or, on a dry run,
 * would do). */
async function runPage(
  db: Firestore,
  step: PageStep,
  commit: boolean,
  counts: Counts,
): Promise<void> {
  const pageRef = db.collection("nodes").doc(step.page);
  const pageSnap = await pageRef.get();
  const page = pageSnap.data();
  const verdict = checkPage(pageSnap.exists ? page : undefined, step);
  const title = `${step.page} ${String(page?.name ?? "?")}${page?.published === true ? " [published]" : ""}`;
  if (!verdict.ok) {
    say(`  SKIP ${title}: ${verdict.why}`);
    counts.refused += step.remove.length + step.move.length;
    return;
  }

  const batch: WriteBatch = db.batch();
  let writes = 0;
  const lines: string[] = [];

  if (verdict.linkToWrite) {
    const others = await pagesLinking(db, verdict.linkToWrite, step.page);
    if (others.length > 0) {
      say(
        `  SKIP ${title}: ${verdict.linkToWrite} already has a page ` +
          `(${others.join(", ")}) - merge them instead`,
      );
      counts.refused += step.remove.length + step.move.length;
      return;
    }
    const { revisionRef } = createRevisionTransaction(
      db,
      batch,
      AUTHOR,
      pageRef,
      { ...withoutInternalFields(page!), rejestrIo: verdict.linkToWrite },
      // Approved, and published or not as it was: the review is what decided
      // whose page it is, and nothing about who may see it changes.
      { stored: page, approve: true },
    );
    recordAudit(
      db,
      {
        action: "approve",
        collection: "nodes",
        target_id: step.page,
        revision_id: revisionRef.id,
        user: AUTHOR.uid,
      },
      batch,
    );
    writes++;
    counts.link++;
    lines.push(
      `    link ${String(page!.rejestrIo ?? "none")} -> ${verdict.linkToWrite}`,
    );
  } else if (step.set_link) {
    counts.done++;
  }

  for (const item of step.remove) {
    const edgeRef = db.collection("edges").doc(item.edge);
    const snap = await edgeRef.get();
    const stored = snap.exists ? snap.data() : undefined;
    const check = checkEdge(
      stored,
      step.page,
      item.target,
      stored ? await edgeRevisions(db, item.edge) : [],
    );
    if (!check.act) {
      if (check.done) counts.done++;
      else counts.refused++;
      lines.push(
        `    ${check.done ? "done" : "SKIP"} ${item.edge}: ${check.why}`,
      );
      continue;
    }
    if (item.duplicate_of) {
      const twin = await db.collection("edges").doc(item.duplicate_of).get();
      if (!twin.exists || twin.data()?.deleted === true) {
        counts.refused++;
        lines.push(
          `    SKIP ${item.edge}: the copy on the entry's own page ` +
            `(${item.duplicate_of}) is gone, so the reason no longer holds`,
        );
        continue;
      }
    }
    await removeEdgeInBatch(db, batch, AUTHOR, edgeRef, stored!, item.reason);
    writes++;
    counts.remove++;
    lines.push(`    remove ${item.edge} (${item.entry})`);
  }

  // The moves that can go ahead, read before any page is made for them: a page
  // made for an entry whose every job turned out to be gone would be empty.
  const moving: {
    item: PageStep["move"][number];
    edgeRef: DocumentReference;
    stored: Record<string, unknown>;
  }[] = [];
  for (const item of step.move) {
    const edgeRef = db.collection("edges").doc(item.edge);
    const snap = await edgeRef.get();
    const stored = snap.exists ? snap.data() : undefined;
    const check = checkEdge(
      stored,
      step.page,
      item.target,
      stored ? await edgeRevisions(db, item.edge) : [],
    );
    if (!check.act) {
      if (check.done) counts.done++;
      else counts.refused++;
      lines.push(
        `    ${check.done ? "done" : "SKIP"} ${item.edge}: ${check.why}`,
      );
      continue;
    }
    moving.push({ item, edgeRef, stored: stored! });
  }

  // Where each moving job goes. A page named in the plan is checked to still be
  // its entry's; an entry of `new_pages` gets the page already linking it -
  // made by an earlier run, a night or a person - or one made here, which is
  // not in the database yet and holds nothing.
  const pageOf = new Map<string, { id: string; made: boolean }>();
  for (const wanted of step.new_pages) {
    if (!moving.some(({ item }) => !item.to && item.entry === wanted.entry)) {
      continue;
    }
    const existing = await pagesLinking(
      db,
      registerLink(wanted.entry),
      step.page,
    );
    if (existing.length > 1) {
      lines.push(
        `    SKIP a page for ${wanted.entry}: it has ${existing.length} ` +
          `(${existing.join(", ")}) - merge them first`,
      );
      continue;
    }
    if (existing.length === 1) {
      pageOf.set(wanted.entry, { id: existing[0]!, made: false });
      continue;
    }
    const madeRef = db.collection("nodes").doc();
    const { revisionRef } = createRevisionTransaction(
      db,
      batch,
      AUTHOR,
      madeRef,
      newPerson(wanted),
      // Approved because the review is what found the person, and a draft:
      // like the page a split makes, it is for somebody to read before it is
      // in front of anybody.
      { approve: true, published: false },
    );
    recordAudit(
      db,
      {
        action: "approve",
        collection: "nodes",
        target_id: madeRef.id,
        revision_id: revisionRef.id,
        user: AUTHOR.uid,
      },
      batch,
    );
    pageOf.set(wanted.entry, { id: madeRef.id, made: true });
    writes++;
    counts.pages++;
    lines.push(
      `    new page ${madeRef.id} for ${wanted.entry} (${wanted.name})`,
    );
  }

  for (const { item, edgeRef, stored } of moving) {
    const target = item.to
      ? { id: item.to, made: false }
      : pageOf.get(item.entry);
    if (!target) {
      counts.refused++;
      lines.push(`    SKIP ${item.edge}: no page for ${item.entry} to take it`);
      continue;
    }
    const to = target.id;
    if (item.to) {
      const destination = await db.collection("nodes").doc(to).get();
      const dest = destination.data();
      if (
        !destination.exists ||
        dest?.type !== "person" ||
        dest.deleted === true ||
        typeof dest.merged_into === "string" ||
        entryOf(dest.rejestrIo) !== item.entry
      ) {
        counts.refused++;
        lines.push(
          `    SKIP ${item.edge}: ${to} is no longer the live page of ${item.entry}`,
        );
        continue;
      }
    }

    const copy = movedCopy(stored, to);
    const identity = edgeIdentity(copy as EdgeLike);
    const there = target.made
      ? []
      : (
          await db
            .collection("edges")
            .where("source", "==", to)
            .where("target", "==", copy.target)
            .where("type", "==", copy.type)
            .get()
        ).docs;
    const twin = there.find(
      (doc) =>
        doc.data().deleted !== true &&
        edgeIdentity(doc.data() as EdgeLike) === identity,
    );
    let created: DocumentReference | undefined;
    if (!twin) {
      created = db.collection("edges").doc(edgeDocumentId(copy as EdgeLike));
      const taken = target.made ? undefined : await created.get();
      if (taken?.exists) {
        // The id this job would take there belongs to a relation somebody
        // removed from that page: writing over it would undo that removal.
        counts.refused++;
        lines.push(
          `    SKIP ${item.edge}: ${created.id} on ${to} exists` +
            (taken.data()?.deleted === true ? " and was removed" : ""),
        );
        continue;
      }
      const { revisionRef } = createRevisionTransaction(
        db,
        batch,
        AUTHOR,
        created,
        copy,
        // Approved because the review attributed it; a draft like any job the
        // ingest files for a page nobody has published.
        { approve: true, published: false },
      );
      recordAudit(
        db,
        {
          action: "approve",
          collection: "edges",
          target_id: created.id,
          revision_id: revisionRef.id,
          user: AUTHOR.uid,
        },
        batch,
      );
    }
    await removeEdgeInBatch(db, batch, AUTHOR, edgeRef, stored, item.reason);
    writes++;
    counts.move++;
    lines.push(
      `    move ${item.edge} -> ${to} ` +
        (created ? `as ${created.id}` : `(already there: ${twin!.id})`),
    );
  }

  say(`  ${title}`);
  for (const line of lines) say(line);
  if (commit && writes > 0) await batch.commit();
}

export async function main(): Promise<void> {
  const input = argValue("--input");
  if (!input) {
    console.error(
      "--input <plan.json> is required: the reviewed list of page fixes.",
    );
    process.exit(2);
  }
  const plan = planSchema.parse(JSON.parse(readFileSync(input, "utf8")));

  const isProd = process.argv.includes("--prod");
  const commit = process.argv.includes("--commit");
  const only = argValue("--page");
  const limit = Number(argValue("--limit") ?? Number.POSITIVE_INFINITY);
  if (!(limit > 0)) {
    console.error("--limit takes a positive number of pages.");
    process.exit(2);
  }

  if (!isProd) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  }
  // The shared server code logs every approval and audit entry it files, which
  // buries the per-page report under a few hundred lines. `--verbose` keeps it.
  if (!process.argv.includes("--verbose")) console.info = () => {};
  const app = initializeApp({ projectId: "koryta-pl" });
  const db = getFirestore(app, "koryta-pl");

  say(
    `${isProd ? "PRODUCTION" : `emulator ${process.env.FIRESTORE_EMULATOR_HOST}`}` +
      (commit ? "" : " (dry run - pass --commit to apply)"),
  );
  const steps = plan.pages
    .filter((step) => !only || step.page === only)
    .slice(0, limit);
  say(`${steps.length} of the plan's ${plan.pages.length} pages:`);

  const counts: Counts = {
    remove: 0,
    move: 0,
    link: 0,
    pages: 0,
    done: 0,
    refused: 0,
  };
  for (const step of steps) await runPage(db, step, commit, counts);

  say(
    `\n${commit ? "Wrote" : "Would write"}: ${counts.link} links, ` +
      `${counts.pages} new pages, ${counts.remove} removals, ` +
      `${counts.move} moves. ` +
      `Already done: ${counts.done}. Skipped: ${counts.refused}.`,
  );
  if (!commit) {
    reportRemaining({
      links: counts.link,
      pages: counts.pages,
      removals: counts.remove,
      moves: counts.move,
    });
    say("\nDry run. Re-run with --commit to apply.");
  }
}

if (process.argv[1]?.endsWith("remove-namesake-jobs.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

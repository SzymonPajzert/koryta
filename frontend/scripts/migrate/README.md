# One-off data migrations

Scripts that repair or reshape documents in the `koryta-pl` Firestore database.
They are kept after they have been run: the commit that adds one explains why
the data was wrong, and the script is the only record of what was done to it.

## The two flags

Every script in this directory takes the same pair, and **both default to the
safe side**:

| Flag       | Without it                             | With it                 |
| ---------- | -------------------------------------- | ----------------------- |
| `--commit` | dry run — counts what it would change  | writes                  |
| `--prod`   | the local emulator on `127.0.0.1:8080` | the production database |

So the bare invocation reads production-shaped data out of a local emulator and
writes nothing, and it takes two deliberate flags to touch production:

```bash
npx tsx scripts/migrate/<name>.ts                 # dry run, emulator
npx tsx scripts/migrate/<name>.ts --commit        # apply, emulator
npx tsx scripts/migrate/<name>.ts --prod          # dry run, PRODUCTION
npx tsx scripts/migrate/<name>.ts --prod --commit # apply, PRODUCTION
```

## How to run one

Rehearse against a copy of production before going near the real thing:

```bash
npm run db:pull                       # latest prod export into .firebase/
devlock npm run dev:prod-data         # emulator, loaded with it
npx tsx scripts/migrate/<name>.ts     # dry run: how much would change?
npx tsx scripts/migrate/<name>.ts --commit
npx tsx scripts/migrate/<name>.ts     # re-run: should now report nothing
```

That last step is the one worth not skipping. It checks the script is
idempotent, and it is also how you confirm the counts were real rather than a
predicate matching everything.

Only then:

```bash
npx tsx scripts/migrate/<name>.ts --prod          # dry run against production
npx tsx scripts/migrate/<name>.ts --prod --commit
```

`devlock` is needed because the emulators bind fixed ports and only one stack
can run at a time; see the note in `~/.claude/CLAUDE.md`. Nothing here needs the
Nuxt dev server, so `npm run emulators:prod-data` on its own is enough if you
would rather not start it.

## What a script is expected to do

- **Report before it writes.** The dry run prints the same counts the real run
  will, so the number can be sanity-checked against the database first.
- **Be idempotent.** Re-running must be a no-op. Skip documents that are already
  in the target shape rather than rewriting them — a write that changes nothing
  still costs, and "a clean run is free" is what makes the script safe to leave
  in a runbook.
- **Skip what it does not understand.** Narrow the predicate to the documents
  the migration is actually about and report anything adjacent that it chose not
  to touch, instead of guessing.
- **Batch in chunks of 400.** Firestore's limit is 500; 400 leaves room and
  matches what the other scripts here do.
- **Say why in the docstring.** What was wrong, what broke because of it, and
  where the code fix lives — a migration without its cause is unreadable a month
  later.

## Scripts that are meant to be re-run

Most of these are one-offs kept as a record. A few are not:
`apply-company-categories.ts` brings `categories` on company nodes in line with
what the pipelines say, so it is the thing to run after _any_ change to
`data/pipelines/src/entities/company_categories.py` — the filter offers a
category immediately and finds nothing under it until either the company upload
runs again or this does. It holds no mapping of its own: point it with
`--input` at a file of `{krs, categories}` records, which is the shape
`CompaniesPayloads` emits, so it needs no edit when the rules change. Each
change is filed as a revision rather than written past one, and a node a person
has edited (`categoriesSource: "manual"`) is left alone.

It replaced `recompute-company-categories.ts`, which derived the categories
itself from the PKD codes on the node. That could not survive the mapping
moving to Python: keeping it would have meant a second copy of the answer in
TypeScript, which is the thing the move was for.

Everything above still applies to one: the dry run reports, a clean run writes
nothing, and it takes `--prod --commit` to touch production.

## Fixing the cause too

A migration repairs documents that are already written; on its own it is
temporary, because whatever wrote them is still running. Land the code fix in
the same change, and say in the docstring where it is.

`unwrap-array-fields.ts` is the worked example: `sanitizeFirestoreData` in
`server/utils/revisions.ts` was rewriting every array as a map, so the script
repairs the 6088 documents already stored that way _and_ the function no longer
does it. Without the second half the count would simply grow back — the people
affected had gone from 105 to 461 in the month before it was noticed.

## `merge-duplicate-people.ts`, and the two flags it adds

It folds together the person pages that share a `rejestr.io` id — one human who
got two pages because the ingest matched on the name string and the pipeline's
name for him was not stable across runs ("Andrzej Golimont" one night, "Andrzej
Marcin Golimont" the next). 170 pairs against the 2026-08-29 export. The cause
is fixed in `server/api/ingest/person.post.ts`, which now matches on `rejestrIo`
first; this repairs what the old rule already wrote.

It is the one script here that does **not** run under a bare `npx tsx`:

```bash
npx tsx --tsconfig .nuxt/tsconfig.server.json \
  scripts/migrate/merge-duplicate-people.ts --limit 10
```

Everything it knows about merging comes from `server/utils/merge.ts`, which is
also what `/api/nodes/merge` calls — the same reasoning behind the admin button
and behind 170 merges at once, rather than two copies that can disagree about
what a duplicate relation is. `merge.ts` reaches its neighbours through the
`~~/` alias, which plain tsx cannot resolve, so the run points it at Nuxt's
generated server tsconfig. That is the trade `apply-company-categories.ts` made
the other way when it copied `INTERNAL_FIELDS` rather than import it; here the
thing being imported is the migration's whole subject, so a copy is not on.

`--limit N` does the first N duplicate groups and stops, in a stable order, so
the first run can do ten and be looked at. Use it: each relation the script
writes fires `onEdgeWritten` (`functions/src/edges.ts`), which re-reads every
edge of the relation's source node, and a full run is ~2000 of those. Not at a
busy moment.

Reading the dry run: it prints the first ten groups with both names, both ids
and each page's relation count, then the totals, and it says so loudly if those
totals are nowhere near the 170 groups / 2044 relations / 452 collapses / 72
review cases measured against the export. The 72 are `election` relations the
survivor already appears to hold and which are moved across anyway rather than
collapsed — nothing stored separates two candidacies in one place in one year,
so somebody has to read them on the surviving page afterwards.

Each merge is one Firestore batch, so no merge can be left half-applied: a
failure stops the script with everything before it whole and everything after it
untouched, and re-running finishes the job because a page that already carries
`merged_into` is skipped. A single merge needing more than 500 writes is
reported and skipped rather than split across batches.

It only repairs one page per person. The opposite error — 36 pages that are two
people whose `rejestrIo` overwrote each other — is `needs_split` and
`/api/nodes/split`, and is by hand.

## `delete-extraction-tag.ts`, and the two flags it adds

It removes every extraction filed under one model tag, together with the votes
that point at those facts. `v26-mentions-qwen3.8-27b-openrouter` is the default,
and `--tag <name>` points it at another.

Read the dry run before committing. Ingest has no dedupe key — every fact is a
fresh `doc()` — so a re-run files the same fact again, but a tag is rarely
_only_ duplicates: of that tag's 293 facts on the 2026-09-02 export, 40 have a
twin under another tag and 253 exist nowhere else. The script prints that split
and warns when the second number is not zero. `--duplicates-only` deletes just
the facts a different run also produced.

Votes go with the facts. A vote whose `extractionId` names a deleted document
is unreachable but still counted by /api/stats/database, which is the dead
weight `delete-untargeted-votes.ts` cleared out; deleting both together avoids
making more of it. `onVoteWritten` then fires for each deleted vote and logs a
NOT_FOUND trying to update an aggregate on a fact that is gone — one error line
per vote, expected.

## The invariants suite

`data/pipelines/src/tests/pipelines/test_invariants.py` checks these properties
against the nightly production export. Most of its assertions carry a budget —
the number of documents known to be broken — so after running a migration
against production, lower the matching budget to the new count. A migration is
finished when its budget reaches zero.

## Note on the older scripts

`migrate-teryt.ts` predates this convention: it has no `--commit`, so it writes
as soon as it is run, and without `--prod` it talks to the `demo-koryta-pl`
seeded emulator rather than to a copy of production. Follow
`unwrap-array-fields.ts` or `backfill-extraction-vote-stats.ts` for anything new.

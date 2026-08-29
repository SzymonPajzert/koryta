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
`--input` at a file of `{krs, categories}` records, so it needs no edit when the
rules change. Each change is filed as a revision rather than written past one,
and a node a person has edited (`categoriesSource: "manual"`) is left alone.

**Run it in the same session as the rule change.** Between a change to the
mapping and a run of this script the site keeps serving the _previous_ mapping's
answer, and there is nothing anywhere to say the answer is stale — no warning,
no empty state, just a category that quietly disagrees with the code. That is
not hypothetical: the koleje mapping was rewritten on 2026-08-26 and production
was still labelling companies with the rule the frontend used before it two days
later, with mining and road-building companies under "Koleje" and PKP itself
absent. A user reported it as a missing-companies bug.

The reason it never ran was the input. The only producer used to be
`CompaniesPayloads`, which reads today's register — a KRS scrape plus a wiki
rebuild — so a one-line change to the mapping cost hours before it could be
applied. `SiteCompanyCategories` now recomputes the same `{krs, categories}` from
the PKD codes the nightly Firestore export already holds, in one read. It is
strictly less authoritative — it can only repeat the codes a company was last
ingested with — which is exactly the right trade when what changed is the rules
rather than the register. `CompaniesPayloads` is still there for when a
company's codes are what moved.

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

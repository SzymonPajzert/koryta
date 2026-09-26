# NUXT server documentation

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

To start, run:

```bash
# set up
npm install

# It initiates the emulators, seeds the data and creates an endpoint.
npm run dev:local
```

Then access Firebase emulated at hosting at `localhost:5002` and application at http://127.0.0.1:3000/

To start with production data:

```bash
# login to cloud
gcloud auth login

# pull data (remember to ask for permissions, otherwise 403)
npm run db:pull

# It initiates the emulators and the application
npm run dev:prod-data
```

## Testing

### Unit tests (Vitest)

```bash
npm run test:ci
```

### Playwright E2E tests

Playwright tests are the primary E2E test suite. They use the `webServer` config in
`playwright.config.ts` to automatically start emulators, seed data, and launch the dev server.

**CI mode** (seeded emulator data — used in GitHub Actions and `quick-check`):

```bash
npm run test:playwright:ci
```

**Local mode** (production-exported data — useful for testing with real data):

```bash
# First, pull production data if you haven't already
npm run db:pull

npm run test:playwright
```

**With an already-running dev server** (skips automatic server startup):

```bash
# Start your preferred dev environment in one terminal
npm run dev:local    # or: npm run dev:prod-data

# Run tests in another terminal — Playwright will reuse the existing server on :3000
npx playwright test
```

You can override which server command Playwright uses via the `PLAYWRIGHT_SERVER_COMMAND`
environment variable:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm run dev:prod-data" npx playwright test
```

### Cypress E2E tests

```bash
npm run test:e2e        # run with seeded data
npm run test:e2e:prod   # run prod-specific tests
npm run test:e2e:open   # open Cypress UI
```

## Code quality

### Formatting

```bash
# format all files
npx prettier --write .

# check formatting without writing
npx prettier --check .
```

### Linting & duplication

```bash
# lint
npx eslint

# check code duplication in app/ and server/
npm run check:duplication
```

### Type checking

```bash
npm run typecheck
```

### Quick check (format + lint + types + tests)

```bash
# stops on first failure
npm run quick-check

# runs all checks regardless of failures
npm run quick-check:failsafe
```

## QA changelog

Every user visible change gets an entry at the top of `shared/qa.ts`, in the
same commit as the change itself:

```ts
{
  id: "person-places-map",       // never renamed or reused - stored verdicts point at it
  title: "Mapa miejsc osoby w panelu bocznym",
  description: "Co się zmieniło, w języku osoby korzystającej ze strony.",
  steps: ["Wejdź na /eksploruj/tabela", "Kliknij wiersz z osobą"],
  link: "/eksploruj/tabela",     // optional
  area: "public",                // public | contributor | admin
  fixes: ["Kx8V2mQpZrT4bN7cYh1A"], // optional - reports from /admin/opinie this answers
}
```

There is no date on an entry: the order of the array is what says which change
is newest, so prepend rather than inserting, and after a rebase move your entry
back to the top instead of leaving it where the merge put it. Nothing checks
this - the array is the only record of it.

Logged in users work through that list at `/qa`: an entry they have not been
through shows up under "Do sprawdzenia" with its instructions open, and they
answer "Działa" or "Coś nie działa" with a note. Those verdicts live in the
`qaChecks` firestore collection, one document per entry and person
(`${itemId}_${userUid}`).

Verification is **per person**: somebody else's verdict never checks an entry
off for you - the value of the page is the second pair of eyes. What another
reader found is still shown on the card, and an entry they reported a problem
with is flagged, so you know what to look for before you start.

A verdict worth telling the team about also goes out as an ordinary report -
the same `/api/feedback/create` the "Zgłoś" button posts to, so it reaches the
Slack channel and `/admin/opinie` with the entry and the verdict attached
(`FeedbackContext.qa`). "Worth telling" is `qaVerdictIsReportable`: a problem,
or anything somebody wrote out, but never a bare "działa" and never a re-save
of the verdict that was already there. The `qaChecks` document is written
first, so a Slack outage costs the report and never the tick.

When the change answers a report from `/admin/opinie`, put the report's id in
`fixes` - the part after `#fb-` in the Slack "Otwórz w panelu" link, or in the
link on the card's date. It is a claim, not a verdict. The report shows a
"Poprawka" chip for the newest entry naming it, coloured by everybody's current
verdict on that entry on `/qa` - any "Coś nie działa" makes it red, and only
that person changing their verdict clears it. Behind a click are the verdicts,
the reports written while checking any of the entries naming it, and the older
entries. When the chip is green and none of those reports is an open "Coś nie
działa", the card offers "Zamknij jako załatwione" - nothing closes a report by
itself. The joins live in `shared/feedbackFixes.ts`; ids that are not Firestore
auto-ids fail `tests/shared/qa.test.ts`.

## Scripts reference

| Script                        | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `npm run dev:local`           | Start emulators, seed data, and run dev server          |
| `npm run dev:prod-data`       | Start emulators with production data and run dev server |
| `npm run dev:build`           | Build and preview with emulators                        |
| `npm run build`               | Production build                                        |
| `npm run generate`            | Static site generation                                  |
| `npm run preview`             | Preview production build                                |
| `npm run emulators`           | Start Firebase emulators only                           |
| `npm run emulators:prod-data` | Start Firebase emulators with production data           |
| `npm run seed`                | Seed the emulator database                              |
| `npm run db:pull`             | Pull production data locally                            |
| `npm run stop`                | Kill all dev-related ports                              |
| `npm run test:ci`             | Run unit tests (Vitest)                                 |
| `npm run test:e2e`            | Run Cypress e2e tests                                   |
| `npm run test:e2e:prod`       | Run Cypress prod e2e tests                              |
| `npm run test:e2e:open`       | Open Cypress UI                                         |
| `npm run test:visual`         | Run Playwright visual regression tests                  |
| `npm run test:visual:update`  | Update visual regression baselines                      |
| `npm run test:playwright`     | Run Playwright tests (production data)                  |
| `npm run test:playwright:ci`  | Run Playwright tests (seeded data, used in CI)          |
| `npm run quick-check`         | Format + lint + types + tests + Playwright              |

### Visual regression tests

Visual tests live in `tests/visual/` and use Playwright's `toHaveScreenshot()`.
Baselines are committed under `tests/visual/__screenshots__/` and are
OS-specific (the `linux` baselines are the source of truth, compared in CI on
every PR). After an intentional UI change, regenerate them on Linux with
`npm run test:visual:update` and commit the updated PNGs; on failure CI uploads
a `playwright-visual-report` artifact with the image diffs.

## Email notifications

The site writes to a contributor when a reviewer acts on something they
proposed. Nothing in this repo talks to an SMTP server: `notifyUser`
(`server/utils/notifications.ts`) appends a document to the `mail` collection,
and the Firebase **Trigger Email from Firestore** extension delivers it and
writes the result back onto the same document. Retries, bounces and the SMTP
credentials are the extension's problem.

- **What is sent** — `shared/notifications.ts` holds one entry per kind: the
  default, the label the profile page shows, and the copy. Adding a kind is a
  member of `notificationKinds`, an entry in `notificationDefaults` and
  `notificationLabels`, and a branch of `renderNotification`.
- **Who gets it** — `users/{uid}.notifications`, edited on `/profil`. Kinds
  about the user's own contributions default to on; an unverified email address
  is never written to, because anybody can register with anybody's address.
- **Locally** — the extension is not installed in the emulator, so the queue
  just fills up. Read it in the emulator UI under the `mail` collection to see
  exactly what production would have sent.

Installing the extension (once, per project):

```bash
firebase ext:install firebase/firestore-send-email --project koryta-pl
```

Answer its prompts with the collection this app writes to and the database the
rest of the app uses — they are not the defaults:

| Parameter          | Value                                    |
| ------------------ | ---------------------------------------- |
| Firestore instance | `koryta-pl` (**not** `(default)`)        |
| Email documents    | `mail`                                   |
| Cloud Functions    | `europe-west1`                           |
| Default FROM       | an address on a domain with SPF and DKIM |

`firestore.rules` denies every client read and write on `mail`; the documents
pair an address with a message and only the admin SDK and the extension have
any business there.

## Agent tools

Claude sessions in this repo can read production data through an MCP server,
`scripts/mcp/server.ts`, which `/.mcp.json` registers as `koryta`. Today it has
the feedback queue from `/admin/opinie`:

- `feedback_queue` — open reports in the page's order (not yet in the queue,
  then the queue from the top), or the newest closed ones; one line each.
- `feedback_get` — whole reports by id or `#fb-<id>` link, with their place in
  the queue and what the `fixes` claims in `shared/qa.ts` say.

It can only read. Reads go out as `firestore-reader@koryta-pl.iam.gserviceaccount.com`,
which holds `roles/datastore.viewer` and nothing else, and gcloud impersonates
it, so no key file exists. Every read names its fields, so reporters' `contact`,
user agents and uids never leave Firestore.

Once, as a project owner (Cloud Shell will do):

```bash
gcloud services enable iamcredentials.googleapis.com --project=koryta-pl
gcloud iam service-accounts create firestore-reader --project=koryta-pl \
  --display-name="Agents: read-only Firestore"
gcloud projects add-iam-policy-binding koryta-pl --condition=None \
  --member=serviceAccount:firestore-reader@koryta-pl.iam.gserviceaccount.com \
  --role=roles/datastore.viewer
gcloud iam service-accounts add-iam-policy-binding \
  firestore-reader@koryta-pl.iam.gserviceaccount.com --project=koryta-pl \
  --member=serviceAccount:dev-workflow@koryta-pl.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
```

The last binding names whoever gcloud is logged in as on the machine the agents
run on. Claude Code asks before starting a server from `.mcp.json`; to approve
it for sessions that cannot ask, add to `~/.claude/settings.json`:

```json
"enabledMcpjsonServers": ["koryta"],
"permissions": { "allow": ["mcp__koryta"] }
```

With `FIRESTORE_EMULATOR_HOST` set the server reads that emulator instead.
Every answer says which database it came from.

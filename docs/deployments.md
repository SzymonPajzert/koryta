# Deployments

Two App Hosting backends serve the same codebase: **autopush**, which takes
every commit on `main`, and **prod**, which serves koryta.pl. Firestore rules,
indexes and Cloud Functions ship separately, on their own cadences.

The point of this document is the part that used to be missing: how you find
out that something is broken, and how fast you can undo it.

## Why the old setup let breakage through

Every check in CI runs a Nuxt server the runner just started, against an
emulator holding seeded data. That leaves an entire class of failure with
nothing watching it:

- the App Hosting build, its environment variables, and the Cloud Run runtime
- SSR against the real Firestore, with real credentials
- the shape of real documents, which seeded fixtures do not reproduce
- composite indexes - the emulator answers queries the real Firestore refuses
- Firestore rules, which no suite touched at all, because every server route
  uses the admin SDK and bypasses them

And autopush, which was meant to catch these, had nobody and nothing looking at
it. An unwatched staging environment does not reduce risk; it only adds delay.

## What runs when

| Check                | Where               | Covers                                       |
| -------------------- | ------------------- | -------------------------------------------- |
| vitest, eslint, tsc  | PR + main           | units, types, style                          |
| Cypress, Playwright  | PR + main, emulator | flows against seeded data                    |
| Firestore Rules      | PR + main           | what a browser may read and write            |
| **Smoke (deployed)** | after each autopush | the artifact we ship, on real data           |
| **Synthetic (prod)** | every 30 min        | prod breaking with nothing deployed          |
| Sentry               | continuous          | what real users hit, per environment/release |

The two bold ones are the additions. Everything above them tests a copy of the
app; only those two test the app.

## Knowing which build is live

`/api/health` on either backend reports:

```json
{
  "status": "ok",
  "appEnv": "autopush",
  "release": "9cdcabe",
  "commit": "9cdcabe...",
  "buildTime": "2026-07-29T10:31:02.417Z",
  "isLocal": false,
  "firestore": "ok"
}
```

`appEnv` comes from `APP_ENV`, set per backend in `frontend/apphosting.<env>.yaml`
and merged over `apphosting.yaml`. A backend reporting `unknown` has no
Environment name set in the console - fix that first, because its Sentry issues
are landing unlabelled.

App Hosting exposes no commit sha to a build, so `commit` is best effort: an
explicit `APP_RELEASE`, then `GITHUB_SHA`, then git if the build ran in a
checkout. `buildTime` always works and always moves forward, which is what the
post-deploy wait falls back to.

## Bake and promote

Prod is deployed by hand, and today that means "whatever is on `main` right
now". That is the one step worth changing: you watch commit A on autopush,
then deploy at some later point and prod gets A+3, which nothing has smoked.
The commits in between were never the ones you were checking.

Pinning the commit costs nothing and closes that gap:

1. A commit lands on `main`; App Hosting rolls it out to autopush.
2. The **Smoke (deployed)** workflow waits for that exact commit to answer on
   autopush, then runs the smoke suite against it.
3. Let it bake. Thirty minutes is a reasonable floor, but autopush carries
   almost no traffic, so time alone proves little - the smoke run and your own
   clicking around are what make the wait mean something. Check Sentry for new
   issues in `environment:autopush` before promoting.
4. Promote **that** commit, by sha rather than by branch:

   ```bash
   npx firebase apphosting:rollouts:create prod --git-commit <sha> --force
   ```

   The sha is in the green Smoke run, and in `release` from autopush's
   `/api/health`. Deploying `main` instead gives prod an artifact nothing has
   ever smoked - which is the same command, minus the only evidence you have.

5. Smoke prod:

   ```bash
   cd frontend
   SMOKE_BASE_URL=https://koryta.pl SMOKE_EXPECT_ENV=prod npm run test:smoke
   ```

## Rolling back

The same command, aimed at the last good commit:

```bash
npx firebase apphosting:rollouts:create prod --git-commit <last-good-sha> --force
```

Find the last good sha from the green Smoke runs, or from `release` in a
`/api/health` response you captured earlier. Do this before debugging, not
after - a rollback is cheap and reversible, and it buys back the time to think.

Rules and indexes roll back separately, from a checkout of the good commit:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

## Running the checks by hand

```bash
# The deployed smoke suite, against anything with a URL
cd frontend
SMOKE_BASE_URL=https://autopush--koryta-pl.<region>.hosted.app npm run test:smoke

# Firestore rules. Runs its own emulator on port 8081, off the dev stack's
# ports, so it needs no dev lock and does not block a running dev server.
npm run test:rules
```

## Setup this repo cannot do for itself

These need console access and are not yet done:

- [ ] Set the **Environment name** on each App Hosting backend: `autopush` and
      `prod`. Until then both fall back to `apphosting.yaml` and report
      `appEnv: unknown`, and the smoke suite fails on purpose.
- [ ] Add the repository variables `AUTOPUSH_URL` and `PROD_URL` (Settings >
      Secrets and variables > Actions > Variables). Smoke (deployed) fails
      without `AUTOPUSH_URL`; Synthetic defaults to `https://koryta.pl`.
- [ ] In Sentry, add an alert rule on **new issue in `environment:prod`** to
      Slack, and a second on issue-rate spikes. The tagging is in place; the
      routing is not.
- [ ] Add a Cloud Monitoring uptime check on `https://koryta.pl/api/health`,
      alerting on non-200. It polls every minute, where the Synthetic workflow
      runs every 30 and GitHub's scheduler runs late under load. The endpoint
      answers 503 when Firestore is unreachable, so the check catches a
      degraded backend and not just a dead one.
- [ ] Optional: move the manual promote into a `workflow_dispatch` job that
      takes a sha, refuses one whose Smoke run was not green, and rolls it out.
      That needs a service account with App Hosting admin, reached through
      workload identity federation. Until then the discipline is the numbered
      list above - deploy the sha you smoked, not the branch.

## Known gaps

- Functions (`frontend/functions`) deploy on their own cadence and are not
  pinned to an App Hosting rollout. A frontend change that needs a new callable
  can ship before the callable does.
- `npm run test:e2e:prod` runs the emulator against a real Firestore export and
  is not wired into CI; it needs the export in the runner. It is the cheapest
  remaining way to catch real-data breakage before a deploy rather than after.
- The smoke suite covers the logged-out reader. Nothing deployed exercises
  login, revisions or the admin flows - those are still emulator-only.

# Development

## Default Credentials

When running locally with `npm run dev:local`, the following default accounts are seeded:

- Admin level access
  - **Email:** `admin@koryta.pl`
  - **Password:** `password123`
- Normal user
  - **Email:** `user@koryta.pl`
  - **Password:** `password123`

You can use this account to log in and test authenticated features.

## Preview deployments

A branch can be put on a real URL, which is the only practical way to look at a
change on a phone. It deploys to the `preview` App Hosting backend in the
**`koryta-pl-preview`** project — a copy of the nightly export, its own
accounts, its own everything — so nothing done there can reach koryta.pl.

### Deploying a branch

Push the branch, then either:

- add the **`preview`** label to its pull request (adding the label again after
  a push redeploys — it is the one "deploy now" gesture that works from a
  phone), or
- run **Actions → Preview deployment → Run workflow** and name a branch, or
- from a laptop: `npm run preview:deploy` for the current branch, or
  `npm run preview:deploy -- some-branch`.

The build runs on Google's side from the branch **as GitHub has it**, so
anything unpushed is not in the deployment. Expect a few minutes.

There is one backend, not one per pull request: whoever deploys last owns the
URL. The workflow run and the pull request comment say which branch is on it.

### Signing in

The preview project has its own Auth, seeded with two synthetic accounts:

| account                   | claims                 |
| ------------------------- | ---------------------- |
| `admin@preview.koryta.pl` | `admin`, `datascience` |
| `user@preview.koryta.pl`  | none                   |

`npm run preview:seed:auth` creates them and prints a generated password once,
or sets one of yours with `PREVIEW_PASSWORD=…`. Re-running it leaves existing
passwords alone unless `PREVIEW_PASSWORD` says otherwise.

Production's users are deliberately not copied. Auth is the one thing that
cannot be shared without a preview being able to do real damage — a password
changed or an account deleted on a throwaway site is changed and deleted for
the person it belongs to — and it is also the easiest thing to fake, because
nothing on the site cares who you are beyond a uid and a couple of claims.

### What "safe" means here

Preview is a **separate Firebase project**. It was a second database inside
`koryta-pl` first, which works for as long as every call site keeps taking its
database id from configuration; a separate project needs no such vigilance,
because the preview backend runs as a service account with no grant on
production at all. Isolation is the same thing that stops any other project on
Google Cloud reading koryta.pl's data, rather than something this repository
has to keep getting right.

Everything else is deliberately identical — same Firestore database ids
(`koryta-pl` for the site's data, `(default)` for `users`), same
`firestore.rules`, same indexes, same triggers — so the export imports
one-for-one, the functions deploy unchanged, and a preview is a rehearsal of
production rather than of something arranged differently.

That leaves the project id as the entire difference between the two, and
nothing in this repository states what a preview's project ids are:

- App Hosting hands the build `FIREBASE_WEBAPP_CONFIG` — the api key, app id
  and database URL of the project the backend lives in. `shared/firebase-env.ts`
  reads it, so a branch deploys to the preview project without anyone writing
  its ids down. (`NUXT_PUBLIC_FIREBASE_API_KEY` / `_APP_ID` override it for a
  build outside App Hosting; `npm run preview:setup` prints them.)
- At runtime Cloud Run says which project the container is in.
  `server/plugins/firebase.server.ts` refuses to start if that disagrees with
  what was built in. **A preview backend that lost its configuration builds
  itself as production and then dies on startup**, which is the failure this
  whole arrangement exists to survive.

Call sites still go through `appFirestore()` / `appUsersFirestore()` /
`appDatabase()` in `app/` and `adminFirestore()` / `adminDatabase()` in
`server/` — the two databases are not interchangeable, and a test in
`tests/shared/firebase-env.test.ts` fails the build if a literal id creeps
back in.

The preview is served with `NUXT_PUBLIC_SITE_INDEXABLE=false`, so
`@nuxtjs/robots` disallows everything and it cannot compete with koryta.pl in
search results.

### Triggers

The functions in `functions/` are deployed to the preview project too, by
`npm run preview:setup` or by hand:

```
npx firebase deploy --only functions --config ../firebase.preview.json \
  --project koryta-pl-preview
```

Their triggers name `database: "koryta-pl"`, which is the preview project's
database as well, so they fire there without a second set of definitions —
which is what a second database in one project could never have done. The
exception is `scheduledFirestoreExport`, which checks the project and returns:
the nightly export is production's, and a copy of preview's data landing in
that bucket would be handed straight back as production's.

### Refreshing the data

```
npm run db:preview:refresh             # import the newest nightly export
npm run db:preview:refresh -- --fresh  # drop the database first
```

Both read the same export `npm run db:pull` downloads for the emulator, but
Google imports it from the bucket, so nothing comes through your machine. A
plain refresh _merges_: documents deleted in production since the last refresh,
and anything edited through the preview site, stay. `--fresh` recreates the
database and is the only way to get a faithful copy. Neither touches the
accounts — `users` is in the other database and was never in the export.

The preview Realtime Database is not copied. It only ever receives writes
(`user/<uid>` from the profile and login pages), so it starts empty.

### One-time setup

`npm run preview:setup` builds the project: creates it, links billing, enables
the APIs, registers a web app, creates both Firestore databases and the
Realtime Database, turns on email/password sign-in, deploys the rules and
indexes, grants the new project read access to the export bucket, imports the
data, seeds the accounts and deploys the functions. It is idempotent — run it
again after a failure, or when something has drifted — and it prints whatever
it could not do at the end.

One step is not scriptable: an App Hosting backend with a repository
connection has to be created in the console. Three details on it matter —

- **Environment name `preview`**, which is what makes it read
  `apphosting.preview.yaml`. Without it the build comes up as production,
  notices it is running in `koryta-pl-preview`, and refuses to serve.
- **A web app selected**, which is what makes App Hosting pass
  `FIREBASE_WEBAPP_CONFIG` to the build.
- **Automatic rollouts off**, so pushes to `main` do not land on it.

CI needs two repository variables — `GCP_PREVIEW_SERVICE_ACCOUNT` (with
`roles/firebaseapphosting.admin` **on `koryta-pl-preview` and nothing on
production**, reachable through the existing workload identity provider) and
`PREVIEW_URL` (what the workflow tells people to open).

### Pointing local tools at the preview data

The scripts under `scripts/migrate/` take `--prod` to mean "not the emulator";
_which_ real project that is comes from `GOOGLE_CLOUD_PROJECT`, and defaults to
production. So a migration is rehearsed on real-shaped data, with no way to
damage any, by naming the preview project:

```
GOOGLE_CLOUD_PROJECT=koryta-pl-preview npx tsx scripts/migrate/... --prod
```

The database ids are the same in both, so the project is the whole of the
choice.

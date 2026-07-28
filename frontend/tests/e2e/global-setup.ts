import { chromium, type FullConfig, type Page } from "@playwright/test";

/** Compiles every route the suite uses before the first test runs.
 *
 * The suite runs against `nuxt dev`, which transforms and pre-bundles a
 * route's module graph the first time a browser asks for it. On a cold
 * checkout - every CI run, and any local run after the vite cache is cleared -
 * that takes tens of seconds, and it is the first tests to run that pay it:
 * they see markup with no listeners on it yet, so a fill never reaches the
 * component and an element that only exists after hydration never shows up.
 * Whichever specs happen to go first fail, which is why the failures move
 * around instead of pointing at one broken page.
 *
 * Warming the routes here moves that cost out of the tests' timeouts. The
 * logged in pages are visited as the seeded admin, because a page behind the
 * auth middleware only bounces to /login when nobody is signed in and its own
 * chunk would still be uncompiled.
 */
const PUBLIC_ROUTES = [
  "/",
  "/lista",
  "/login",
  "/eksploruj/tabela",
  "/eksploruj/tabela?krs=0000357114",
  // Jan Kowalski, seeded as node 1. The entity page pulls in the heaviest of
  // the chunks - the detail view and the graph - and two specs land on one
  // straight after submitting a revision, with no time to spare for a build.
  "/osoba/jan-kowalski-1",
];

const LOGGED_IN_ROUTES = [
  "/eksploruj/nowe",
  "/admin/rewizje",
  // The id does not have to resolve; the route's own chunk is what we want
  // compiled before a spec follows a revision link into it.
  "/admin/rewizje/warmup",
];

/** Seeded by scripts/seed-emulator.ts, the same account the specs log in as. */
const ADMIN = { email: "admin@koryta.pl", password: "password123" };

const NAV_TIMEOUT = 180_000;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3000";

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  // Vite serves a route's modules as the browser discovers them, so the
  // request stream going quiet is what "this route is compiled" looks like.
  let lastModuleAt = Date.now();
  const isModule = (url: string) =>
    ["/_nuxt/", "/@id/", "/@fs/", "/@vite/"].some((part) => url.includes(part));
  page.on("request", (r) => {
    if (isModule(r.url())) lastModuleAt = Date.now();
  });
  page.on("response", (r) => {
    if (isModule(r.url())) lastModuleAt = Date.now();
  });

  const settle = async (route: string) => {
    const start = Date.now();
    while (Date.now() - lastModuleAt < 2_000) {
      if (Date.now() - start > NAV_TIMEOUT) {
        throw new Error(`Warmup: ${route} kept loading modules for 3 minutes`);
      }
      await page.waitForTimeout(250);
    }
  };

  const warm = async (route: string) => {
    lastModuleAt = Date.now();
    await page.goto(route, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await settle(route);
  };

  try {
    for (const route of PUBLIC_ROUTES) await warm(route);

    await logIn(page);
    for (const route of LOGGED_IN_ROUTES) await warm(route);
  } finally {
    await browser.close();
  }
}

/** Signs in through the form, so the auth state the warmed pages see is real. */
async function logIn(page: Page) {
  await page.goto("/login", {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });

  const email = page.locator("input#email");
  // The form is warm by now, but hydration still lands a beat after the
  // modules do - retry the fill until the value sticks in the component.
  const deadline = Date.now() + 60_000;
  for (;;) {
    await email.fill(ADMIN.email);
    const dirty = await page
      .locator(".v-input:has(input#email) .v-field")
      .evaluate((el) => el.classList.contains("v-field--dirty"))
      .catch(() => false);
    if (dirty) break;
    if (Date.now() > deadline)
      throw new Error("Warmup: login form never came alive");
    await page.waitForTimeout(500);
  }

  await page.locator("input#password").fill(ADMIN.password);
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

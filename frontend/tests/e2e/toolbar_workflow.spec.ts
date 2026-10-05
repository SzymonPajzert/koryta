import { test, expect, type Locator, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The Cypress specs this replaces drove a "Dodaj nowe" menu in the signed in
 * toolbar - "Dodaj artykuł", "Dodaj osobę", "Audyt". None of those entries
 * exist any more; the toolbar in layouts/default.vue offers Rewizje, Aktywność
 * and a "Zespół" menu to everyone - the QA list, its problems, and for an admin
 * every report, then the links that leave the site - and an "Admin" menu with
 * the panel and two of its inboxes to admins, and the users page to those past
 * their trial. The intent - the toolbar is for signed in users, and it takes
 * them where it says - ports over; the entries themselves do not.
 *
 * A menu's entries are teleported out of the toolbar, into the overlay
 * container, so they are looked up under `.user-toolbar-menu` rather than
 * under the bar. */
const toolbar = "header .user-toolbar, .user-toolbar";
const menu = ".user-toolbar-menu";

/** The "Admin" activator, by the start of its name. An open menu is
 * `aria-owns`ed by its activator, so while it is open the button's accessible
 * name runs on into every entry - "Admin Panel administracyjny Kolejka ..." -
 * and an exact "Admin" matches nothing until it closes again. */
const adminName = /^Admin/;

/** Open a toolbar menu and wait for `entry` inside it.
 *
 * The activator renders as soon as auth resolves, but it only opens the menu
 * once Vue has attached it, so an early click does nothing. The retry must not
 * click a menu that is already open, which would close it again. */
async function openMenu(page: Page, activator: Locator, entry: string) {
  await expect(async () => {
    if ((await activator.getAttribute("aria-expanded")) !== "true") {
      await activator.click();
    }
    await expect(
      page.locator(menu).getByRole("link", { name: entry }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("User toolbar", () => {
  test("is hidden until you sign in", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(toolbar)).toHaveCount(0);

    await logIn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(toolbar).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("'Rewizje' opens the revisions list", async ({ page }) => {
    await logIn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const rewizje = page.locator(toolbar).getByRole("link", {
      name: "Rewizje",
    });

    // The toolbar renders as soon as auth resolves, but the link only routes
    // once Vue has attached it, so an early click navigates nowhere.
    await expect(async () => {
      await rewizje.first().click();
      await page.waitForURL(/\/admin\/rewizje/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    // The entry list, which is all of the page a reader who is not an admin
    // gets - the queue above it is an admin's.
    await expect(page.locator("#wpisy")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("#kolejka")).toHaveCount(0);
  });

  test("hides the admin menu from a normal user", async ({ page }) => {
    await logIn(page, USERS.normal);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar.getByRole("link", { name: "Rewizje" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Aktywność" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Zespół" })).toBeVisible();
    await expect(bar.getByRole("button", { name: adminName })).toHaveCount(0);
  });

  test("puts the admin pages in one menu for an admin", async ({ page }) => {
    await logIn(page, USERS.admin);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    const admin = bar.getByRole("button", { name: adminName });
    await expect(admin).toBeVisible({ timeout: 30_000 });

    // The four buttons it replaces are no longer links in the strip itself.
    for (const name of ["Admin", "Kolejka", "Notatki", "Zgłoszenia"]) {
      await expect(bar.getByRole("link", { name })).toHaveCount(0);
    }

    await openMenu(page, admin, "Panel administracyjny");
    const entries = page.locator(menu);
    for (const name of ["Kolejka zmian", "Notatki"]) {
      await expect(entries.getByRole("link", { name })).toBeVisible();
    }
    // The seeded admin holds no `newAdmin`, so the users page is theirs; an
    // administrator on trial does not get the entry (DefaultLayout.test.ts).
    await expect(
      entries.getByRole("link", { name: "Użytkownicy" }),
    ).toHaveAttribute("href", "/admin/uzytkownicy");
    // The reports are under "Zespół", beside the QA problems they include.
    await expect(entries.getByRole("link", { name: "Zgłoszenia" })).toHaveCount(
      0,
    );

    await entries.getByRole("link", { name: "Notatki" }).click();
    await page.waitForURL(/\/admin\/notatki/, { timeout: 30_000 });

    // A closed menu has no `to` to light it, so it is lit by hand on the pages
    // it stands for - and "Rewizje", a different route, stays dark.
    await expect(admin).toHaveClass(/v-btn--active/);
    await expect(admin).toHaveAttribute("aria-current", "true");
    await expect(bar.getByRole("link", { name: "Rewizje" })).not.toHaveClass(
      /v-btn--active/,
    );
  });

  test("'Kolejka zmian' opens the queue on the revisions page", async ({
    page,
  }) => {
    await logIn(page, USERS.admin);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    const admin = bar.getByRole("button", { name: adminName });
    await expect(admin).toBeVisible({ timeout: 30_000 });

    await openMenu(page, admin, "Kolejka zmian");
    await page
      .locator(menu)
      .getByRole("link", { name: "Kolejka zmian" })
      .click();
    await page.waitForURL(/\/admin\/rewizje#kolejka$/, { timeout: 30_000 });
    await expect(page.locator("#kolejka")).toBeVisible({ timeout: 30_000 });

    // The queue is a section of /admin/rewizje, a page every signed-in reader
    // has, so arriving there lights "Rewizje" - not the Admin menu, which
    // stands for the pages only an admin can open.
    await expect(bar.getByRole("link", { name: "Rewizje" })).toHaveClass(
      /v-btn--active/,
    );
    await expect(admin).not.toHaveClass(/v-btn--active/);
  });

  test("'Zespół' puts QA, its problems and the reports in one place", async ({
    page,
  }) => {
    await logIn(page, USERS.admin);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    const team = bar.getByRole("button", { name: "Zespół" });
    await expect(team).toBeVisible({ timeout: 30_000 });

    await openMenu(page, team, "QA - zmiany do sprawdzenia");
    const entries = page.locator(menu);
    await expect(
      entries.getByRole("link", { name: "Zgłoszenia" }),
    ).toHaveAttribute("href", "/admin/opinie");

    // Straight to the tab where a problem found on /qa is the report it went
    // out as - for an admin, the reports from every checker.
    await entries.getByRole("link", { name: "Problemy z QA" }).click();
    await page.waitForURL(/\/qa\?widok=problemy$/, { timeout: 30_000 });
    await expect(page.locator('[data-filter="issue"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('[data-section="qa-reports"]')).toBeVisible({
      timeout: 30_000,
    });
  });

  test("'Zespół' gives a reader QA and the links that leave the site", async ({
    page,
  }) => {
    // The home page has an affine board; /aktywnosc does not.
    await logIn(page, USERS.normal);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    const team = bar.getByRole("button", { name: "Zespół" });
    await expect(team).toBeVisible({ timeout: 30_000 });

    await openMenu(page, team, "Nowy bug w GitHubie");
    const entries = page.locator(menu);
    const github = entries.getByRole("link", { name: "Nowy bug w GitHubie" });
    await expect(github).toHaveAttribute("href", /github\.com/);
    await expect(github).toHaveAttribute("target", "_blank");
    await expect(
      entries.getByRole("link", { name: "Dyskusja w affine" }),
    ).toHaveAttribute("href", /app\.affine\.pro/);
    // Above them, QA and its problems, which /qa opens to everybody signed
    // in - and not the reports, which are an admin's.
    await expect(
      entries.getByRole("link", { name: "QA - zmiany do sprawdzenia" }),
    ).toHaveAttribute("href", "/qa");
    await expect(
      entries.getByRole("link", { name: "Problemy z QA" }),
    ).toHaveAttribute("href", "/qa?widok=problemy");
    await expect(entries.getByRole("link", { name: "Zgłoszenia" })).toHaveCount(
      0,
    );

    await page.keyboard.press("Escape");
    await expect(team).toHaveAttribute("aria-expanded", "false");
    await bar.getByRole("link", { name: "Aktywność" }).click();
    await page.waitForURL(/\/aktywnosc/, { timeout: 30_000 });
    await openMenu(page, team, "Nowy bug w GitHubie");
    await expect(
      entries.getByRole("link", { name: "Dyskusja w affine" }),
    ).toHaveCount(0);
  });
});

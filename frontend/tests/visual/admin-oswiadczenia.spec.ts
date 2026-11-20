import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import {
  DAILY_AUTO_PUBLISH_LIMIT,
  type DeclarationOverview,
} from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  BY_HAND,
  OPENED_CROP,
  cropImages,
  declarationOverview,
  declarationOverviewEmpty,
  declarationOverviewOff,
  heldCrops,
  heldCropsOfAnother,
  heldRelations,
  proposalRevisions,
} from "./fixtures/declarationsAdmin";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";
import { SEEDED_DECLARATION_PEOPLE as declarationPeople } from "../../scripts/declarationPeople";

/** /admin/oswiadczenia, how far the reading of BIP declarations has got: the
 * declarations by state, the chain from a candidacy searched to a person
 * published with today's publications against the limit, and the lists an
 * admin works through. As approved on the design board (round bip-admin-r2:
 * the bar above the chain).
 *
 * The readings live in collections the seed leaves empty, so the overview and
 * the crop are answered from ./fixtures/declarationsAdmin.ts - production's
 * numbers, made-up people, and a crop cut from a fake scan, never a real one.
 * The page is rendered in the browser only (`ssr: false` on /admin/**), which
 * is what lets a route handler answer it, and it tells every time against the
 * frozen clock.
 *
 * Every shot is `admin-oswiadczenia…`: baselines are one flat folder by name,
 * and the reading page, /oswiadczenia, has `oswiadczenia…` of its own. */

const OSWIADCZENIA = { tag: pageTag("admin/oswiadczenia") };

const HELD = declarationOverview.lists.held;
/** The newest held row of a reason. */
const heldFor = (reason: string) => HELD.find((row) => row.reason === reason)!;
/** A page held for a conflicting reading whose only crop is a namesake's,
 * settled on the date of another page it names. */
const OF_ANOTHER = HELD.filter(
  (row) => row.reason === "conflicting_reading",
)[1]!;
/** A page held while a person's proposal waits, the newest version on it. */
const PROPOSAL = heldFor("pending_proposal");

/** Signed in as the seeded admin on the page, with `overview` as the answer.
 * Only what the page reads is answered: no shot here sends a decision. A held
 * row's crops, and what the publish dialog reads, come from the fixtures. */
async function openOverview(page: Page, overview: DeclarationOverview) {
  await freezeClock(page);
  await page.route("**/api/declarations/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/declarations/overview") {
      return route.fulfill({ json: overview });
    }
    // The night's people count, drawn above the declarations by state.
    if (request.method() === "GET" && path === "/api/declarations/people") {
      return route.fulfill({ json: { people: declarationPeople } });
    }
    if (request.method() === "GET" && path.endsWith("/images")) {
      return route.fulfill({ json: cropImages() });
    }
    const crops = /^\/api\/declarations\/publications\/([^/]+)\/crops$/.exec(
      path,
    );
    if (request.method() === "GET" && crops) {
      const row = HELD.find((held) => held.personId === crops[1]) ?? HELD[0]!;
      return route.fulfill({
        json:
          row.personId === OF_ANOTHER.personId
            ? heldCropsOfAnother(row)
            : heldCrops(row),
      });
    }
    return route.fulfill({ status: 404, json: { message: "Page not found" } });
  });
  // The publish dialog: the two-places page's runs for any page, but none for
  // the proposal's page, so its shot is about the version alone - and a
  // relation's „→” is drawn in a system font, which is not the same on CI.
  await page.route("**/api/edges/byNode**", (route) => {
    const nodeId = new URL(route.request().url()).searchParams.get("nodeId");
    const relations = heldRelations(heldFor("two_places").personId);
    return route.fulfill({
      json:
        nodeId === PROPOSAL.personId
          ? { relations: [], nodeParties: ["PO"], nodePublished: false }
          : { ...relations, nodePublished: false },
    });
  });
  await page.route("**/api/revisions/byNode**", (route) => {
    const nodeId = new URL(route.request().url()).searchParams.get("nodeId");
    return route.fulfill({
      json:
        nodeId === PROPOSAL.personId
          ? proposalRevisions(PROPOSAL.name)
          : { revisions: [], approvedRevisionId: "fxrevapproved" },
    });
  });
  await logIn(page, USERS.admin, "/admin/oswiadczenia");
  await expect(page.getByTestId("declarations-progress")).toBeVisible({
    timeout: 30_000,
  });
}

test("admin-oswiadczenia", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openOverview(page, declarationOverview);

  // What only the fixture has, so a run that drew an empty overview fails
  // here rather than banking one.
  await expect(
    page
      .getByTestId("declarations-disputed")
      .locator(`[data-declaration-id="${OPENED_CROP.id}"]`),
  ).toBeVisible();
  await expect(page.getByTestId("declarations-cap")).toContainText(
    "9 osób czeka na kolejny dzień.",
  );
  // The bar of the declarations by state stands above the chain.
  const states = await page.getByTestId("declarations-states").boundingBox();
  const chain = await page.getByTestId("declarations-progress").boundingBox();
  expect(states!.y + states!.height).toBeLessThanOrEqual(chain!.y);
  // The readings chart is drawn after its card mounts.
  await expect(
    page.getByTestId("declarations-readings").locator(".apexcharts-svg"),
  ).toBeVisible({ timeout: 30_000 });

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("admin-oswiadczenia.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** A disputed crop opened: the crop at its own size (scrolled sideways on a
 * phone), what readers typed, the page it is for with its date kept out of
 * sight, and the decisions under it. */
test(
  "admin-oswiadczenia-sporny-wycinek",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);

    const row = page
      .getByTestId("declarations-disputed")
      .locator(`[data-declaration-id="${OPENED_CROP.id}"]`);
    await row.locator("[data-row-toggle]").click();

    // Both crops in, decoded, before anything is judged.
    for (const crop of ["date", "name"]) {
      const image = row.locator(`[data-crop="${crop}"] img`);
      await expect(image).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    await expect(row.locator("[data-settle-reading]")).toHaveCount(3);
    // The page's date stays hidden until the admin asks for it.
    await expect(row.locator("[data-reveal-dates]")).toBeVisible();
    await expect(row.locator("[data-page-date]")).toHaveCount(0);

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot("admin-oswiadczenia-sporny-wycinek.png");

    await expectFitsThePhone(page, testInfo);
  },
);

/** The automatic publication switched off (a daily limit of 0): the chain
 * ends in „Dziś” without places to count, and the queue waits with the
 * button to publish from it all the same - an admin's press goes past the
 * limit, as round bip-admin-r2 drew it. */
test(
  "admin-oswiadczenia-wylaczone",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverviewOff);

    const cap = page.getByTestId("declarations-cap");
    await expect(cap).toHaveAttribute("data-limit", "0");
    await expect(cap).toContainText("publikowanie automatyczne wyłączone");
    await expect(cap).toContainText("83 osoby czekają w kolejce.");
    await expect(cap.locator("[data-cap-publish]")).toBeVisible();

    await readyForElementShot(page);
    await expect(page.getByTestId("declarations-progress")).toHaveScreenshot(
      "admin-oswiadczenia-wylaczone.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** Right after the deploy, before the job's first upload: the head and the
 * chain at nought, none of the day's places taken under the limit the site
 * ships with, and one sentence where the lists will be. */
test("admin-oswiadczenia-puste", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openOverview(page, declarationOverviewEmpty);

  await expect(page.locator("[data-overview-empty]")).toContainText(
    "Zadanie jeszcze niczego nie przesłało.",
  );
  await expect(page.getByTestId("declarations-states")).toHaveCount(0);
  const cap = page.getByTestId("declarations-cap");
  await expect(cap).toHaveAttribute(
    "data-limit",
    String(DAILY_AUTO_PUBLISH_LIMIT),
  );
  await expect(cap).toContainText(`z ${DAILY_AUTO_PUBLISH_LIMIT}`);
  await expect(cap).toContainText("Nikt nie czeka w kolejce.");

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("admin-oswiadczenia-puste.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** A row opened, by its person, in the section given: past the 20 the list
 * starts with, when it is further down. */
async function openRow(page: Page, section: string, personId: string) {
  const row = page.locator(`${section} [data-person-id="${personId}"]`);
  if ((await row.count()) === 0) {
    await page.locator(`${section} [data-show-all]`).click();
  }
  await row.locator("[data-row-toggle]").first().click();
  return row;
}

/** A page held for standing in two places, opened: what holds it, what to do
 * about it, and the decisions (round oswiadczenia-wstrzymane-r3). */
test(
  "admin-oswiadczenia-wstrzymany",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);

    const row = await openRow(
      page,
      "#wstrzymane",
      heldFor("two_places").personId,
    );
    await expect(row.locator("[data-hold-publish]")).toBeVisible();
    await expect(row.locator("[data-hold-recheck]")).toBeVisible();
    await expect(row.locator("[data-hold-decline]")).toBeVisible();

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot("admin-oswiadczenia-wstrzymany.png");

    await expectFitsThePhone(page, testInfo);
  },
);

/** „Opublikuj ręcznie” on it: the election's two runs in a block of their
 * own, each with its office, its party and where else the person stood, and
 * under it the party only the unticked run gives the page. */
test(
  "admin-oswiadczenia-okno-publikacji",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);
    const person = heldFor("two_places").personId;
    const row = await openRow(page, "#wstrzymane", person);

    await row.locator("[data-hold-publish]").click();
    const dialog = page.getByTestId("publish-node-dialog");
    await expect(
      dialog.getByTestId("publish-place-clash-local-2024"),
    ).toBeVisible();
    // The run in the declaration's place ticked, as an admin would: the
    // namesake's party still goes up with the page.
    await dialog.getByTestId(`publish-relation-check-${person}-run1`).click();
    await expect(
      dialog.getByTestId("publish-clash-parties-local-2024"),
    ).toContainText("Tylko niezaznaczona kandydatura daje partię: PiS.");

    await readyForElementShot(page);
    await expect(dialog).toHaveScreenshot(
      "admin-oswiadczenia-okno-publikacji.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** The dialog on a page whose newest version is a person's proposal: what
 * publishing approves is said to be one. */
test(
  "admin-oswiadczenia-okno-propozycja",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);
    const row = await openRow(page, "#wstrzymane", PROPOSAL.personId);

    await row.locator("[data-hold-publish]").click();
    const dialog = page.getByTestId("publish-node-dialog");
    await expect(dialog.getByTestId("publish-auto-approve")).toContainText(
      "propozycję zmiany",
    );
    await expect(dialog.getByTestId("publish-no-relations")).toBeVisible();

    await readyForElementShot(page);
    await expect(dialog).toHaveScreenshot(
      "admin-oswiadczenia-okno-propozycja.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** A page held for a conflicting reading whose crop is a namesake's: the crop
 * is shown without its decisions, and no recheck is offered. */
test(
  "admin-oswiadczenia-inna-data-cudzy",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);
    const row = await openRow(page, "#wstrzymane", OF_ANOTHER.personId);

    await expect(row.locator("[data-hold-crops-others]")).toBeVisible();
    const image = row.locator("[data-crop] img").first();
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(row.locator("[data-hold-recheck]")).toHaveCount(0);

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot(
      "admin-oswiadczenia-inna-data-cudzy.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** A page held on a date an admin settled: published by hand, it shows the
 * declaration (decision on 2026-11-18). */
test(
  "admin-oswiadczenia-data-administratora",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);
    const row = await openRow(
      page,
      "#wstrzymane",
      heldFor("admin_decision").personId,
    );

    await expect(row.locator("[data-hold-note]")).toContainText(
      "Datę ustalił administrator, więc automat nie publikuje.",
    );
    await expect(row.locator("[data-hold-recheck]")).toHaveCount(0);

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot(
      "admin-oswiadczenia-data-administratora.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** One an admin said not to publish, first in „Nie do publikacji”, with the
 * way back. */
test(
  "admin-oswiadczenia-odlozony",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);
    const declined = declarationOverview.lists.setAside.find(
      (row) => row.status === "declined",
    )!;
    const row = await openRow(page, "#nie-do-publikacji", declined.personId);

    await expect(row.locator("[data-hold-restore]")).toBeVisible();

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot("admin-oswiadczenia-odlozony.png");

    await expectFitsThePhone(page, testInfo);
  },
);

/** A held page published by hand: the hold closed, it is among the recent
 * publications, as published by hand. */
test("admin-oswiadczenia-recznie", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openOverview(page, declarationOverview);
  const row = page
    .getByTestId("declarations-recent")
    .locator(`[data-person-id="${BY_HAND}"]`);
  await row.locator("[data-row-toggle]").first().click();

  await expect(row).toContainText("opublikowana ręcznie");

  await readyForElementShot(page);
  await expect(row).toHaveScreenshot("admin-oswiadczenia-recznie.png");

  await expectFitsThePhone(page, testInfo);
});

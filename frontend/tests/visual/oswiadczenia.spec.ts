import { test, expect } from "./test";
import type { Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  DOCUMENT_HOST,
  FIRST_DATE,
  ReadingDesk,
  readingCrops,
} from "./fixtures/declarations";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /oswiadczenia, where readers type the birth date off a line cut out of a
 * councillor's asset declaration: Szymon's pick of round bip-czytanie-r1, one
 * field that says back what it understood (variant B), approved in round
 * bip-czytanie-r2 with reading open to readers without an account.
 *
 * Every crop is fetched in the browser - with the reader's token, or with
 * this browser's reader id when nobody is signed in - so the two endpoints the
 * page calls are answered here, from ./fixtures/declarations.ts, whose crops
 * are synthetic: the repo is public, and a real one is a named person's
 * handwriting. */

const OSWIADCZENIA = { tag: pageTag("oswiadczenia/index") };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Asked = {
  method: string;
  path: string;
  authorization: string | null;
  readerId: string | null;
};

/** Answers the reading endpoints from `desk`, as the real ones would: a token
 * or a reader id, or a 401. Returns what the page asked, and with what. */
async function serveReading(page: Page, desk: ReadingDesk) {
  const asked: Asked[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/api/declarations/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = await request.allHeaders();
      asked.push({
        method: request.method(),
        path: url.pathname,
        authorization: headers.authorization ?? null,
        readerId: headers["x-reader-id"] ?? null,
      });
      if (!headers.authorization && !headers["x-reader-id"]) {
        return route.fulfill({
          status: 401,
          json: { statusCode: 401, message: "Unauthorized" },
        });
      }
      if (request.method() === "GET" && url.pathname.endsWith("/next")) {
        const count = Number(url.searchParams.get("count")) || 1;
        return route.fulfill({ json: desk.next(count) });
      }
      const answer = /^\/api\/declarations\/([^/]+)\/answer$/.exec(
        url.pathname,
      );
      const result =
        request.method() === "POST" && answer
          ? desk.answer(decodeURIComponent(answer[1]!), request.postDataJSON())
          : null;
      return result
        ? route.fulfill({ json: result })
        : route.fulfill({
            status: 404,
            json: { statusCode: 404, message: "Page not found" },
          });
    },
  );
  return asked;
}

/** A signed-in reader, through the sign-in's redirect, which is a router push:
 * the page mounts in the browser with the reader known. */
async function openSignedIn(page: Page, desk: ReadingDesk) {
  const asked = await serveReading(page, desk);
  await freezeClock(page);
  await logIn(page, USERS.normal, "/oswiadczenia");
  return asked;
}

/** The crop on screen, drawn: what only the fixture says is on the card, so a
 * run that drew something else fails here rather than banking it. */
async function cropShown(page: Page, unit: string) {
  await expect(page.getByTestId("declaration-task")).toContainText(unit, {
    timeout: 30_000,
  });
  for (const testid of ["declaration-crop-date", "declaration-crop-name"]) {
    await expect(page.getByTestId(testid)).toHaveJSProperty("complete", true);
  }
}

/** A reader with a dozen crops read, three of them today, and the three
 * crops of the fixture before them. */
const readerAtWork = () =>
  new ReadingDesk(readingCrops(), {
    open: 1284,
    mine: { today: 3, total: 12 },
  });

/** Every request went with the reader's token, none under a reader id. */
function askedSignedIn(asked: Asked[]) {
  expect(asked.length).toBeGreaterThan(0);
  for (const { method, path, authorization, readerId } of asked) {
    expect(authorization, `${method} ${path}`).toMatch(/^Bearer /);
    expect(readerId, `${method} ${path}`).toBeNull();
  }
}

test("oswiadczenia", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const asked = await openSignedIn(page, readerAtWork());
  await cropShown(page, "Testowice (gmina miejsko-wiejska)");
  await expect(page.getByTestId("declaration-progress")).toContainText(
    "razem 12",
  );
  askedSignedIn(asked);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("oswiadczenia.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

/** What the field understood, said back beside its label. */
test("oswiadczenia-data-wpisana", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openSignedIn(page, readerAtWork());
  await cropShown(page, "Testowice (gmina miejsko-wiejska)");

  await page.getByTestId("declaration-date-input").fill(FIRST_DATE);
  await expect(page.getByTestId("declaration-reading")).toHaveText(
    "15 lipca 1979",
  );

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("oswiadczenia-data-wpisana.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** A day that does not exist, sent anyway: the field turns red, the line
 * beside its label says why in the danger ink, and nothing is sent. */
test("oswiadczenia-zla-data", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const desk = readerAtWork();
  await openSignedIn(page, desk);
  await cropShown(page, "Testowice (gmina miejsko-wiejska)");

  const date = page.getByTestId("declaration-date-input");
  await date.fill("31.02.1979");
  await date.press("Enter");
  const reading = page.getByTestId("declaration-reading");
  await expect(reading).toHaveText("Taki dzień nie istnieje.");
  await expect(reading).toHaveClass(/ow-reading--error/);
  await expect(date).toHaveClass(/ow-card__input--error/);
  // Refused on the page: the crop stays, and the server heard nothing.
  await expect(page.getByTestId("declaration-answered")).toHaveCount(0);
  expect(desk.answers).toEqual([]);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("oswiadczenia-zla-data.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** The next crop, and under it the line about the one just answered: what was
 * saved, the link to the whole declaration in dark sage (Szymon, round
 * bip-czytanie-r2), and that the crop has enough readings now. */
test("oswiadczenia-po-odpowiedzi", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const desk = readerAtWork();
  const asked = await openSignedIn(page, desk);
  await cropShown(page, "Testowice (gmina miejsko-wiejska)");

  const date = page.getByTestId("declaration-date-input");
  await date.fill(FIRST_DATE);
  await date.press("Enter");

  const answered = page.getByTestId("declaration-answered");
  await expect(answered).toContainText("Zapisane: 15 lipca 1979");
  await expect(answered).toContainText("ten wycinek ma już komplet odczytów");
  await cropShown(page, "Przykładowo (gmina miejska)");
  await expect(page.getByTestId("declaration-progress")).toContainText(
    "razem 13",
  );
  // Sent as the day it is, from the key a hurried reader presses.
  expect(desk.answers).toEqual([
    { id: "wycinek-1", body: { verdict: "date", value: "1979-07-15" } },
  ]);
  askedSignedIn(asked);

  const link = page.getByTestId("declaration-document-link");
  await expect(link).toHaveAttribute(
    "href",
    `https://${DOCUMENT_HOST}/oswiadczenia/wycinek-1.pdf`,
  );
  await expect(answered).toContainText(DOCUMENT_HOST);
  // In the dark sage ink, not the blue one links elsewhere take.
  const inks = await link.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "rgb(var(--v-theme-ink-sage))";
    el.parentElement!.appendChild(probe);
    const sage = getComputedStyle(probe).color;
    probe.remove();
    return { link: getComputedStyle(el).color, sage };
  });
  expect(inks.link).toBe(inks.sage);

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("oswiadczenia-po-odpowiedzi.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** Nothing left for this reader: the crops still open wait for other readers,
 * never the same one twice. */
test(
  "oswiadczenia-wszystko-odczytane",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const asked = await openSignedIn(
      page,
      new ReadingDesk([], { open: 5, mine: { today: 3, total: 12 } }),
    );

    const done = page.getByTestId("declaration-done");
    await expect(done).toContainText("Na razie wszystko odczytane", {
      timeout: 30_000,
    });
    await expect(done).toContainText(
      "Pozostałe wycinki czekają na odczyty innych osób",
    );
    await expect(page.getByTestId("declaration-task")).toHaveCount(0);
    askedSignedIn(asked);

    await readyForFullPage(page);
    await expect(page).toHaveScreenshot("oswiadczenia-wszystko-odczytane.png", {
      fullPage: true,
    });

    await expectFitsThePhone(page, testInfo);
  },
);

/** A stranger reads straight away (Szymon, round bip-czytanie-r1): the crop,
 * and under the work the banner that says what an account adds. A plain visit,
 * as one makes it - the server draws the title, the browser the crop. */
test("oswiadczenia-bez-konta", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const asked = await serveReading(
    page,
    new ReadingDesk(readingCrops(), {
      open: 1284,
      mine: { today: 0, total: 0 },
    }),
  );
  await freezeClock(page);
  await page.goto("/oswiadczenia");

  await cropShown(page, "Testowice (gmina miejsko-wiejska)");
  await expect(page.getByTestId("declaration-progress")).toContainText(
    "jeszcze żadnego",
  );
  const banner = page.getByTestId("declaration-login");
  await expect(banner).toContainText("Czytasz bez konta.");
  await expect(banner.getByTestId("login-banner-signup")).toBeVisible();
  // Under the work, never in its way.
  const card = await page.getByTestId("declaration-task").boundingBox();
  const under = await banner.boundingBox();
  expect(under!.y).toBeGreaterThan(card!.y + card!.height);
  // Asked without a token, under one reader id this browser made and kept.
  expect(asked.length).toBeGreaterThan(0);
  const readerIds = new Set(asked.map((request) => request.readerId));
  expect(readerIds.size).toBe(1);
  for (const { method, path, authorization, readerId } of asked) {
    expect(authorization, `${method} ${path}`).toBeNull();
    expect(readerId, `${method} ${path}`).toMatch(UUID);
  }

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("oswiadczenia-bez-konta.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

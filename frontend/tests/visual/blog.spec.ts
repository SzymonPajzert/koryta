import { test, expect } from "./test";
import { expectFitsThePhone } from "./phoneWidth";
import { pageTag } from "./pageTags";
import { readyForFullPage } from "./fullPage";
import type { BlogPostSummary } from "../../shared/blog";

/** /blog, drawn from a fixed list rather than from content/blog.
 *
 * The page lists whatever posts the build holds, so a capture of the real list
 * would change with every post published, and every publishing commit would
 * have to retake it. The list is answered here instead - on a navigation inside
 * the site, which is when the page asks /api/blog from the browser, where a
 * route can answer it. */
const posts: BlogPostSummary[] = [
  {
    slug: "radni-w-spolkach",
    path: "/blog/radni-w-spolkach",
    title: "Ilu radnych zasiada w zarządach i radach spółek miejskich",
    description:
      "Policzyliśmy radnych, którzy pracują w spółkach należących do gmin, w których zasiadają - i sprawdziliśmy, z jakich są komitetów.",
    date: "2026-10-09",
    authors: ["Zespół Koryta.pl"],
    draft: false,
    readingMinutes: 6,
  },
  {
    slug: "szpitale-rady",
    path: "/blog/szpitale-rady",
    title: "Rady społeczne szpitali po wyborach",
    description: "Kto zasiadł w radach szpitali powiatowych w ostatnim roku.",
    date: "2026-09-21",
    authors: ["Jan Kowalski", "Anna Nowak"],
    draft: true,
    readingMinutes: 3,
  },
];

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: {
        $router: { push: (to: string) => Promise<unknown> };
      };
    };
  };
};

test("blog", { tag: pageTag("blog/index") }, async ({ page }, testInfo) => {
  await page.route("**/api/blog", (route) => route.fulfill({ json: posts }));

  await page.goto("/o-nas");
  await page.waitForFunction(
    () =>
      !!(document.querySelector("#__nuxt") as MountPoint | null)?.__vue_app__,
  );
  await page.evaluate(async () => {
    const root = document.querySelector("#__nuxt") as MountPoint;
    await root.__vue_app__!.config.globalProperties.$router.push("/blog");
  });
  await page.waitForURL("**/blog");
  await page.getByText(posts[0]!.title).waitFor();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("blog.png", {
    fullPage: true,
    timeout: 20_000,
  });
  await expectFitsThePhone(page, testInfo);
});

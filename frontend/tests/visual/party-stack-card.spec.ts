import { test, expect } from "./test";

/** The picture a link to „Partie w czasie” unfurls into, fetched the way a
 * platform fetches it: the og:image of the page's server render, then that
 * image. Not a browser screenshot, so no page tag: nothing is opened in
 * `page`.
 *
 * The seeded emulators hold a handful of posts with a party and none in a
 * category, so this is every institution, over years the seed has finished
 * with - the picture does not move as the months go by. */

const LINK = "/eksploruj/autograf/partie-w-czasie?od=2015&do=2024";

test("partie-w-czasie-karta", async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name !== "visual-desktop",
    "One picture, whatever the viewport",
  );

  // The first render may give up on a stack still being counted and keep the
  // site's card; the count goes on, and a later render has it.
  let image = "";
  await expect
    .poll(
      async () => {
        const html = await (await request.get(LINK)).text();
        image =
          /<meta property="og:image" content="([^"]+)"/
            .exec(html)?.[1]
            ?.replaceAll("&amp;", "&") ?? "";
        return image;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toContain("/_og/d/");

  // Absolute, and named after the site's url rather than this server.
  const response = await request.get(new URL(image).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(await response.body()).toMatchSnapshot("partie-w-czasie-karta.png");
});

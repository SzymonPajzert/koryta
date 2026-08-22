import { test, expect, type Locator, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** v-network-graph draws its labels as SVG text, which `getByText` will not
 * find - it reads innerText, and SVG elements have none. */
const label = (page: Page, name: string) =>
  page.locator("svg text").filter({ hasText: name });

/** Types into an entity picker and picks the option that comes back.
 *
 * Retried as a whole because the suite runs against the dev server: until the
 * field has hydrated a `fill` writes the DOM value without it reaching the
 * component, so no search is issued and no option ever appears. Same helper as
 * topic_graph.spec.ts.
 */
async function pick(page: Page, field: Locator, term: string, name: string) {
  const input = field.locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(term);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

/** Recording that an article names somebody, and where that then shows up.
 *
 * Until this existed the only way to say it from the app was the generic edge
 * editor, which is not on the article's page, so in practice every mention came
 * from the extraction pipeline. The point of the feature is that a name the
 * model missed can be added by whoever is reading the article - and that adding
 * it puts the person in the article's graph and in the graph of any story the
 * article belongs to, without anybody having to draw a relation first.
 *
 * "Artykuł placeholder 6" (node a6) is used by no other spec and starts with no
 * edges at all, so everything asserted here can only have come from this test.
 */
test("a mention added by hand reaches the article and topic graphs", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Unique, so parallel workers and repeat runs against a warm emulator do not
  // collide on the topic name.
  const topicName = `Sprawa placeholder ${Date.now()}`;

  await logIn(page, USERS.normal, "/artykul/artykul-placeholder-6-a6");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Artykuł placeholder 6",
    { timeout: 30_000 },
  );

  // 1. The mention itself, from the article's own page.
  await pick(
    page,
    page.getByTestId("article-mention-picker"),
    "Nowak",
    "Anna Nowak",
  );
  await page.getByTestId("article-mention-add").click();
  const chip = page
    .getByTestId("article-mention-chip")
    .filter({ hasText: "Anna Nowak" });
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // Really stored, not just rendered optimistically.
  await page.reload();
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // 2. And drawn. No relation has been recorded from her, which is the point:
  //    somebody named in an article belongs in its graph before the work of
  //    connecting them is done.
  await expect(label(page, "Anna Nowak").first()).toBeVisible({
    timeout: 60_000,
  });

  // 2b. With the network she sits in around her. Nothing rests on this
  //     article, so her employer and the person she knows can only have come
  //     from the hop out the article graph takes from everybody it names -
  //     which is what makes the mention worth drawing rather than a lone dot.
  await expect(label(page, "Orlen").first()).toBeVisible({ timeout: 60_000 });
  await expect(label(page, "Jan Kowalski").first()).toBeVisible({
    timeout: 60_000,
  });

  // 3. The story the article belongs to draws her too.
  const picker = page.getByTestId("article-topic-picker");
  await expect(async () => {
    await picker.locator("input").fill(topicName);
    await expect(page.getByTestId("entity-picker-add-new-topic")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("entity-picker-add-new-topic").click();
  const createDialog = page.locator(".v-dialog:visible");
  await expect(createDialog).toContainText("Zaproponuj nowy temat", {
    timeout: 30_000,
  });
  await createDialog.getByRole("button", { name: "Zaproponuj" }).click();
  await expect(createDialog).toBeHidden({ timeout: 30_000 });
  await page.getByTestId("article-topic-add").click();

  await page
    .getByTestId("article-topic-chip")
    .filter({ hasText: topicName })
    .click();
  await expect(page).toHaveURL(/\/temat\//, { timeout: 30_000 });
  await expect(label(page, "Anna Nowak").first()).toBeVisible({
    timeout: 60_000,
  });
  // And her alone: a story already draws every one of its articles' people,
  // so it does not take the hop out that a single article's page does.
  await expect(label(page, "Jan Kowalski")).toHaveCount(0);

  // 4. Taking it back takes her off both.
  await page.goBack();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.getByTestId("article-mention-remove").click();
  await expect(chip).toHaveCount(0, { timeout: 30_000 });

  await page.reload();
  await expect(chip).toHaveCount(0, { timeout: 30_000 });
});

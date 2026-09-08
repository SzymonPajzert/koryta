import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Open the composer from a relation section and name the other end.
 *
 * Retried as a whole because the suite runs against the dev server: until the
 * dialog has hydrated a `fill` writes the DOM value without it reaching the
 * component, so no search is ever issued and no option appears. */
async function compose(page: Page, trigger: string, name: string) {
  await page.getByTestId(trigger).click();

  const dialog = page.getByTestId("add-relation-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const input = dialog.getByTestId("add-relation-entity").locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(name);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
  return dialog;
}

/** Adding a relation, the way the composer asks for it: who first, then how.
 *
 * The node ids are the ones scripts/seed-emulator.ts writes. Both specs pick
 * pairs the seed leaves unconnected, so what the page shows afterwards can
 * only have come from the form. */
test.describe("Add a relation", () => {
  test("a reader connects two people from the relations section", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Jan Kowalski (1) and Piotr Wiśniewski (4).
    await logIn(page, USERS.normal, "/entity/person/1");
    // Scoped to the relations list, not to the whole page: the graph below it
    // draws two hops now, and Piotr is at the second - both of them are linked
    // to Orlen. What this spec is about is whether they are related to each
    // other, and the list is where that is claimed.
    const relations = page.getByTestId("relations-history");
    await expect(relations).not.toContainText("Piotr Wiśniewski");

    const dialog = await compose(
      page,
      "add-relation-employment",
      "Piotr Wiśniewski",
    );

    // Two people can only be joined one way, so the composer settles the verb
    // itself rather than asking.
    await expect(
      dialog.getByTestId("add-relation-verb-connection-outgoing"),
    ).toBeVisible();

    await dialog.getByTestId("add-relation-name").locator("input").fill("żona");
    // A personal tie is named from both ends - see `Edge.reverse_name` - and
    // the form will not submit until it says both. The vocabulary offers the
    // second word as a chip.
    await expect(dialog.getByTestId("add-relation-submit")).toBeDisabled();
    await dialog.getByTestId("add-relation-reverse-suggestion-mąż").click();
    await dialog.getByTestId("add-relation-submit").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Really stored: an edge awaiting approval is still shown to a logged in
    // reader, so a reload lists it. In the list, again - his name was on the
    // page before the relation existed.
    await page.reload();
    await expect(page.getByTestId("relations-history")).toContainText(
      "Piotr Wiśniewski",
      { timeout: 30_000 },
    );
    await expect(page.locator("body")).toContainText("żona");
  });

  test("the verb offered depends on what was picked", async ({ page }) => {
    test.setTimeout(180_000);
    // Krzysztof Wójcik (5) has no relations in the seed at all.
    await logIn(page, USERS.normal, "/entity/person/5");

    const dialog = await compose(page, "add-relation-employment", "Orlen");

    // A person and a company: employment, not the connection offered above.
    await expect(
      dialog.getByTestId("add-relation-verb-employed-outgoing"),
    ).toBeVisible();
    await expect(
      dialog.getByTestId("add-relation-verb-connection-outgoing"),
    ).toBeHidden();

    await dialog
      .getByTestId("add-relation-name")
      .locator("input")
      .fill("prezes zarządu");
    await dialog.getByTestId("add-relation-submit").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await page.reload();
    await expect(page.locator("body")).toContainText("prezes zarządu", {
      timeout: 30_000,
    });
  });

  test("a logged out reader is sent to sign in", async ({ page }) => {
    await page.goto("/entity/person/1");
    // The section is there to read; adding is what needs an account.
    await expect(page.getByTestId("add-relation-employment")).toBeHidden();
  });
});

import { expect, type Locator, type Page } from "@playwright/test";

/** Wait until Vue has hydrated the login form inside `scope`.
 *
 * The suite runs against the dev server, where hydrating the form takes a
 * couple of seconds. Until it finishes the inputs and links are already in the
 * markup but carry no listeners, so clicks are dropped and typed values never
 * reach the component state - the form then submits empty credentials. Vuetify
 * derives `v-field--dirty` from the field's model, so seeing that class after a
 * fill proves the reactive form is live. */
export async function waitForLoginFormHydrated(scope: Page | Locator) {
  const email = scope.locator(".v-input:has(input#email)");

  // The budget stays well under the default test timeout, so a form that never
  // comes alive is reported here instead of as a timeout further down the flow.
  await expect(async () => {
    await email.locator("input").fill("hydration-probe@example.com");
    await expect(email.locator(".v-field")).toHaveClass(/v-field--dirty/, {
      timeout: 500,
    });
  }).toPass({ timeout: 15_000 });

  await email.locator("input").fill("");
}

/** Answer the newsletter question a reader outside the team is asked right
 * after creating an account or signing in, on /login or in the sign-in
 * dialog (components/mail/NewsletterQuestion.vue), so a spec that only needs
 * an account can go on to what it is about. */
export async function answerNewsletterQuestion(
  scope: Page | Locator,
  answer: "yes" | "no" = "no",
) {
  const question = scope.locator("[data-newsletter-question]");
  await expect(question).toBeVisible({ timeout: 30_000 });
  await question
    .locator(
      answer === "yes" ? "[data-newsletter-yes]" : "[data-newsletter-no]",
    )
    .click();
}

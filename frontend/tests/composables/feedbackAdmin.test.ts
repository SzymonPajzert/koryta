import { describe, it, expect } from "vitest";
import { feedbackPlace } from "../../app/composables/feedbackAdmin";
import type { Feedback, FeedbackContext } from "../../shared/model";

const report = (context: Partial<FeedbackContext> = {}): Feedback => ({
  id: "fb-1",
  kind: "bug",
  message: "Nie działa.",
  context: { route: "/entity/person/abc", ...context },
  createdAt: "2026-10-15T08:00:00.000Z",
  adminStatus: "new",
});

/** Where a report was written, as its one-line row on /admin/opinie and /qa
 * names it. Nearly every document title ends in the site's name, which took up
 * to a third of that line - the one part every report shares - while the name
 * that told two reports apart was cut to „Mari…”. */
describe("feedbackPlace", () => {
  it("names the QA entry a report from /qa was about", () => {
    expect(
      feedbackPlace(
        report({
          route: "/qa",
          pageTitle: "QA | Koryta.pl",
          qa: {
            itemId: "redesign-admin-pages",
            title: "Nowy wygląd stron administracji",
            status: "issue",
          },
        }),
      ),
    ).toBe("QA: Nowy wygląd stron administracji");
  });

  it("drops the site's name from the end of a page's title", () => {
    expect(
      feedbackPlace(report({ pageTitle: "Mariola Duraj-Majda | Koryta.pl" })),
    ).toBe("Mariola Duraj-Majda");
    // The admin pages' own „ - koryta.pl” comes before the layout's suffix.
    expect(
      feedbackPlace(report({ pageTitle: "Opinie - koryta.pl | Koryta.pl" })),
    ).toBe("Opinie");
    // The same plain hyphen on its own, as the site writes every separator.
    expect(feedbackPlace(report({ pageTitle: "Procesy - koryta.pl" }))).toBe(
      "Procesy",
    );
    // An en dash, as a typographer writes the separator.
    expect(feedbackPlace(report({ pageTitle: "Procesy – koryta.pl" }))).toBe(
      "Procesy",
    );
  });

  // Only a trailing suffix is the site's name; anywhere else it is part of
  // the title the reader saw.
  it("keeps the site's name where it is the title, or not at its end", () => {
    expect(feedbackPlace(report({ pageTitle: "Koryta.pl" }))).toBe("Koryta.pl");
    expect(
      feedbackPlace(report({ pageTitle: "Koryta.pl - o projekcie" })),
    ).toBe("Koryta.pl - o projekcie");
  });

  it("falls back to the route when there is no title to show", () => {
    expect(feedbackPlace(report({ route: "/admin/procesy" }))).toBe(
      "/admin/procesy",
    );
    expect(
      feedbackPlace(report({ route: "/admin/procesy", pageTitle: "" })),
    ).toBe("/admin/procesy");
    // A title that was nothing but the suffix leaves nothing to show.
    expect(
      feedbackPlace(
        report({ route: "/admin/procesy", pageTitle: "| Koryta.pl" }),
      ),
    ).toBe("/admin/procesy");
  });

  it("leaves the stored report as the browser sent it", () => {
    const item = report({ pageTitle: "Opinie - koryta.pl | Koryta.pl" });
    feedbackPlace(item);
    expect(item.context.pageTitle).toBe("Opinie - koryta.pl | Koryta.pl");
  });
});

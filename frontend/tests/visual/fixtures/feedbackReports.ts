import type { Feedback } from "../../../shared/model";
import { daysAgo } from "../clock";

/** /api/feedback/list for /admin/opinie's visual test.
 *
 * The seed clears the `feedback` collection, and a report cannot be filed
 * from a test without also going out to Slack, so the list is answered from
 * here. Something in every section the page has: two reports nobody has
 * placed yet, a queue of two - one of them a verdict sent from /qa, which the
 * row marks - and two closed ones, which the page folds away. Anonymous, so
 * no row asks /api/users/lookup about an account that does not exist. */
export const feedbackReports: Feedback[] = [
  {
    id: "wizfb1",
    kind: "bug",
    message:
      "Na stronie spółki licznik osób w zarządzie pokazuje 0, choć niżej są wymienione trzy osoby.",
    context: {
      route: "/instytucja/wodociagi-przykladowo-wizmi1",
      pageTitle: "Wodociągi Przykładowo sp. z o.o. - koryta.pl",
    },
    createdAt: daysAgo(0),
    adminStatus: "new",
  },
  {
    id: "wizfb2",
    kind: "data",
    message:
      "Pani Barbara Przykładowa nie jest już w radzie nadzorczej od marca.",
    contact: "czytelnik@example.com",
    context: {
      route: "/osoba/barbara-przykladowa-wizos1",
      pageTitle: "Barbara Przykładowa - koryta.pl",
    },
    createdAt: daysAgo(2),
    adminStatus: "new",
  },
  {
    id: "wizfb3",
    kind: "idea",
    message: "Przydałby się filtr po województwie w tabeli osób.",
    context: { route: "/eksploruj/tabela", pageTitle: "Eksploruj - Tabela" },
    createdAt: daysAgo(9),
    adminStatus: "in_progress",
    adminNote: "Zaczęte, razem z filtrem po powiecie.",
    queueRank: 1024,
  },
  {
    id: "wizfb4",
    kind: "bug",
    message: "Przycisk „Otwórz” w tym wpisie prowadzi na pustą stronę.",
    context: {
      route: "/qa",
      pageTitle: "QA - zmiany do sprawdzenia",
      qa: {
        itemId: "reviewer-queue",
        title: "Jeden ekran do przeglądania kolejki rewizji",
        status: "issue",
      },
    },
    createdAt: daysAgo(5),
    adminStatus: "new",
    queueRank: 2048,
  },
  {
    id: "wizfb5",
    kind: "bug",
    message: "Mapa na stronie osoby nie ładuje się na telefonie.",
    context: { route: "/osoba/anna-przykladowa-wizos3" },
    createdAt: daysAgo(20),
    adminStatus: "resolved",
    adminNote: "Poprawione.",
  },
  {
    id: "wizfb6",
    kind: "other",
    message: "Dlaczego nie ma tu wszystkich radnych z mojej gminy?",
    context: { route: "/" },
    createdAt: daysAgo(30),
    adminStatus: "wont_fix",
  },
];

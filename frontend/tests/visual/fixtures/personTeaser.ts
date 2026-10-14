import type { PersonTeaser } from "../../../shared/personTeaser";

/** /api/nodes/h1/teaser for the teaser's visual test.
 *
 * `h1` is a seeded draft, so a logged out reader's /api/nodes answer for it is
 * the 404 the teaser stands in for. Its id has no hyphen in it, which matters:
 * the page reads the id off the url as whatever follows the last one. The real
 * teaser route would 404 for it too - no seeded person has the import's
 * revision behind it that the route asks for (`importedOrReviewed`), and adding
 * one would move the counts every other baseline prints - so the answer is
 * this. The name is made up; the company is the seeded one the institution
 * pages are photographed with, which is published and public, so the row
 * draws it as a link with its „Instytucja publiczna” chip. */
export const personTeaser: PersonTeaser = {
  id: "h1",
  name: "Jan Przykładowy",
  post: {
    id: "teaser-post",
    name: "Członek Rady Nadzorczej",
    start_date: "2024-03-15",
    company: {
      id: "sukspolka",
      name: "Wojewódzki Zakład Testowy",
      visibility: true,
      isPublic: true,
    },
  },
  employmentCount: 4,
};

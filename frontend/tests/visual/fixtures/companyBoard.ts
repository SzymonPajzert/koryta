import type { CompanySuccessions } from "../../../server/api/edges/successions.get";

/** /api/edges/successions for the seeded institution, as a logged out reader
 * is answered for a board with unpublished holders on it.
 *
 * No seeded person is unpublished with the import's revision behind them that
 * the endpoint asks for (`importedOrReviewed`), and adding one would move the
 * counts every other baseline prints - so the answer is this. The names are
 * made up. The shapes are the endpoint's: a published holder with the party
 * they always had, two unpublished ones whose party is held back
 * (`partyHidden`, `parties` empty) - the second with the longest name on the
 * board, so a phone wraps the chip under it - and one with no party on record,
 * who gets no chip at all. */
export const companyBoard: CompanySuccessions = {
  successions: [],
  current: [
    {
      edgeId: "board-prezes",
      personId: "b1",
      personName: "Anna Przykładowa",
      parties: ["PSL"],
      role: "Prezes Zarządu",
      start: "2023-02-01",
      published: true,
    },
    {
      edgeId: "board-rn-1",
      personId: "b2",
      personName: "Jan Testowy",
      parties: [],
      role: "Rada Nadzorcza",
      start: "2024-04-30",
      published: false,
      partyHidden: true,
    },
    {
      edgeId: "board-rn-2",
      personId: "b3",
      personName: "Krzysztof Stanisław Wielkopolański",
      parties: [],
      role: "Rada Nadzorcza",
      start: "2024-09-06",
      published: false,
      partyHidden: true,
    },
    {
      edgeId: "board-rn-3",
      personId: "b4",
      personName: "Ewa Bezpartyjna",
      parties: [],
      role: "Rada Nadzorcza",
      start: "2019-05-27",
      published: false,
    },
  ],
  hidden: 0,
};

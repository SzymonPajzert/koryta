import type { UnpublishedEdges } from "../../../server/api/edges/unpublished.get";

/** /api/edges/unpublished for /admin/krawedzie's visual test.
 *
 * What the seed leaves ready to publish depends on what the other specs in the
 * run have published by then, so the page is answered from here. A page that
 * stopped on the scan's limit - the case the counter over the table and
 * „Wczytaj więcej” under it are for - with one row of each kind the column
 * has to cope with: a long name at one end and a long company at the other,
 * an article whose name is its bare address, a relation with no period, an
 * ingest's lower-case role, and an end that has no name, only its id. The
 * people and places are made up. */
export const unpublishedEdges: UnpublishedEdges = {
  edges: [
    {
      id: "wizkr1",
      type: "employed",
      name: "Rada Nadzorcza",
      sourceId: "wizos1",
      sourceName: "Barbara Przykładowa",
      targetId: "wizmi1",
      targetName: "Wodociągi Przykładowo sp. z o.o.",
      start_date: "2021-03-15",
      end_date: null,
    },
    {
      id: "wizkr2",
      type: "employed",
      name: "Prezes Zarządu",
      sourceId: "wiznos1",
      sourceName: "Aleksandra Konstantynowicz-Szczepańska",
      targetId: "wizmi9",
      targetName:
        "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.",
      start_date: "2019-07-01",
      end_date: "2023-06-30",
    },
    {
      id: "wizkr3",
      type: "election",
      name: "kandydatura",
      sourceId: "wizos2",
      sourceName: "Tomasz Przykładowy",
      targetId: "wizre1",
      targetName: "Powiat przykładowski",
      start_date: "2024-04-07",
      end_date: "2024-04-07",
    },
    {
      id: "wizkr4",
      type: "owns",
      name: null,
      sourceId: "wizgm1",
      sourceName: "Gmina Przykładowo",
      targetId: "wizmi4",
      targetName:
        "Przedsiębiorstwo Komunikacji Miejskiej w Przykładowie sp. z o.o.",
      start_date: null,
      end_date: null,
    },
    {
      id: "wizkr5",
      type: "mentions",
      name: null,
      sourceId: "wizart2",
      sourceName:
        "https://www.gazeta-przykladowa.example.pl/region/2024/03/radny-powiatu-prezesem-spolki-komunalnej-kulisy-konkursu,123456.html",
      targetId: "wizos1",
      targetName: "Barbara Przykładowa",
      start_date: null,
      end_date: null,
    },
    {
      id: "wizkr6",
      type: "employed",
      name: "członek rady nadzorczej",
      sourceId: "wizos7",
      sourceName: null,
      targetId: "wizmi6",
      targetName: "Szpital Powiatowy w Przykładowie sp. z o.o.",
      start_date: "2022-01-01",
      end_date: null,
    },
  ],
  nextCursor: "wizkr6",
  scanned: 3000,
  truncated: true,
};

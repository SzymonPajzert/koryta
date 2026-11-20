import type { HitLine } from "../../../shared/searchLine";

/** What /api/search answers „jan kow” with in the search line's visual test,
 * once /api/stats/computeNodes has stored each person's line - the seed
 * carries none, and nothing in a visual run computes them.
 *
 * Made-up people with real towns, picked for what can go wrong in a line of
 * one: a published councillor with a party, an unpublished namesake with only
 * the post its teaser shows, the longest town in the base on a phone, a
 * register name long enough to be cut, and a person with no line at all, who
 * keeps the one-line row every hit had before. */
export const searchLineHits: {
  id: string;
  name: string;
  type: string;
  published: boolean;
  line?: HitLine;
}[] = [
  {
    id: "radny",
    name: "Jan Kowalski",
    type: "person",
    published: true,
    line: {
      where: "Mielec",
      parties: ["PiS"],
      what: "Rada miasta",
      when: "2024",
    },
  },
  {
    id: "imiennik",
    name: "Jan Kowalski",
    type: "person",
    published: false,
    line: { where: "Jelenia Góra", what: "„WODNIK”", when: "do 2025" },
  },
  {
    id: "dyrektor",
    name: "Jan Kowalczyk",
    type: "person",
    published: true,
    line: {
      where: "Ostrowiec Świętokrzyski",
      parties: ["Nowa Lewica", "SLD"],
      what: "MIEJSKI ZAKŁAD KOMUNIKACJI",
    },
  },
  {
    id: "lekarz",
    name: "Jan Kowalewski",
    type: "person",
    published: false,
    line: {
      where: "Sosnowiec",
      what: "WOJEWÓDZKI SZPITAL SPECJALISTYCZNY NR 5 IM. ŚW. BARBARY W SOSNOWCU",
      when: "do 2019",
    },
  },
  { id: "nikt", name: "Jan Kowalik", type: "person", published: false },
];

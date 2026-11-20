import type { DeclarationPeople } from "../shared/declarations";

/** The declarations job's nightly count in people, invented, for the emulator
 * seed (scripts/seed-emulator.ts writes it to stats/declaration_people) and the
 * tests that draw it. The numbers add up the way the real ones must
 * (`declarationPeopleSchema`), and the unit names are made up. */
export const SEEDED_DECLARATION_PEOPLE: DeclarationPeople = {
  at: "2026-11-14T06:30:00.000Z",
  exportDay: "2026-11-14",
  people: 1200,
  published: 300,
  namesakes: 50,
  mismatched: 10,
  held: 60,
  reading: 90,
  cropped: 450,
  downloaded: 130,
  searching: 110,
  searchingBy: [
    {
      reason: "unreachable",
      count: 40,
    },
    {
      reason: "not_listed",
      count: 35,
    },
    {
      reason: "no_date_line",
      count: 20,
    },
    {
      reason: "refused",
      count: 10,
    },
    {
      reason: "other_page",
      count: 5,
    },
  ],
  expectedNamesakes: {
    count: 120,
    low: 100,
    high: 140,
  },
  bySurname: [
    {
      min: 0,
      max: 50,
      settled: 40,
      namesakes: 0,
      remaining: 90,
    },
    {
      min: 50,
      max: 1000,
      settled: 150,
      namesakes: 5,
      remaining: 260,
    },
    {
      min: 1000,
      max: 5000,
      settled: 90,
      namesakes: 9,
      remaining: 220,
    },
    {
      min: 5000,
      max: 20000,
      settled: 70,
      namesakes: 17,
      remaining: 170,
    },
    {
      min: 20000,
      max: null,
      settled: 50,
      namesakes: 19,
      remaining: 110,
    },
  ],
  topUnits: [
    {
      teryt: "106101",
      name: "Przykładowo (gmina miejska)",
      people: 9,
      reason: "unreachable",
    },
    {
      teryt: "246601",
      name: "powiat próbny",
      people: 4,
      reason: "refused",
    },
    {
      teryt: "020100",
      name: "Szkicowo (gmina wiejska)",
      people: 3,
      reason: "unreachable",
    },
  ],
  publishedByDay: [
    {
      day: "2026-11-05",
      count: 40,
    },
    {
      day: "2026-11-06",
      count: 12,
    },
    {
      day: "2026-11-07",
      count: 35,
    },
    {
      day: "2026-11-09",
      count: 28,
    },
    {
      day: "2026-11-10",
      count: 60,
    },
    {
      day: "2026-11-11",
      count: 75,
    },
    {
      day: "2026-11-12",
      count: 30,
    },
    {
      day: "2026-11-13",
      count: 20,
    },
  ],
};

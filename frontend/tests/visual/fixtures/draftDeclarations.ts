import { readFileSync } from "node:fs";
import type {
  PersonDeclarationCrop,
  PersonDeclarationCrops,
} from "../../../shared/declarations";
import { NOW } from "../clock";
import { DOCUMENT_HOST } from "./declarations";

/** What a draft person's page is answered with in
 * tests/visual/person-draft-declarations.spec.ts: the block of their BIP
 * declarations a signed-in reader sees under the facts, in the states that
 * draw differently.
 *
 * Synthetic, every one of them, as ./declarations.ts says of its crops: the
 * pictures are the PNGs ./crops/make_crops.py draws, and the units and the
 * BIP host are made up. The seeded Jan Kowalski stands in as the draft, with
 * crop 1's date for his birth date, so a crop settled on it reads as a match.
 */

/** The seeded person, and the birth date crop 1's line gives. */
export const draftPerson = {
  id: "1",
  path: "/osoba/jan-kowalski-1",
  birthDate: "1979-07-15",
};

const png = (file: string) =>
  `data:image/png;base64,${readFileSync(
    new URL(`./crops/${file}`, import.meta.url),
  ).toString("base64")}`;

/** Each crop's pictures, by its id: crop `n`'s date and name lines. */
export function draftCropImages(
  id: string,
): { date: string; name: string } | null {
  const n = /^wycinek-(\d)-p0$/.exec(id)?.[1];
  return n
    ? { date: png(`crop-${n}-data.png`), name: png(`crop-${n}-nazwisko.png`) }
    : null;
}

const TESTOWICE = "Testowice (gmina miejsko-wiejska)";

function crop(
  n: number,
  fields: Partial<PersonDeclarationCrop> = {},
): PersonDeclarationCrop {
  return {
    id: `wycinek-${n}-p0`,
    status: "open",
    failure: null,
    unit: TESTOWICE,
    office: "Rada gminy",
    documentUrl: `https://${DOCUMENT_HOST}/oswiadczenia/wycinek-${n}.pdf`,
    answers: 0,
    agreed: null,
    agreedBy: null,
    outcome: null,
    imageSize: {
      date: { width: 950, height: 105 },
      name: { width: 1160, height: 94 },
    },
    ...fields,
  };
}

/** Three declarations waiting for readers, one of them answered once, and a
 * fourth nothing could be cut from, last in the fold. */
export const waiting: PersonDeclarationCrops = {
  publication: null,
  crops: [
    crop(1, { answers: 1 }),
    crop(2),
    crop(3, { unit: "Powiat wzorcowy", office: "Rada powiatu" }),
    crop(4, {
      status: "failed",
      failure: "no_label",
      imageSize: null,
    }),
  ],
  searches: [],
  links: [],
};

/** Matched on the page's date, and held: a candidacy in two places. */
export const held: PersonDeclarationCrops = {
  publication: { status: "held", reason: "two_places", paidPost: true },
  crops: [
    crop(1, {
      status: "agreed",
      answers: 2,
      agreed: draftPerson.birthDate,
      agreedBy: "readers",
      outcome: "queued",
    }),
    crop(2),
  ],
  searches: [],
  links: [],
};

/** Settled on another day than the page's: likely a namesake's. */
export const anotherDay: PersonDeclarationCrops = {
  publication: null,
  crops: [
    crop(2, {
      status: "agreed",
      answers: 3,
      agreed: "1971-09-03",
      agreedBy: "readers",
      outcome: "different",
    }),
    crop(3),
  ],
  searches: [],
  links: [],
};

/** No crop: three local elections won, what the crawler found for each, and
 * a link this reader gave today. */
export const missing: PersonDeclarationCrops = {
  publication: null,
  crops: [],
  searches: [
    {
      year: 2024,
      office: "Wójt",
      unit: "Powiat wzorcowy",
      status: null,
      reason: null,
      files: 0,
      bipUrl: null,
    },
    {
      year: 2018,
      office: "Rada gminy",
      unit: TESTOWICE,
      status: "not_found",
      reason: "not_listed",
      files: 0,
      bipUrl: `https://${DOCUMENT_HOST}/rada-gminy`,
    },
    {
      year: 2014,
      office: "Rada gminy",
      unit: TESTOWICE,
      status: "unconfirmed",
      reason: "unnamed",
      files: 3,
      bipUrl: `https://${DOCUMENT_HOST}/rada-gminy`,
    },
  ],
  links: [
    {
      url: `https://${DOCUMENT_HOST}/oswiadczenia/2018/rada-gminy/kowalski-jan-oswiadczenie-majatkowe-2018.pdf`,
      at: NOW.toISOString(),
      mine: true,
    },
  ],
};

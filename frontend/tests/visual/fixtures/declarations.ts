import { readFileSync } from "node:fs";
import type {
  DeclarationAnswer,
  DeclarationAnswerResult,
  DeclarationFinds,
  DeclarationQueue,
  DeclarationTask,
} from "../../../shared/declarations";

/** The crops /oswiadczenia is photographed with, and the two endpoints the
 * page calls, for tests/visual/oswiadczenia.spec.ts.
 *
 * Synthetic, every one of them: the repo is public, and a real crop is a named
 * person's handwriting cut out of their asset declaration. The PNGs in ./crops
 * were drawn for these tests - the printed form in DejaVu Sans, the
 * „handwriting” in DejaVu Serif Italic, made-up people and places - at the
 * sizes of the job's own crops, a date line about 950 by 105 px and a name line
 * 1,160 by 94, which is what OswiadczeniaCrop fits on a computer and pans on a
 * phone. The units and the BIP host are made up as well.
 *
 * ./crops/make_crops.py draws them. To change one, edit its CASES and run it
 * from frontend/ with data/pipelines' venv (Pillow 12.3.0), then retake the
 * oswiadczenia baselines:
 *
 *     ../data/pipelines/.venv/bin/python -I tests/visual/fixtures/crops/make_crops.py tests/visual/fixtures/crops
 *
 * Unchanged, it draws the committed PNGs again byte for byte.
 *
 * The endpoints live on another branch of the change, and the reader's queue is
 * not in the seed, so the page is answered from here: every crop is fetched in
 * the browser, signed in or not, where a route handler can answer it. */

/** Where the made-up declarations are, for the link under each crop.
 * `.example` never resolves. */
export const DOCUMENT_HOST = "bip.testowice.example";

const png = (file: string) =>
  `data:image/png;base64,${readFileSync(
    new URL(`./crops/${file}`, import.meta.url),
  ).toString("base64")}`;

/** The date read off the first crop, which the spec types. */
export const FIRST_DATE = "15.07.1979";

/** Three crops, as many as the page asks for at a time: the one on screen and
 * two behind it, so answering one never sends it back for more. */
/** The date line of the fixture's crop `n`, as the card draws it: how a test
 * tells which crop is on the card, now that the card says nothing else of it. */
export const cropDate = (n: number) => png(`crop-${n}-data.png`);

export function readingCrops(): DeclarationTask[] {
  const crop = (
    n: number,
    office: DeclarationTask["office"],
    unit: string,
    declarationYear: number,
  ): DeclarationTask => ({
    id: `wycinek-${n}`,
    unit,
    office,
    declarationYear,
    documentUrl: `https://${DOCUMENT_HOST}/oswiadczenia/wycinek-${n}.pdf`,
    host: DOCUMENT_HOST,
    images: {
      date: png(`crop-${n}-data.png`),
      name: png(`crop-${n}-nazwisko.png`),
    },
    imageSize: {
      date: { width: 950, height: 105 },
      name: { width: 1160, height: 94 },
    },
  });
  return [
    crop(1, "Rada gminy", "Testowice (gmina miejsko-wiejska)", 2019),
    crop(2, "Burmistrz", "Przykładowo (gmina miejska)", 2020),
    crop(3, "Rada powiatu", "Powiat wzorcowy", 2021),
  ];
}

/** The three people the reader of `readerAtWork` found, for
 * /oswiadczenia/znalezione: two pages live and a draft. Made up, the people
 * and the places. */
export function readerFinds(): DeclarationFinds {
  return {
    total: 3,
    people: [
      {
        id: "znalezionaOsoba01",
        name: "Jan Szablonowy",
        published: true,
        unit: "Testowice (gmina miejsko-wiejska)",
        office: "Rada gminy",
        declarationYear: 2024,
      },
      {
        id: "znalezionaOsoba02",
        name: "Anna Atrapowa",
        published: false,
        unit: "Przykładowo (gmina miejska)",
        office: "Burmistrz",
        declarationYear: 2023,
      },
      {
        id: "znalezionaOsoba03",
        name: "Piotr Próbny",
        published: true,
        unit: "Powiat wzorcowy",
        office: "Rada powiatu",
        declarationYear: 2024,
      },
    ],
  };
}

/** One reader's sitting, as the server would serve it: the crops not yet
 * answered, how many wait for anybody, and this reader's own count. */
export class ReadingDesk {
  readonly answers: { id: string; body: DeclarationAnswer }[] = [];
  private remaining: DeclarationTask[];
  private open: number;
  private mine: DeclarationQueue["mine"];

  constructor(
    crops: DeclarationTask[],
    counts: { open: number; mine: DeclarationQueue["mine"] },
  ) {
    this.remaining = [...crops];
    this.open = counts.open;
    this.mine = { ...counts.mine };
  }

  /** `GET /api/declarations/next?count=N`. */
  next(count: number): DeclarationQueue {
    const [task = null, ...upcoming] = this.remaining.slice(0, count);
    return { task, upcoming, open: this.open, mine: { ...this.mine } };
  }

  /** `POST /api/declarations/<id>/answer`, or null for a crop not on the
   * desk. Every answer here settles its crop - the second reader's date
   * agreeing with the first - so the line under the next crop says it has
   * enough readings. */
  answer(id: string, body: DeclarationAnswer): DeclarationAnswerResult | null {
    const index = this.remaining.findIndex((task) => task.id === id);
    if (index < 0) return null;
    this.remaining.splice(index, 1);
    this.answers.push({ id, body });
    const settled = body.verdict !== "skip";
    if (settled) {
      this.open -= 1;
      this.mine.today += 1;
      this.mine.total += 1;
    }
    return {
      ...this.next(3),
      settled,
      answered: { id },
    };
  }
}

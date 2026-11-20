import {
  cropOrder,
  type PersonDeclarationCrop,
  type PersonDeclarationCrops,
  type PersonDeclarationLink,
  type PersonDeclarationSearch,
} from "~~/shared/declarations";
import {
  declarationHoldLabel,
  declarationHoldLabels,
  declarationHoldNote,
  declarationReasonLabel,
} from "~/utils/declarationsAdmin";
import { plural } from "~/utils/jobStyle";
import { polishCounting } from "~/composables/polish";

/** Where a draft's declarations stand, as the line over its crops says it:
 * first what its publication record says, then what the crop that got
 * furthest does, and with no crop at all, that there is none. */
export type CropsLineKind =
  | "held"
  | "declined"
  | "queued"
  | "matched"
  | "different"
  | "disputed"
  | "open"
  | "noDate"
  | "read"
  | "unreadable"
  | "failed"
  | "missing";

export type CropsLine = {
  kind: CropsLineKind;
  text: string;
  /** What an admin can do about it, where there is something to say: for
   * admins only, as it tells them what to publish. */
  note: string | null;
  /** The crop the line is about, shown first, and the others; none where
   * there is no crop. */
  lead: PersonDeclarationCrop | null;
  rest: PersonDeclarationCrop[];
  /** With no crop: the elections the person won, and the search for each
   * one's declaration. */
  searches: PersonDeclarationSearch[];
  /** With no crop: the links to the declaration readers found by hand. */
  links: PersonDeclarationLink[];
};

/** The line over a draft's crops, or null for a page with nothing to say:
 * no crop, no local election won since 2014 and no link given. */
export function cropsLine(data: PersonDeclarationCrops): CropsLine | null {
  const [lead, ...rest] = data.crops;
  if (!lead) {
    return data.searches.length > 0 || data.links.length > 0
      ? {
          kind: "missing",
          text: "Nie mamy oświadczenia majątkowego.",
          note: null,
          lead: null,
          rest: [],
          searches: data.searches,
          links: data.links,
        }
      : null;
  }
  const base = { lead, rest, searches: [], links: [] };
  const publication = data.publication;

  if (publication?.status === "held") {
    const row = {
      status: "held" as const,
      reason: publication.reason,
      pagePublic: false,
      paidPost: publication.paidPost,
    };
    return {
      kind: "held",
      text: `Automatyczna publikacja wstrzymana: ${declarationHoldLabel(row)}.`,
      note: declarationHoldNote(row),
      ...base,
    };
  }
  if (publication?.status === "declined") {
    return {
      kind: "declined",
      text: "Automatyczna publikacja odłożona przez administratora.",
      note: publication.reason
        ? `Była wstrzymana: ${declarationHoldLabels[publication.reason]}.`
        : null,
      ...base,
    };
  }
  if (publication) {
    return {
      kind: "queued",
      text: "Data zgadza się z oświadczeniem majątkowym: strona czeka w kolejce do publikacji.",
      note: null,
      ...base,
    };
  }

  const kind = kindOf(lead);
  return { kind, text: textOf(kind, data.crops), note: null, ...base };
}

function kindOf(crop: PersonDeclarationCrop): CropsLineKind {
  switch (cropOrder(crop)) {
    case 0:
      return "matched";
    case 1:
      return "different";
    case 2:
      return "disputed";
    case 3:
      return "open";
    case 4:
      return crop.outcome === "no_date" ? "noDate" : "read";
    case 6:
      return "failed";
    default:
      return "unreadable";
  }
}

function textOf(
  kind: CropsLineKind,
  crops: readonly PersonDeclarationCrop[],
): string {
  switch (kind) {
    case "matched":
      return "Data urodzenia zgadza się z oświadczeniem majątkowym.";
    case "disputed":
      return "Sporny odczyt oświadczenia majątkowego: czytelnicy podali różne daty.";
    case "open": {
      const open = crops.filter((crop) => crop.status === "open").length;
      return open === 1
        ? "Oświadczenie majątkowe czeka na czytelników."
        : `${open} ${plural(open, "oświadczenie majątkowe czeka", "oświadczenia majątkowe czekają", "oświadczeń majątkowych czeka")} na czytelników.`;
    }
    case "different":
      return "Oświadczenie majątkowe podaje inną datę urodzenia niż strona.";
    case "noDate":
      return "Oświadczenie majątkowe podaje datę urodzenia, której strona nie ma.";
    case "read":
      return "Z oświadczenia majątkowego odczytano datę urodzenia.";
    case "failed":
      return "Z oświadczenia majątkowego nie udało się wyciąć daty urodzenia.";
    default:
      return "Nikt nie odczytał daty z oświadczenia majątkowego.";
  }
}

/** Where one crop is, after its unit, for a crop the line's date comparison
 * does not already say it of: a settled date is drawn against the page's. */
export function cropState(crop: PersonDeclarationCrop): string | null {
  if (crop.status === "open") {
    return crop.answers > 0
      ? `czeka na czytelników, ${polishCounting(crop.answers, "odpowiedź", "odpowiedzi", "odpowiedzi")}`
      : "czeka na czytelników";
  }
  if (crop.status === "disputed") return "sporne";
  if (crop.status === "unreadable") return "nieczytelne";
  if (crop.status === "failed") {
    return crop.failure
      ? `bez wycinka: ${declarationReasonLabel(crop.failure)}`
      : "bez wycinka";
  }
  return null;
}

/** What the crawler found for an election the person won: never looked, the
 * reason it found nothing, files that name nobody, or files with no crop
 * cut from them yet. */
export function searchState(search: PersonDeclarationSearch): string {
  const files = polishCounting(search.files, "plik", "pliki", "plików");
  switch (search.status) {
    case "not_found": {
      if (!search.reason) return "nie znaleziono";
      const reason = declarationReasonLabel(search.reason);
      // „nie znaleziono działu z oświadczeniami” says it once already.
      return reason.startsWith("nie znaleziono")
        ? reason
        : `nie znaleziono: ${reason}`;
    }
    case "unconfirmed":
      return `${files} bez nazwiska`;
    case "found":
      return `pobrano ${files}, bez wycinka`;
    default:
      return "jeszcze nie szukaliśmy";
  }
}

/** A link as the list shows it: the host, and for a path too long for its
 * line, its last parts, whole, which is where a declaration's file name is. */
export function shortLink(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    const path = pathname === "/" && !search ? "" : `${pathname}${search}`;
    if (path.length <= 48) return `${host}${path}`;
    const parts = path.split("/").filter(Boolean);
    let tail = "";
    for (let i = parts.length - 1; i >= 0; i--) {
      const longer = `/${parts[i]}${tail}`;
      if (tail && longer.length > 36) break;
      tail = longer;
    }
    return `${host}/…${tail}`;
  } catch {
    return url;
  }
}

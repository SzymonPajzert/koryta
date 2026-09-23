import {
  mdiCallMerge,
  mdiCallSplit,
  mdiCheck,
  mdiClose,
  mdiDeleteOutline,
  mdiEarth,
  mdiEyeOffOutline,
  mdiFlagOutline,
  mdiNoteTextOutline,
  mdiPencilOutline,
  mdiSquareEditOutline,
  mdiThumbsUpDownOutline,
  mdiTrayArrowUp,
} from "@mdi/js";
import type { FeedKind } from "~~/shared/activityFeed";

/** A theme hue: `ink-<tone>` for the glyph, `surface-<tone>` behind it (see
 * shared/colors.ts - every pair clears AA). */
export type FeedTone =
  "sage" | "success" | "warning" | "danger" | "info" | "neutral";

/** The glyph and hue each kind of line carries, so a reader scanning the feed
 * tells a rating from a removal before reading a word. Hues follow what the
 * action does to the public site - green puts something up, red takes it down,
 * amber is what an administrator changed without review - and are keyed on
 * every kind so a new one cannot render blank. */
export const feedKindStyle: Record<
  FeedKind,
  { icon: string; tone: FeedTone; label: string }
> = {
  vote: { icon: mdiThumbsUpDownOutline, tone: "neutral", label: "Ocena" },
  note: { icon: mdiNoteTextOutline, tone: "neutral", label: "Notatka" },
  proposal: {
    icon: mdiPencilOutline,
    tone: "info",
    label: "Propozycja zmiany",
  },
  edit: {
    icon: mdiSquareEditOutline,
    tone: "warning",
    label: "Zmiana bez przeglądu",
  },
  approve: { icon: mdiCheck, tone: "success", label: "Zatwierdzenie" },
  reject: { icon: mdiClose, tone: "danger", label: "Odrzucenie" },
  publish: { icon: mdiEarth, tone: "success", label: "Publikacja" },
  unpublish: { icon: mdiEyeOffOutline, tone: "neutral", label: "Ukrycie" },
  delete: { icon: mdiDeleteOutline, tone: "danger", label: "Usunięcie" },
  merge: { icon: mdiCallMerge, tone: "info", label: "Scalenie" },
  split: { icon: mdiCallSplit, tone: "warning", label: "Rozdzielenie" },
  splitMark: {
    icon: mdiFlagOutline,
    tone: "warning",
    label: "Do rozdzielenia",
  },
  import: { icon: mdiTrayArrowUp, tone: "warning", label: "Import" },
};

/** The utility classes for a tone. Neutral has no surface of its own; it sits
 * on the muted one, which is what `ink-neutral` was measured against. */
export function feedToneClasses(tone: FeedTone): {
  ink: string;
  surface: string;
} {
  return {
    ink: `text-ink-${tone}`,
    surface: `bg-surface-${tone === "neutral" ? "muted" : tone}`,
  };
}

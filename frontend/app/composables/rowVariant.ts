import { computed } from "vue";

/** The look of the admin row lists (`AdminExpandRow`, `AdminRowList`,
 * `AdminSectionHead`), while three of them are being compared.
 *
 * - `a` "karta": quiet - an open row turns into a tinted card.
 * - `b` "szyna": a rail in the row's colour down every row, and a strip of
 *   facts across the top of an open one.
 * - `c` "podział": an open row splits into a solid pane of facts on the left
 *   and the body on the right.
 *
 * Temporary: chosen by `?wariant=` so all three can be photographed from one
 * build. Whichever wins stays; the switch goes. */
export type RowVariant = "a" | "b" | "c";

export function useRowVariant() {
  const route = useRoute();
  return computed<RowVariant>(() => {
    const value = route.query.wariant;
    return value === "a" || value === "c" ? value : "b";
  });
}

/** The colour a row stands for, as one of the ink/surface pairs in
 * shared/colors.ts. `neutral` pairs `ink-neutral` with `surface-muted`. */
export type RowTone =
  | "sage"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

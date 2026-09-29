/** The colour a row of an admin list stands for (`AdminExpandRow`'s rail and
 * open header), as one of the ink/surface pairs in shared/colors.ts. `neutral`
 * pairs `ink-neutral` with `surface-muted`, and so does `strong`, with the
 * darkest ink - for the few rows everything else leads to. */
export type RowTone =
  "sage" | "success" | "warning" | "danger" | "info" | "neutral" | "strong";

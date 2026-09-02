/** Normalizes a stored list field to a string array. Firestore nodes are not
 * guaranteed to match the TS types: array fields sometimes come back as
 * objects with numeric keys ({"0": "PiS"}) or are missing entirely. */
export function toStringArray(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

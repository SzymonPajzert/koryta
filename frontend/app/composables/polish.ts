export interface PolishNoun {
  nominative: string;
  genitive: string;
  dative: string;
  accusative: string;
  instrumental: string;
  locative: string;
}

export function polishCounting(
  number: number,
  form_singular: string,
  form_plural: string,
  form_genitive: string,
): string {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    // dopełniacz dla naście
    return `${number} ${form_genitive}`;
  }
  if (n1 > 1 && n1 < 5) {
    return `${number} ${form_plural}`;
  }
  if (n1 === 1) {
    return `${number} ${form_singular}`;
  }
  return `${number} ${form_genitive}`;
}

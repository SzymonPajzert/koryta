export interface PolishNoun {
  nominative: string;
  genitive: string;
  dative: string;
  accusative: string;
  instrumental: string;
  locative: string;
}

export interface Feminatyw {
  singular: PolishNoun;
  plural: PolishNoun;
}

type InputNoun = [string, string, string, string, string, string];

function toNoun(input: InputNoun): PolishNoun {
  return {
    nominative: input[0],
    genitive: input[1],
    dative: input[2],
    accusative: input[3],
    instrumental: input[4],
    locative: input[5],
  };
}

export function useFeminatyw(options?: { forceFemale?: boolean }) {
  const useFemale: boolean = options?.forceFemale ?? (Math.random() > 0.5);

  function createNoun(
    femaleSingular: InputNoun,
    femalePlural: InputNoun,
    maleSingular: InputNoun,
    malePlural: InputNoun,
  ): Feminatyw {
    if (useFemale) {
      return {
        singular: toNoun(femaleSingular),
        plural: toNoun(femalePlural),
      };
    }
    return {
      singular: toNoun(maleSingular),
      plural: toNoun(malePlural),
    };
  }

  const koryciarz = createNoun(
    [
      "koryciarka",
      "koryciarki",
      "koryciarce",
      "koryciarkę",
      "koryciarką",
      "koryciarce",
    ],
    [
      "koryciarki",
      "koryciarek",
      "koryciarkom",
      "koryciarki",
      "koryciarkami",
      "koryciarkach",
    ],
    [
      "koryciarz",
      "koryciarza",
      "koryciarzowi",
      "koryciarza",
      "koryciarzem",
      "koryciarzu",
    ],
    [
      "koryciarze",
      "koryciarzy",
      "koryciarzom",
      "koryciarzy",
      "koryciarzami",
      "koryciarzach",
    ],
  );

  const tuczyciel = createNoun(
    [
      "tuczycielka",
      "tuczycielki",
      "tuczycielce",
      "tuczycielkę",
      "tuczycielką",
      "tuczycielce",
    ],
    [
      "tuczycielki",
      "tuczycielek",
      "tuczycielkom",
      "tuczycielki",
      "tuczycielkami",
      "tuczycielkach",
    ],
    [
      "tuczyciel",
      "tuczyciela",
      "tuczycielowi",
      "tuczyciela",
      "tuczycielem",
      "tuczycielu",
    ],
    [
      "tuczyciele",
      "tuczycieli",
      "tuczycielom",
      "tuczycieli",
      "tuczycielami",
      "tuczycielach",
    ],
  );

  const pracownik = createNoun(
    [
      "pracowniczka",
      "pracowniczki",
      "pracowniczce",
      "pracowniczkę",
      "pracowniczką",
      "pracowniczce",
    ],
    [
      "pracowniczki",
      "pracowniczek",
      "pracowniczkom",
      "pracowniczki",
      "pracowniczkami",
      "pracowniczkach",
    ],
    [
      "pracownik",
      "pracownika",
      "pracownikowi",
      "pracownika",
      "pracownikiem",
      "pracowniku",
    ],
    [
      "pracownicy",
      "pracowników",
      "pracownikom",
      "pracowników",
      "pracownikami",
      "pracownikach",
    ],
  );

  return { koryciarz, tuczyciel, pracownik };
}

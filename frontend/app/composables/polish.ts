type word = "połączenie";

type cases = {
  singular: string; // 1 owoc
  smallPlural: string; // 2 owoce, 3 owoce, 4 owoce
  bigPlural: string; // 5 owoców, 6 owoców, 7 owoców
};

const wordCases: Map<word, cases> = new Map([
  [
    "połączenie",
    {
      singular: "połączenie",
      smallPlural: "połączenia",
      bigPlural: "połączeń",
    },
  ],
]);

export function declination(count: number, word: word) {
  if (count == 1) return wordCases.get(word)?.singular;
  if (count < 5) return wordCases.get(word)?.smallPlural;
  return wordCases.get(word)?.bigPlural;
}

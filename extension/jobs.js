/** What a capture is doing, said in Polish.
 *
 * One table rather than one per surface. The popup and the side panel both
 * subscribe to the same job and are often on screen a second apart, so two
 * copies of this would eventually disagree about what "extracting" is called —
 * and a state missing from either copy renders as a blank line that says
 * nothing about a job that is still running.
 */

import { factWord } from "./facts.js";

const MESSAGES = {
  idle: () => "",
  capturing: () => "Odczytuję stronę…",
  uploading: () => "Wysyłam do archiwum…",
  extracting: () => "Wyciągam fakty — to potrwa kilkanaście sekund…",
  unauthenticated: () =>
    "Zaloguj się na koryta.pl i połącz rozszerzenie, żeby zapisywać artykuły.",
  slow: (job) => job.message,
  done: (job) =>
    job.duplicate
      ? "Ten artykuł był już zapisany."
      : job.facts
        ? `Gotowe — ${job.facts} ${factWord(job.facts)} do przejrzenia.`
        : "Zapisane. Nie znaleziono w tym artykule faktów do dodania.",
  error: (job) => `Nie udało się: ${job.error}`,
};

export function jobMessage(job) {
  return (MESSAGES[job?.state] || (() => ""))(job) || "";
}

/** Whether the capture button should be held shut. */
export function jobIsBusy(job) {
  return ["capturing", "uploading", "extracting"].includes(job?.state);
}

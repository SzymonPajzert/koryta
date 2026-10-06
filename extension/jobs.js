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
  // Neither success nor failure, and deliberately not styled as either: the
  // page is archived and the nightly pipeline will read it out of the bucket
  // whatever happens here. Only the preview is missing, and the reason for that
  // is a deployment somewhere and not anything the reader did.
  stored: (job) =>
    job.error
      ? `Zapisane w archiwum — ekstrakcja nie wystartowała (${job.error}). Nocny potok i tak przeczyta tę stronę.`
      : "Zapisane w archiwum — ekstrakcja nie wystartowała. Nocny potok i tak przeczyta tę stronę.",
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

/** Where the capture can be followed on the site: its run on /admin/procesy,
 * which reads the same `articlePages` document this job polls and shows what
 * came of it after the panel is closed - the extractor's progress, its
 * error, the facts. Null until the upload has handed back the page's id.
 *
 * The page is the datascience group's, as capturing is, so whoever can
 * capture can open it. */
export function jobProgressUrl(origin, job) {
  if (!job?.pageId) return null;
  return `${origin}/admin/procesy#przebieg-${encodeURIComponent(job.pageId)}`;
}

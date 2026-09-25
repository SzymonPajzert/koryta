/** Reports a change answers without an entry on the QA list of its own: a fix
 * that does what the report asked and no more, so the report already says what
 * to check and where.
 *
 * Like `QaItem.fixes`, the claim is code, made in the commit that makes the
 * change, so it reaches a page exactly when the change does - a branch's claims
 * show on that branch's /qa, and on koryta.pl once it is rolled out. Nobody but
 * an admin checks these: /qa lists the open ones to an admin under "Zgłoszenia
 * do zamknięcia", with what changed and where to look, and the admin closes a
 * report once it works. A change others should try for themselves still gets a
 * QA entry, with its `fixes`. `shared/feedbackFixes.ts` joins both kinds of
 * claim to the reports.
 */

export type ReportFix = {
  /** What changed, in a sentence, in the language of the site: what the admin
   * checking it should now see. */
  change: string;
  /** The reports it answers, as `feedback` document ids - the part after
   * `#fb-`, as in `QaItem.fixes`. */
  fixes: string[];
  /** Where to look, when it is not the page the report was written on - a
   * report sent from /qa, say. */
  link?: string;
};

/** Newest first: prepend, in the commit that makes the change. An entry stays
 * after its reports are closed - a closed report on /admin/opinie still shows
 * what fixed it. */
export const REPORT_FIXES: ReportFix[] = [
  {
    change:
      "Karta faktu na stronie osoby ma pod cytatem link „Artykuł w bazie”, który prowadzi na stronę artykułu w serwisie.",
    fixes: ["s6LJDRorb8Cq9woLl0JM"],
    link: "/osoba/rafal-trzaskowski-8rg6MrDfdiRR7YaAvE5O",
  },
  {
    change:
      "„Artykuł stanowi źródło dla” pokazuje każdą relację w jednej linijce, z chipami zamiast niebieskich linków, a artykuł, który potwierdza relację, jest w „Artykuły, które o tym wspominają” na stronach obu jej końców.",
    fixes: ["wEGUmip1NzOZtA3dPaM5"],
  },
  {
    change:
      "Ołówek przy kandydaturze otwiera okno z polem „Uzyskano mandat”, więc wygraną można oznaczyć bez starego formularza.",
    fixes: ["ZASMgbwZm0hewxZ8wLBL"],
    link: "/osoba/kamil-sebastian-barczyk-qFxOI9faG9y0TuYuJAMc",
  },
];

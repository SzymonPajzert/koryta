import { describe, it, expect } from "vitest";
import {
  reportTaskDraft,
  reportTaskTitle,
  reportUrl,
  reportsOf,
  tasksByReport,
} from "../../shared/reportTasks";
import { taskReports } from "../../shared/taskContext";
import { taskCreateSchema, type Task } from "../../shared/tasks";
import type { Feedback } from "../../shared/model";

const REPORT = "Wii0ubWl6sMTMhsxpmvS";
const OWNER = "of0BKlwqWLX21Cuml4NMHZ18xoC3";

const report = (fields: Partial<Feedback> = {}): Feedback => ({
  id: REPORT,
  kind: "idea",
  message:
    "It would be nice to promote an idea from admin/opinie to /admin/zadania. It would still be able to track the status of it but this way it would be easier to plan this item",
  userUid: OWNER,
  context: {
    route: "/admin/zadania?widok=mapa&kto=ty#t-decide-open-umowy-product-calls",
    pageTitle: "Zadania (Admin) - koryta.pl",
  },
  createdAt: "2026-09-29T14:36:58.736Z",
  adminStatus: "new",
  ...fields,
});

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: `Zadanie ${id}`,
  body: "",
  kind: "task",
  who: "owner",
  status: "open",
  dependsOn: [],
  tags: [],
  links: [],
  branches: [],
  createdAt: "2026-09-28T10:00:00.000Z",
  updatedAt: "2026-09-28T10:00:00.000Z",
  createdBy: "owner",
  log: [],
  ...fields,
});

describe("reportTaskDraft", () => {
  it("makes an idea an idea, for the owner, with the report and its link", () => {
    const draft = reportTaskDraft(report());

    expect(draft.kind).toBe("idea");
    expect(draft.who).toBe("owner");
    expect(draft.title).toBe(
      "It would be nice to promote an idea from admin/opinie to /admin/zadania",
    );
    expect(draft.links).toEqual([
      "https://koryta.pl/admin/opinie#fb-Wii0ubWl6sMTMhsxpmvS",
    ]);
    expect(draft.body).toBe(
      [
        report().message,
        "",
        "Zgłoszenie: https://koryta.pl/admin/opinie#fb-Wii0ubWl6sMTMhsxpmvS",
        "Zgłaszający: właściciel serwisu (owner)",
        "Strona: https://koryta.pl/admin/zadania?widok=mapa&kto=ty",
      ].join("\n"),
    );
    expect(draft.source).toBe("zgłoszenie Wii0ubWl6sMTMhsxpmvS");
    expect(draft.tags).toEqual(["opinie"]);
  });

  it("says who wrote the report, in the labels the agents' tools use", () => {
    const who = (userUid?: string) =>
      reportTaskDraft(report({ userUid })).body.split("\n")[3];
    expect(who("REdyYP4uvMSgCEjdSoiEHqy360G3")).toBe(
      "Zgłaszający: zaufany recenzent (trusted)",
    );
    expect(who("someoneelse")).toBe(
      "Zgłaszający: zalogowany użytkownik (signed-in)",
    );
    expect(who(undefined)).toBe("Zgłaszający: ktoś niezalogowany (anonymous)");
  });

  it("makes anything but an idea a task", () => {
    for (const kind of ["bug", "data", "other"] as const) {
      expect(reportTaskDraft(report({ kind })).kind).toBe("task");
    }
  });

  it("is a task the list takes as it is", () => {
    // What the dialog sends is this, as the owner left it: the server parses
    // it with the same schema.
    const draft = reportTaskDraft(
      report({ message: "x".repeat(5000), adminNote: "y".repeat(2000) }),
    );
    expect(() => taskCreateSchema.parse(draft)).not.toThrow();
  });

  it("is read back as the report's task, wherever its text is changed", () => {
    const draft = reportTaskDraft(report());
    expect(reportsOf(draft)).toEqual([REPORT]);
    // Taken out of the links in the dialog, it is still in the text.
    expect(reportsOf({ ...draft, links: [] })).toEqual([REPORT]);
    // And „Kopiuj dla czatu” hands the agent that one report.
    expect(taskReports(draft)).toEqual([REPORT]);
  });

  it("is not the task of the report whose page the report was written on", () => {
    // Km0Pw1ii was written with IzZixsXe open: its page is that report's
    // link, and it was never a task for that one.
    const draft = reportTaskDraft(
      report({
        context: { route: "/admin/opinie#fb-IzZixsXeIRtgftDXSpWG" },
      }),
    );
    expect(draft.body.split("\n")).toContain(
      "Strona: https://koryta.pl/admin/opinie",
    );
    expect(draft.body).not.toContain("IzZixsXe");
    expect(reportsOf(draft)).toEqual([REPORT]);
    expect(taskReports(draft)).toEqual([REPORT]);
  });

  it("names the QA entry a verdict was written on rather than /qa", () => {
    const draft = reportTaskDraft(
      report({
        kind: "bug",
        message: "Przycisk „Otwórz” w tym wpisie prowadzi na pustą stronę.",
        userUid: undefined,
        context: {
          route: "/qa",
          qa: {
            itemId: "reviewer-queue",
            title: "Jeden ekran do przeglądania kolejki rewizji",
            status: "issue",
          },
        },
      }),
    );
    expect(draft.body.split("\n").slice(2)).toEqual([
      "Zgłoszenie: https://koryta.pl/admin/opinie#fb-Wii0ubWl6sMTMhsxpmvS",
      "Zgłaszający: ktoś niezalogowany (anonymous)",
      "Wpis QA: „Jeden ekran do przeglądania kolejki rewizji” https://koryta.pl/qa#qa-reviewer-queue",
    ]);
  });

  it("leaves out a page that is not on the site, and adds the team's note", () => {
    const draft = reportTaskDraft(
      report({
        context: { route: "https://example.com/phish" },
        adminNote: "  Zaczęte, razem z filtrem po powiecie.  ",
      }),
    );
    expect(draft.body).not.toContain("example.com");
    expect(draft.body.split("\n").at(-1)).toBe(
      "Notatka: Zaczęte, razem z filtrem po powiecie.",
    );
  });

  it("links to the origin it is given", () => {
    expect(reportUrl("abc", "http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/admin/opinie#fb-abc",
    );
  });
});

describe("reportTaskTitle", () => {
  const title = (message: string) => reportTaskTitle(message, "Zgłoszenie x");

  it("takes the first sentence, without its full stop", () => {
    expect(title("Filtr po województwie. I po powiecie.")).toBe(
      "Filtr po województwie",
    );
    expect(title("Tylko pierwsza linia\ndruga linia")).toBe(
      "Tylko pierwsza linia",
    );
    expect(title("Strona osoby:\n- brak zdjęcia")).toBe("Strona osoby");
  });

  it("ends a sentence at a question or exclamation mark, whatever follows", () => {
    expect(title("Czy da się to zrobić? Bo nie wiem.")).toBe(
      "Czy da się to zrobić?",
    );
    expect(title("Dlaczego go nie ma? może dlatego, że")).toBe(
      "Dlaczego go nie ma?",
    );
  });

  it("goes on past an abbreviation, capital after it or not", () => {
    expect(title("Licznik np. osób w zarządzie pokazuje 0. Coś jeszcze")).toBe(
      "Licznik np. osób w zarządzie pokazuje 0",
    );
    expect(
      title("Na stronie spółki np. PKP Intercity brakuje zarządu. Druga"),
    ).toBe("Na stronie spółki np. PKP Intercity brakuje zarządu");
    expect(title("Adres ul. Marszałkowska jest zły. Poprawcie")).toBe(
      "Adres ul. Marszałkowska jest zły",
    );
    expect(title("Brakuje m.in. Orlenu i PGE na liście. Dalej")).toBe(
      "Brakuje m.in. Orlenu i PGE na liście",
    );
    expect(
      title("Pokazujemy 24 najnowszych z 66. -> dlaczego tylko 24? Nie ma"),
    ).toBe("Pokazujemy 24 najnowszych z 66. -> dlaczego tylko 24?");
    expect(title("Wielokropek... zostaje")).toBe("Wielokropek... zostaje");
  });

  it("does not take a list's first marker for the first word", () => {
    expect(
      title("1. QA mają w mojej przeglądarce dziwny wygląd.\n2. Czy możemy"),
    ).toBe("QA mają w mojej przeglądarce dziwny wygląd");
    expect(title("- brak zdjęcia. Reszta")).toBe("brak zdjęcia");
  });

  it("cuts a long first sentence at a word", () => {
    const long = `${"słowo ".repeat(40)}koniec`;
    const cut = title(long);
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut.endsWith("słowo…")).toBe(true);
  });

  it("falls back to the report when there are no words", () => {
    expect(title("   \n  ")).toBe("Zgłoszenie x");
  });
});

describe("tasksByReport", () => {
  it("finds a report in a task's links or on its Zgłoszenie line, open tasks first", () => {
    const other = "abcdefghijABCDEFGHIJ";
    const tasks = [
      task("done-one", {
        status: "done",
        links: [reportUrl(REPORT)],
        createdAt: "2026-09-29T10:00:00.000Z",
      }),
      task("older", { body: `Coś.\n\nZgłoszenie: ${reportUrl(REPORT)}` }),
      task("newer", {
        links: [reportUrl(REPORT), reportUrl(other)],
        createdAt: "2026-09-29T09:00:00.000Z",
      }),
      task("unrelated"),
    ];
    const found = tasksByReport(tasks);

    expect(found.get(REPORT)?.map((t) => t.id)).toEqual([
      "newer",
      "older",
      "done-one",
    ]);
    expect(found.get(other)?.map((t) => t.id)).toEqual(["newer"]);
    expect([...found.keys()]).toHaveLength(2);
  });

  it("leaves a report the text only mentions to itself", () => {
    const tasks = [
      task("mentions", {
        body: `Jak w ${reportUrl(REPORT)}.\nStrona: https://koryta.pl/admin/opinie#fb-${REPORT}`,
      }),
    ];
    expect(tasksByReport(tasks).size).toBe(0);
  });

  it("counts a task once for a report it names twice", () => {
    const tasks = [
      task("twice", {
        body: `Zgłoszenie: ${reportUrl(REPORT)}`,
        links: [reportUrl(REPORT)],
      }),
    ];
    expect(
      tasksByReport(tasks)
        .get(REPORT)
        ?.map((t) => t.id),
    ).toEqual(["twice"]);
  });
});

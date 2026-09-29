import type { Task } from "../../../shared/tasks";

/** /api/ops/tasks/list for /admin/zadania's visual tests.
 *
 * The tasks live in their own database, which the seed does not fill, so the
 * list is answered from here: something on every list the page has, and a
 * chain for the map to draw - a merge, the deploy waiting on it, and the
 * upload waiting on the deploy - beside a second chain with a decision at its
 * head and a goal at its end. Times are fixed rather than relative, since the
 * page prints them as dates. */

const at = (day: string, time = "09:00") => `2026-09-${day}T${time}:00.000Z`;

function task(id: string, fields: Partial<Task> & Pick<Task, "title">): Task {
  return {
    id,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: at("26"),
    updatedAt: at("26"),
    createdBy: "agent:bridge-cse_01Example",
    log: [],
    ...fields,
  };
}

export const opsTasks: Task[] = [
  task("merge-przykladowa-galaz", {
    title: "Scal gałąź przykladowa-galaz: spółki bez nazwy dostają numer KRS",
    tags: ["deploy"],
    branches: ["przykladowa-galaz"],
    rank: 1,
  }),
  task("deploy-indeksow", {
    title: "Wdróż indeksy Firestore, których potrzebuje przykladowa-galaz",
    body: "npx firebase deploy --only firestore:indexes",
    dependsOn: ["merge-przykladowa-galaz"],
    tags: ["deploy"],
  }),
  task("upload-nazw-spolek", {
    title: "Wgraj nazwy spółek (companies-names.jsonl) na produkcję",
    body:
      "Po wdrożeniu indeksów: koryta_uploader --type company --prod < companies-names.jsonl\n" +
      "Zgłoszenie: https://koryta.pl/admin/opinie#fb-wizfb1",
    dependsOn: ["deploy-indeksow"],
    tags: ["data"],
    links: ["https://koryta.pl/admin/opinie#fb-wizfb1"],
    createdAt: at("27"),
    updatedAt: at("27", "10:30"),
    log: [
      {
        at: at("27", "10:30"),
        by: "owner",
        text: "Plik sprawdzony, 5 spółek.",
      },
    ],
  }),
  task("decyzja-widocznosc", {
    title: "Zdecyduj, które powiązania z umów są publiczne od razu",
    kind: "decision",
    tags: ["umowy"],
  }),
  task("wgraj-powiazania", {
    title: "Wgraj powiązania z umów po decyzji o widoczności",
    dependsOn: ["decyzja-widocznosc"],
    tags: ["umowy", "data"],
  }),
  task("umowy-na-produkcji", {
    title: "Umowy i powiązania z nich widoczne na koryta.pl",
    kind: "goal",
    dependsOn: ["wgraj-powiazania"],
    tags: ["umowy"],
  }),
  task("etykieta-rady-spolecznej", {
    title: "Nazywaj radę społeczną SPZOZ po imieniu, nie „Rada Nadzorcza”",
    kind: "task",
    who: "agent",
    tags: ["pipelines"],
  }),
  task("testy-wizualne-home", {
    title: "Zamroź zegar w teście wizualnym strony głównej",
    kind: "task",
    who: "agent",
    status: "doing",
    tags: ["frontend"],
  }),
  task("gra-szesc-krokow", {
    title: "Gra „sześć kroków” między dwiema osobami na /gry",
    kind: "idea",
    who: "agent",
    tags: ["frontend"],
  }),
  task("stare-chunki-nuxt", {
    title:
      "Serwuj stare pliki _nuxt po wdrożeniu, żeby Googlebot ich nie gubił",
    kind: "task",
    status: "parked",
    tags: ["infra"],
  }),
  task("reguly-glosow", {
    title: "Wdróż reguły Firestore zamykające dziurę w głosach",
    status: "done",
    tags: ["security"],
    closedAt: at("25"),
    updatedAt: at("25"),
  }),
];

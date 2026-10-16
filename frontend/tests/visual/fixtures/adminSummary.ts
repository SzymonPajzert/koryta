import type { AdminSummary } from "../../../server/api/admin/summary.get";

/** /api/admin/summary for /admin's visual test.
 *
 * The seed has no feedback and no flagged revision, so the live summary is
 * three green „0”s. This is a panel with work on it: no new report - the one
 * card that draws its empty state - and four-digit counts on the notes, with
 * a long name, a long company name and a note that is one bare address on the
 * list under them. The revisions are past the inspection cap, so the count
 * carries its „+”, and mix pages with relations, one of them deleted since it
 * was proposed. The people and places are made up. */

const LONG_PERSON = "Aleksandra Konstantynowicz-Szczepańska";
const LONG_COMPANY =
  "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.";

export const adminSummary: AdminSummary = {
  feedback: { needsAction: 0, sample: [] },
  notes: {
    needsAction: 1287,
    uncategorized: 2406,
    sample: [
      {
        noteId: "wiznote1",
        nodeId: "wiznos1",
        name: LONG_PERSON,
        url: null,
        note: "To imienniczka – w radzie nadzorczej wodociągów zasiada inna osoba o tym samym nazwisku, z Radomia.",
        kind: "change_request",
        adminType: null,
      },
      {
        noteId: "wiznote2",
        nodeId: "wizmi9",
        name: LONG_COMPANY,
        url: "https://rejestr.example.pl/krs/0000123456",
        note: "Brakuje składu zarządu z lat 2019–2023, jest w KRS pod numerem 0000123456.",
        kind: "missing",
        adminType: "missing_data",
      },
      {
        noteId: "wiznote3",
        nodeId: "wizmi1",
        name: "Wodociągi Przykładowo sp. z o.o.",
        url: null,
        note: "https://bip.przykladowo.example.pl/rada-nadzorcza/uchwaly/2024/uchwala-nr-XIV-112-2024-w-sprawie-powolania-czlonka-rady-nadzorczej.pdf",
        kind: "source",
        adminType: "new_connection",
      },
      {
        noteId: "wiznote4",
        nodeId: "wizno-usuniety",
        name: null,
        url: null,
        note: "Ta strona dubluje się z inną – to ta sama osoba, inaczej zapisane imię.",
        kind: "change_request",
        adminType: null,
      },
    ],
  },
  revisions: {
    unapproved: 12418,
    unapprovedManual: 16,
    inspected: 600,
    truncated: true,
    sample: [
      {
        kind: "node",
        id: "wizos1",
        name: "Barbara Przykładowa",
        type: "person",
      },
      { kind: "node", id: "wizmi9", name: LONG_COMPANY, type: "place" },
      {
        kind: "node",
        id: "wizart1",
        name: "Radny powiatu prezesem spółki komunalnej. Kulisy konkursu",
        type: "article",
      },
      {
        kind: "edge",
        id: "wizrev-e1",
        name: `${LONG_PERSON} → ${LONG_COMPANY}`,
        type: "employed",
      },
      {
        kind: "edge",
        id: "wizrev-e2",
        name: "Tomasz Przykładowy → Powiat przykładowski",
        type: "election",
      },
      // Proposed on a relation that has been deleted since: no pair to name
      // it by, and no type.
      { kind: "edge", id: "wizrev-e3", name: "wizedge-usuniete", type: "" },
    ],
  },
};

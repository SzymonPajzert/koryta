import type { MyProposals } from "../../../server/api/revisions/mine.get";
import { daysAgo } from "../clock";
import { proposal } from "./revisionHub";

/** /api/revisions/mine for /profil's visual test: what the signed-in admin
 * proposed, and what came of it.
 *
 * The seed's revisions carry other authors, and propose-confirmation.spec
 * files one of its own mid-run, so the card is answered from here. One row in
 * each state the card words differently: two waiting, one approved and live,
 * one approved on a page still waiting to be published, one approved over
 * since, a removal, and one rejected with its reason - with a long name and a
 * long company among them. The endpoint caps its scan at 300 records, so
 * there is no four-digit count to be had here. The people and places are made
 * up. */

const LONG_PERSON = "Aleksandra Konstantynowicz-Szczepańska";
const LONG_COMPANY =
  "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.";

const mine = { updateUser: "test-admin", author: null };

export const myProposals: MyProposals = {
  revisions: [
    proposal({
      ...mine,
      id: "wizmoja1",
      targetId: "wizmi9",
      targetName: LONG_COMPANY,
      targetType: "place",
      targetPath: "/instytucja/przedsiebiorstwo-gospodarki-komunalnej-wizmi9",
      changes: [
        {
          field: "content",
          label: "opis",
          from: null,
          to: "Spółka powiatu przykładowskiego: wywóz odpadów, zarząd budynków komunalnych i lokali socjalnych.",
        },
        { field: "krsNumber", label: "KRS", from: null, to: "0000123456" },
      ],
      changeCount: 2,
      updateTime: daysAgo(0),
    }),
    proposal({
      ...mine,
      id: "wizmoja2",
      targetId: "wiznos1",
      targetName: LONG_PERSON,
      targetPath: "/osoba/aleksandra-konstantynowicz-szczepanska-wiznos1",
      changes: [{ field: "parties", label: "partie", from: null, to: "PSL" }],
      changeCount: 1,
      updateTime: daysAgo(2),
    }),
    proposal({
      ...mine,
      id: "wizmoja3",
      status: "approved",
      reviewTime: daysAgo(4),
      reviewUser: "wizautor5",
      changes: [
        {
          field: "content",
          label: "opis",
          from: "Radna powiatu przykładowskiego.",
          to: "Radna powiatu przykładowskiego, od 2025 w radzie nadzorczej Wodociągów Przykładowo.",
        },
      ],
      changeCount: 1,
      updateTime: daysAgo(6),
    }),
    proposal({
      ...mine,
      id: "wizmoja4",
      status: "approved",
      targetId: "wizos2",
      targetName: "Tomasz Przykładowy",
      targetPath: "/osoba/tomasz-przykladowy-wizos2",
      published: false,
      reviewTime: daysAgo(8),
      reviewUser: "wizautor5",
      changes: [
        { field: "birthDate", label: "data urodzenia", from: null, to: "1971" },
      ],
      changeCount: 1,
      updateTime: daysAgo(9),
    }),
    proposal({
      ...mine,
      id: "wizmoja5",
      status: "superseded",
      statusDerived: true,
      targetId: "wizmi1",
      targetName: "Wodociągi Przykładowo sp. z o.o.",
      targetType: "place",
      targetPath: "/instytucja/wodociagi-przykladowo-wizmi1",
      changes: [
        {
          field: "name",
          label: "nazwa",
          from: "Wodociągi Przykładowo",
          to: "Wodociągi Przykładowo sp. z o.o.",
        },
      ],
      changeCount: 1,
      updateTime: daysAgo(15),
    }),
    proposal({
      ...mine,
      id: "wizmoja6",
      kind: "removal",
      targetId: "wizart3",
      targetName: "To samo co wyżej – kopia artykułu",
      targetType: "article",
      targetPath: null,
      targetExists: false,
      deleteReason:
        "Duplikat artykułu, który jest już podpięty pod inny adres.",
      updateTime: daysAgo(18),
    }),
    proposal({
      ...mine,
      id: "wizmoja7",
      status: "rejected",
      rejectReason:
        "Brak źródła – w KRS ta osoba nie występuje w zarządzie tej spółki.",
      reviewTime: daysAgo(20),
      reviewUser: "wizautor5",
      targetId: "wizos3",
      targetName: "Jan Przykładowy",
      targetPath: "/osoba/jan-przykladowy-wizos3",
      changes: [
        {
          field: "content",
          label: "opis",
          from: null,
          to: "Prezes Przedsiębiorstwa Komunikacji Miejskiej w Przykładowie.",
        },
      ],
      changeCount: 1,
      updateTime: daysAgo(24),
    }),
  ],
  total: 7,
  counts: { pending: 3, approved: 2, superseded: 1, rejected: 1 },
  truncated: false,
};

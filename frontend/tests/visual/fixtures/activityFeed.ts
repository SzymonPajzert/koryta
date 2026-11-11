import type {
  ActivityFeed,
  FeedActor,
  FeedBatch,
  FeedTarget,
} from "../../../shared/activityFeed";
import { NOW } from "../clock";

/** /api/activity/feed for /aktywnosc's visual test, as an established
 * administrator is sent it: every name, uid, reason and revision link.
 *
 * The seed's activity is years old, and the live window ends today, so the
 * week is answered from here and ends on ./clock.ts's frozen day. Over ten
 * lines from other people - fewer, and the page widens itself to the month -
 * one of each kind of thing the timeline draws differently: a rating of many
 * pages, which folds its pills behind „i jeszcze”, a publication with the
 * relations that went with it, a rejection and a removal with their reasons,
 * a page deleted since, a self-approval, and an administrator on trial. The
 * reader's own line is in the answer and hidden, as the page opens. The people
 * and places are made up. */

/** `days` days before NOW, at a Warsaw-summer `hour:minute` (UTC+2). */
const at = (days: number, hour: number, minute = 0) =>
  new Date(
    Date.UTC(
      NOW.getUTCFullYear(),
      NOW.getUTCMonth(),
      NOW.getUTCDate() - days,
      hour - 2,
      minute,
    ),
  ).toISOString();

const actor = (
  uid: string,
  name: string,
  fields: Partial<FeedActor> = {},
): FeedActor => ({
  key: uid,
  uid,
  name,
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
  ...fields,
});

const ALEKSANDRA = actor(
  "wizautor4",
  "Aleksandra Konstantynowicz-Szczepańska",
  { newAdmin: true },
);
const EWA = actor("wizautor1", "Ewa Sprawdzająca");
// Has not turned the public name on: an administrator sees it anyway.
const MAREK = actor("wizautor2", "Marek Zgłaszający", { named: false });
const ANNA = actor("wizautor5", "Anna Redaktorka");
const KONTAKT = actor(
  "wizautor3",
  "kontakt@stowarzyszenie-przykladowe.example.org",
);
const SELF = actor("test-admin", "Admin User", {
  isSelf: true,
  publicName: false,
});

const person = (id: string, name: string): FeedTarget => ({
  key: id,
  type: "person",
  name,
  href: `/osoba/${id}`,
});

const place = (id: string, name: string): FeedTarget => ({
  key: id,
  type: "place",
  name,
  href: `/instytucja/${id}`,
});

const LONG_COMPANY =
  "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.";

const batch = (
  id: string,
  who: FeedActor,
  fields: Omit<
    FeedBatch,
    "id" | "actorKey" | "objects" | "alongEdges" | "moreTargets"
  > &
    Partial<Pick<FeedBatch, "objects" | "alongEdges" | "moreTargets">>,
): FeedBatch => ({
  id,
  actorKey: who.key,
  objects: {},
  alongEdges: 0,
  moreTargets: 0,
  ...fields,
});

export const activityFeed: ActivityFeed = {
  window: { since: at(7, 0), until: NOW.toISOString(), days: 7 },
  identified: true,
  actors: [ALEKSANDRA, SELF, EWA, MAREK, ANNA, KONTAKT],
  batches: [
    batch("wizfeed1", ALEKSANDRA, {
      kind: "vote",
      firstAt: at(0, 9, 12),
      lastAt: at(0, 11, 40),
      count: 41,
      objects: { person: 38, fact: 3 },
      targets: [
        person("wizos1", "Barbara Przykładowa"),
        person("wiznos1", "Aleksandra Konstantynowicz-Szczepańska"),
        person("wizos2", "Tomasz Przykładowy"),
        person("wizos3", "Jan Przykładowy"),
        {
          key: "wizexk2",
          type: "fact",
          name: `Barbara Przykładowa · ${LONG_COMPANY}`,
          href: "/ekstrakcje/kategoryzacja?fact=wizexk2",
        },
        person("wizos4", "Krystyna Przykładowa-Nowak"),
        person("wizos5", "Piotr Przykładowy"),
      ],
      moreTargets: 34,
    }),
    // The reader's own sitting: in the answer, hidden on the page.
    batch("wizfeed2", SELF, {
      kind: "approve",
      firstAt: at(0, 10, 5),
      lastAt: at(0, 10, 7),
      count: 3,
      targets: [person("wizos1", "Barbara Przykładowa")],
    }),
    batch("wizfeed3", ALEKSANDRA, {
      kind: "publish",
      firstAt: at(0, 8, 30),
      lastAt: at(0, 8, 31),
      count: 2,
      objects: { person: 1, place: 1 },
      alongEdges: 36,
      targets: [
        person("wiznos1", "Aleksandra Konstantynowicz-Szczepańska"),
        place("wizmi9", LONG_COMPANY),
      ],
    }),
    batch("wizfeed4", EWA, {
      kind: "proposal",
      firstAt: at(0, 7, 50),
      lastAt: at(0, 7, 50),
      count: 2,
      targets: [
        {
          ...place("wizmi1", "Wodociągi Przykładowo sp. z o.o."),
          revisionHref: "/admin/rewizje?rewizja=wizrew9#kolejka",
        },
      ],
    }),
    batch("wizfeed5", MAREK, {
      kind: "note",
      firstAt: at(1, 21, 2),
      lastAt: at(1, 21, 15),
      count: 2,
      targets: [
        person("wizos2", "Tomasz Przykładowy"),
        place("wizmi6", "Szpital Powiatowy w Przykładowie sp. z o.o."),
      ],
    }),
    batch("wizfeed6", ANNA, {
      kind: "reject",
      firstAt: at(1, 14, 20),
      lastAt: at(1, 14, 20),
      count: 1,
      targets: [
        {
          ...person("wizos3", "Jan Przykładowy"),
          revisionHref: "/admin/rewizje?rewizja=wizrew8#kolejka",
          reason:
            "Brak źródła - w KRS ta osoba nie występuje w zarządzie tej spółki.",
        },
      ],
    }),
    batch("wizfeed7", ALEKSANDRA, {
      kind: "approve",
      firstAt: at(1, 12, 0),
      lastAt: at(1, 12, 45),
      count: 5,
      targets: [
        {
          ...person("wiznos1", "Aleksandra Konstantynowicz-Szczepańska"),
          revisionHref: "/admin/rewizje?rewizja=wizrew7#kolejka",
          selfApproved: true,
        },
        {
          ...place("wizmi9", LONG_COMPANY),
          revisionHref: "/admin/rewizje?rewizja=wizrew6#kolejka",
        },
      ],
      moreTargets: 3,
    }),
    batch("wizfeed8", KONTAKT, {
      kind: "vote",
      firstAt: at(2, 18, 10),
      lastAt: at(2, 18, 12),
      count: 1,
      objects: { person: 1 },
      targets: [person("wizos5", "Piotr Przykładowy")],
    }),
    batch("wizfeed9", ANNA, {
      kind: "delete",
      firstAt: at(3, 11, 5),
      lastAt: at(3, 11, 5),
      count: 1,
      objects: { article: 1 },
      targets: [
        {
          key: "wizart3",
          type: "article",
          name: "https://www.gazeta-przykladowa.example.pl/region/2023/12/to-samo-co-wyzej-kopia-artykulu,99999.html",
          href: null,
          deleted: true,
          reason: "Duplikat artykułu z innym adresem.",
        },
      ],
    }),
    batch("wizfeed10", EWA, {
      kind: "merge",
      firstAt: at(4, 16, 30),
      lastAt: at(4, 16, 30),
      count: 1,
      targets: [
        {
          ...person("wizos4", "Krystyna Przykładowa-Nowak"),
          reason: "Ta sama osoba, nazwisko po ślubie.",
        },
      ],
    }),
    batch("wizfeed11", MAREK, {
      kind: "splitMark",
      firstAt: at(5, 9, 0),
      lastAt: at(5, 9, 0),
      count: 1,
      objects: { person: 1 },
      targets: [
        {
          ...person("wizos6", "Jan Kowalczyk-Przykładowy"),
          reason: "Dwóch radnych o tym samym nazwisku, z różnych gmin.",
        },
      ],
    }),
    batch("wizfeed12", ANNA, {
      kind: "unpublish",
      firstAt: at(6, 13, 40),
      lastAt: at(6, 13, 41),
      count: 1,
      objects: { place: 1 },
      alongEdges: 4,
      targets: [
        place(
          "wizmi4",
          "Przedsiębiorstwo Komunikacji Miejskiej w Przykładowie sp. z o.o.",
        ),
      ],
    }),
    batch("wizfeed13", ALEKSANDRA, {
      kind: "edit",
      firstAt: at(6, 10, 0),
      lastAt: at(6, 10, 25),
      count: 2,
      objects: { edge: 2 },
      targets: [
        {
          key: "wizedge1",
          type: "edge",
          name: `Aleksandra Konstantynowicz-Szczepańska → ${LONG_COMPANY}`,
          href: "/osoba/wiznos1",
        },
        {
          key: "wizedge2",
          type: "edge",
          name: "Tomasz Przykładowy → Wodociągi Przykładowo sp. z o.o.",
          href: "/osoba/wizos2",
        },
      ],
    }),
  ],
  newAdmins: [ALEKSANDRA],
  truncated: [],
};

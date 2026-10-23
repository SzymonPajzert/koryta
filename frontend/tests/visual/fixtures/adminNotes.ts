import type { GraphLayout } from "../../../shared/graph/util";
import type { NodeStats } from "../../../shared/graph/model";
import { NODE_COLORS } from "../../../shared/graph/nodes";
import type { NoteRow, Person } from "../../../shared/model";
import type { LookedUpUser } from "../../../app/composables/users";
import { daysAgo } from "../clock";

/** What /admin/notatki and its phone queue, /admin/notatki/kategoryzacja, are
 * drawn from, for their visual tests.
 *
 * The seed has three notes, all on Jan Kowalski, which is neither a page of a
 * table nor a backlog. These are: the table's first page of ten out of over a
 * thousand, and the queue's first three of over two thousand, with the record
 * of the person the first card is about. Something in every column the table
 * has - each kind, each verdict, the deferred state, a source that is an
 * address, one that is not, one with no text at all, and a note whose page has
 * no name, only its id - and a long name, a long company name and a long
 * address where they have to give way. The people and places are made up. */

const LONG_PERSON = "Aleksandra Konstantynowicz-Szczepańska";
const LONG_COMPANY =
  "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.";

/** What /api/users/lookup answers for the notes' authors. One has never set a
 * name, so the chip falls back to the address. */
export const noteAuthors: Record<string, LookedUpUser> = {
  wizautor1: {
    displayName: "Ewa Sprawdzająca",
    email: null,
    photoURL: null,
  },
  wizautor2: {
    displayName: "Marek Zgłaszający",
    email: null,
    photoURL: null,
  },
  wizautor3: {
    displayName: null,
    email: "kontakt@stowarzyszenie-przykladowe.example.org",
    photoURL: null,
  },
};

const row = (
  fields: Partial<NoteRow> & Pick<NoteRow, "noteId" | "nodeId">,
): NoteRow => ({
  key: `${fields.noteId}-${fields.sourceIndex ?? 0}`,
  sourceIndex: 0,
  nodeName: null,
  nodeType: null,
  userUid: "wizautor1",
  createdAt: daysAgo(0),
  updatedAt: null,
  note: "",
  url: null,
  kind: "source",
  articleNodeId: null,
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...fields,
});

/** /api/notes/admin for the table, newest first: the first page of ten. */
export const noteRows: NoteRow[] = [
  row({
    noteId: "wiznote1",
    nodeId: "wiznos1",
    nodeName: LONG_PERSON,
    nodeType: "person",
    userUid: "wizautor2",
    createdAt: daysAgo(0, 7),
    kind: "change_request",
    note: "To imienniczka - w radzie nadzorczej wodociągów zasiada inna osoba o tym samym nazwisku, z Radomia. Ta ma inną datę urodzenia w oświadczeniu majątkowym i nigdy nie pracowała w spółkach powiatu.",
  }),
  row({
    noteId: "wiznote2",
    nodeId: "wizmi9",
    nodeName: LONG_COMPANY,
    nodeType: "place",
    userUid: "wizautor3",
    createdAt: daysAgo(0, 6),
    kind: "missing",
    note: "Brakuje składu zarządu z lat 2019-2023, jest w KRS pod numerem 0000123456.",
    url: "https://rejestr.example.pl/krs/0000123456",
    adminStatus: "unresolved",
    adminType: "missing_data",
  }),
  row({
    noteId: "wiznote3",
    nodeId: "wizos1",
    nodeName: "Barbara Przykładowa",
    nodeType: "person",
    createdAt: daysAgo(1, 15),
    note: "Uchwała rady powiatu o powołaniu do rady nadzorczej, strona 4.",
    url: "https://bip.powiat-przykladowski.example.pl/rada-powiatu/uchwaly/2024/uchwala-nr-XIV-112-2024-w-sprawie-powolania-czlonka-rady-nadzorczej.pdf",
    adminStatus: "resolved",
    adminType: "new_connection",
  }),
  row({
    noteId: "wiznote4",
    nodeId: "wizart1",
    nodeName: "Radny powiatu prezesem spółki komunalnej. Kulisy konkursu",
    nodeType: "article",
    userUid: "wizautor2",
    createdAt: daysAgo(1, 9),
    // Not an address: printed as text, not bound as a link.
    url: "gazeta lokalna, wydanie papierowe z 12 marca, strona 3",
    adminTypeDeferred: true,
  }),
  row({
    // A page nobody has approved yet: no name to show, only its id.
    noteId: "wiznote5",
    nodeId: "wizno-szkic",
    createdAt: daysAgo(2),
    kind: "change_request",
    note: "Ta strona dubluje się z inną - to ta sama osoba, inaczej zapisane imię.",
    adminStatus: "unresolved",
  }),
  row({
    // A source saved with neither text nor an address.
    noteId: "wiznote6",
    nodeId: "wizmi1",
    nodeName: "Wodociągi Przykładowo sp. z o.o.",
    nodeType: "place",
    userUid: "wizautor3",
    createdAt: daysAgo(3),
    adminType: "other",
  }),
  row({
    noteId: "wiznote7",
    nodeId: "wizos2",
    nodeName: "Tomasz Przykładowy",
    nodeType: "person",
    createdAt: daysAgo(4),
    kind: "missing",
    note: "Brakuje kandydatury do rady gminy w 2018 roku.",
    url: "https://wybory.example.pl/2018/kandydaci/tomasz-przykladowy",
    adminStatus: "resolved",
    adminType: "context",
  }),
  row({
    noteId: "wiznote8",
    nodeId: "wizre1",
    nodeName: "Powiat przykładowski",
    nodeType: "region",
    userUid: "wizautor2",
    createdAt: daysAgo(6),
    note: "Lista spółek powiatu w sprawozdaniu za 2023 rok.",
    url: "https://bip.powiat-przykladowski.example.pl/sprawozdania/2023.pdf",
  }),
  row({
    // A bare host, which the link gets its scheme for.
    noteId: "wiznote9",
    nodeId: "wizos3",
    nodeName: "Jan Przykładowy",
    nodeType: "person",
    createdAt: daysAgo(8),
    kind: "change_request",
    note: "Data urodzenia jest błędna - w oświadczeniu majątkowym podano rok 1971.",
    url: "bip.gmina-przykladowo.example.pl/oswiadczenia/2023/jan-przykladowy.pdf",
    adminType: "missing_data",
  }),
  row({
    noteId: "wiznote10",
    nodeId: "wizmi6",
    nodeName: "Szpital Powiatowy w Przykładowie sp. z o.o.",
    nodeType: "place",
    userUid: "wizautor3",
    createdAt: daysAgo(11),
    note: "Skład rady społecznej ze strony szpitala.",
    url: "https://szpital-przykladowo.example.pl/o-nas/rada-spoleczna",
  }),
];

/** How many notes the table pages through. */
export const noteTotal = 1287;

/** /api/notes/admin for the phone queue: untyped and not handed back to the
 * table, newest first. The first card is about a person, so the record under
 * the choices is drawn; its address is long enough to be cut off. */
export const triageQueue: NoteRow[] = [
  row({
    noteId: "wiznote11",
    nodeId: "wiznos1",
    nodeName: LONG_PERSON,
    nodeType: "person",
    userUid: "wizautor3",
    createdAt: daysAgo(0, 8),
    note: "Oświadczenie majątkowe za 2023 rok: członkini rady nadzorczej przedsiębiorstwa komunalnego od 2021 roku, wcześniej prezeska wodociągów.",
    url: "https://bip.powiat-przykladowski.example.pl/oswiadczenia-majatkowe/2023/rada-nadzorcza/konstantynowicz-szczepanska-aleksandra.pdf",
  }),
  row({
    noteId: "wiznote12",
    nodeId: "wizmi9",
    nodeName: LONG_COMPANY,
    nodeType: "place",
    createdAt: daysAgo(1),
    kind: "missing",
    note: "Nie ma tu nowego prezesa, powołanego w lipcu.",
  }),
  row({
    noteId: "wiznote13",
    nodeId: "wizart1",
    nodeName: "Radny powiatu prezesem spółki komunalnej. Kulisy konkursu",
    nodeType: "article",
    userUid: "wizautor2",
    createdAt: daysAgo(2),
    url: "https://www.gazeta-przykladowa.example.pl/region/2024/03/radny-powiatu-prezesem-spolki-komunalnej-kulisy-konkursu,123456.html",
  }),
];

/** How many notes wait in the queue. */
export const triageTotal = 2406;

/** The person the first card is about, as /api/nodes/[id] sends them. */
export const triagePerson: Person & { id: string } = {
  id: "wiznos1",
  name: LONG_PERSON,
  type: "person",
  parties: ["PSL"],
  birthDate: "1968-03-21",
  education: "magister ekonomii",
  published: true,
};

const stats: NodeStats = { people: 1 };

/** /api/graph/local/[id] for the same person: two seats on boards, the long
 * company's among them, and a run for the county council. */
export const triagePersonGraph: GraphLayout = {
  nodes: {
    wiznos1: {
      id: "wiznos1",
      name: LONG_PERSON,
      entityType: "person",
      type: "circle",
      color: NODE_COLORS.person,
      visibility: true,
      stats,
    },
    wizmi9: {
      id: "wizmi9",
      name: LONG_COMPANY,
      entityType: "place",
      type: "rect",
      color: NODE_COLORS.place,
      visibility: true,
      stats,
    },
    wizmi1: {
      id: "wizmi1",
      name: "Wodociągi Przykładowo sp. z o.o.",
      entityType: "place",
      type: "rect",
      color: NODE_COLORS.place,
      visibility: true,
      stats,
    },
    wizre1: {
      id: "wizre1",
      name: "Powiat przykładowski",
      entityType: "region",
      type: "document",
      color: NODE_COLORS.region,
      visibility: true,
      stats,
    },
  },
  edges: [
    {
      id: "wiznos1-rn",
      source: "wiznos1",
      target: "wizmi9",
      type: "employed",
      name: "Rada Nadzorcza",
      start_date: "2021-03-15",
      visibility: true,
    },
    {
      id: "wiznos1-prezes",
      source: "wiznos1",
      target: "wizmi1",
      type: "employed",
      name: "Prezes Zarządu",
      start_date: "2015-01-01",
      end_date: "2019-12-31",
      visibility: true,
    },
    {
      id: "wiznos1-kandydatura",
      source: "wiznos1",
      target: "wizre1",
      type: "election",
      name: "kandydatura",
      position: "Samorząd",
      start_date: "2024-04-07",
      end_date: "2024-04-07",
      visibility: true,
    },
  ],
  nodeGroups: [],
};

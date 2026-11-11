import type { ExtractionFact } from "../../../shared/model";
import { daysAgo } from "../clock";

/** What /ekstrakcje and its swipe queue, /ekstrakcje/kategoryzacja, are drawn
 * from, for their visual tests.
 *
 * The seed's few facts make neither a backlog nor a list of articles, and
 * which of them are still unreviewed depends on what the other specs in the
 * run have voted on. So /api/extractions is answered from here: six articles
 * out of nearly five thousand facts for the list - a long path, a domain long
 * enough to reach the rail's cap, a url stored without its scheme and with no
 * domain recorded, one fact and twenty-two - and for the queue a card with a
 * long name and a long company, two more facts from the same article under it
 * and one from another. The ids are prefixed so no stored vote can match one.
 * The people, places and articles are made up. */

const LONG_PERSON = "Aleksandra Konstantynowicz-Szczepańska";
const LONG_COMPANY =
  "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej w Przykładowie Wielkopolskim sp. z o.o.";

const GAZETA =
  "https://www.gazeta-przykladowa.example.pl/region/2024/03/radny-powiatu-prezesem-spolki-komunalnej-kulisy-konkursu,123456.html";
const PORTAL =
  "https://przykladowo24.example.pl/wiadomosci/nowa-rada-nadzorcza-wodociagow";
const BIP =
  "https://bip.przedsiebiorstwo-gospodarki-komunalnej-przykladowo.example.pl/aktualnosci/2023/zmiany-w-skladzie-zarzadu-spolki-po-zgromadzeniu-wspolnikow";
const TYGODNIK =
  "tygodnik.example.pl/polityka/2024/kto-zasiada-w-radach-szpitali";
const RADIO =
  "https://www.radio-przykladowe.example.pl/2023/11/14/prezes-spolki-odwolany?utm_source=rss";
const REGION =
  "https://portal-regionalny.example.pl/wiadomosci/samorzad/2024/09/powiatowe-spolki-po-wyborach-kto-zostal-kto-odszedl-i-kto-przyszedl-na-ich-miejsce-pelna-lista-nazwisk";

const fact = (
  id: string,
  articleUrl: string,
  fields: Partial<ExtractionFact> = {},
): ExtractionFact => ({
  id,
  url: articleUrl,
  articleUrl,
  articleDomain: new URL(
    articleUrl.includes("://") ? articleUrl : `https://${articleUrl}`,
  ).hostname.replace(/^www\./, ""),
  fact_type: "employment",
  person: "Tomasz Przykładowy",
  organization: "Wodociągi Przykładowo sp. z o.o.",
  role: "członek zarządu",
  justification:
    "Tomasz Przykładowy od lipca zasiada w zarządzie wodociągów, do których trafił po kampanii wyborczej.",
  tag: "v1_przyklad",
  createdAt: daysAgo(1),
  reviewed: false,
  ...fields,
});

const many = (prefix: string, articleUrl: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    fact(`${prefix}${index + 1}`, articleUrl),
  );

/** How many facts there are behind the newest hundred. */
export const extractionTotal = 4812;

/** /api/extractions?groupBy=article, newest article first. */
export const extractionArticles: Record<
  string,
  { domain: string; facts: ExtractionFact[] }
> = {
  [GAZETA]: {
    domain: "gazeta-przykladowa.example.pl",
    facts: many("wizexg", GAZETA, 3),
  },
  [PORTAL]: {
    domain: "przykladowo24.example.pl",
    facts: many("wizexp", PORTAL, 1),
  },
  [BIP]: {
    domain: "bip.przedsiebiorstwo-gospodarki-komunalnej-przykladowo.example.pl",
    facts: many("wizexb", BIP, 5),
  },
  // Stored without its scheme, and with no domain recorded: the row names it
  // by the url's own host.
  [TYGODNIK]: { domain: "", facts: many("wizext", TYGODNIK, 22) },
  [RADIO]: {
    domain: "radio-przykladowe.example.pl",
    facts: many("wizexr", RADIO, 2),
  },
  [REGION]: {
    domain: "portal-regionalny.example.pl",
    facts: many("wizexs", REGION, 12),
  },
};

/** How many facts nobody has reviewed yet. */
export const unreviewedTotal = 3127;

/** /api/extractions?reviewed=no, newest first: the card, and what is listed
 * under it as from the same article. */
export const unreviewedFacts: ExtractionFact[] = [
  fact("wizexk1", GAZETA, {
    person: LONG_PERSON,
    personNodeId: "wiznos1",
    personNodeName: LONG_PERSON,
    organization: LONG_COMPANY,
    role: "członkini rady nadzorczej",
    justification:
      "Aleksandra Konstantynowicz-Szczepańska, radna powiatu z ramienia PSL, od marca 2021 roku zasiada w radzie nadzorczej przedsiębiorstwa komunalnego, choć - jak przyznaje starostwo - konkursu na to stanowisko nie ogłoszono.",
    createdAt: daysAgo(0, 7),
  }),
  fact("wizexk2", GAZETA, {
    person: "Barbara Przykładowa",
    organization: LONG_COMPANY,
    role: "prezes zarządu",
    justification:
      "Prezesem spółki została w lutym Barbara Przykładowa, wcześniej sekretarz powiatu.",
    createdAt: daysAgo(0, 7),
  }),
  fact("wizexk3", GAZETA, {
    fact_type: "party_membership",
    person: "Barbara Przykładowa",
    organization: undefined,
    role: undefined,
    party: "PSL",
    justification:
      "Przykładowa jest członkinią PSL od 2010 roku i startowała z jego listy do rady powiatu.",
    createdAt: daysAgo(0, 7),
  }),
  fact("wizexk4", RADIO, {
    person: "Jan Przykładowy",
    organization:
      "Przedsiębiorstwo Komunikacji Miejskiej w Przykładowie sp. z o.o.",
    role: "prezes zarządu",
    justification:
      "Rada nadzorcza odwołała we wtorek prezesa spółki, Jana Przykładowego.",
    createdAt: daysAgo(1),
  }),
];

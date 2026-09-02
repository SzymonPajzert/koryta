import type { EducationTerm } from "./education";

/** Everything "Po jakich studiach?" knows how to be answered with.
 *
 * Two jobs at once, which is why it is one list rather than two. It is the
 * autocomplete the player types into, and it is the ordering their guess is
 * ranked against - so a term that is missing is both un-guessable and invisible
 * to every other guess's rank. Adding one is cheap and safe; removing one moves
 * every rank around it.
 *
 * SIZE IS THE THING TO WATCH. A rank only reads as progress if the list is
 * long enough for #340 to mean something - Contexto's does, at ~100k words.
 * This one is a starting point, not a finished corpus: it covers the fields and
 * levels Polish public CVs actually run through, and it should keep growing
 * towards a few thousand. Until it does, the ranks are coarser than the feel
 * the game is aiming at, which is a reason to add rows rather than to reweight
 * the similarity.
 *
 * `path` is general to specific and is the whole of the field distance between
 * two terms - see `educationSimilarity`. Keep the first segment drawn from the
 * set already in use here; a one-off top-level branch makes its own terms
 * distant from everything, which reads to a player as the game being broken.
 */
export const educationVocabulary: EducationTerm[] = [
  // ---- prawnicze ----
  {
    term: "magister prawa",
    level: "magister",
    path: ["prawnicze", "prawo"],
    aliases: ["prawo", "prawnik", "mgr prawa", "studia prawnicze"],
  },
  { term: "radca prawny", level: "magister", path: ["prawnicze", "prawo"] },
  { term: "adwokat", level: "magister", path: ["prawnicze", "prawo"] },
  { term: "sędzia", level: "magister", path: ["prawnicze", "prawo"] },
  { term: "prokurator", level: "magister", path: ["prawnicze", "prawo"] },
  { term: "notariusz", level: "magister", path: ["prawnicze", "prawo"] },
  {
    term: "doktor nauk prawnych",
    level: "doktor",
    path: ["prawnicze", "prawo"],
  },
  {
    term: "magister administracji",
    level: "magister",
    path: ["prawnicze", "administracja"],
    aliases: ["administracja"],
  },
  {
    term: "licencjat administracji",
    level: "licencjat",
    path: ["prawnicze", "administracja"],
  },
  {
    term: "administracja publiczna",
    level: "magister",
    path: ["prawnicze", "administracja"],
  },
  {
    term: "bezpieczeństwo wewnętrzne",
    level: "magister",
    path: ["prawnicze", "administracja"],
  },

  // ---- ekonomiczne ----
  {
    term: "magister ekonomii",
    level: "magister",
    path: ["ekonomiczne", "ekonomia"],
    aliases: ["ekonomia", "ekonomista", "mgr ekonomii"],
  },
  {
    term: "licencjat ekonomii",
    level: "licencjat",
    path: ["ekonomiczne", "ekonomia"],
  },
  {
    term: "doktor nauk ekonomicznych",
    level: "doktor",
    path: ["ekonomiczne", "ekonomia"],
  },
  {
    term: "magister finansów",
    level: "magister",
    path: ["ekonomiczne", "finanse"],
    aliases: ["finanse", "finanse i bankowość"],
  },
  { term: "bankowość", level: "magister", path: ["ekonomiczne", "finanse"] },
  {
    term: "magister rachunkowości",
    level: "magister",
    path: ["ekonomiczne", "rachunkowość"],
    aliases: ["rachunkowość", "księgowość"],
  },
  {
    term: "biegły rewident",
    level: "magister",
    path: ["ekonomiczne", "rachunkowość"],
  },
  {
    term: "technik ekonomista",
    level: "średnie",
    path: ["ekonomiczne", "ekonomia"],
  },
  {
    term: "magister zarządzania",
    level: "magister",
    path: ["ekonomiczne", "zarządzanie"],
    aliases: ["zarządzanie", "zarządzanie i marketing"],
  },
  {
    term: "MBA",
    level: "magister",
    path: ["ekonomiczne", "zarządzanie"],
    aliases: ["master of business administration"],
  },
  {
    term: "magister marketingu",
    level: "magister",
    path: ["ekonomiczne", "marketing"],
    aliases: ["marketing"],
  },
  {
    term: "logistyka",
    level: "magister",
    path: ["ekonomiczne", "zarządzanie"],
  },
  {
    term: "handel zagraniczny",
    level: "magister",
    path: ["ekonomiczne", "ekonomia"],
  },
  {
    term: "technik handlowiec",
    level: "średnie",
    path: ["ekonomiczne", "ekonomia"],
  },

  // ---- techniczne ----
  {
    term: "magister inżynier budownictwa",
    level: "magister",
    path: ["techniczne", "budownictwo"],
    aliases: ["budownictwo", "inżynier budownictwa"],
  },
  {
    term: "inżynier budownictwa",
    level: "licencjat",
    path: ["techniczne", "budownictwo"],
  },
  {
    term: "technik budowlany",
    level: "średnie",
    path: ["techniczne", "budownictwo"],
  },
  {
    term: "magister inżynier mechanik",
    level: "magister",
    path: ["techniczne", "mechanika"],
    aliases: ["mechanika", "budowa maszyn"],
  },
  {
    term: "technik mechanik",
    level: "średnie",
    path: ["techniczne", "mechanika"],
  },
  {
    term: "magister inżynier elektryk",
    level: "magister",
    path: ["techniczne", "elektrotechnika"],
    aliases: ["elektrotechnika"],
  },
  {
    term: "technik elektryk",
    level: "średnie",
    path: ["techniczne", "elektrotechnika"],
  },
  {
    term: "magister inżynier informatyki",
    level: "magister",
    path: ["techniczne", "informatyka"],
    aliases: ["informatyka", "informatyk"],
  },
  {
    term: "technik informatyk",
    level: "średnie",
    path: ["techniczne", "informatyka"],
  },
  {
    term: "magister inżynier energetyki",
    level: "magister",
    path: ["techniczne", "energetyka"],
    aliases: ["energetyka"],
  },
  {
    term: "magister inżynier górnictwa",
    level: "magister",
    path: ["techniczne", "górnictwo"],
    aliases: ["górnictwo", "górnictwo i geologia"],
  },
  {
    term: "technik górnik",
    level: "średnie",
    path: ["techniczne", "górnictwo"],
  },
  {
    term: "magister inżynier transportu",
    level: "magister",
    path: ["techniczne", "transport"],
    aliases: ["transport"],
  },
  {
    term: "technik kolejowy",
    level: "średnie",
    path: ["techniczne", "transport"],
  },
  {
    term: "magister inżynier ochrony środowiska",
    level: "magister",
    path: ["techniczne", "środowisko"],
    aliases: ["ochrona środowiska", "inżynieria środowiska"],
  },
  {
    term: "magister inżynier technologii chemicznej",
    level: "magister",
    path: ["techniczne", "chemia przemysłowa"],
  },
  {
    term: "geodezja i kartografia",
    level: "magister",
    path: ["techniczne", "geodezja"],
    aliases: ["geodezja", "geodeta"],
  },
  {
    term: "technik geodeta",
    level: "średnie",
    path: ["techniczne", "geodezja"],
  },
  { term: "doktor nauk technicznych", level: "doktor", path: ["techniczne"] },

  // ---- rolnicze ----
  {
    term: "magister inżynier rolnictwa",
    level: "magister",
    path: ["rolnicze", "rolnictwo"],
    aliases: ["rolnictwo", "inżynier rolnictwa"],
  },
  {
    term: "dyplomowany rolnik",
    level: "zasadnicze zawodowe",
    path: ["rolnicze", "rolnictwo"],
    aliases: ["rolnik"],
  },
  { term: "technik rolnik", level: "średnie", path: ["rolnicze", "rolnictwo"] },
  {
    term: "lekarz weterynarii",
    level: "magister",
    path: ["rolnicze", "weterynaria"],
    aliases: ["weterynaria", "weterynarz"],
  },
  {
    term: "magister inżynier leśnictwa",
    level: "magister",
    path: ["rolnicze", "leśnictwo"],
    aliases: ["leśnictwo", "leśnik"],
  },
  {
    term: "technik ogrodnik",
    level: "średnie",
    path: ["rolnicze", "ogrodnictwo"],
    aliases: ["ogrodnictwo"],
  },
  { term: "zootechnika", level: "magister", path: ["rolnicze", "rolnictwo"] },
  {
    term: "technologia żywności",
    level: "magister",
    path: ["rolnicze", "żywność"],
  },

  // ---- medyczne ----
  {
    term: "lekarz medycyny",
    level: "magister",
    path: ["medyczne", "medycyna"],
    aliases: ["medycyna", "lekarz"],
  },
  {
    term: "doktor nauk medycznych",
    level: "doktor",
    path: ["medyczne", "medycyna"],
  },
  {
    term: "lekarz dentysta",
    level: "magister",
    path: ["medyczne", "stomatologia"],
    aliases: ["stomatologia", "dentysta"],
  },
  {
    term: "magister farmacji",
    level: "magister",
    path: ["medyczne", "farmacja"],
    aliases: ["farmacja", "farmaceuta"],
  },
  {
    term: "magister pielęgniarstwa",
    level: "magister",
    path: ["medyczne", "pielęgniarstwo"],
    aliases: ["pielęgniarstwo", "pielęgniarka"],
  },
  {
    term: "licencjat pielęgniarstwa",
    level: "licencjat",
    path: ["medyczne", "pielęgniarstwo"],
  },
  {
    term: "ratownictwo medyczne",
    level: "licencjat",
    path: ["medyczne", "ratownictwo"],
  },
  {
    term: "zdrowie publiczne",
    level: "magister",
    path: ["medyczne", "zdrowie publiczne"],
  },
  {
    term: "fizjoterapia",
    level: "magister",
    path: ["medyczne", "fizjoterapia"],
    aliases: ["fizjoterapeuta"],
  },
  {
    term: "położnictwo",
    level: "licencjat",
    path: ["medyczne", "pielęgniarstwo"],
  },

  // ---- społeczne ----
  {
    term: "magister politologii",
    level: "magister",
    path: ["społeczne", "politologia"],
    aliases: ["politologia", "nauki polityczne", "politolog"],
  },
  {
    term: "doktor nauk politycznych",
    level: "doktor",
    path: ["społeczne", "politologia"],
  },
  {
    term: "stosunki międzynarodowe",
    level: "magister",
    path: ["społeczne", "politologia"],
  },
  {
    term: "magister socjologii",
    level: "magister",
    path: ["społeczne", "socjologia"],
    aliases: ["socjologia", "socjolog"],
  },
  {
    term: "magister psychologii",
    level: "magister",
    path: ["społeczne", "psychologia"],
    aliases: ["psychologia", "psycholog"],
  },
  {
    term: "magister pedagogiki",
    level: "magister",
    path: ["społeczne", "pedagogika"],
    aliases: ["pedagogika", "pedagog"],
  },
  {
    term: "nauczyciel",
    level: "magister",
    path: ["społeczne", "pedagogika"],
    aliases: ["nauczycielstwo"],
  },
  {
    term: "licencjat pedagogiki",
    level: "licencjat",
    path: ["społeczne", "pedagogika"],
  },
  {
    term: "magister dziennikarstwa",
    level: "magister",
    path: ["społeczne", "dziennikarstwo"],
    aliases: ["dziennikarstwo", "dziennikarz"],
  },
  {
    term: "praca socjalna",
    level: "licencjat",
    path: ["społeczne", "praca socjalna"],
  },
  {
    term: "europeistyka",
    level: "magister",
    path: ["społeczne", "politologia"],
  },
  {
    term: "bezpieczeństwo narodowe",
    level: "magister",
    path: ["społeczne", "politologia"],
  },

  // ---- humanistyczne ----
  {
    term: "magister historii",
    level: "magister",
    path: ["humanistyczne", "historia"],
    aliases: ["historia", "historyk"],
  },
  {
    term: "doktor nauk humanistycznych",
    level: "doktor",
    path: ["humanistyczne"],
  },
  {
    term: "magister filologii polskiej",
    level: "magister",
    path: ["humanistyczne", "filologia"],
    aliases: ["polonistyka", "filologia polska"],
  },
  {
    term: "filologia angielska",
    level: "magister",
    path: ["humanistyczne", "filologia"],
    aliases: ["anglistyka"],
  },
  {
    term: "filologia germańska",
    level: "magister",
    path: ["humanistyczne", "filologia"],
    aliases: ["germanistyka"],
  },
  {
    term: "filologia rosyjska",
    level: "magister",
    path: ["humanistyczne", "filologia"],
    aliases: ["rusycystyka"],
  },
  {
    term: "magister filozofii",
    level: "magister",
    path: ["humanistyczne", "filozofia"],
    aliases: ["filozofia"],
  },
  {
    term: "kulturoznawstwo",
    level: "magister",
    path: ["humanistyczne", "kultura"],
  },
  {
    term: "archeologia",
    level: "magister",
    path: ["humanistyczne", "historia"],
  },
  {
    term: "historia sztuki",
    level: "magister",
    path: ["humanistyczne", "kultura"],
  },
  {
    term: "bibliotekoznawstwo",
    level: "magister",
    path: ["humanistyczne", "kultura"],
  },

  // ---- ścisłe ----
  {
    term: "magister matematyki",
    level: "magister",
    path: ["ścisłe", "matematyka"],
    aliases: ["matematyka", "matematyk"],
  },
  {
    term: "magister fizyki",
    level: "magister",
    path: ["ścisłe", "fizyka"],
    aliases: ["fizyka"],
  },
  {
    term: "magister chemii",
    level: "magister",
    path: ["ścisłe", "chemia"],
    aliases: ["chemia"],
  },
  {
    term: "magister biologii",
    level: "magister",
    path: ["ścisłe", "biologia"],
    aliases: ["biologia", "biolog"],
  },
  {
    term: "magister geografii",
    level: "magister",
    path: ["ścisłe", "geografia"],
    aliases: ["geografia", "geograf"],
  },
  {
    term: "geologia",
    level: "magister",
    path: ["ścisłe", "geologia"],
    aliases: ["geolog"],
  },
  { term: "doktor nauk ścisłych", level: "doktor", path: ["ścisłe"] },

  // ---- teologiczne i formacje ----
  {
    term: "magister teologii",
    level: "magister",
    path: ["teologiczne", "teologia"],
    aliases: ["teologia", "teolog"],
  },
  {
    term: "ksiądz katolicki",
    level: "formacja",
    path: ["teologiczne", "duchowieństwo"],
    aliases: ["ksiądz", "kapłan", "duchowny katolicki"],
  },
  {
    term: "duchowny prawosławny",
    level: "formacja",
    path: ["teologiczne", "duchowieństwo"],
    aliases: ["prawosławny duchowny", "batiuszka"],
  },
  {
    term: "pastor protestancki",
    level: "formacja",
    path: ["teologiczne", "duchowieństwo"],
    aliases: ["pastor"],
  },
  {
    term: "zakonnik",
    level: "formacja",
    path: ["teologiczne", "duchowieństwo"],
  },
  {
    term: "seminarium duchowne",
    level: "formacja",
    path: ["teologiczne", "duchowieństwo"],
  },

  // ---- mundurowe ----
  {
    term: "oficer Wojska Polskiego",
    level: "formacja",
    path: ["mundurowe", "wojsko"],
    aliases: ["wojsko", "oficer", "akademia wojskowa"],
  },
  {
    term: "podoficer zawodowy",
    level: "formacja",
    path: ["mundurowe", "wojsko"],
  },
  {
    term: "oficer Policji",
    level: "formacja",
    path: ["mundurowe", "policja"],
    aliases: ["policja", "szkoła policji"],
  },
  {
    term: "oficer Państwowej Straży Pożarnej",
    level: "formacja",
    path: ["mundurowe", "straż"],
    aliases: ["straż pożarna", "strażak"],
  },
  {
    term: "Wyższa Szkoła Oficerska",
    level: "formacja",
    path: ["mundurowe", "wojsko"],
  },

  // ---- artystyczne ----
  {
    term: "magister sztuki",
    level: "magister",
    path: ["artystyczne"],
    aliases: ["sztuka", "akademia sztuk pięknych", "asp"],
  },
  {
    term: "architektura",
    level: "magister",
    path: ["artystyczne", "architektura"],
    aliases: ["architekt"],
  },
  {
    term: "muzyka",
    level: "magister",
    path: ["artystyczne", "muzyka"],
    aliases: ["akademia muzyczna", "muzyk"],
  },
  {
    term: "aktorstwo",
    level: "magister",
    path: ["artystyczne", "teatr"],
    aliases: ["aktor", "szkoła teatralna"],
  },
  {
    term: "grafika",
    level: "magister",
    path: ["artystyczne"],
    aliases: ["grafik"],
  },

  // ---- sport ----
  {
    term: "wychowanie fizyczne",
    level: "magister",
    path: ["sportowe"],
    aliases: ["awf", "akademia wychowania fizycznego", "trener"],
  },
  { term: "turystyka i rekreacja", level: "licencjat", path: ["sportowe"] },

  // ---- rzemieślnicze ----
  {
    term: "stolarz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "drzewne"],
    aliases: ["stolarstwo"],
  },
  {
    term: "cieśla",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "drzewne"],
  },
  {
    term: "murarz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "budowlane"],
    aliases: ["murarstwo"],
  },
  {
    term: "hydraulik",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "budowlane"],
  },
  {
    term: "elektryk",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "elektryczne"],
  },
  {
    term: "mechanik samochodowy",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "mechaniczne"],
  },
  {
    term: "ślusarz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "mechaniczne"],
    aliases: ["ślusarstwo"],
  },
  {
    term: "spawacz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "mechaniczne"],
  },
  {
    term: "piekarz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "spożywcze"],
  },
  {
    term: "cukiernik",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "spożywcze"],
  },
  {
    term: "kucharz",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "spożywcze"],
    aliases: ["gastronomia"],
  },
  {
    term: "fryzjer",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "usługowe"],
    aliases: ["fryzjerstwo"],
  },
  {
    term: "krawiec",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "usługowe"],
    aliases: ["krawiectwo"],
  },
  {
    term: "kierowca zawodowy",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "transportowe"],
  },
  {
    term: "górnik",
    level: "zasadnicze zawodowe",
    path: ["rzemieślnicze", "wydobywcze"],
  },

  // ---- ogólne szczeble, dla osób bez kierunku ----
  {
    term: "wykształcenie średnie ogólne",
    level: "średnie",
    path: ["ogólne"],
    aliases: ["liceum", "matura", "średnie"],
  },
  { term: "technikum", level: "średnie", path: ["ogólne"] },
  {
    term: "wykształcenie podstawowe",
    level: "podstawowe",
    path: ["ogólne"],
    aliases: ["podstawowe", "szkoła podstawowa"],
  },
  {
    term: "wykształcenie zawodowe",
    level: "zasadnicze zawodowe",
    path: ["ogólne"],
    aliases: ["zasadnicze zawodowe", "szkoła zawodowa"],
  },
  {
    term: "wykształcenie wyższe",
    level: "magister",
    path: ["ogólne"],
    aliases: ["wyższe", "studia wyższe"],
  },
  { term: "studia podyplomowe", level: "magister", path: ["ogólne"] },
  {
    term: "profesor",
    level: "doktor",
    path: ["ogólne"],
    aliases: ["profesura", "tytuł profesora"],
  },
  {
    term: "doktor habilitowany",
    level: "doktor",
    path: ["ogólne"],
    aliases: ["habilitacja", "dr hab."],
  },
];

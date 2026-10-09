/** Given names somebody in the company register is called by.
 *
 * The first names of the people `people_enriched` holds, casefolded, that at
 * least two of them share: 689 names in the build of 2026-10-09. Two, so that
 * a surname typed into the first-name field once is not taken for a name.
 *
 * It exists for `shortPersonName`, which has to tell a middle name from the
 * first half of a double surname written with a space, and the name itself
 * does not say: "Antoni Ignacy Sikoń" and "Zuzanna Benc Szczepaniak" are both
 * three words. Of the person pages with three words and a register entry to
 * check them against, 2,729 of the 2,749 middle names are in this list, and 2
 * of the 334 surname halves.
 *
 * Regenerate it from a people_enriched jsonl when it seems short:
 *
 *   counts = Counter(row["first_name"].strip().casefold() for row in rows
 *                    if isinstance(row.get("first_name"), str))
 *   sorted(name for name, n in counts.items() if n >= 2)
 *
 * A name it lacks costs nothing worse than a label drawn in full.
 */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
  `
  aaron ada adam adela adelajda adelina adolf adrian adriana adrianna agata
  agnieszka ahmad alan albert albin albina aldona aleks aleksander aleksandra
  aleksy alexander alexandra alfons alfred alfreda alicja alina alojzy amadeusz
  amanda amelia amer anastasiia anastazja anatol anatola andrea andreas andrii
  andrzej andré andżelika aneta anetta angela angelica angelika angelina aniela
  anita anna annabella antoni antonina antonio anzelm apolonia apoloniusz
  ariadna ariel arkadiusz arleta arletta armen armin arnold artem artur ashok
  august augustyn aurelia aureliusz axel barbara bartosz bartłomiej bazyl bazyli
  beata beatrycze belinda benedykt beniamin benita benoit benon bernadeta
  bernadetta bernard bernarda bernardeta bernhard bianka bibianna blandyna
  blanka bogdan bogna bogumił bogumiła bogusz bogusław bogusława bohdan bolesław
  bonawentura bonifacy boris borys borysław bożena bożenna bożydar bożysław
  brian bronisław bronisława bruno brunon brygida błażej carl carlos cecylia
  celestyn celina cezariusz cezary christian christine christoph christopher
  cyprian cyryl czesław czesława dagmara damazy damian daniel daniela danuta
  daria dariusz darosław david dawid dezyderiusz diana diego dieter dionizy dirk
  ditmar dobiesław dobrochna dobromir dobrosław dobrosława domicela dominik
  dominika donald donat donata dorian dorota dragomir dymitr edgar edmund edward
  edwin edyta ela eleonora elfryda eliasz eligiusz eliza elwira elżbieta emanuel
  emil emila emilia emilian erich ernest erwin eryk eryka estera eugenia
  eugeniusz eulalia eunika euzebiusz ewa ewald ewaryst ewelina fabian fabien
  felicja felicjan feliks feliksa ferdynand filip florian franciszek franciszka
  frank franz fryderyk gabriel gabriela galyna gang genadiusz genowefa gerard
  gerhard gertruda gianluca gilbert ginter gizela gniewomir gracjan gracjana
  grażyna greta grzegorz gustaw gwidon gábor halina hanka hanna harald helena
  helga helmut henryk henryka herbert hieronim hilary holger honorata horst
  hubert ida idalia idzi iga ignacy igor ilona ines inez inga ingrida irena
  ireneusz irma irmina istván ivan iwo iwona iwonna iza izabela izabella izydor
  jacek jacenty jadwiga jagna jagoda jakub james jan jana janetta janina
  janisław january janusz jaromir jarosław jarosława jean jean-paul jens jeremi
  jerzy jiří joachim joanna john jolanta jonasz jordan jorge josef josé jowita
  juan judyta julia julian julianna julita julitta juliusz jurand jurij justyn
  justyna józef józefa jędrzej kacper kaja kajetan kalina kamil kamila kamilla
  karen karina karol karolina kasper katarzyna kazimiera kazimierz kewin kinga
  klara klaudia klaudiusz klemens konrad konstanty kordian kornel kornela
  kornelia korneliusz koryna kostyantyn kryspin krystian krystyn krystyna
  krzysztof krzysztofa ksawery ksenia kurt lars laura lech lechosław lena
  leokadia leon leonard leonarda leontyna leopold leszek lesław lew lidia ligia
  lila lilia liliana lilianna lilla liwia liwiusz longin longina loretta lubomir
  lucja lucjan lucjusz lucyna ludmiła ludomir ludwik ludwika luigi luiza maciej
  magda magdalena maja makary maks maksym maksymilian malwina manfred manuela
  marcel marcela marceli marcelina marcin marcjanna marco marek margota maria
  marian marianna marietta marika marina mariola marita mariusz mark marko
  marlena marta martin martyna maryla marzanna marzena marzenna mateusz matylda
  maurycy małgorzata medard melania michael michal michalina michał mieczysław
  mieczysława mieszko mikołaj milena mirela mirella miron mirona mirosław
  mirosława miłosz miłosław miłosława modest monika nadieżda narcyz natalia
  natasza nela nelly nicolas nikodem nikola nina noemi norbert oksana oktawian
  oktawiusz ola olaf oleg oleksii olena olga olgierd olimpia olivier oliwer
  oliwia omar orest oskar oswald otto otton otylia pamela paolo patrick patrik
  patrycja patrycjusz patryk paul paula paulina pavel paweł pedro pelagia peter
  petros philip philippe pierre piotr pola przemysław rachel radomir radosław
  radosława rafael rafał rajmund regina reinhard remigiusz renard renata rene
  renisław riad ricardo richard rita robert roberto roch roger roksana roland
  roma roman romana romuald romualda ronald rozalia rudolf rufin ruslan rusłan
  ryszard ryszarda ryta róża sabina sambor sandra sara saturnin sebastian sergii
  sergiusz sergiy seweryn siegmund simona sobiesław sonia stanislav stanisław
  stanisława stefan stefania stefano stella stéphane svitlana sybila sybilla
  sylweriusz sylwester sylwia sylwiana szczepan szymon sława sławoj sławomir
  sławomira tadeusz taida tamara tatiana teodor teodora teodozja teofil teresa
  thierry thomas tobiasz tomas tomasz tomáš tyberiusz tymon tymoteusz tytus
  urban urszula vadim victor vincent violeta violetta vladyslav volodymyr wacław
  wacława wadim waldemar walenty walentyna waleria walerian walery walter wanda
  wawrzyniec werner weronika wiera wiesław wiesława wieńczysław wiktor wiktoria
  wilhelm william wincenty winfrid winicjusz wioleta wioletta wirginia
  wirginiusz wit witold witosław wojciech władysław władysława włodzimierz
  xavier yuriy zbigniew zbyszek zbyszko zbysław zdzisław zdzisława zenobia
  zenobiusz zenon zenona ziemowit zofia zuzanna zygfryd zygmunt zyta łucja
  łucjan łukasz światosław świętosław żaklina żaneta żanetta
`
    .split(/\s+/)
    .filter(Boolean),
);

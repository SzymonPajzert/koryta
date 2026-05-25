import { ref } from "vue";

export type Company = {
  // TODO implement it and link it
  nodeId?: string;
  name: string;
};

export type Person = {
  name: string;
  party?: string;
  accountId?: string;
  currentEmployment?: Company;
  pastEmployment?: Company;
};

export type UkorycenieData = {
  regionName: string;
  people: Person[];
};

export function useRegionStatistics(terytCode: string) {
  const data = ref<UkorycenieData | undefined>(undefined);
  const loading = ref(true);
  const error = ref<Error | undefined>(undefined);

  // Mock data fetching for 2 teryt codes
  setTimeout(() => {
    if (terytCode === "1261") {
      data.value = {
        regionName: "Rada Miasta Krakowa",
        people: [
          { name: "Anna Bałdyga" },
          { name: "Iwona Chamielec" },
          { name: "Michał Ciechowski" },
          {
            name: "Tomasz Daros",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1496535/tomasz-daros",
            pastEmployment: {
              name: "MAŁOPOLSKI REGIONALNY FUNDUSZ PORĘCZENIOWY",
            },
          },
          { name: "Bogumiła Drabik" },
          { name: "Michał Drewnicki" },
          { name: "Eliza Dydyńska-Czesak" },
          {
            name: "Grażyna Fijałkowska",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1335842/grazyna-fijalkowska",
            currentEmployment: {
              name: "MIEJSKIE CENTRUM OPIEKI DLA OSÓB STARSZYCH",
            },
          },
          { name: "Grzegorz Garboliński" },
          { name: "Łukasz Gibała" },
          { name: "Joanna Hańderek" },
          {
            name: "Marek Hohenauer",
            party: "PO",
            accountId: "/osoba/marek-jan-hohenauer-0KlvIX9iK39SdVANgV3d",
            pastEmployment: { name: "KRAKÓW NOWA HUTA PRZYSZŁOŚCI" },
          },
          {
            name: "Mariusz Kękuś",
            party: "PiS",
            accountId: "/osoba/mariusz-boguslaw-kekus-Im3MD1urbcD6A4fJakUP",
            pastEmployment: { name: "MAŁOPOLSKA AGENCJA ROZWOJU REGIONALNEGO" },
          },
          {
            name: "Bartłomiej Kocurek",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1287087/bartlomiej-kocurek",
            currentEmployment: { name: 'KOPALNIA SOLI "WIELICZKA"' },
          },
          {
            name: "Jakub Kosek",
            party: "PO",
            accountId: "https://rejestr.io/osoby/2456438/jakub-kosek",
            currentEmployment: {
              name: "ZAKŁAD DOŚWIADCZALNY INSTYTUTU ZOOTECHNIKI",
            },
          },
          { name: "Małgorzata Kot" },
          { name: "Zbigniew Kożuch" },
          { name: "Renata Kucharska" },
          { name: "Tomasz Leśniak" },
          { name: "Agnieszka Łętocha" },
          { name: "Łukasz Maślona" },
          {
            name: "Magdalena Mazurkiewicz",
            party: "PO",
            accountId:
              "https://krakow.wyborcza.pl/krakow/7,44425,32804881,kolejna-krakowska-polityczka-tym-razem-nauczycielka-pada.html",
            currentEmployment: { name: "Teatr Słowackiego w Krakowie" },
          },
          {
            name: "Maciej Michałowski",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/90690/maciej-michalowski",
            pastEmployment: { name: "ZARZĄD MORSKIEGO PORTU GDYNIA" },
          },
          {
            name: "Piotr Moskała",
            party: "PO",
            accountId: "/osoba/piotr-marian-moskala-NdUyWl4iQl2AdkidUZsI",
            currentEmployment: {
              name: "ZAKŁAD DOŚWIADCZALNY INSTYTUTU ZOOTECHNIKI",
            },
          },
          { name: "Edyta Nowak" },
          { name: "Rafał Nowak" },
          { name: "Aleksandra Owca" },
          { name: "Agnieszka Paderewska" },
          {
            name: "Włodzimierz Pietrus",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1257087/wlodzimierz-pietrus",
            pastEmployment: { name: "PRZEDSIĘBIORSTWO USŁUG HOTELARSKICH" },
          },
          {
            name: "Renata Piętka",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1802484/renata-pietka",
            currentEmployment: {
              name: "MIEJSKIE CENTRUM OPIEKI DLA OSÓB STARSZYCH",
            },
          },
          {
            name: "Agnieszka Pogoda-Tota",
            party: "PO",
            accountId:
              "https://rejestr.io/krs/57996/miejskie-centrum-opieki-dla-osob-starszych-przewlekle-niepelnosprawnych-oraz-niesamodzielnych-w-krak/powiazania?m=wszystkie",
            currentEmployment: {
              name: "MIEJSKIE CENTRUM OPIEKI DLA OSÓB STARSZYCH",
            },
          },
          {
            name: "Edward Porębski",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1205347/edward-porebski",
            currentEmployment: { name: "SZPITAL SPECJALISTYCZNY IM.J.DIETLA" },
          },
          { name: "Małgorzata Potocka" },
          { name: "Edyta Sikora" },
          { name: "Marek Sobieraj" },
          { name: "Michał Starobrat" },
          {
            name: "Grzegorz Stawowy",
            party: "PO",
            accountId: "/osoba/grzegorz-klaudiusz-stawowy-Hops3RkW6zqYIRo459V1",
            pastEmployment: { name: "KOLEJE MAŁOPOLSKIE" },
          },
          { name: "Grzegorz Wojciech Stawowy" },
          { name: "Krzysztof Sułowski" },
          {
            name: "Alicja Szczepańska",
            party: "PO",
            accountId: "/osoba/alicja-anna-szczepanska-dmdAWj2WQBstahqMEDrC",
            currentEmployment: {
              name: "MIEJSKIE CENTRUM OPIEKI DLA OSÓB STARSZYCH",
            },
          },
          { name: "Aleksandra Witek" },
          { name: "Rafał Zawiślak" },
          {
            name: "Maciej Żmuda",
            party: "PO",
            accountId: "https://rejestr.io/osoby/2769750/maciej-zmuda",
            currentEmployment: {
              name: "WOJEWÓDZKA PRZYCHODNIA STOMATOLOGICZNA",
            },
          },
        ],
      };
    } else if (terytCode === "12") {
      data.value = {
        regionName: "Sejmik województwa Mazowieckiego",
        people: [
          {
            name: "Tadeusz Arkit",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1336689/tadeusz-arkit",
            currentEmployment: {
              name: "MAŁOPOLSKI SZPITAL CHORÓB PŁUC I REHABILITACJI",
            },
          },
          {
            name: "Dariusz Badurski",
            party: "Polska 2050",
            accountId: "https://rejestr.io/osoby/147600/dariusz-badurski",
            currentEmployment: { name: "KRAKOWSKI SZPITAL SPECJALISTYCZNY" },
          },
          {
            name: "Kazimierz Barczyk",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1173777/kazimierz-barczyk",
            currentEmployment: { name: "WOJEWÓDZKI SZPITAL OKULISTYCZNY" },
          },
          {
            name: "Grzegorz Biedroń",
            party: "PiS",
            accountId: "/osoba/grzegorz-janusz-biedron-DttvDV3r6ghAo5eKJ8Yd",
            currentEmployment: {
              name: 'SZPITAL SPECJALISTYCZNY CHORÓB PŁUC "ODRODZENIE"',
            },
          },
          {
            name: "Piotr Ćwik",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/2242764/piotr-cwik",
            currentEmployment: { name: "KRAKOWSKI SZPITAL SPECJALISTYCZNY" },
          },
          {
            name: "Mirosław Dróżdż",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/4999/miroslaw-drozdz",
            currentEmployment: {
              name: "SZPITAL KLINICZNY IM. DR. JÓZEFA BABIŃSKIEGO",
            },
          },
          {
            name: "Jan Wiesław Duda",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1281709/jan-duda",
            currentEmployment: {
              name: "SZPITAL SPECJALISTYCZNY IM. JĘDRZEJA ŚNIADECKIEGO",
            },
          },
          { name: "Jan Tadeusz Duda", party: "PiS" },
          { name: "Piotr Dziurdzia", party: "PiS" },
          {
            name: "Jerzy Fedorowicz",
            party: "PO",
            accountId: "https://rejestr.io/osoby/94593/jerzy-fedorowicz",
            currentEmployment: { name: "KRAKOWSKI SZPITAL SPECJALISTYCZNY" },
          },
          { name: "Szczęsny Filipiak", party: "PO" },
          {
            name: "Józef Gawron",
            party: "PiS",
            accountId: "/osoba/jozef-wojciech-gawron-LgQnJ4z624WY4lcxE2xr",
            currentEmployment: {
              name: "SZPITAL WOJEWÓDZKI IM.ŚW.ŁUKASZA SAMODZIELNY",
            },
          },
          {
            name: "Lidia Gądek",
            party: "PSL",
            accountId: "https://rejestr.io/osoby/1273316/lidia-gadek",
            currentEmployment: {
              name: "MAŁOPOLSKI SZPITAL CHORÓB PŁUC I REHABILITACJI",
            },
          },
          { name: "Iwona Gibas", party: "PiS" },
          { name: "Danuta Kawa", party: "PiS" },
          {
            name: "Witold Kozłowski",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1258289/witold-kozlowski",
            currentEmployment: {
              name: "SZPITAL SPECJALISTYCZNY IM. JĘDRZEJA ŚNIADECKIEGO",
            },
          },
          { name: "Maciej Koźbiał", party: "PO" },
          { name: "Jacek Krupa", party: "PO" },
          {
            name: "Grzegorz Lipiec",
            party: "PO",
            accountId: "/osoba/grzegorz-cezary-lipiec-qqTjGbVcTgcHcdUuANJ2",
            currentEmployment: { name: "WOJEWÓDZKI SZPITAL OKULISTYCZNY" },
          },
          {
            name: "Marta Malec-Lech",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/702144/marta-malec-lech",
            pastEmployment: { name: "MAŁOPOLSKA ORGANIZACJA TURYSTYCZNA" },
          },
          {
            name: "Grzegorz Małodobry",
            party: "PO",
            accountId:
              "/osoba/grzegorz-franciszek-malodobry-wNiDCSSBFsWCDLtegyCt",
            currentEmployment: {
              name: "MIEJSKIE PRZEDSIĘBIORSTWO KOMUNIKACYJNE",
            },
          },
          { name: "Miłosz Motyka", party: "PSL", accountId: "" },
          { name: "Barbara Nowak", party: "PiS" },
          {
            name: "Krzysztof Nowak",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1244292/krzysztof-nowak",
            currentEmployment: { name: "MIEJSKI ZARZĄD BUDYNKÓW" },
          },
          {
            name: "Ryszard Pagacz",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/694315/ryszard-pagacz",
            currentEmployment: { name: "SZPITAL WOJEWÓDZKI IM.ŚW.ŁUKASZA" },
          },
          {
            name: "Stanisław Pasoń",
            party: "PSL",
            accountId: "https://rejestr.io/osoby/1350410/stanislaw-pason",
            currentEmployment: { name: "SZPITAL SPECJALISTYCZNY IM. JĘDRZEJA" },
          },
          {
            name: "Bogdan Pęk",
            party: "PiS",
            accountId: "/osoba/bogdan-marek-pek-KBIsuBFM00sRYowmBdvb",
            currentEmployment: { name: "MAŁOPOLSKI SZPITAL ORTOPEDYCZNO" },
          },
          {
            name: "Jan Piczura",
            party: "PiS",
            accountId: "/osoba/jan-piczura-aQASMiUY2niPzj93nlZ3",
            currentEmployment: { name: "WOJEWÓDZKI SZPITAL REHABILITACYJNY" },
          },
          { name: "Tomasz Płatek", party: "PiS" },
          {
            name: "Wojciech Skruch",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1356875/wojciech-skruch",
            currentEmployment: { name: 'CENTRUM MEDYCZNE "KOL-MED"' },
          },
          {
            name: "Michał Słowik",
            party: "PO",
            accountId: "https://rejestr.io/osoby/1021650/michal-slowik",
            currentEmployment: { name: "SZPITAL SPECJALISTYCZNY IM. JĘDRZEJA" },
          },
          {
            name: "Łukasz Smółka",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/1209075/lukasz-smolka",
            currentEmployment: {
              name: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
            },
          },
          {
            name: "Stanisław Sorys",
            party: "PSL",
            accountId: "https://rejestr.io/osoby/72070/stanislaw-sorys",
            currentEmployment: {
              name: "SZPITAL WOJEWÓDZKI IM.ŚW.ŁUKASZA SAMODZIELNY",
            },
          },
          { name: "Rafał Stuglik", party: "PiS" },
          { name: "Małgorzata Szostak", party: "Polska 2050" },
          { name: "Patrycja Tocka", party: "PO" },
          {
            name: "Marek Wierzba",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/2301302/marek-wierzba",
            currentEmployment: {
              name: 'SZPITAL SPECJALISTYCZNY CHORÓB PŁUC "ODRODZENIE"',
            },
          },
          {
            name: "Jadwiga Wójtowicz",
            party: "PiS",
            accountId: "https://rejestr.io/osoby/973977/jadwiga-wojtowicz",
            currentEmployment: { name: "KRAKOWSKI SZPITAL SPECJALISTYCZNY" },
          },
          { name: "Sylwia Żak-Biesik", party: "PO" },
        ],
      };
    }
    loading.value = false;
  }, 500);

  return { data, loading, error };
}

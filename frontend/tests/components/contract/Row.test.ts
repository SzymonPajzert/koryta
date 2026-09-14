import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Row from "../../../app/components/contract/Row.vue";
import { plnExact } from "../../../shared/money";
import { companyShortName } from "../../../shared/names";
import type { ContractParty, ContractRow } from "../../../shared/contracts";

/** The branch matrix the seed cannot cover cheaply.
 *
 * Every case below is a real shape from the first CRU window - a withheld
 * value, a contract worth 0 zł, a private individual, a row the register
 * indexes but will not describe - and none of them is on the happy path a
 * visual baseline would photograph. They are also the cases where getting it
 * wrong is not a cosmetic bug: „Bez podanej wartości" rendered as an empty cell
 * reads as a bug in this site rather than as a decision by a public body, and a
 * register deep link on a row naming a private individual undoes the whole
 * reason their name is not stored.
 */
function party(fields: Partial<ContractParty> = {}): ContractParty {
  return {
    role: "supplier",
    kind: "firma",
    name: "ACME SPÓŁKA AKCYJNA",
    ...fields,
  };
}

function contract(fields: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "cru_abc",
    source: "cru",
    sourceId: "abc-def",
    number: "WKS.526.60.2026",
    subject: "Dostawa materiałów biurowych",
    value: 1436,
    signedAt: "2026-07-14",
    active: true,
    buyer: party({
      role: "buyer",
      kind: "jsfp",
      name: "URZĄD MIASTA KRAKOWA",
      nodeId: "krakow1",
      nodeName: "Urząd Miasta Krakowa",
    }),
    suppliers: [party()],
    nodeIds: ["krakow1"],
    linked: true,
    bothLinked: false,
    nips: ["1234567890"],
    supplierNodeIds: [],
    hasIndividual: false,
    valueSort: 1436,
    signedSort: "2026-07-14",
    ...fields,
  };
}

const render = (fields: Partial<ContractRow> = {}) =>
  mountSuspended(Row, { props: { contract: contract(fields) } });

describe("ContractRow value", () => {
  it("says a value was never stated rather than leaving a gap", async () => {
    // 764 contracts of 149 683 state no figure at all. An empty pill there is
    // indistinguishable from a rendering bug.
    const text = (await render({ value: undefined, valueSort: -1 })).text();

    expect(text).toContain("Bez podanej wartości");
  });

  it("prints 0 zł as the real value it is", async () => {
    // 251 contracts are worth exactly nothing, and they are not the same thing
    // as the ones that do not say - which is why `valueSort` is -1 and not 0.
    const text = (await render({ value: 0, valueSort: 0 })).text();

    expect(text).toContain("0");
    expect(text).not.toContain("—");
  });

  it("keeps the figure and adds the basis when the register gave both", async () => {
    // Five contracts carry the redaction flag AND state a value. The register
    // answered, so the flag is not evidence that it did not; concealing the
    // number would be this site editing the register.
    const text = (
      await render({
        value: 4200,
        valueRedaction: {
          scope: "Wartość umowy",
          basis: "art. 5 ust. 2 u.d.i.p.",
        },
      })
    ).text();

    expect(text).toContain(plnExact(4200));
    expect(text).toContain("zastrzeżenie: art. 5 ust. 2 u.d.i.p.");
  });

  it("says „Utajniona” where the flag stands alone", async () => {
    const text = (
      await render({
        value: undefined,
        valueSort: -1,
        valueRedaction: { basis: "art. 5 ust. 2 u.d.i.p." },
      })
    ).text();

    expect(text).toContain("Utajniona");
  });

  it("names a withheld subject and quotes the legal basis", async () => {
    const wrapper = await render({
      subject: undefined,
      subjectRedaction: {
        scope: "Przedmiot umowy",
        basis: "art. 5 ust. 1 u.d.i.p.",
      },
    });

    expect(wrapper.text()).toContain("Przedmiot utajniony");
    expect(wrapper.text()).toContain("art. 5 ust. 1 u.d.i.p.");
  });
});

describe("ContractRow dates and status", () => {
  it("asserts no term where the register recorded none", async () => {
    // 113 020 contracts of 149 683 have no end date. „obecnie" or a dash there
    // would state a term nobody recorded.
    const text = (await render()).text();

    expect(text).toContain("zawarta 14 lipca 2026");
    expect(text).not.toContain("na czas nieoznaczony");
    expect(text).not.toMatch(/\bdo \d/);
  });

  it("says so when the contract runs open-ended", async () => {
    expect((await render({ openEnded: true })).text()).toContain(
      "na czas nieoznaczony",
    );
  });

  it("marks an inactive contract and leaves an active one unmarked", async () => {
    expect((await render({ active: false })).text()).toContain("Nieaktywna");
    expect((await render({ active: true })).text()).not.toContain("Nieaktywna");
  });

  it("counts the amendments", async () => {
    const text = (
      await render({
        amendments: [
          { kind: "Aneks", date: "2026-07-20" },
          { kind: "Wygaśnięcie umowy", date: "2026-08-01" },
        ],
      })
    ).text();

    expect(text).toContain("aneksowana (2)");
  });
});

describe("ContractRow parties", () => {
  it("pluralises the label when there is more than one supplier", async () => {
    // 1 237 contracts of 149 683 have several. „Wykonawca:" three times reads
    // as three separate contracts.
    const wrapper = await render({
      suppliers: [
        party({ name: "PIERWSZA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" }),
        party({ name: "DRUGA SPÓŁKA AKCYJNA" }),
        party({ name: "TRZECIA SPÓŁKA JAWNA" }),
      ],
    });

    expect(wrapper.text()).toContain("Wykonawcy");
    expect(wrapper.text()).not.toContain("Wykonawca:");
    // And the legal form is abbreviated: 27% of party names end in a
    // spelled-out one, and „SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" alone is
    // 35 characters, i.e. most of a two-line row on a phone.
    expect(wrapper.text()).toContain(
      companyShortName("PIERWSZA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"),
    );
    expect(wrapper.text()).toContain(
      "Pierwsza sp. z o.o.".toUpperCase().slice(0, 8),
    );
  });

  it("never names a private individual, and never links to where the register does", async () => {
    // Both halves of decision 6. We store no name for the 18 505 contracts that
    // have one - so there is nothing to leak - and we drop the register deep
    // link on them, which is the one element that turns an anonymised row back
    // into a one-click lookup of the name.
    const html = (
      await render({
        hasIndividual: true,
        suppliers: [party({ kind: "osoba", name: undefined })],
      })
    ).html();

    expect(html).toContain("osoba fizyczna");
    expect(html).not.toContain("rejestrumow.gov.pl");
  });

  it("links to the register on a row with no individual on it", async () => {
    // The anchor for the assertion above: its absence has to mean something.
    expect((await render()).html()).toContain("rejestrumow.gov.pl");
  });
});

describe("ContractRow edge cases", () => {
  it("says the register withheld the details rather than dropping the row", async () => {
    // The 42 `zrodlo: "wynik"` rows. Dropping them is a silent edit of somebody
    // else's register; drawing an empty party block for them is a bug.
    const wrapper = await render({
      detailsUnavailable: true,
      subject: undefined,
      buyer: { role: "buyer" },
      suppliers: [],
    });

    expect(wrapper.text()).toContain(
      "Rejestr nie udostępnił szczegółów tej umowy.",
    );
    expect(wrapper.text()).not.toContain("Zamawiający");
    expect(wrapper.text()).not.toContain("Wykonawca");
  });

  it("never takes the accent rail", async () => {
    // `app/app.vue` reserves the sage rail for a card that carries a claim
    // about somebody. A register entry is not one, and painting it in the
    // site's editorial colour because a NIP matched is the false impression of
    // causation this feature exists to avoid.
    const root = (await render()).find("article");

    expect(root.classes()).toContain("k-card");
    expect(root.classes()).not.toContain("k-card--accent");
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PeopleStrip from "../../../app/components/contract/PeopleStrip.vue";
import type {
  ContractPartyPeople,
  ContractPerson,
} from "../../../shared/contracts";

/** The gate, in the DOM.
 *
 * `tests/server/contracts.test.ts` proves the server never sends a withheld
 * name; this proves the component never invents a way to show one. The two are
 * separate on purpose: per-row partial redaction has no precedent in this repo,
 * and the failure mode nobody catches by eye is a name that is in the html and
 * merely painted over - `filter: blur` is a paint instruction, not an access
 * rule, and the html of this page is what Google stores.
 */
function person(fields: Partial<ContractPerson> = {}): ContractPerson {
  return {
    id: "p1",
    name: "Jan Opublikowany",
    role: "Prezes zarządu",
    parties: [],
    ours: false,
    ...fields,
  };
}

function payload(
  fields: Partial<ContractPartyPeople> = {},
): ContractPartyPeople {
  return {
    nodeId: "szpital1",
    people: [person()],
    hiddenPeople: 0,
    morePeople: 0,
    ...fields,
  };
}

const render = (fields: Partial<ContractPartyPeople> = {}) =>
  mountSuspended(PeopleStrip, {
    props: { data: payload(fields), companyName: "Szpital Uniwersytecki" },
  });

describe("ContractPeopleStrip, logged out", () => {
  it("draws no draft treatment when every entry is a published one", async () => {
    const wrapper = await render({ hiddenPeople: 3 });

    expect(wrapper.text()).toContain("Kogo znamy po tej stronie:");
    expect(wrapper.text()).toContain("Jan Opublikowany");
    expect(wrapper.text()).not.toContain("szkic");
    expect(wrapper.find('[data-testid="umowy-people-draft"]').exists()).toBe(
      false,
    );
  });

  it("never carries a withheld name, because it is never sent one", async () => {
    // The anonymous payload counts what it holds back and names none of it, so
    // there is nothing here to hide. Asserted on the html rather than on
    // visibility: the bytes are the thing.
    const html = (await render({ hiddenPeople: 3 })).html();

    expect(html).not.toContain("Anna Szkic");
    expect(html).not.toContain("Piotr Szkic");
  });

  it("leaves the login prompt to the list it is in", async () => {
    // One banner over twenty rows, not twenty banners. The count is on the
    // payload so the feed can sum it; this component reads it for nothing.
    //
    // `text()` rather than `html()`, unlike the assertion above it: the words
    // being looked for are copy, and the component's own source comments
    // discuss them by name. Asserting on the markup would fail on a comment
    // explaining why the markup is right.
    const text = (await render({ hiddenPeople: 3 })).text();

    expect(text).not.toContain("Zaloguj");
    expect(text).not.toContain("zalogow");
  });
});

describe("ContractPeopleStrip, signed in", () => {
  it("marks our opinion three ways and never by colour alone", async () => {
    const wrapper = await render({
      people: [
        person(),
        person({ id: "p2", name: "Anna Szkic", ours: true }),
        person({ id: "p3", name: "Piotr Szkic", ours: true }),
      ],
    });

    // A dashed container, a sentence, and a badge - the same token and the same
    // word `chip/DraftStatus.vue` uses, measured 5.54:1.
    expect(
      wrapper.find('[data-testid="umowy-people-draft"]').classes(),
    ).toContain("k-note");
    expect(wrapper.text()).toContain(
      "Naszym zdaniem powiązani (jeszcze nieopublikowani):",
    );
    expect(wrapper.text().match(/szkic/g)).toHaveLength(2);
    // And the published one stays upstairs, out of the note.
    expect(wrapper.text()).toContain("Kogo znamy po tej stronie:");
  });

  it("keeps a draft out of the published block", async () => {
    const wrapper = await render({
      people: [person({ id: "p2", name: "Anna Szkic", ours: true })],
    });

    expect(wrapper.text()).not.toContain("Kogo znamy po tej stronie:");
  });
});

describe("ContractPeopleStrip truncation", () => {
  it("words a cap as a cap and not as a gate", async () => {
    // A truncation that reads like a login gate is a lie about coverage in the
    // direction that flatters us: „+4 więcej" leads somewhere, „po zalogowaniu"
    // does not.
    const wrapper = await render({ morePeople: 4 });

    expect(wrapper.text()).toContain("+4 więcej");
    expect(wrapper.text()).not.toContain("Zaloguj");
    expect(wrapper.text()).not.toContain("zalogow");
    // And it leads to the institution's own page rather than to
    // `/entity/place/<id>`, which is the redirect bucket the internal links
    // were cleaned out of in August.
    expect(wrapper.html()).toContain("/instytucja/");
  });

  it("prints the role the endpoint resolved, not the edge's own name", async () => {
    // `ContractPerson.role` arrives through `displayRole`, so a hospital's rada
    // społeczna does not reach this component calling itself a supervisory
    // board. The component prints what it is given and must not re-label it.
    const wrapper = await render({
      people: [person({ role: "Rada Społeczna" })],
    });

    expect(wrapper.text()).toContain("(Rada Społeczna)");
    expect(wrapper.text()).not.toContain("Rada Nadzorcza");
  });
});

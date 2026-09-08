import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import PersonSearchMenu from "../../../app/components/button/PersonSearchMenu.vue";
import type { PersonRich } from "../../../shared/model";

const person: PersonRich = {
  id: "jan",
  type: "person",
  name: "Jan Kowalski",
  companies: [],
  elections: [],
  experience: 0,
  workLocations: ["Płock"],
};

/** The menu renders into a teleport, so its items are in the document rather
 * than under the wrapper. */
async function openMenu() {
  const wrapper = await mountSuspended(PersonSearchMenu, { props: { person } });
  await wrapper.find(".v-btn").trigger("click");
  await nextTick();
  return wrapper;
}

const items = () =>
  Array.from(document.querySelectorAll(".v-list-item")).map((el) => ({
    text: el.textContent,
    href: el.getAttribute("href"),
  }));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ButtonPersonSearchMenu", () => {
  it("offers every register and query on its own", async () => {
    await openMenu();
    const text = items()
      .map((item) => item.text)
      .join("\n");
    expect(text).toContain("rejestr.io");
    expect(text).toContain("Wikipedia");
    expect(text).toContain("Jan Kowalski PKW");
    // The town off `workLocations`, which is what makes the local paper's
    // coverage reachable from the same name.
    expect(text).toContain("Jan Kowalski Płock");
  });

  it("keeps opening all of them on offer, with the pop-up warning on it", async () => {
    await openMenu();
    const all = items().find((item) => item.text.includes("Otwórz wszystkie"));
    expect(all).toBeDefined();
    // Five: rejestr.io, wikipedia, the name, PKW and the town.
    expect(all!.text).toContain("(5)");
    expect(all!.text).toContain("pop-up");
  });

  it("makes each row a real link, so it can be middle clicked", async () => {
    // The whole point of the menu is picking one lookup; a click handler would
    // take „open in a new window" and „copy link" away from it.
    await openMenu();
    const google = items().find((item) => item.text.includes("PKW"));
    expect(google?.href).toContain("google.com/search");
  });
});

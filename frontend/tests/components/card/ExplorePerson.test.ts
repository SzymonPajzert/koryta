import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ExplorePerson from "../../../app/components/card/ExplorePerson.vue";
import type { PersonRich } from "../../../shared/model";

const person = {
  id: "xFCwXT4EuQUrjyN532Zt",
  type: "person",
  name: "Paweł Kobyliński",
  parties: [],
  companies: [],
  elections: [],
  experience: 0,
} as unknown as PersonRich;

describe("CardExplorePerson", () => {
  /** The card the drawer on /eksploruj/tabela and /eksploruj/nowe opens with.
   * Its name linked to a bare `/osoba/<id>`, and the page's slug healing runs
   * on the server with no token, so a page awaiting review stayed on it. */
  it("links the name to the person's page by name and id", async () => {
    const wrapper = await mountSuspended(ExplorePerson, {
      props: { person, region: undefined, company: undefined },
    });

    const link = wrapper.find("a.person-link");
    expect(link.attributes("href")).toBe(
      "/osoba/pawel-kobylinski-xFCwXT4EuQUrjyN532Zt",
    );
    expect(link.attributes("target")).toBe("_blank");
  });
});

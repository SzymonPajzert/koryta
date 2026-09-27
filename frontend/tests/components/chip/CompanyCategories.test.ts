import { describe, it, expect, vi } from "vitest";
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import CompanyCategories from "../../../app/components/chip/CompanyCategories.vue";
import type { Company } from "../../../shared/model";

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
mockNuxtImport("navigateTo", () => navigateTo);

function company(fields: Partial<Company>): Company {
  return { type: "place", name: "Podmiot", ...fields } as Company;
}

async function mount(props: {
  company: Company | undefined;
  asLinks?: boolean;
}) {
  return await mountSuspended(CompanyCategories, { props });
}

describe("ChipCompanyCategories", () => {
  it("names a stored category in Polish", async () => {
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    expect(wrapper.text()).toContain("Koleje");
  });

  it("shows every category a company carries", async () => {
    const wrapper = await mount({
      company: company({ categories: ["szpitale", "koleje"] }),
    });
    expect(wrapper.text()).toContain("Szpitale");
    expect(wrapper.text()).toContain("Koleje");
  });

  it("renders each chip as a link where the caller asks for one", async () => {
    // The category is only useful as a way into the rest of the sector. Where
    // the link points is `categoryFilterUrl`'s job and is asserted in
    // `tests/shared/companyCategories.test.ts`: Vuetify resolves `to` through
    // the router, which emits no href under the test harness.
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
      asLinks: true,
    });
    expect(wrapper.find("a.v-chip--link").exists()).toBe(true);
  });

  it("puts no link inside the link its row already is", async () => {
    // Every caller but the summary card sits in a row or a card that links to
    // the company. An <a> in an <a> is split apart by the browser's parser, and
    // hydrating what was left drew PKP SKM's owners twice.
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find(".v-chip--link").exists()).toBe(true);
  });

  it("still leads into the sector on a click, and only there", async () => {
    navigateTo.mockClear();
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    const row = vi.fn();
    wrapper.element.addEventListener("click", row);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find(".v-chip").element.dispatchEvent(click);

    expect(navigateTo).toHaveBeenCalledWith(
      "/eksploruj/tabela?category=koleje",
    );
    // Neither the row's own link nor the browser's default for the <a> around
    // the chip gets the click as well.
    expect(row).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it.each(["ctrlKey", "metaKey", "shiftKey"])(
    "opens the sector in a new tab on a click with %s held, as a link would",
    async (modifier) => {
      navigateTo.mockClear();
      const wrapper = await mount({
        company: company({ categories: ["koleje"] }),
      });
      const row = vi.fn();
      wrapper.element.addEventListener("click", row);

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      wrapper.find(".v-chip").element.dispatchEvent(click);

      expect(navigateTo).toHaveBeenCalledWith(
        "/eksploruj/tabela?category=koleje",
        { open: { target: "_blank" } },
      );
      expect(row).not.toHaveBeenCalled();
      expect(click.defaultPrevented).toBe(true);
    },
  );

  it("opens the sector in a new tab on a middle click, not the row's company", async () => {
    // A middle click is an `auxclick`. Unhandled, it went past the chip to the
    // <a> of the row, and the browser opened the company in the new tab.
    navigateTo.mockClear();
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    const row = vi.fn();
    wrapper.element.addEventListener("auxclick", row);

    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    wrapper.find(".v-chip").element.dispatchEvent(middle);

    expect(navigateTo).toHaveBeenCalledWith(
      "/eksploruj/tabela?category=koleje",
      { open: { target: "_blank" } },
    );
    expect(row).not.toHaveBeenCalled();
    expect(middle.defaultPrevented).toBe(true);
  });

  it("leaves the right button to the browser", async () => {
    navigateTo.mockClear();
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });

    const right = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    wrapper.find(".v-chip").element.dispatchEvent(right);

    expect(navigateTo).not.toHaveBeenCalled();
    expect(right.defaultPrevented).toBe(false);
  });

  it("opens the sector in a new tab on Ctrl+Enter, and in this one on Enter", async () => {
    navigateTo.mockClear();
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    const chip = wrapper.find(".v-chip").element;

    chip.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    chip.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(navigateTo.mock.calls).toEqual([
      ["/eksploruj/tabela?category=koleje"],
      ["/eksploruj/tabela?category=koleje", { open: { target: "_blank" } }],
    ]);
  });

  it("leaves a chip that is a link to the browser's own handling", async () => {
    // Where the chip is an <a> of its own, a middle click opens it the way the
    // browser opens any link.
    navigateTo.mockClear();
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
      asLinks: true,
    });

    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    wrapper.find(".v-chip").element.dispatchEvent(middle);

    expect(navigateTo).not.toHaveBeenCalled();
    expect(middle.defaultPrevented).toBe(false);
  });

  it("reads a category stored in the sanitized map shape", async () => {
    // Nodes written before 2026-07-28 hold `{"0": "koleje"}` where an array
    // belongs, and `unwrap-array-fields.ts` has not been run against prod.
    const wrapper = await mount({
      company: company({
        categories: { 0: "koleje" } as unknown as string[],
      }),
    });
    expect(wrapper.text()).toContain("Koleje");
  });

  it("renders nothing for a company with no categories", async () => {
    expect((await mount({ company: company({ categories: [] }) })).text()).toBe(
      "",
    );
    expect((await mount({ company: company({}) })).text()).toBe("");
    expect((await mount({ company: undefined })).text()).toBe("");
  });

  it("shows a category the site does not name yet, as itself", async () => {
    // The pipelines and the site deploy separately. Hiding the value would
    // hide that the two have drifted apart.
    const wrapper = await mount({
      company: company({ categories: ["lotniska"] }),
    });
    expect(wrapper.text()).toContain("lotniska");
  });
});

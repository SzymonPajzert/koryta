import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Answered from "../../../app/components/oswiadczenia/Answered.vue";
import type { AnsweredCrop } from "../../../app/composables/declarationQueue";

const crop = (over: Partial<AnsweredCrop> = {}): AnsweredCrop => ({
  id: "crop-1",
  documentUrl: "https://bip.gmina-testowa.example/oswiadczenie-1.pdf",
  host: "bip.gmina-testowa.example",
  verdict: "date",
  value: "1979-07-15",
  settled: true,
  ...over,
});

const mount = (over: Partial<AnsweredCrop> = {}) =>
  mountSuspended(Answered, { props: { crop: crop(over) } });

const LINK = '[data-testid="declaration-document-link"]';

/** The line under the next crop about the one just answered, and the only
 * place its declaration is linked: the form names the person, so before the
 * answer it would be a way to look the date up rather than read it. */
describe("OswiadczeniaAnswered", () => {
  it("says what was saved, links the whole declaration and says when the crop has its readings", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Zapisane: 15 lipca 1979");
    const link = wrapper.get(LINK);
    expect(link.attributes("href")).toBe(
      "https://bip.gmina-testowa.example/oswiadczenie-1.pdf",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
    expect(wrapper.text()).toContain("bip.gmina-testowa.example");
    expect(wrapper.text()).toContain("ten wycinek ma już komplet odczytów");
  });

  // The server checks the address at upload; the page that puts it in front
  // of a reader checks it again.
  it("links nothing that is not an http(s) address", async () => {
    const wrapper = await mount({
      documentUrl: "javascript:alert(document.cookie)",
      host: null,
    });

    expect(wrapper.find(LINK).exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Zobacz całe oświadczenie");
    // What was saved is still said.
    expect(wrapper.text()).toContain("Zapisane: 15 lipca 1979");
  });

  it("says a skip was a skip, and nothing was saved", async () => {
    const wrapper = await mount({
      verdict: "skip",
      value: null,
      settled: false,
    });

    expect(wrapper.text()).toContain("Pominięte");
    expect(wrapper.text()).not.toContain("Zapisane");
  });

  it("claims no full set of readings for a crop that is still open", async () => {
    const wrapper = await mount({ settled: false });

    expect(wrapper.text()).toContain("Zapisane: 15 lipca 1979");
    expect(wrapper.text()).not.toContain("komplet odczytów");
  });
});

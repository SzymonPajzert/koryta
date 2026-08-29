import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import NoteSourceCard from "../../app/components/note/SourceCard.vue";
import type { NoteSource } from "~~/shared/model";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const mount = (source: NoteSource, isEditing = false) =>
  mountSuspended(NoteSourceCard, {
    props: { modelValue: source, isEditing },
  });

describe("NoteSourceCard", () => {
  it("labels a change request but leaves a plain source unlabelled", async () => {
    const change = await mount({ note: "zła data", kind: "change_request" });
    expect(change.text()).toContain("Do poprawy");

    const source = await mount({
      note: "ciekawe",
      url: "https://a.example",
      kind: "source",
    });
    expect(source.text()).not.toContain("Do poprawy");
  });

  it("reads an entry written before kinds existed as a source", async () => {
    const wrapper = await mount({ note: "stara", url: "https://a.example" });

    expect(wrapper.text()).not.toContain("Do poprawy");
    expect(wrapper.text()).not.toContain("Brakuje danych");
  });

  it("emits a whole new entry when the kind is switched", async () => {
    const wrapper = await mount({ note: "czegoś brak" }, true);

    const missingChip = wrapper
      .findAll(".v-chip")
      .find((c) => c.text().includes("Brakuje danych"));
    await missingChip?.trigger("click");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toEqual({
      note: "czegoś brak",
      kind: "missing",
    });
  });

  // The report this component was rebuilt for, twice over: a reader was shown
  // their neighbours' notes inside read-only text fields, with the *author's*
  // prompt floating over each one as a label. Nothing else on a person's page
  // renders content in an input, and no amount of matching the heading above
  // it made the section stop reading as an unfinished form.
  it("shows a note as text, not as a form field", async () => {
    const wrapper = await mount({ note: "brakuje kadencji", kind: "missing" });

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.text()).toContain("brakuje kadencji");
    // And no prompt: it is a question put to whoever wrote the entry.
    expect(wrapper.text()).not.toContain("Czego tu brakuje?");
  });

  it("gives its author a field, and only its author", async () => {
    const wrapper = await mount(
      { note: "brakuje kadencji", kind: "missing" },
      true,
    );

    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.text()).toContain("Czego tu brakuje?");
  });

  // The entry is the site's card - the same rule that draws a handover in
  // "Zmiany na stanowisku" directly above the notes on a person's page. The
  // class is the whole contract: it lives in app.vue, so a scoped copy
  // reappearing anywhere is what this guards against.
  it("is drawn as the site's card", async () => {
    const wrapper = await mount({ note: "cokolwiek" });

    expect(wrapper.get("article").classes()).toEqual(
      expect.arrayContaining(["k-card", "k-card--accent"]),
    );
  });

  it("names a source by its host and keeps the whole url on the link", async () => {
    const url = "https://www.wyborcza.pl/artykul?utm_source=nowhere";
    const wrapper = await mount({ note: "ciekawe", url });

    const link = wrapper.get("a.source-link");
    expect(link.text()).toContain("wyborcza.pl");
    expect(link.attributes("href")).toBe(url);
    expect(link.attributes("target")).toBe("_blank");
    // The old chip printed the whole address under a `max-width: 75%`, and on
    // a phone the truncation fell mid-path.
    expect(wrapper.text()).not.toContain("utm_source");
  });

  it("shows a source that is not a url as the text it is", async () => {
    const wrapper = await mount({ note: "z papieru", url: "gazeta, strona 3" });

    expect(wrapper.find("a.source-link").exists()).toBe(false);
    expect(wrapper.text()).toContain("gazeta, strona 3");
  });

  it("links the article a source became", async () => {
    const wrapper = await mount({
      note: "ciekawe",
      url: "https://a.example",
      articleNodeId: "art-1",
    });

    expect(wrapper.get("a.note-entry__article").attributes("href")).toBe(
      "/entity/article/art-1",
    );
  });
});

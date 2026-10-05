import { describe, it, expect, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearError, clearNuxtData, useError } from "#app";
import { createError } from "h3";
import UczestnikPage from "../../app/pages/uczestnik/[handle].vue";
import type { PublicProfile } from "../../shared/userAdmin";

/** What `/api/profiles/<handle>` answers, by handle. A handle missing from
 * here is a 404, as it is on the server. */
let profiles: Record<string, PublicProfile> = {};

registerEndpoint("/api/profiles/anna-nowak", () => answer("anna-nowak"));
registerEndpoint("/api/profiles/bartek", () => answer("bartek"));

function answer(handle: string) {
  const profile = profiles[handle];
  if (!profile) {
    throw createError({ statusCode: 404, message: "Nie ma takiego profilu." });
  }
  return profile;
}

const profile = (fields: Partial<PublicProfile> = {}): PublicProfile => ({
  handle: "anna-nowak",
  name: "Anna Nowak",
  avatar: null,
  joined: "2026-05",
  counts: { votes: 12, notes: 1, proposals: 3, accepted: 2 },
  ...fields,
});

const open = (handle = "anna-nowak") =>
  mountSuspended(UczestnikPage, { route: `/uczestnik/${handle}` });

beforeEach(async () => {
  clearNuxtData();
  await clearError();
  profiles = { "anna-nowak": profile() };
});

describe("/uczestnik/[handle]", () => {
  it("shows who it is and since when", async () => {
    const wrapper = await open();

    expect(wrapper.find("h1").text()).toBe("Anna Nowak");
    // The genitive after „od”, which a month on its own does not take.
    expect(wrapper.text()).toContain("Na koryta.pl od maja 2026");
  });

  it("counts what the person did, in Polish", async () => {
    const wrapper = await open();
    const tiles = wrapper
      .findAll("[data-testid='uczestnik-count']")
      .map((tile) => tile.text().replace(/\s+/g, " ").trim());

    expect(tiles).toEqual([
      "12 ocen",
      "1 notatka",
      "3 propozycje zmian",
      "2 przyjęte",
    ]);
  });

  it("draws initials when the person has no picture of their own", async () => {
    const wrapper = await open();

    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("[data-testid='uczestnik-avatar']").text()).toBe("AN");
  });

  it("draws the picture the site stored", async () => {
    profiles["anna-nowak"] = profile({ avatar: "/api/images/img1" });

    const wrapper = await open();

    // Read off the prop: v-img only writes the <img> once it has loaded.
    expect(wrapper.findComponent({ name: "VImg" }).props("src")).toBe(
      "/api/images/img1",
    );
  });

  it("leaves out the month when nobody knows it", async () => {
    profiles["anna-nowak"] = profile({ joined: null });

    const wrapper = await open();

    expect(wrapper.text()).not.toContain("Na koryta.pl od");
  });

  it("says this is a volunteer and where the rest of them are", async () => {
    const wrapper = await open();
    const link = wrapper.findComponent({ name: "NuxtLink" });

    expect(wrapper.text()).toContain("wolontariusze");
    expect(link.props("to")).toBe("/eksploruj/statystyki");
  });

  it("lists nothing the person rated or proposed, and no role", async () => {
    const wrapper = await open();

    expect(wrapper.text()).not.toMatch(/admin|redakc|osob[ay] |\/osoba\//i);
  });

  it("is the standard not-found page for a profile that is not open", async () => {
    const wrapper = await open("bartek");

    // Handed to app/error.vue, as any other missing page is.
    expect(useError().value).toMatchObject({ statusCode: 404, fatal: true });
    expect(wrapper.find("h1").exists()).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  spellsOverlap,
  withoutRedundantRoleless,
  type RoleSpell,
} from "../../shared/rolelessSpells";

/** A spell of one person's at one company unless told otherwise - the pair
 * the report on PZO Gliwice was about. */
function spell(fields: Partial<RoleSpell> & { id?: string }) {
  return {
    id: "?",
    personId: "janina",
    companyId: "pzo",
    role: null,
    start: null,
    end: null,
    ...fields,
  };
}

/** Which spells a list keeps, by id, so the assertions read as the list. */
function kept(spells: ReturnType<typeof spell>[]): string[] {
  return withoutRedundantRoleless(spells, (s) => s).map((s) => s.id);
}

describe("withoutRedundantRoleless", () => {
  it("drops the role-less copy of a prokura entered the same day", () => {
    // The report: one appointment from 2026-07-14, uploaded once without a
    // role and once as „Prokurent", both still open.
    expect(
      kept([
        spell({ id: "bez-funkcji", start: "2026-07-14" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2026-07-14" }),
      ]),
    ).toEqual(["prokurent"]);
  });

  it("keeps a role-less stint that ended years before the prokura", () => {
    // Two posts, not one post twice: nothing about the first says it was the
    // prokura, and the dates say it was not.
    expect(
      kept([
        spell({ id: "wczesniej", start: "2012-03-01", end: "2015-06-30" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2026-07-14" }),
      ]),
    ).toEqual(["wczesniej", "prokurent"]);
  });

  it("keeps a role-less stint that ended the day the named one began", () => {
    // A change of function on one day - some other post until the morning the
    // prokura began - is two posts, not one filed twice.
    expect(
      kept([
        spell({ id: "do-2021", start: "2012-05-21", end: "2021-01-21" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2021-01-21" }),
      ]),
    ).toEqual(["do-2021", "prokurent"]);
  });

  it("drops a role-less spell that overlaps a prokura from another day", () => {
    expect(
      kept([
        spell({ id: "bez-funkcji", start: "2026-06-05" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2025-05-22" }),
      ]),
    ).toEqual(["prokurent"]);
  });

  it("keeps a role-less post beside a rada nadzorcza seat", () => {
    // The old pipeline named a supervisory seat all along, so a role-less
    // spell beside one is some other post - a prokura, at Grupa Azoty.
    expect(
      kept([
        spell({ id: "bez-funkcji", start: "2026-06-05" }),
        spell({ id: "rada", role: "Rada Nadzorcza", start: "2025-05-22" }),
      ]),
    ).toEqual(["bez-funkcji", "rada"]);
  });

  it("keeps a prokura taken the day a zarząd seat ended, beside a stale copy of the seat", () => {
    // ESV9: the zarząd seat stored once closed and once still open, and the
    // prokura that followed it stored with no role. The open copy makes the
    // prokura look like it overlaps the seat; it is still a different post.
    expect(
      kept([
        spell({
          id: "zarzad",
          role: "Zarząd",
          start: "2014-09-25",
          end: "2026-06-19",
        }),
        spell({
          id: "zarzad-nieaktualny",
          role: "Zarząd",
          start: "2014-09-25",
        }),
        spell({ id: "prokura", start: "2026-06-19" }),
      ]),
    ).toEqual(["zarzad", "zarzad-nieaktualny", "prokura"]);
  });

  it("keeps a receivership that followed a zarząd seat", () => {
    // A court-appointed receiver after the board went: the old pipeline wrote
    // KRS_RECEIVER with no role too, and it is nobody's copy of anything.
    expect(
      kept([
        spell({ id: "zarzad", role: "Zarząd", start: "2025-05-28" }),
        spell({ id: "zarzadca", start: "2026-07-14" }),
      ]),
    ).toEqual(["zarzad", "zarzadca"]);
  });

  it("drops the role-less copy of a pełnomocnik too", () => {
    expect(
      kept([
        spell({ id: "bez-funkcji", start: "2024-03-01" }),
        spell({ id: "pelnomocnik", role: "Pełnomocnik", start: "2024-03-01" }),
      ]),
    ).toEqual(["pelnomocnik"]);
  });

  it("keeps a role-less relation with no dates at all", () => {
    // Nothing about it says which post it is - and somebody adding one by
    // hand, with no role and no dates, should not see it vanish on save.
    expect(
      kept([
        spell({ id: "bez-dat" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2026-07-14" }),
      ]),
    ).toEqual(["bez-dat", "prokurent"]);
  });

  it("drops an open copy whose named twin has since closed", () => {
    // Same start, so same appointment. The role-less copy was written before
    // the post ended; keeping it would put somebody who has left on the board.
    expect(
      kept([
        spell({ id: "bez-funkcji", start: "2025-08-25" }),
        spell({
          id: "prokurent",
          role: "Prokurent",
          start: "2025-08-25",
          end: "2026-03-03",
        }),
      ]),
    ).toEqual(["prokurent"]);
  });

  it("keeps a role-less spell with nothing named beside it", () => {
    // „Funkcja niepodana w rejestrze" is all anybody knows about this post.
    expect(kept([spell({ id: "jedyny", start: "2023-02-01" })])).toEqual([
      "jedyny",
    ]);
  });

  it("does not let another person's role, or another company's, stand in", () => {
    expect(
      kept([
        spell({ id: "janina", start: "2026-07-14" }),
        spell({
          id: "ktos-inny",
          personId: "ktos-inny",
          role: "Prokurent",
          start: "2026-07-14",
        }),
        spell({
          id: "gdzie-indziej",
          companyId: "mpgk",
          role: "Prokurent",
          start: "2026-07-14",
        }),
      ]),
    ).toEqual(["janina", "ktos-inny", "gdzie-indziej"]);
  });

  it("reads a blank role as none, the way /api/edges/create writes it", () => {
    expect(
      kept([
        spell({ id: "pusty", role: "  ", start: "2026-07-14" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2026-07-14" }),
      ]),
    ).toEqual(["prokurent"]);
  });

  it("leaves two named spells alone, however much they overlap", () => {
    // Somebody on the zarząd and a prokurent at once holds two posts.
    expect(
      kept([
        spell({ id: "zarzad", role: "Zarząd", start: "2020-01-01" }),
        spell({ id: "prokurent", role: "Prokurent", start: "2020-01-01" }),
      ]),
    ).toEqual(["zarzad", "prokurent"]);
  });

  it("passes through what is not a spell, in order", () => {
    const items = ["kandydatura", "bez-funkcji", "artykul", "prokurent"];
    const spells: Record<string, RoleSpell> = {
      "bez-funkcji": spell({ start: "2026-07-14" }),
      prokurent: spell({ role: "Prokurent", start: "2026-07-14" }),
    };
    expect(withoutRedundantRoleless(items, (item) => spells[item])).toEqual([
      "kandydatura",
      "artykul",
      "prokurent",
    ]);
  });
});

describe("spellsOverlap", () => {
  it("counts an undated spell as overlapping, since nothing shows it apart", () => {
    expect(
      spellsOverlap(
        spell({}),
        spell({ role: "Zarząd", start: "2026-07-03", end: "2026-08-01" }),
      ),
    ).toBe(true);
  });

  it("tells apart a spell that ended before the other began", () => {
    expect(
      spellsOverlap(
        spell({ end: "2015-01-01" }),
        spell({ role: "Zarząd", start: "2020-01-01" }),
      ),
    ).toBe(false);
  });

  it("does not compare a date that is not an ISO day as a string", () => {
    // "2016" would sort before "2016-05-01" and so look like an earlier end;
    // it is a date nobody can place, which is the same as no date.
    expect(
      spellsOverlap(
        spell({ start: "2010-01-01", end: "2016" }),
        spell({ role: "Zarząd", start: "2016-05-01" }),
      ),
    ).toBe(true);
  });
});

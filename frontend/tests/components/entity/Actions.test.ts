import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { h } from "vue";
import { VTooltip } from "vuetify/components";
import { mdiGraphOutline, mdiHistory } from "@mdi/js";
import EntityActions from "../../../app/components/entity/Actions.vue";
import ButtonIconAction from "../../../app/components/button/IconAction.vue";
import ButtonProposeChange from "../../../app/components/button/ProposeChange.vue";

/** The row as a page fills it: „Zaproponuj zmianę”, a link of the page's own,
 * and - where `tools` is set - an admin's tool after them. */
function mountRow(tools = false) {
  return mountSuspended(EntityActions, {
    slots: {
      default: () => [
        h(ButtonProposeChange, { "data-testid": "propose" }),
        h(ButtonIconAction, {
          icon: mdiGraphOutline,
          label: "Graf powiązań",
          "data-testid": "graph",
        }),
      ],
      ...(tools
        ? {
            tools: () =>
              h(ButtonIconAction, {
                icon: mdiHistory,
                label: "Rewizje",
                "data-testid": "revisions",
              }),
          }
        : {}),
    },
  });
}

/** The row's style block. No stylesheet is applied in the test DOM, so a rule
 * scoped to a media query is read from the file, as EntityDetailsCard.test.ts
 * reads its own. */
const RELATIVE = "app/components/entity/Actions.vue";
const style = (() => {
  const source = readFileSync(
    existsSync(resolve(process.cwd(), RELATIVE))
      ? resolve(process.cwd(), RELATIVE)
      : resolve(process.cwd(), "frontend", RELATIVE),
    "utf8",
  );
  return source
    .slice(source.indexOf("<style"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
})();

/** The phone's block of the style, braces matched. */
function phoneBlock(): string {
  const head = "@media (max-width: 599.98px) {";
  const start = style.indexOf(head);
  if (start < 0) return "";
  let depth = 1;
  let at = start + head.length;
  while (depth > 0 && at < style.length) {
    if (style[at] === "{") depth++;
    if (style[at] === "}") depth--;
    at++;
  }
  return style.slice(start + head.length, at - 1);
}

/** The row of actions under an entity's name, one for a person's page and a
 * company's (Szymon's 2026-10-23 unification of the two rounds). */
describe("EntityActions", () => {
  it("labels every button in it, where elsewhere the same button is an icon", async () => {
    // `ButtonIconAction` learns from the tree that it is in the row: the
    // buttons come from the pages and from components of their own, none of
    // which knows where it is drawn.
    const row = await mountRow();
    const graph = row.get("[data-testid='graph']");
    expect(graph.text()).toBe("Graf powiązań");
    expect(graph.classes()).toContain("v-btn--variant-tonal");
    expect(graph.classes()).not.toContain("v-btn--icon");

    const alone = await mountSuspended(ButtonIconAction, {
      props: { icon: mdiGraphOutline, label: "Graf powiązań" },
    });
    expect(alone.get(".v-btn").classes()).toContain("v-btn--icon");
    // Its name is still in the DOM for a screen reader, only clipped.
    expect(alone.get(".visually-hidden").text()).toBe("Graf powiązań");
  });

  it("says on hover what a label cannot, and nothing that only repeats it", async () => {
    // On a computer the label stands beside the icon, so a tooltip saying the
    // label again would be noise; one with more to say keeps it.
    const row = await mountSuspended(EntityActions, {
      slots: {
        default: () => [
          h(ButtonIconAction, {
            icon: mdiGraphOutline,
            label: "Graf powiązań",
          }),
          h(ButtonIconAction, {
            icon: mdiHistory,
            label: "Ta strona to duplikat",
            tooltip: "Ta strona to duplikat - scal ją z tą drugą",
          }),
        ],
      },
    });

    const [plain, explained] = row.findAllComponents(VTooltip);
    expect(plain!.props("disabled")).toBe(true);
    expect(explained!.props("disabled")).toBe(false);
    expect(explained!.props("text")).toBe(
      "Ta strona to duplikat - scal ją z tą drugą",
    );
  });

  it("puts „Zaproponuj zmianę” first, in the control tint with its pencil in amber", async () => {
    const row = await mountRow();
    const buttons = row.findAll(".v-btn");
    expect(buttons.map((button) => button.text())).toEqual([
      "Zaproponuj zmianę",
      "Graf powiązań",
    ]);

    const propose = row.get("[data-testid='propose']");
    expect(propose.classes()).toContain("propose-change");
    expect(propose.classes()).toContain("v-btn--variant-tonal");
    expect(propose.get(".v-btn__prepend .v-icon").classes()).toContain(
      "text-warning",
    );
  });

  it("sets the tools apart from the reader's actions, after them", async () => {
    const row = await mountRow(true);

    const tools = row.get(".entity-actions__tools");
    expect(tools.find("[data-testid='revisions']").exists()).toBe(true);
    expect(tools.find("[data-testid='propose']").exists()).toBe(false);
    // Labelled in their group too: the injection reaches every button in the
    // row, whichever slot it came through.
    expect(tools.get("[data-testid='revisions']").text()).toBe("Rewizje");
    expect(row.get(".entity-actions").element.lastElementChild).toBe(
      tools.element,
    );
  });

  it("draws no line of tools for a reader who has none", async () => {
    const row = await mountRow();

    expect(row.find(".entity-actions__tools").exists()).toBe(false);
  });

  it("gives the tools a line of their own at every width, not only on a phone", () => {
    // At 1024 an admin found „Rewizje” under the vote on a person's page and
    // beside the links on a company's.
    const phone = phoneBlock();
    expect(style.replace(phone, "")).toMatch(
      /\.entity-actions__tools \{\s*flex-basis: 100%;\s*\}/,
    );
    expect(phone).not.toContain("flex-basis");
  });

  it("folds every button but „Zaproponuj zmianę” to a 40px square on a phone", () => {
    const phone = phoneBlock();
    expect(phone).toMatch(
      /\.entity-actions :deep\(\.v-btn:not\(\.v-btn--icon, \.propose-change\)\) \{[^}]*width: 40px;/,
    );
    // The label is clipped, not removed: `display: none` would take the
    // button's name from a screen reader along with the pixels.
    expect(phone).toMatch(
      /:deep\(\.v-btn:not\(\.v-btn--icon, \.propose-change\) > \.v-btn__content\) \{[^}]*clip: rect\(0, 0, 0, 0\);/,
    );
    expect(phone).not.toContain("display: none");
  });
});

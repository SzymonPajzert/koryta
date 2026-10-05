import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import NominationForm from "../../../../app/components/admin/users/NominationForm.vue";
import type { AdminUserRow } from "../../../../shared/userAdmin";
import { daysBefore, userRow } from "./rows";

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>;

async function mountForm(
  row: AdminUserRow,
  submit = vi.fn(async () => true),
): Promise<{ wrapper: Wrapper; submit: typeof submit }> {
  const wrapper = await mountSuspended(NominationForm, {
    props: { row, submit },
  });
  return { wrapper, submit };
}

const radio = (wrapper: Wrapper, level: string) =>
  wrapper.get(`[data-level="${level}"] input`);

/** What a click on a Vuetify radio or checkbox amounts to: the input's own
 * checked state, then the `input` event it listens for. */
async function choose(wrapper: Wrapper, level: string) {
  const input = radio(wrapper, level);
  (input.element as HTMLInputElement).checked = true;
  await input.trigger("input");
  await flushPromises();
}

async function setTrial(wrapper: Wrapper, value: boolean) {
  const input = wrapper.get("[data-trial-checkbox] input");
  (input.element as HTMLInputElement).checked = value;
  await input.trigger("input");
  await flushPromises();
}

async function typeReason(wrapper: Wrapper, text: string) {
  await wrapper.get("[data-nomination-reason] textarea").setValue(text);
}

const sendButton = (wrapper: Wrapper) => wrapper.get("[data-nominate]");
const isDisabled = (wrapper: Wrapper) =>
  sendButton(wrapper).attributes("disabled") !== undefined;

describe("AdminUsersNominationForm", () => {
  it("offers every level with its hint and marks the current one", async () => {
    const { wrapper } = await mountForm(
      userRow("a", {
        current: { level: "trusted", trial: false, owner: false },
      }),
    );
    const text = wrapper.text();
    expect(text).toContain("Uczestnik");
    expect(text).toContain("Zaufany uczestnik");
    expect(text).toContain("Zespół");
    expect(text).toContain("Administrator");
    expect(text).toContain("Import może publikować bez przeglądu");
    expect(wrapper.get('[data-level="trusted"]').text()).toContain("(teraz)");
    expect(
      (radio(wrapper, "trusted").element as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("needs a change and a reason of at least three characters", async () => {
    const { wrapper } = await mountForm(userRow("a"));
    // The account as it is: nothing to send.
    expect(isDisabled(wrapper)).toBe(true);
    expect(wrapper.get("[data-nomination-preview]").text()).toBe(
      "Bez zmian - konto ma już tę rolę.",
    );

    await choose(wrapper, "trusted");
    expect(wrapper.get("[data-nomination-preview]").text()).toBe(
      "Uczestnik → Zaufany uczestnik po zatwierdzeniu",
    );
    expect(isDisabled(wrapper)).toBe(true);

    await typeReason(wrapper, "  ok  ");
    expect(isDisabled(wrapper)).toBe(true);

    await typeReason(wrapper, "Pomaga od miesięcy.");
    expect(isDisabled(wrapper)).toBe(false);

    await typeReason(wrapper, "x".repeat(501));
    expect(isDisabled(wrapper)).toBe(true);
  });

  it("ticks the trial for somebody becoming an administrator, and only shows it for administrators", async () => {
    const { wrapper } = await mountForm(userRow("a"));
    expect(wrapper.find("[data-trial-checkbox]").exists()).toBe(false);

    await choose(wrapper, "admin");
    const box = wrapper.get("[data-trial-checkbox] input");
    expect((box.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.get("[data-nomination-preview]").text()).toBe(
      "Uczestnik → Administrator (okres próbny) po zatwierdzeniu",
    );

    await choose(wrapper, "datascience");
    expect(wrapper.find("[data-trial-checkbox]").exists()).toBe(false);
  });

  it("leaves an established administrator's trial unticked", async () => {
    const { wrapper } = await mountForm(
      userRow("a", { current: { level: "admin", trial: false, owner: false } }),
    );
    const box = wrapper.get("[data-trial-checkbox] input");
    expect((box.element as HTMLInputElement).checked).toBe(false);
    // Putting them on trial is a change in its own right.
    await setTrial(wrapper, true);
    await typeReason(wrapper, "Sporo pomyłek ostatnio.");
    expect(isDisabled(wrapper)).toBe(false);
  });

  it("sends the level, the trial and the trimmed reason, and clears the reason once it went through", async () => {
    const { wrapper, submit } = await mountForm(userRow("a"));
    await choose(wrapper, "admin");
    await typeReason(wrapper, "  Przegląda kolejkę codziennie.  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(submit).toHaveBeenCalledWith({
      level: "admin",
      trial: true,
      reason: "Przegląda kolejkę codziennie.",
    });
    expect(
      (
        wrapper.get("[data-nomination-reason] textarea")
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });

  it("keeps the reason when the server said no", async () => {
    const { wrapper } = await mountForm(
      userRow("a"),
      vi.fn(async () => false),
    );
    await choose(wrapper, "trusted");
    await typeReason(wrapper, "Pomaga od miesięcy.");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(
      (
        wrapper.get("[data-nomination-reason] textarea")
          .element as HTMLTextAreaElement
      ).value,
    ).toBe("Pomaga od miesięcy.");
  });

  it("warns about an unverified address and will not send a level that needs one", async () => {
    const { wrapper } = await mountForm(userRow("a", { emailVerified: false }));
    await typeReason(wrapper, "Pomaga od miesięcy.");

    await choose(wrapper, "trusted");
    expect(wrapper.find("[data-unverified-warning]").exists()).toBe(false);
    expect(isDisabled(wrapper)).toBe(false);

    await choose(wrapper, "datascience");
    expect(wrapper.get("[data-unverified-warning]").text()).toContain(
      "nie jest potwierdzony",
    );
    expect(isDisabled(wrapper)).toBe(true);
  });

  it("starts from a waiting nomination and says when the choice is the same", async () => {
    const { wrapper } = await mountForm(
      userRow("a", {
        nomination: {
          desired: {
            level: "datascience",
            trial: false,
            reason: "Prośba z /pomoc.",
            by: "me",
            byName: "Ja",
            at: daysBefore(1),
          },
          pending: true,
          applyError: null,
        },
      }),
    );
    expect(
      (radio(wrapper, "datascience").element as HTMLInputElement).checked,
    ).toBe(true);
    expect(wrapper.get("[data-nomination-preview]").text()).toBe(
      "Ta nominacja już czeka na skrypt.",
    );
    await typeReason(wrapper, "Jednak nie.");
    expect(isDisabled(wrapper)).toBe(true);

    // Back to what the account has is a change of the wish.
    await choose(wrapper, "normal");
    expect(isDisabled(wrapper)).toBe(false);
  });

  it("starts somebody who asked for access at the team's level", async () => {
    const { wrapper } = await mountForm(
      userRow("a", {
        accessRequest: {
          reason: "Chcę dodawać artykuły z rozszerzenia.",
          source: "rozszerzenie",
          createdAt: daysBefore(2),
          status: "open",
        },
      }),
    );
    expect(
      (radio(wrapper, "datascience").element as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("keeps the owner an administrator", async () => {
    const { wrapper } = await mountForm(
      userRow("owner", {
        current: { level: "admin", trial: false, owner: true },
      }),
    );
    expect(wrapper.text()).toContain("To konto właściciela serwisu");
    for (const level of ["normal", "trusted", "datascience"]) {
      expect(radio(wrapper, level).attributes("disabled")).toBeDefined();
    }
    expect(radio(wrapper, "admin").attributes("disabled")).toBeUndefined();
  });
});

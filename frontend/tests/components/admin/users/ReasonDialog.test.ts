import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import ReasonDialog from "../../../../app/components/admin/users/ReasonDialog.vue";

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>;

let wrapper: Wrapper | null = null;

/** Mounted closed and then opened, the way a row drives it - the reason is
 * cleared on that transition. Attached to the document, because the dialog's
 * content is teleported out of the component. */
async function openDialog(props: Record<string, unknown>) {
  wrapper = await mountSuspended(ReasonDialog, {
    attachTo: document.body,
    props: {
      modelValue: false,
      title: "Ukryć profil?",
      confirmLabel: "Ukryj profil",
      limits: { min: 3, max: 20 },
      ...props,
    },
  });
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

const textarea = () =>
  document.body.querySelector<HTMLTextAreaElement>(
    "[data-reason-input] textarea",
  )!;
const confirm = () =>
  document.body.querySelector<HTMLButtonElement>("[data-reason-confirm]")!;

async function type(text: string) {
  textarea().value = text;
  textarea().dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("AdminUsersReasonDialog", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("asks for a reason within the bounds when one is required", async () => {
    await openDialog({
      required: true,
      text: "Profil przestanie się otwierać.",
    });
    expect(document.body.textContent).toContain("Ukryć profil?");
    expect(document.body.textContent).toContain(
      "Profil przestanie się otwierać.",
    );
    expect(confirm().disabled).toBe(true);

    await type(" ab ");
    expect(confirm().disabled).toBe(true);
    await type("Obraźliwa");
    expect(confirm().disabled).toBe(false);
    await type("x".repeat(21));
    expect(confirm().disabled).toBe(true);
  });

  it("lets an optional reason be left out and sends what was typed, trimmed", async () => {
    const dialog = await openDialog({ required: false });
    expect(confirm().disabled).toBe(false);

    await type("  Za wcześnie.  ");
    confirm().click();
    await flushPromises();
    expect(dialog.emitted("confirm")).toEqual([["Za wcześnie."]]);
  });

  it("starts empty every time it opens", async () => {
    const dialog = await openDialog({ required: true });
    await type("Poprzednie konto");
    await dialog.setProps({ modelValue: false });
    await flushPromises();
    await dialog.setProps({ modelValue: true });
    await flushPromises();
    expect(textarea().value).toBe("");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import DialogLogin from "../../../app/components/dialog/Login.vue";
import { useSignInOnScreen } from "../../../app/composables/signInOnScreen";

/** The dialog's content, in place, while it is open: the real one is an
 * overlay teleported out of the wrapper. */
const DialogStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-dialog": "" }, slots.default?.())
        : null;
  },
});

/** The note the dialog closes with, in place while it is up: the real one
 * is an overlay too, and goes by itself after 6 s. */
const NoteStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("div", { "data-note": "" }, slots.default?.())
        : null;
  },
});

/** The form: a button that signs in, as the real one does once Firebase
 * has. */
const FormStub = defineComponent({
  emits: ["success"],
  setup(_, { emit }) {
    return () =>
      h(
        "button",
        { type: "button", "data-sign-in": "", onClick: () => emit("success") },
        "Zaloguj się",
      );
  },
});

/** The newsletter step, answered: the dialog closes with the answer's
 * note. */
const StepStub = defineComponent({
  emits: ["done"],
  setup(_, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          "data-answer": "",
          onClick: () => emit("done", "Zapisano."),
        },
        "Tak, zapisz mnie",
      );
  },
});

const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function mount(props: { form?: "login" | "signup" } = {}) {
  const wrapper = await mountSuspended(DialogLogin, {
    props: { hideActivator: true, modelValue: false, ...props },
    global: {
      stubs: {
        VDialog: DialogStub,
        FormLoginForm: true,
        MailNewsletterSignInStep: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The dialog with a form that signs in and a newsletter step that is
 * answered, and its note in place. */
async function mountSigningIn() {
  const wrapper = await mountSuspended(DialogLogin, {
    props: { hideActivator: true, modelValue: false },
    global: {
      stubs: {
        VDialog: DialogStub,
        VSnackbar: NoteStub,
        FormLoginForm: FormStub,
        MailNewsletterSignInStep: StepStub,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

type Mounted = Awaited<ReturnType<typeof mount>>;

const title = (wrapper: Mounted) =>
  wrapper.get("[data-dialog] .v-card-title > span").text();

/** „Nie masz konta? Zarejestruj się”, or the way back. */
const switchForm = (wrapper: Mounted) =>
  wrapper.get("[data-dialog] .v-card-text .mb-4 a").trigger("click");

async function reopen(wrapper: Mounted) {
  await wrapper.setProps({ modelValue: false });
  await wrapper.setProps({ modelValue: true });
}

/** The sign-in dialog. A button that says „Rejestracja” opens it on the
 * registration form, as /login?konto=nowe does, so a reader with no account
 * does not land on a form for one. */
describe("DialogLogin", () => {
  it("opens on the registration form each time it is opened for one", async () => {
    const wrapper = await mount({ form: "signup" });
    await wrapper.setProps({ modelValue: true });

    expect(title(wrapper)).toBe("Rejestracja");

    await switchForm(wrapper);
    expect(title(wrapper)).toBe("Zaloguj się");
    await reopen(wrapper);

    expect(title(wrapper)).toBe("Rejestracja");
  });

  it("opens on the login form when opened for it", async () => {
    const wrapper = await mount({ form: "signup" });
    await wrapper.setProps({ modelValue: true });
    await wrapper.setProps({ modelValue: false });

    await wrapper.setProps({ form: "login" });
    await wrapper.setProps({ modelValue: true });

    expect(title(wrapper)).toBe("Zaloguj się");
  });

  // The app bar's, and every caller that names no form.
  it("opens on whichever form it was left on when no form is named", async () => {
    const wrapper = await mount();
    await wrapper.setProps({ modelValue: true });
    expect(title(wrapper)).toBe("Zaloguj się");

    await switchForm(wrapper);
    await reopen(wrapper);

    expect(title(wrapper)).toBe("Rejestracja");
  });
});

/** Whether a sign-in dialog is on screen, for a page whose own line would go
 * where the dialog's note goes, at the bottom of the window, and over the
 * dialog: /oswiadczenia holds its line until the dialog and its note have
 * gone (`useSignInOnScreen`). */
describe("DialogLogin on screen", () => {
  it("is on screen while open, and once closed until the note it closed with has gone", async () => {
    const onScreen = useSignInOnScreen();
    const wrapper = await mountSigningIn();
    expect(onScreen.value).toBe(false);

    await wrapper.setProps({ modelValue: true });
    expect(onScreen.value).toBe(true);

    await wrapper.get("[data-sign-in]").trigger("click");
    await vi.waitFor(
      () => expect(wrapper.find("[data-answer]").exists()).toBe(true),
      { timeout: 3000 },
    );
    await wrapper.get("[data-answer]").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-dialog]").exists()).toBe(false);
    expect(wrapper.get("[data-note]").text()).toBe("Zapisano.");
    expect(onScreen.value).toBe(true);

    wrapper.findComponent(NoteStub).vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(wrapper.find("[data-note]").exists()).toBe(false);
    expect(onScreen.value).toBe(false);
  });

  it("is off screen once closed without a sign-in, and once gone while open", async () => {
    const onScreen = useSignInOnScreen();
    const closed = await mountSigningIn();
    await closed.setProps({ modelValue: true });
    await closed.setProps({ modelValue: false });

    expect(onScreen.value).toBe(false);

    const gone = await mountSigningIn();
    await gone.setProps({ modelValue: true });
    expect(onScreen.value).toBe(true);
    gone.unmount();
    mounted.splice(mounted.indexOf(gone), 1);

    expect(onScreen.value).toBe(false);
  });
});

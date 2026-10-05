import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { defineComponent, h, ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import Row from "../../../../app/components/admin/users/Row.vue";
import type {
  UserAction,
  UserDetailState,
  UserSectionKey,
} from "../../../../app/composables/adminUsers";
import type { AdminUserRow } from "../../../../shared/userAdmin";
import { NOW, daysBefore, userDetail, userRow } from "./rows";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

/** The dialog, drawn in place while open: a title, what the decision does, a
 * field and the confirm button. The real one is teleported and has its own
 * spec. */
const ReasonDialogStub = defineComponent({
  props: {
    modelValue: Boolean,
    title: { type: String, default: "" },
    text: { type: String, default: "" },
    confirmLabel: { type: String, default: "" },
    required: Boolean,
  },
  emits: ["confirm", "update:modelValue"],
  setup(props, { emit }) {
    const reason = ref("");
    return () =>
      props.modelValue
        ? h("div", { "data-dialog": "", "data-required": props.required }, [
            h("span", { "data-dialog-title": "" }, props.title),
            h("p", { "data-dialog-text": "" }, props.text),
            h("textarea", {
              "data-dialog-reason": "",
              value: reason.value,
              onInput: (event: Event) =>
                (reason.value = (event.target as HTMLTextAreaElement).value),
            }),
            h(
              "button",
              {
                "data-dialog-confirm": "",
                onClick: () => emit("confirm", reason.value),
              },
              props.confirmLabel,
            ),
          ])
        : null;
  },
});

type Act = Mock<(action: UserAction) => Promise<boolean>>;

async function mountRow(
  row: AdminUserRow,
  options: {
    section?: UserSectionKey;
    expanded?: boolean;
    self?: boolean;
    detail?: UserDetailState;
    act?: Act;
  } = {},
) {
  const act: Act = options.act ?? vi.fn(async () => true);
  const wrapper = await mountSuspended(Row, {
    props: {
      row,
      section: options.section ?? "others",
      now: NOW,
      self: options.self ?? false,
      detail: options.detail,
      expanded: options.expanded ?? false,
      act,
    },
    global: { stubs: { AdminUsersReasonDialog: ReasonDialogStub } },
  });
  return { wrapper, act };
}

type Wrapper = Awaited<ReturnType<typeof mountRow>>["wrapper"];

const trialAdmin = { level: "admin", trial: true, owner: false } as const;

const pendingNomination = (): AdminUserRow["nomination"] => ({
  desired: {
    level: "datascience",
    trial: false,
    reason: "Prosiła o dostęp do rozszerzenia.",
    by: "admin-uid",
    byName: "Anna Admin",
    at: daysBefore(3),
  },
  pending: true,
  applyError: null,
});

const quickKeys = (wrapper: Wrapper) =>
  wrapper.findAll("[data-quick]").map((b) => b.attributes("data-quick"));

describe("AdminUsersRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says on the line who it is, the role, sign-ins, when last here and the 90 days", async () => {
    const { wrapper } = await mountRow(
      userRow("u1", {
        displayName: "Marta Nowicka",
        current: { level: "datascience", trial: false, owner: false },
        lastRefreshAt: daysBefore(3),
        signIns: {
          count: 5,
          activeDays: 22,
          firstSeenAt: daysBefore(40),
          lastSeenAt: daysBefore(1),
        },
        activity: {
          counts: { vote: 30, revision: 10, noteSource: 2, publication: 0 },
          total: 42,
          lastActiveAt: daysBefore(1),
        },
      }),
      { section: "team" },
    );
    const line = wrapper.get("[data-row-toggle]");
    expect(line.text()).toContain("Marta Nowicka");
    expect(wrapper.get("[data-role-chip]").text()).toBe("Zespół");
    expect(wrapper.find("[data-pending-chip]").exists()).toBe(false);
    expect(wrapper.get("[data-sign-ins]").text()).toBe("5 logowań · 22 dni");
    // The later of the token refresh and the recorded visit.
    expect(wrapper.get("[data-last-seen]").text()).toBe("wczoraj");
    expect(wrapper.get("[data-activity]").text()).toBe("42 w 90 dni");
    expect(wrapper.get("#u-u1").classes()).toContain("arow--tone-sage");
  });

  it("marks a waiting nomination with the chip", async () => {
    const { wrapper } = await mountRow(
      userRow("u1", { nomination: pendingNomination() }),
      { section: "pending" },
    );
    expect(wrapper.get("[data-pending-chip]").text()).toBe("czeka na skrypt");
    expect(wrapper.get("#u-u1").classes()).toContain("arow--tone-warning");
  });

  it("counts a trial's days and flags one past the review date", async () => {
    const { wrapper } = await mountRow(
      userRow("u1", { current: trialAdmin, trialStartedAt: daysBefore(41) }),
      { section: "trials" },
    );
    const tag = wrapper.get("[data-trial-days]");
    expect(tag.text()).toBe("od 41 dni");
    expect(tag.attributes("data-trial-due")).toBe("true");
    expect(wrapper.get("[data-role-chip]").text()).toBe(
      "Administrator (okres próbny)",
    );
    expect(wrapper.get("#u-u1").classes()).toContain("arow--tone-danger");

    const { wrapper: fresh } = await mountRow(
      userRow("u2", { current: trialAdmin, trialStartedAt: daysBefore(1) }),
      { section: "trials" },
    );
    expect(fresh.get("[data-trial-days]").text()).toBe("od 1 dnia");
    expect(fresh.get("[data-trial-days]").attributes("data-trial-due")).toBe(
      "false",
    );
  });

  it("puts the decision its section is about on the line", async () => {
    const request = {
      reason: "Chcę dodawać artykuły.",
      source: "pomoc" as const,
      createdAt: daysBefore(1),
      status: "open" as const,
    };
    const cases: [AdminUserRow, UserSectionKey, string[]][] = [
      [userRow("r", { accessRequest: request }), "requests", ["dismiss"]],
      [
        userRow("p", { nomination: pendingNomination() }),
        "pending",
        ["withdraw"],
      ],
      [
        userRow("t", { current: trialAdmin, trialStartedAt: daysBefore(5) }),
        "trials",
        ["graduate", "revoke"],
      ],
      [
        userRow("a", {
          current: { level: "admin", trial: false, owner: false },
        }),
        "team",
        [],
      ],
    ];
    for (const [row, section, expected] of cases) {
      const { wrapper } = await mountRow(row, { section });
      expect(quickKeys(wrapper), section).toEqual(expected);
    }
  });

  it("offers nothing to decide on one's own account or a robot's", async () => {
    const { wrapper: own } = await mountRow(
      userRow("me", { current: trialAdmin, trialStartedAt: daysBefore(5) }),
      { section: "trials", self: true, expanded: true },
    );
    expect(quickKeys(own)).toEqual([]);
    expect(own.find("[data-decision]").exists()).toBe(false);
    expect(own.find("[data-nomination-form]").exists()).toBe(false);
    expect(own.get("[data-no-nomination]").text()).toContain(
      "nominować samego siebie nie można",
    );

    const { wrapper: robot } = await mountRow(
      userRow("pipeline-krs", { robot: true }),
      { expanded: true },
    );
    expect(robot.get("#u-pipeline-krs").classes()).toContain("arow--dimmed");
    expect(robot.find("[data-nomination-form]").exists()).toBe(false);
    expect(robot.find("[data-moderation]").exists()).toBe(false);
    expect(robot.get("[data-no-nomination]").text()).toContain(
      "Konto techniczne",
    );
  });

  it("ends a trial with a nomination to administrator, once a reason is given", async () => {
    const { wrapper, act } = await mountRow(
      userRow("t", { current: trialAdmin, trialStartedAt: daysBefore(40) }),
      { section: "trials" },
    );
    await wrapper.get('[data-quick="graduate"]').trigger("click");
    expect(wrapper.get("[data-dialog-title]").text()).toBe(
      "Zakończyć okres próbny?",
    );
    expect(wrapper.get("[data-dialog]").attributes("data-required")).toBe(
      "true",
    );
    // Ending a trial takes away only `newAdmin`, and the script does not sign
    // anybody out for that - so the dialog must not warn that it will.
    expect(wrapper.get("[data-dialog-text]").text()).not.toMatch(/wylog|sesj/i);

    await wrapper
      .get("[data-dialog-reason]")
      .setValue("Rozsądne decyzje przez miesiąc.");
    await wrapper.get("[data-dialog-confirm]").trigger("click");
    await flushPromises();

    expect(act).toHaveBeenCalledWith({
      kind: "nominate",
      body: {
        uid: "t",
        level: "admin",
        trial: false,
        reason: "Rozsądne decyzje przez miesiąc.",
      },
    });
    // Closed once it went through.
    expect(wrapper.find("[data-dialog]").exists()).toBe(false);
  });

  it("takes the rights away with a nomination to a plain account, and stays open on a refusal", async () => {
    const act: Act = vi.fn(async () => false);
    const { wrapper } = await mountRow(
      userRow("t", { current: trialAdmin, trialStartedAt: daysBefore(40) }),
      { section: "trials", act },
    );
    await wrapper.get('[data-quick="revoke"]').trigger("click");
    // Taking the rights away does take claims, so here the sign-out is real.
    expect(wrapper.get("[data-dialog-text]").text()).toContain("wylogowane");
    await wrapper.get("[data-dialog-reason]").setValue("Publikuje bez źródeł.");
    await wrapper.get("[data-dialog-confirm]").trigger("click");
    await flushPromises();

    expect(act).toHaveBeenCalledWith({
      kind: "nominate",
      body: {
        uid: "t",
        level: "normal",
        trial: false,
        reason: "Publikuje bez źródeł.",
      },
    });
    expect(wrapper.find("[data-dialog]").exists()).toBe(true);
  });

  it("withdraws and dismisses without a reason when none is given", async () => {
    const { wrapper, act } = await mountRow(
      userRow("p", { nomination: pendingNomination() }),
      { section: "pending" },
    );
    await wrapper.get('[data-quick="withdraw"]').trigger("click");
    expect(wrapper.get("[data-dialog]").attributes("data-required")).toBe(
      "false",
    );
    await wrapper.get("[data-dialog-confirm]").trigger("click");
    await flushPromises();
    expect(act).toHaveBeenCalledWith({
      kind: "withdraw",
      body: { uid: "p", reason: undefined },
    });

    const { wrapper: request, act: dismiss } = await mountRow(
      userRow("r", {
        accessRequest: {
          reason: "Chcę pomagać.",
          source: "rozszerzenie",
          createdAt: daysBefore(1),
          status: "open",
        },
      }),
      { section: "requests" },
    );
    await request.get('[data-quick="dismiss"]').trigger("click");
    await request.get("[data-dialog-reason]").setValue("Najpierw pół roku.");
    await request.get("[data-dialog-confirm]").trigger("click");
    await flushPromises();
    expect(dismiss).toHaveBeenCalledWith({
      kind: "dismiss",
      body: { uid: "r", reason: "Najpierw pół roku." },
    });
  });

  it("opens on the account's facts, its request, its nomination and the script's error", async () => {
    const { wrapper } = await mountRow(
      userRow("u1", {
        email: "marta@example.com",
        emailVerified: false,
        providers: ["password"],
        accessRequest: {
          reason: "Chcę dodawać artykuły z rozszerzenia.",
          source: "rozszerzenie",
          createdAt: daysBefore(2),
          status: "open",
        },
        nomination: {
          ...pendingNomination()!,
          applyError: {
            at: daysBefore(1),
            message: "Adres e-mail nie jest potwierdzony.",
          },
        },
      }),
      { section: "requests", expanded: true },
    );
    const meta = wrapper.get(".arow__meta").text();
    expect(meta).toContain("marta@example.com");
    expect(meta).toContain("niepotwierdzony");
    expect(meta).toContain("e-mail i hasło");
    expect(wrapper.get("[data-access-request]").text()).toContain(
      "Chcę dodawać artykuły z rozszerzenia.",
    );
    expect(wrapper.get("[data-access-request]").text()).toContain(
      "z /rozszerzenie",
    );
    expect(wrapper.get("[data-nomination]").text()).toContain("Anna Admin");
    expect(wrapper.get("[data-apply-error]").text()).toContain(
      "Adres e-mail nie jest potwierdzony.",
    );
    // Every decision the state allows, in the footer, with the note.
    expect(
      wrapper
        .findAll("[data-decision]")
        .map((b) => b.attributes("data-decision")),
    ).toEqual(["dismiss", "withdraw"]);
    expect(wrapper.get(".arow__footer").text()).toContain("set_auth_claims");
  });

  it("names a seeded nomination's nominator as the migration, not by its label", async () => {
    // `set_auth_claims --seed` writes a nomination for every account that
    // already holds a role, by a label the server has no name for.
    const { wrapper } = await mountRow(
      userRow("a", {
        current: { level: "admin", trial: false, owner: false },
        nomination: {
          desired: {
            level: "admin",
            trial: false,
            reason: "Uprawnienia sprzed wprowadzenia nominacji.",
            by: "migration:set_auth_claims",
            byName: null,
            at: daysBefore(1),
          },
          pending: false,
          applyError: null,
        },
      }),
      { section: "team", expanded: true },
    );
    const nomination = wrapper.get("[data-nomination]").text();
    expect(nomination).toContain("migracja");
    expect(nomination).toContain("konto ma już tę rolę");
    expect(nomination).not.toContain("migration:");
  });

  it("shows the counts, the links and the history once the detail is in", async () => {
    const row = userRow("u1", {
      current: trialAdmin,
      trialStartedAt: daysBefore(40),
    });
    const detail = userDetail(row, {
      trial: {
        startedAt: daysBefore(40),
        days: 40,
        revisions: 14,
        decisions: 9,
      },
      links: {
        revisions: "/admin/rewizje?author=u1&status=all&automatic=all#kolejka",
        activity: "/aktywnosc?kto=u1",
        profile: "/uczestnik/marta",
      },
      history: [
        {
          id: "h1",
          kind: "nominate",
          target: "u1",
          by: "admin-uid",
          byName: "Anna Admin",
          at: daysBefore(45),
          reason: "Przegląda kolejkę codziennie.",
          from: { level: "datascience", trial: false, owner: false },
          to: { level: "admin", trial: true },
        },
        {
          id: "h2",
          kind: "apply",
          target: "u1",
          by: "script:set_auth_claims@predator",
          byName: null,
          at: daysBefore(40),
          from: { level: "datascience", trial: false, owner: false },
          to: { level: "admin", trial: true },
        },
      ],
    });
    const { wrapper } = await mountRow(row, {
      section: "trials",
      expanded: true,
      detail: { data: detail, loading: false, error: "" },
    });

    const stats = wrapper.get("[data-user-stats]");
    expect(stats.get('[data-stat="votes"]').text()).toContain("120");
    // 12 of the 16 decided: 75%.
    expect(stats.get('[data-stat="revisions"]').text()).toContain(
      "75% przyjętych",
    );
    expect(wrapper.get("[data-trial-stats]").text()).toContain(
      "propozycje zmian 14 · decyzje 9",
    );
    // Asked of the chips rather than read off an href: there is no router
    // link to render one here.
    const links = wrapper
      .get("[data-user-links]")
      .findAllComponents({ name: "VChip" })
      .map((chip: VueWrapper) => (chip.props() as { to?: unknown }).to);
    expect(links).toEqual([
      "/admin/rewizje?author=u1&status=all&automatic=all#kolejka",
      "/aktywnosc?kto=u1",
      "/uczestnik/marta",
    ]);

    const history = wrapper.findAll("[data-history-kind]");
    // Newest first.
    expect(history.map((item) => item.attributes("data-history-kind"))).toEqual(
      ["apply", "nominate"],
    );
    expect(history[0]!.text()).toContain("Nadanie uprawnień skryptem");
    expect(history[0]!.text()).toContain("skrypt uprawnień");
    expect(history[1]!.text()).toContain(
      "Zespół → Administrator (okres próbny)",
    );
    expect(history[1]!.text()).toContain("„Przegląda kolejkę codziennie.”");
  });

  it("says when the detail is loading, and offers to try again when it failed", async () => {
    const { wrapper: loading } = await mountRow(userRow("u1"), {
      expanded: true,
      detail: { data: null, loading: true, error: "" },
    });
    expect(loading.find("[data-detail-loading]").exists()).toBe(true);

    const { wrapper: failed } = await mountRow(userRow("u1"), {
      expanded: true,
      detail: { data: null, loading: false, error: "Nie udało się." },
    });
    await failed.get("[data-detail-error] button").trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("moderates only what the account has, with a reason", async () => {
    const { wrapper, act } = await mountRow(
      userRow("u1", {
        displayName: "Ktoś Obraźliwy",
        photoURL: "https://koryta.pl/api/images/abc",
        profile: { handle: "ktos", public: true, hidden: false },
      }),
      { expanded: true },
    );
    expect(
      wrapper
        .findAll("[data-moderate]")
        .map((b) => b.attributes("data-moderate")),
    ).toEqual(["removeAvatar", "resetName", "hideProfile"]);

    await wrapper.get('[data-moderate="hideProfile"]').trigger("click");
    expect(wrapper.get("[data-dialog-title]").text()).toBe("Ukryć profil?");
    await wrapper.get("[data-dialog-reason]").setValue("Obraźliwa nazwa.");
    await wrapper.get("[data-dialog-confirm]").trigger("click");
    await flushPromises();
    expect(act).toHaveBeenCalledWith({
      kind: "moderate",
      body: { uid: "u1", action: "hideProfile", reason: "Obraźliwa nazwa." },
    });

    // A Google photo is not ours to remove; a hidden profile can come back.
    const { wrapper: other } = await mountRow(
      userRow("u2", {
        displayName: null,
        photoURL: "https://lh3.googleusercontent.com/a/photo",
        profile: { handle: "u2", public: true, hidden: true },
      }),
      { expanded: true },
    );
    expect(
      other
        .findAll("[data-moderate]")
        .map((b) => b.attributes("data-moderate")),
    ).toEqual(["unhideProfile"]);

    const { wrapper: bare } = await mountRow(
      userRow("u3", { displayName: null }),
      { expanded: true },
    );
    expect(bare.find("[data-nothing-to-moderate]").exists()).toBe(true);
  });

  it("sends a nomination from the form with the account's uid", async () => {
    const { wrapper, act } = await mountRow(userRow("u1"), { expanded: true });
    const input = wrapper.get('[data-level="trusted"] input');
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("input");
    await wrapper
      .get("[data-nomination-reason] textarea")
      .setValue("Pomaga od miesięcy.");
    await wrapper.get("[data-nomination-form]").trigger("submit");
    await flushPromises();
    expect(act).toHaveBeenCalledWith({
      kind: "nominate",
      body: {
        uid: "u1",
        level: "trusted",
        trial: false,
        reason: "Pomaga od miesięcy.",
      },
    });
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import FeedTimeline from "../../../app/components/activity/FeedTimeline.vue";
import type {
  FeedActor,
  FeedBatch,
  FeedTarget,
} from "../../../shared/activityFeed";

const actor = (overrides: Partial<FeedActor> = {}): FeedActor => ({
  key: "named-1",
  uid: null,
  name: "Anna Nowak",
  named: true,
  isSelf: false,
  photoURL: null,
  newAdmin: false,
  ...overrides,
});

const target = (
  id: string,
  overrides: Partial<FeedTarget> = {},
): FeedTarget => ({
  key: id,
  type: "person",
  name: `Osoba ${id}`,
  href: `/osoba/osoba-${id}`,
  ...overrides,
});

// 12:20 UTC is 14:20 in Warsaw in September.
const batch = (overrides: Partial<FeedBatch> = {}): FeedBatch => ({
  id: "named-1:vote:2026-09-22T12:20:00.000Z",
  kind: "vote",
  actorKey: "named-1",
  firstAt: "2026-09-22T12:20:00.000Z",
  lastAt: "2026-09-22T12:20:00.000Z",
  count: 1,
  objects: { person: 1 },
  alongEdges: 0,
  targets: [target("a")],
  moreTargets: 0,
  ...overrides,
});

/** One day holding one line: what the old single-line component was, so the
 * behaviours it pinned down carry over as they were. */
const mountItem = (props: { batch?: FeedBatch; actor?: FeedActor } = {}) => {
  const line = props.batch ?? batch();
  const who = props.actor ?? actor();
  return mountSuspended(FeedTimeline, {
    props: {
      groups: [{ day: "2026-09-22", label: "Dzisiaj", batches: [line] }],
      actorOf: () => who,
    },
  });
};

type Wrapper = Awaited<ReturnType<typeof mountItem>>;

const targetNames = (wrapper: Wrapper) =>
  wrapper
    .findAll('[data-testid="feed-item-target"]')
    .map((node) => node.text());

/** Where each target link goes, read off the prop: see ContributorTable.test
 * for why an `href` is not to be trusted under the test router. */
const linkTargets = (wrapper: Wrapper) =>
  wrapper
    .findAllComponents({ name: "NuxtLink" })
    .map((link) => link.props("to") as string);

describe("ActivityFeedTimeline", () => {
  it("says who did what in one sentence", async () => {
    const wrapper = await mountItem({
      batch: batch({ count: 15, objects: { person: 15 } }),
    });

    expect(wrapper.text()).toContain("Anna Nowak");
    expect(wrapper.text()).toContain("ocenił/a 15 osób");
  });

  it("gives a single time for a short sitting, in Warsaw", async () => {
    const wrapper = await mountItem({
      batch: batch({ firstAt: "2026-09-22T12:17:00.000Z" }),
    });

    expect(wrapper.find("time").text()).toBe("14:20");
  });

  it("gives the span of a sitting longer than five minutes", async () => {
    const wrapper = await mountItem({
      batch: batch({ firstAt: "2026-09-22T12:02:00.000Z" }),
    });

    expect(wrapper.find("time").text()).toBe("14:02–14:20");
  });

  it("names five targets and offers the rest it was sent", async () => {
    const targets = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
      target(id),
    );
    const wrapper = await mountItem({
      batch: batch({ targets, moreTargets: 110, count: 118 }),
    });

    expect(targetNames(wrapper)).toHaveLength(5);
    const expand = wrapper.get('[data-testid="feed-item-expand"]');
    expect(expand.text()).toBe("i jeszcze 3");
    // One "i jeszcze" at a time: the count past the listed ones waits until
    // the listed ones are all out.
    expect(wrapper.text()).not.toContain("i jeszcze 110");

    await expand.trigger("click");

    expect(targetNames(wrapper)).toHaveLength(8);
    expect(wrapper.find('[data-testid="feed-item-expand"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("i jeszcze 110");
  });

  it("says how many more there were when it lists them all", async () => {
    const wrapper = await mountItem({
      batch: batch({ targets: [target("a")], moreTargets: 4, count: 5 }),
    });

    expect(wrapper.find('[data-testid="feed-item-expand"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("i jeszcze 4");
  });

  it("links each target, and marks a removed one without a link", async () => {
    const wrapper = await mountItem({
      batch: batch({
        count: 2,
        objects: { person: 2 },
        targets: [
          target("a"),
          target("gone", { name: "Usunięta Osoba", href: null, deleted: true }),
        ],
      }),
    });

    expect(linkTargets(wrapper)).toEqual(["/osoba/osoba-a"]);
    expect(targetNames(wrapper)[1]).toContain("Usunięta Osoba");
    expect(targetNames(wrapper)[1]).toContain("(usunięte)");
  });

  it("shows no revision link, chip or reason when none was sent", async () => {
    const wrapper = await mountItem({ batch: batch({ kind: "approve" }) });

    expect(
      wrapper.find('[data-testid="feed-item-self-approved"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-testid="feed-item-revision"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="feed-item-reason"]').exists()).toBe(
      false,
    );
  });

  it("shows the revision, the self-approval and the reason when sent", async () => {
    const wrapper = await mountItem({
      batch: batch({
        kind: "delete",
        targets: [
          target("a", {
            revisionHref: "/admin/rewizje?rewizja=rev-1#kolejka",
            selfApproved: true,
            reason: "duplikat strony",
          }),
        ],
      }),
    });

    expect(wrapper.get('[data-testid="feed-item-self-approved"]').text()).toBe(
      "własna propozycja",
    );
    expect(linkTargets(wrapper)).toContain(
      "/admin/rewizje?rewizja=rev-1#kolejka",
    );
    // One page, so the reason does not name it again.
    expect(wrapper.get('[data-testid="feed-item-reason"]').text()).toBe(
      "duplikat strony",
    );
  });

  it("says which page a reason is about when there is a choice", async () => {
    const wrapper = await mountItem({
      batch: batch({
        kind: "reject",
        count: 2,
        targets: [target("a", { reason: "brak źródła" }), target("b")],
      }),
    });

    expect(wrapper.get('[data-testid="feed-item-reason"]').text()).toBe(
      "Osoba a: brak źródła",
    );
  });

  it("sets the second half of a fact or relation apart, keeping its text", async () => {
    const wrapper = await mountItem({
      batch: batch({
        count: 2,
        objects: { fact: 1, edge: 1 },
        targets: [
          target("f", { type: "fact", name: "Jan Kowalski · PKP SA" }),
          target("e", { type: "edge", name: "Jan Kowalski → PKP SA" }),
        ],
      }),
    });

    const rests = wrapper
      .findAll(".ft-target__rest")
      .map((node) => node.text());
    expect(rests).toEqual(["· PKP SA", "→ PKP SA"]);
    expect(targetNames(wrapper)[0]).toContain("Jan Kowalski · PKP SA");
  });

  it("shows what kind of thing was done before a word is read", async () => {
    const wrapper = await mountItem({ batch: batch({ kind: "delete" }) });

    expect(wrapper.get(".ft-badge").attributes("aria-label")).toBe("Usunięcie");
  });

  it("puts each day under its own heading", async () => {
    const wrapper = await mountSuspended(FeedTimeline, {
      props: {
        groups: [
          { day: "2026-09-22", label: "Dzisiaj", batches: [batch()] },
          {
            day: "2026-09-21",
            label: "Wczoraj",
            batches: [batch({ id: "named-1:vote:2026-09-21T10:00:00.000Z" })],
          },
        ],
        actorOf: () => actor(),
      },
    });

    expect(
      wrapper.findAll('[data-testid="activity-day"] h2').map((h) => h.text()),
    ).toEqual(["Dzisiaj", "Wczoraj"]);
  });

  it("marks an administrator on trial", async () => {
    const onTrial = await mountItem({ actor: actor({ newAdmin: true }) });
    expect(onTrial.text()).toContain("okres próbny");

    const established = await mountItem();
    expect(established.text()).not.toContain("okres próbny");
  });

  it("draws names as text, never as markup", async () => {
    const wrapper = await mountItem({
      actor: actor({ name: '<img src="x" onerror="alert(1)">' }),
      batch: batch({
        targets: [target("a", { name: "<b>pogrubione</b>" })],
      }),
    });

    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("b").exists()).toBe(false);
    expect(wrapper.text()).toContain("<b>pogrubione</b>");
    expect(wrapper.text()).toContain('<img src="x" onerror="alert(1)">');
  });

  it("lets a named actor be picked, and never a masked one", async () => {
    const named = await mountItem();
    await named.get('[data-testid="feed-item-actor"]').trigger("click");
    expect(named.emitted("select-actor")?.[0]).toEqual([actor()]);

    const masked = await mountItem({
      actor: actor({ key: "anon-1", name: "Anonim 1", named: false }),
    });
    expect(masked.find('[data-testid="feed-item-actor"]').exists()).toBe(false);
    expect(masked.text()).toContain("Anonim 1");

    const self = await mountItem({
      actor: actor({ key: "self", named: false, isSelf: true }),
    });
    expect(self.find('[data-testid="feed-item-actor"]').exists()).toBe(true);
  });
});

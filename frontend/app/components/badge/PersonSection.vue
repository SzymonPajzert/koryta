<template>
  <!-- Signed-in readers only, and the gate is the root of the component rather
       than a condition at the call site.

       The policy is the notes' policy, word for word: „Notes on a person are
       unreviewed claims about a named individual, so a reader has to be logged
       in to see them” (EntityDetailView.vue, above `NoteEditor`). A badge is
       the same kind of claim and then some - the satirical and interpretive
       entries characterise a living person and nobody has reviewed them,
       sitting on their canonical, indexed url - and this section shows the
       whole catalogue on everybody, including the badges nobody has proposed.
       `visibleBadges` would show a logged-out visitor none of them; the offer
       to vote must not show them either.

       No badge title anywhere in this template's comments, deliberately. A
       comment before the root element is its own vnode, so it is emitted even
       on the logged-out path where `PageSection` draws nothing - and template
       comments survive dev SSR, though a production build strips them. Quoting
       a title here would therefore put it in `view-source` on every person
       page in development, which is exactly what
       `tests/e2e/person_badges.spec.ts` asserts against.

       Inside rather than at the mount point, which is where `NoteEditor`'s
       lives, because that gate is a condition another surface can forget to
       copy - `ExtractionPersonFacts` moved its own inside for the same reason.
       The chips a logged-out reader may see are `BadgePersonRow`'s job and are
       drawn in the page header; nothing here is for them. -->
  <PageSection
    v-if="user"
    title="Odznaki"
    :icon="mdiSealVariant"
    lead="Odznaki nadają czytelnicy. Publiczna staje się po trzech głosach."
    class="mt-4"
    data-testid="person-badges"
  >
    <template #info>
      <p class="mb-1">
        Odznaka nie jest zarzutem, wyrokiem ani ustaleniem redakcji. Nie mówi,
        że ktoś złamał prawo albo zrobił coś nieuczciwego — mówi tylko, co
        czytelnicy wyczytali z jego historii w tej bazie.
      </p>
      <p class="mb-0">
        Nie trafia też do tytułu strony, do opisu w wyszukiwarce ani do mapy
        witryny. Zostaje tutaj, przy głosach, które ją nadały.
      </p>
    </template>

    <!-- Before the badges, not after them. Five rows with a paragraph each is
         more than one screen on a phone, so a disclaimer under the last one is
         a disclaimer nobody reaching for the first „Popieram” has read. It is
         in the section itself - not on /zrodla, not behind the „(i)” - because
         a hidden disclaimer protects nobody: the sentence has to be next to the
         click that makes the claim. -->
    <div class="k-note badge-disclaimer" data-testid="badge-disclaimer">
      <span>
        Odznaki to oceny czytelników, nie ustalenia redakcji ani sądu.
      </span>
      <!-- The site's own report form, opened here rather than reimplemented:
           it captures the route and this person's node id by itself
           (`captureFeedbackContext`, app/composables/feedback.ts), files to the
           same `feedback` collection and the same Slack channel, and carries
           the honeypot and the anonymity rules that go with it. What it cannot
           do is arrive with a sentence already typed - `FeedbackDialog` takes
           nothing but its `v-model` - so the reader names the badge
           themselves. -->
      <v-btn
        variant="text"
        size="small"
        class="px-1"
        :prepend-icon="mdiFlagOutline"
        data-testid="badge-report"
        @click="reportOpen = true"
      >
        To nieprawda — zgłoś
      </v-btn>
    </div>

    <!-- Why the arrows are gone. Said in the section rather than by disabling
         five pairs of buttons with no explanation: this is the one state where
         a reader would otherwise conclude the feature is broken. -->
    <div
      v-if="readOnlyNote"
      class="k-note badge-readonly"
      data-testid="badge-readonly"
    >
      {{ readOnlyNote }}
    </div>

    <article
      v-for="row in rows"
      :key="row.id"
      class="k-card k-card--accent badge-row"
      :data-testid="`badge-row-${row.id}`"
    >
      <div class="badge-row__head">
        <!-- `aria-hidden`, like the chip row's: a screen reader announces 🚌 as
             „autobus”, read out before the title that already names the badge.
             The emoji is decoration for the eye. -->
        <span class="badge-row__emoji" aria-hidden="true">{{ row.emoji }}</span>
        <h4 class="badge-row__title">{{ row.title }}</h4>
        <!-- What standard of evidence the badge asks for, in one word. The
             three are not interchangeable - „faktograficzna” is a lookup
             anybody can settle, „satyryczna” is a joke about a named living
             person - and the voter is the one who has to know which they are
             being asked for (see `BadgeSubjectivity`, shared/badges.ts). -->
        <span class="badge-row__kind">{{ row.subjectivity }}</span>
        <v-spacer />
        <span class="badge-row__status" :data-testid="`badge-status-${row.id}`">
          {{ row.statusLabel }}
        </span>
      </div>

      <p class="badge-row__claim">{{ row.claim }}</p>
      <p class="badge-row__evidence">
        <strong>Czego szukać, zanim klikniesz:</strong> {{ row.evidence }}
      </p>

      <div class="badge-row__foot">
        <span class="badge-row__tally" :data-testid="`badge-tally-${row.id}`">
          {{ row.up }} za / {{ row.down }} przeciw
        </span>

        <!-- An editor's „no” outranks any number of readers, so the pair of
             arrows is replaced by the verdict rather than disabled next to it:
             a disabled button invites the same three people to keep trying. The
             row itself stays, which is the point - it says the badge was
             considered and refused, instead of quietly disappearing from a
             catalogue the reader can see the rest of. -->
        <span
          v-if="row.blocked"
          class="badge-row__blocked"
          :data-testid="`badge-blocked-${row.id}`"
        >
          <v-icon :icon="mdiEyeOffOutline" size="15" class="mr-1" />
          Zablokowana przez redakcję
        </span>
        <!-- A retired badge keeps its tally (retiring stays reversible,
             shared/badges.ts) and is not offered for voting - `vote()` refuses
             it anyway, so a control here would be a button that does
             nothing. -->
        <span
          v-else-if="row.retired"
          class="badge-row__blocked"
          :data-testid="`badge-retired-${row.id}`"
        >
          Wycofana z katalogu
        </span>

        <template v-else-if="!readOnly">
          <v-tooltip
            location="top"
            :text="
              row.myVote === 1
                ? 'Kliknij ponownie, aby wycofać głos'
                : 'Popieram: tak, ta odznaka pasuje do tej osoby'
            "
          >
            <template #activator="{ props: tip }">
              <v-btn
                v-bind="tip"
                size="small"
                rounded="lg"
                :prepend-icon="mdiThumbUpOutline"
                :variant="row.myVote === 1 ? 'flat' : 'outlined'"
                :color="row.myVote === 1 ? 'primary' : undefined"
                :disabled="loading"
                :aria-pressed="row.myVote === 1"
                :data-testid="`badge-vote-up-${row.id}`"
                @click="onVote(row.id, 1)"
              >
                Popieram
              </v-btn>
            </template>
          </v-tooltip>

          <v-tooltip
            location="top"
            :text="
              row.myVote === -1
                ? 'Kliknij ponownie, aby wycofać głos'
                : 'Nie zgadzam się: to nie ten przypadek'
            "
          >
            <template #activator="{ props: tip }">
              <!-- Flat with a colour when it is the reader's answer, outlined
                   otherwise - and `error` rather than the theme's own
                   `secondary`, a pale pink that is 1.85:1 as ink and would make
                   the pressed state the *less* visible of the two
                   (chip/PublicCompany.vue). -->
              <v-btn
                v-bind="tip"
                size="small"
                rounded="lg"
                :prepend-icon="mdiThumbDownOutline"
                :variant="row.myVote === -1 ? 'flat' : 'outlined'"
                :color="row.myVote === -1 ? 'error' : undefined"
                :disabled="loading"
                :aria-pressed="row.myVote === -1"
                :data-testid="`badge-vote-down-${row.id}`"
                @click="onVote(row.id, -1)"
              >
                Nie zgadzam się
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <!-- The editor's half. „Zatwierdź” only where approval is what is
             holding the badge back: offering it on a badge with two votes would
             promise something it cannot do - the threshold is applied at read
             time and three people still have to turn up. -->
        <template v-if="isAdmin">
          <v-btn
            v-if="row.canApprove"
            size="small"
            rounded="lg"
            variant="outlined"
            :prepend-icon="mdiCheckDecagramOutline"
            :loading="moderating === row.id"
            :disabled="!!moderating"
            :data-testid="`badge-approve-${row.id}`"
            @click="setVerdict(row.id, 'approved')"
          >
            Zatwierdź do publikacji
          </v-btn>
          <v-btn
            v-if="row.verdict === 'approved'"
            size="small"
            rounded="lg"
            variant="text"
            :loading="moderating === row.id"
            :disabled="!!moderating"
            :data-testid="`badge-unapprove-${row.id}`"
            @click="setVerdict(row.id, null)"
          >
            Cofnij zatwierdzenie
          </v-btn>
          <v-btn
            v-if="!row.blocked"
            size="small"
            rounded="lg"
            variant="outlined"
            color="error"
            :prepend-icon="mdiEyeOffOutline"
            :loading="moderating === row.id"
            :disabled="!!moderating"
            :data-testid="`badge-hide-${row.id}`"
            @click="setVerdict(row.id, 'hidden')"
          >
            Ukryj
          </v-btn>
          <!-- Not offered on a page that is two people or a merged duplicate:
               clearing „hidden” on the one badge that needs no editor
               publishes it again, and publishing anything on such a page is the
               move the read-only mode exists to prevent. Hiding stays, see the
               comment on `readOnly`. -->
          <v-btn
            v-if="row.blocked && !readOnly"
            size="small"
            rounded="lg"
            variant="outlined"
            :prepend-icon="mdiEyeOutline"
            :loading="moderating === row.id"
            :disabled="!!moderating"
            :data-testid="`badge-restore-${row.id}`"
            @click="setVerdict(row.id, null)"
          >
            Przywróć
          </v-btn>
        </template>
      </div>
    </article>

    <FeedbackDialog v-model="reportOpen" />

    <!-- Outside every row: a rules rejection or a 403 has to outlive the button
         that caused it, and `loading` is one flag for the whole control. -->
    <v-snackbar v-model="errorShown" color="error" :timeout="6000">
      {{ error }}
    </v-snackbar>
  </PageSection>
</template>

<script lang="ts" setup>
/** The voting half of odznaki: the whole catalogue on one person, with what
 * each badge claims, what to check before clicking, and the two arrows.
 *
 * Separate from `BadgePersonRow`, which draws the chips in the page header,
 * because they answer different questions and have different audiences. The row
 * says what readers have decided and is shown to everybody, logged out visitors
 * included; this says what is on offer and how the vote stands, lists badges
 * *nobody* has proposed, and is shown to signed-in readers only. Folding them
 * together would mean one component whose every element is behind a different
 * condition.
 *
 * The counts it shows come from `/api/nodes/[id]/badges` - a narrow, uncached
 * read of the two fields a badge is made of - with this reader's own clicks
 * added on top until that endpoint has caught up with them. Neither half is an
 * optimisation. The props carry `stats.badges` off `/api/nodes/[id]`, which is
 * served from a six-hour cache to signed-in readers too
 * (server/utils/handlers.ts:5-7), so they are the wrong number after any vote;
 * and the endpoint cannot answer before `onVoteWritten` has recounted, so the
 * click needs an answer of its own in the meantime. See `adoptBadges` for the
 * one rule that keeps the two from being counted twice.
 */
import { computed, ref, toRef, watch } from "vue";
import {
  mdiCheckDecagramOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFlagOutline,
  mdiSealVariant,
  mdiThumbDownOutline,
  mdiThumbUpOutline,
} from "@mdi/js";
import {
  badgeMinVotes,
  badges,
  visibleBadges,
  type BadgeDefinition,
  type BadgeState,
  type BadgeTally,
} from "~~/shared/badges";
import { useBadgeVotes } from "~/composables/badges";
import { authRequest, useAuthState } from "~/composables/auth";
import type { BadgeModerationResult } from "~~/server/api/nodes/[id]/badges.post";
import type { NodeBadges } from "~~/server/api/nodes/[id]/badges.get";

const props = defineProps<{
  /** The person this section votes on. The vote lands in
   * `votes/${nodeId}_${uid}`, so this is the same id the rest of the page is
   * loaded by - never a name, and never a slug. */
  nodeId: string;
  /** `node.stats.badges`, keyed by bare badge id with no `badge:` prefix.
   * Absent on nearly everybody: `computeBadgeStats` writes the field only once
   * there is a vote to count. */
  stats?: Record<string, BadgeTally>;
  /** `person.badgeModeration`. Lives on `Person` and not on `PageBase`, so a
   * caller holding a `Node` needs `(x as Person | undefined)?.badgeModeration`
   * - which is what `EntityDetailView` does. */
  moderation?: Record<string, "approved" | "hidden">;
  /** `node.needs_split` - this page is known to be two people nobody has told
   * apart yet. Passed as a boolean rather than as the record: the section says
   * that the page is not one person, and who marked it and why is the admin
   * banner's business. */
  needsSplit?: boolean;
  /** `node.merged_into` - this page is a duplicate that was merged away. */
  mergedInto?: string;
}>();

const { user, isAdmin } = useAuthState();

/** The catalogue as plain definitions.
 *
 * `badges` is `as const satisfies readonly BadgeDefinition[]`, which keeps the
 * literal types for `BadgeId` and *drops* the optional fields no entry sets -
 * `definition.retired` on that type is a TS2339 that fails the triggers' build
 * (shared/badges.ts:262-273). Anything reading across the whole catalogue goes
 * through a widened view like this one.
 */
const catalogue: readonly BadgeDefinition[] = badges;

const { myVote, vote, loading } = useBadgeVotes(toRef(props, "nodeId"));

const reportOpen = ref(false);
const error = ref("");
const errorShown = ref(false);
const moderating = ref<string | null>(null);

/** What `/api/nodes/[id]/badges` last answered, or null before the first
 * answer - in which case the props are what there is to draw.
 *
 * The props come off `/api/nodes/[id]`, an `authCachedEventHandler` whose
 * `eventIsAuthenticated` is stubbed to `return false`
 * (server/utils/handlers.ts:5-7), so every signed-in reader is served the same
 * entry for up to six hours: they are the right number on a page nobody has
 * voted on and stale on every other. The vote *document* is live (vuefire
 * listens to it), so the arrows are always right, which is precisely what made
 * the stale counter next to them the one number on the site that contradicts
 * the button beside it.
 */
const serverBadges = ref<NodeBadges | null>(null);

/** This reader's clicks, as a correction to the counts above.
 *
 * Still needed with the endpoint in place, and for a reason the endpoint cannot
 * fix: the vote is written to Firestore by the client, and `stats.badges` is
 * recounted from the `votes` collection by `onVoteWritten`, a trigger that runs
 * *after* that write returns. Between the click and the trigger there is no
 * source anywhere that knows the new count, so the click has to be its own
 * answer. A delta also survives a second click - withdrawing takes the same
 * value back off.
 */
const voteDelta = ref<Record<string, { up: number; down: number }>>({});

/** An editor's verdicts as this session has changed them, over whichever of
 * the props and the endpoint's answer is underneath. `null` means „cleared”,
 * which is different from absent: the key has to be able to beat the value it
 * is overlaying. The same job `voteDelta` does for the counts, except that
 * `badges.post.ts` replies with the map it wrote - so this needs no confirming
 * round trip and is simply the newest thing the page knows. */
const localModeration = ref<Record<string, "approved" | "hidden" | null>>({});

/** True where a badge would land on the wrong human.
 *
 * `needs_split` says the page is two people who were never told apart, and
 * `merged_into` says it is a duplicate whose relations now live somewhere else
 * (shared/model.ts:28-45). Either way the history on screen is not one person's
 * history, so „ta osoba pracowała w trzech branżach” is a claim about nobody -
 * and the vote would be counted onto a node a reader is about to be redirected
 * off.
 *
 * Reading rather than hiding: the badges already voted on this page are part of
 * what somebody untangling it needs to see.
 *
 * Everything that could *put* a badge on the page goes away with it - both
 * arrows, „Zatwierdź do publikacji” and „Przywróć”, the last of these because
 * clearing „hidden” on the one badge that needs no editor („Społecznik”) makes
 * it public again. „Ukryj” is the exception and stays, deliberately: it only
 * ever takes a badge down, and a page that is two people is the likeliest place
 * for a badge to be on the wrong one - leaving the editor's veto off exactly
 * there would be a read-only mode that protects the page from its readers and
 * not from what is already on it.
 */
const readOnly = computed(() => !!props.needsSplit || !!props.mergedInto);

const readOnlyNote = computed(() => {
  if (props.mergedInto) {
    return (
      "Ta strona jest duplikatem scalonym z inną — głosowanie na odznaki jest " +
      "tu wyłączone, bo głos trafiłby na stronę, z której i tak przenosimy " +
      "czytelników."
    );
  }
  if (props.needsSplit) {
    return (
      "Ta strona opisuje dwie osoby, których jeszcze nie rozdzieliliśmy — " +
      "głosowanie na odznaki jest tu wyłączone, bo odznaka trafiłaby w " +
      "niewłaściwego człowieka."
    );
  }
  return "";
});

/** The counts the delta is measured against: the endpoint's answer once there
 * is one, the props until then.
 *
 * All or nothing between the two, deliberately - not a per-badge fallback. A
 * badge missing from a fresh answer is a badge at zero (its proposer withdrew,
 * or `computeBadgeStats` never wrote it), and reaching back to the six-hour-old
 * prop for those would resurrect exactly the badges that have just gone away.
 */
function baseTally(id: string): BadgeTally {
  const stored = serverBadges.value
    ? serverBadges.value.badges[id]
    : props.stats?.[id];
  return { up: Number(stored?.up) || 0, down: Number(stored?.down) || 0 };
}

/** The counts as this reader should see them: the freshest base we have, plus
 * what they have done that the base does not know about yet.
 *
 * Clamped at zero. The delta assumes the base already counts the vote this
 * reader is changing, which is true whenever the base is newer than their last
 * vote and wrong when it is older - and „-1 przeciw” is a worse way to be wrong
 * than „0 przeciw”.
 */
const tallies = computed<Record<string, BadgeTally>>(() => {
  const merged: Record<string, BadgeTally> = {};
  for (const definition of catalogue) {
    const base = baseTally(definition.id);
    const delta = voteDelta.value[definition.id];
    const up = Math.max(0, base.up + (delta?.up ?? 0));
    const down = Math.max(0, base.down + (delta?.down ?? 0));
    if (up || down) merged[definition.id] = { up, down };
  }
  return merged;
});

/** Take the endpoint's answer, and drop every delta it has caught up with.
 *
 * This is the one place the counter can be made to say two, and it is worth
 * spelling out how. `voteDelta` is not a number to display - it is a correction
 * to a base that does not know about this reader's click yet. The moment a
 * fetched base does know, the correction has to go, or the vote is counted once
 * by `computeBadgeStats` and once more here, and one click reads „2 za”. The
 * answer therefore **replaces** the delta; it is never added to it.
 *
 * Which is also why the answer cannot simply clear the deltas on arrival.
 * `stats.badges` is recomputed by `onVoteWritten` *after* the write this
 * component awaited, so the fetch that follows a vote usually lands before the
 * trigger has finished and answers with the pre-vote tally. Clearing on arrival
 * would snap the counter back to the old number a few hundred milliseconds
 * after the click - the very failure this endpoint was added to fix, only
 * faster.
 *
 * So a delta is dropped when the answer agrees with what the reader is already
 * being shown, i.e. when base + delta is what the server now counts, and kept -
 * along with the base it was measured against - when it does not. Every delta
 * is re-examined on every answer and not just the badge that was voted on,
 * because a vote on one badge fetches the tallies of all five, and a delta left
 * on a badge the server has meanwhile caught up with is precisely the double.
 *
 * A badge the reader has an unconfirmed click on stays pinned to its old base
 * even if the answer moved for somebody else's vote: the two are
 * indistinguishable from here - the endpoint returns counts, never who voted -
 * and being one behind for a moment is better than the counter jumping about
 * under a reader who has just clicked. The next mount rebases it.
 */
function adoptBadges(fresh: NodeBadges) {
  const pinned: [string, { up: number; down: number }][] = [];
  const bases: Record<string, BadgeTally> = { ...fresh.badges };

  for (const [id, delta] of Object.entries(voteDelta.value)) {
    // A withdrawn vote leaves { up: 0, down: 0 } behind, which corrects
    // nothing and must not pin the badge for the rest of the session.
    if (!delta.up && !delta.down) continue;
    const base = baseTally(id);
    const shown = fresh.badges[id];
    const confirmed =
      (Number(shown?.up) || 0) === base.up + delta.up &&
      (Number(shown?.down) || 0) === base.down + delta.down;
    if (!confirmed) {
      pinned.push([id, delta]);
      bases[id] = base;
    }
  }

  // Both assignments after the loop, which reads `baseTally` - it answers off
  // `serverBadges`, so replacing that first would compare each delta against
  // the very answer it is being judged by.
  voteDelta.value = Object.fromEntries(pinned);
  serverBadges.value = { badges: bases, moderation: fresh.moderation };
}

/** Ask the endpoint where this person's badges stand.
 *
 * `authRequest`, never `authFetch` - see the note on `setVerdict` below: the
 * second call to one url aborts the first, and this one is called on mount and
 * again after every vote, on the same url every time.
 *
 * A failure is swallowed on purpose. Everything here is a *freshness* upgrade
 * over props the page already rendered from, so the worst outcome of a refused
 * or unreachable request is the counter this component had before the endpoint
 * existed. A red snackbar over that would report a problem the reader has no
 * move to make about, on a page that looks entirely fine.
 */
async function refreshBadges() {
  const nodeId = props.nodeId;
  try {
    const fresh = await authRequest<NodeBadges>(`/api/nodes/${nodeId}/badges`, {
      method: "GET",
    });
    // The reader may have walked to another person while this was in flight -
    // the page is a client-side navigation away from any of the people named on
    // it - and adopting an answer about somebody else would put one person's
    // counts under another's name.
    if (nodeId !== props.nodeId) return;
    adoptBadges(fresh);
  } catch (err) {
    console.debug("Nie udało się odświeżyć odznak", err);
  }
}

/** Load the tallies once the reader is known, and reload them when the page
 * changes person under us.
 *
 * Watched rather than fetched in `onMounted`, because `user` is resolved
 * asynchronously by firebase (`useCurrentUser`) and is normally still null when
 * this component mounts - a fetch there would be a guaranteed 401. Client only:
 * on the server there is no signed-in reader to fetch for, the section renders
 * nothing for anybody else, and `authRequest` waits on an auth state that SSR
 * never resolves.
 *
 * The `nodeId` half is not hypothetical. `/osoba/[slug]` reuses this component
 * across a client-side navigation between two people - which is what
 * `useBadgeVotes(toRef(props, "nodeId"))` follows for the same reason - and a
 * tally or a pending delta carried over from the previous person would be
 * counts from one page displayed under another's name.
 *
 * `loadedFor` rather than the watcher's own previous value, which is typed as
 * present and is `undefined` on an `immediate` run: reading `[1]` off it would
 * throw on the very first call, and the lint rule that forbids guarding a
 * non-nullable value is what makes that impossible to paper over.
 */
let loadedFor: string | null = null;

watch(
  [user, () => props.nodeId],
  ([signedIn, nodeId]) => {
    if (loadedFor !== null && loadedFor !== nodeId) {
      serverBadges.value = null;
      voteDelta.value = {};
      localModeration.value = {};
    }
    if (!signedIn || !import.meta.client) return;
    loadedFor = nodeId;
    void refreshBadges();
  },
  { immediate: true },
);

const moderation = computed<Record<string, "approved" | "hidden">>(() => {
  // The endpoint's answer where there is one, for the same reason as the
  // tallies: the props are up to six hours old, so a badge an editor hid this
  // morning would still be offered two arrows here. `localModeration` on top of
  // both - it is only ever set from the server's own reply to this session's
  // write, so it is at least as new as any answer that was already in flight.
  //
  // Anything this session has ruled on is dropped from the base first, so a
  // cleared verdict (`null`) really disappears instead of being re-added by the
  // copy underneath it. Filtering rather than `delete`ing a computed key, which
  // the lint rule forbids.
  const base = serverBadges.value?.moderation ?? props.moderation ?? {};
  const merged: Record<string, "approved" | "hidden"> = Object.fromEntries(
    Object.entries(base).filter(
      ([id]) => localModeration.value[id] === undefined,
    ),
  );
  for (const [id, verdict] of Object.entries(localModeration.value)) {
    if (verdict !== null) merged[id] = verdict;
  }
  return merged;
});

/** What each badge's state is, taken from `visibleBadges` rather than derived
 * here.
 *
 * The section could compare `support` against `badgeMinVotes` itself in one
 * line - and then there would be two implementations of the visibility rule,
 * which is precisely what `visibleBadges` exists to prevent: the status this
 * row shows a voter has to be the status the chip in the header is drawn from,
 * or the section becomes a second opinion about its own feature.
 *
 * Asked with `signedIn: true` because nobody else can see this section at all.
 * Badges it leaves out - support at or below zero, hidden, retired - get their
 * own labels below; that is the one thing this section needs and the chip row
 * does not.
 */
const states = computed<Map<string, BadgeState>>(
  () =>
    new Map(
      visibleBadges(tallies.value, moderation.value, { signedIn: true }).map(
        (chip) => [chip.id, chip.state],
      ),
    ),
);

type BadgeRow = {
  id: string;
  emoji: string;
  title: string;
  claim: string;
  evidence: string;
  subjectivity: string;
  retired: boolean;
  up: number;
  down: number;
  myVote: -1 | 0 | 1;
  verdict: "approved" | "hidden" | undefined;
  blocked: boolean;
  canApprove: boolean;
  statusLabel: string;
};

/** Every badge in the catalogue, in catalogue order.
 *
 * Not sorted by support the way the chips are. This is a menu - the same five
 * entries in the same places on every person - and a list that reorders itself
 * as you vote is one where the second click lands on a different badge than the
 * one you were reading about.
 */
const rows = computed<BadgeRow[]>(() =>
  catalogue.map((definition) => {
    const tally = tallies.value[definition.id];
    const up = tally?.up ?? 0;
    const down = tally?.down ?? 0;
    const verdict = moderation.value[definition.id];
    const state = states.value.get(definition.id);

    return {
      id: definition.id,
      emoji: definition.emoji,
      title: definition.title,
      claim: definition.claim,
      evidence: definition.evidence,
      subjectivity: definition.subjectivity,
      retired: !!definition.retired,
      up,
      down,
      myVote: myVote(definition.id),
      verdict,
      blocked: verdict === "hidden",
      // Only where an editor is the last thing missing. `requiresApproval` and
      // the votes already there - which is exactly the „awaiting” state, so it
      // is read off `visibleBadges` rather than recomputed.
      canApprove:
        definition.requiresApproval && state === "awaiting" && !readOnly.value,
      statusLabel: statusLabel(definition, { up, down }, verdict, state),
    };
  }),
);

/** The one line that says where this badge stands, for a reader who is about to
 * vote on it.
 *
 * Spelled out rather than left to the chip's presence or absence: four of the
 * five states are invisible from the header (a proposal below the bar draws no
 * chip at all), and „why is my vote not showing up” is the question this
 * section exists to answer.
 */
function statusLabel(
  definition: BadgeDefinition,
  tally: BadgeTally,
  verdict: "approved" | "hidden" | undefined,
  state: BadgeState | undefined,
): string {
  if (verdict === "hidden") return "Zablokowana przez redakcję";
  if (definition.retired) return "Wycofana z katalogu";
  if (state === "public") return "Widoczna dla wszystkich";
  if (state === "awaiting") return "Czeka na zatwierdzenie redakcji";

  const support = tally.up - tally.down;
  if (state === "proposal") {
    // How many more people, in this reader's words rather than as „2/3”: the
    // threshold is *net*, so a badge with four supporters and two objectors is
    // still one vote short, and a fraction would say 4/3 and read as done.
    const missing = badgeMinVotes(definition.id) - support;
    return missing === 1
      ? "Propozycja — brakuje jeszcze jednego głosu"
      : `Propozycja — brakuje jeszcze ${missing} głosów`;
  }

  // Everything `visibleBadges` dropped for want of support. The two are worth
  // telling apart: a badge nobody has touched is an open question, a badge
  // talked back down to zero is one the readers have already answered.
  if (tally.down > 0) return "Czytelnicy jej nie poparli";
  return "Nikt jeszcze nie zgłosił";
}

/** Vote, then correct the counter by hand.
 *
 * `useBadgeVotes.vote` does the toggle itself, so the value it will store has
 * to be worked out here too in order to know what changed - and captured
 * *before* the await, because the vuefire listener moves `myVote` out from
 * under us as soon as Firestore acknowledges the write.
 *
 * `false` is not an error: it is an id outside the catalogue, a retired badge,
 * a second click while the first is in flight, or a logged-out reader who has
 * just been redirected to /login. None of them changed a count.
 */
async function onVote(id: string, value: 1 | -1) {
  const before = myVote(id);
  const next: -1 | 0 | 1 = before === value ? 0 : value;

  try {
    const written = await vote(id, value);
    if (!written) return;

    const delta = { ...(voteDelta.value[id] ?? { up: 0, down: 0 }) };
    if (before > 0) delta.up -= 1;
    if (before < 0) delta.down -= 1;
    if (next > 0) delta.up += 1;
    if (next < 0) delta.down += 1;
    voteDelta.value = { ...voteDelta.value, [id]: delta };

    // And then the real number, so that a reload shows it rather than the
    // six-hour-old one this reader has just contradicted. Awaited after the
    // delta, never instead of it: the trigger that recounts `stats.badges` has
    // not necessarily run yet, and `adoptBadges` is what decides which of the
    // two answers is the one to keep.
    await refreshBadges();
  } catch (err) {
    // `write` propagates a rules rejection now (app/composables/votes.ts), and
    // a PERMISSION_DENIED nobody is shown is the one failure a bug report
    // cannot describe.
    error.value = errorMessage(err, "Nie udało się zapisać głosu.");
    errorShown.value = true;
  }
}

/** File an editor's verdict on one badge.
 *
 * `authRequest`, never `authFetch`. `authFetch` wraps `useFetch`, which keys
 * its async data by url: the second call to the same endpoint aborts the first,
 * and whoever awaited the aborted one waits forever - a button that spins and
 * never stops (app/composables/auth.ts:118-127). Two verdicts on two badges of
 * one person hit the same url, so this is not a hypothetical here.
 */
async function setVerdict(id: string, verdict: "approved" | "hidden" | null) {
  moderating.value = id;
  try {
    const result = await authRequest<BadgeModerationResult>(
      `/api/nodes/${props.nodeId}/badges`,
      { method: "POST", body: { badgeId: id, verdict } },
    );

    // The whole map the server ended up with, not only the key we sent. It
    // costs nothing - the response carries it - and it is what makes a second
    // admin's verdict, filed while this page was open, appear rather than be
    // overwritten in the display by our stale props. `null` for the ids the
    // server has no verdict on, because absent in this overlay means „the prop
    // wins” and cleared has to beat it.
    const next: Record<string, "approved" | "hidden" | null> = {};
    for (const definition of catalogue) {
      next[definition.id] = result.badgeModeration[definition.id] ?? null;
    }
    localModeration.value = next;
  } catch (err) {
    error.value = errorMessage(err, "Nie udało się zapisać decyzji.");
    errorShown.value = true;
  } finally {
    moderating.value = null;
  }
}

/** The server's own sentence where it gave one - `requireAdmin` and the
 * endpoint both answer in Polish, and „Odznaki nadaje się tylko osobom” is more
 * use than „nie udało się”. Same shape as `chip/DraftStatus.vue`. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } } | null)?.data;
  return data?.message || (err instanceof Error ? err.message : "") || fallback;
}
</script>

<style scoped>
/* The card, the heading and the lead are global (`app.vue`); what is here is
   this section's own idiom. Spacing matches `.succ` in
   succession/PersonChanges.vue, which is the section directly above this one on
   a person's page. */

.badge-disclaimer {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  gap: 4px;
  margin-bottom: 12px;
}

.badge-readonly {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  margin-bottom: 12px;
}

.badge-row {
  margin-bottom: 8px;
  padding: 11px 12px 12px 14px;
}

.badge-row__head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge-row__emoji {
  font-size: 1.125rem;
  line-height: 1;
}

.badge-row__title {
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.4;
}

.badge-row__kind {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.625rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.badge-row__status {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
}

.badge-row__claim {
  font-size: 0.8125rem;
  line-height: 1.5;
  margin-top: 6px;
  max-width: 78ch;
}

/* „Drobny druk”, and literally so: it is the standard of proof, which a voter
   reads once and then stops needing. Same colour and size as `k-lead`, so it
   sits below the claim without competing with it. */
.badge-row__evidence {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  line-height: 1.5;
  margin-top: 4px;
  max-width: 78ch;
}

.badge-row__foot {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.badge-row__tally {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  font-weight: 600;
  margin-right: 4px;
}

.badge-row__blocked {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: inline-flex;
  font-size: 0.75rem;
}
</style>

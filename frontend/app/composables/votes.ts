import {
  mdiAccountAlertOutline,
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiHelpCircleOutline,
  mdiLightbulbOutline,
} from "@mdi/js";
import { computed, type MaybeRef } from "vue";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { useCurrentUser, useDocument, useFirebaseApp } from "vuefire";
import { useAuthState } from "./auth";
import type { VoteCategory, VoteDocument } from "~~/shared/model";

/** The ink tokens rather than Vuetify's own `success`/`error`/`warning`:
 * `button/vote/Number.vue` writes these two names straight into `text-<name>`
 * on the count and into `:color` on the two arrows, and Vuetify's status
 * colours are picked as fills. On the white pill the count sits in, `success`
 * #4CAF50 measured 2.78:1 and `warning` #FB8C00 2.37:1 - both under the 3:1
 * an icon needs, let alone the 4.5:1 of the 12px number between them. That is
 * the „Twój głos” column of /eksploruj/tabela.
 *
 * `error` #B00020 passed on its own at 7.33:1 and was swapped anyway, so that
 * a category's up and down arrow are two steps of one ramp rather than one
 * measured colour beside one nobody here chose. `ink.danger` is 6.54:1.
 *
 * Nothing outside this file reads these two fields, so no filled control is
 * repainted by it. `shared/colors.ts` carries the measurements and
 * tests/composables/votes.test.ts holds them.
 */
export const voteCategoryConfig: Record<
  VoteCategory,
  {
    text: string;
    icon: string;
    color: string;
    downColor: string;
    /** What clicking the arrows actually asserts, in one sentence, in the first
     * person.
     *
     * The ladder below says how strong a verdict is; this says what the verdict
     * is *about*, and it is the half that was missing. An alpha tester working
     * through /eksploruj/nowe put it plainly: the scale reads perfectly well as
     * -5 to +5 and never says what makes a person „interesująca”, so the arrows
     * get clicked as a rating of the page - is this entry any good - rather
     * than as the judgement about the person that the queue is ordered by.
     *
     * Required on every category rather than only on the one that was
     * complained about, because a category whose meaning cannot be said in a
     * sentence is one nobody can vote on honestly. */
    meaning: string;
  }
> = {
  interesting: {
    text: "Dobre znalezisko",
    icon: mdiLightbulbOutline,
    color: "ink-success",
    downColor: "ink-danger",
    meaning:
      "W górę: moim zdaniem ta osoba powinna być oznaczona jako koryciarz - " +
      "ma posadę w spółce albo instytucji publicznej i polityczne powiązanie, " +
      "które ją tłumaczy. W dół: moim zdaniem nie powinna.",
  },
  quality: {
    text: "Znaleziony problem",
    icon: mdiAlertCircleOutline,
    color: "ink-danger",
    downColor: "ink-success",
    meaning:
      "W górę: coś się tu nie zgadza z danymi. W dół: sprawdziłem/am i jest w " +
      "porządku.",
  },
  correct: {
    text: "Poprawny fakt",
    icon: mdiCheckCircleOutline,
    color: "ink-success",
    downColor: "ink-danger",
    meaning:
      "W górę: ten fakt zgadza się ze źródłem. W dół: źródło mówi co innego.",
  },
  insufficient: {
    text: "Za mało informacji",
    icon: mdiHelpCircleOutline,
    color: "ink-warning",
    downColor: "ink-warning",
    meaning:
      "W górę: nie da się tego ocenić bez dodatkowych informacji, których tu " +
      "nie ma.",
  },
  wrongPerson: {
    text: "To nie ta osoba",
    icon: mdiAccountAlertOutline,
    color: "ink-warning",
    downColor: "ink-warning",
    meaning: "W górę: to imiennik - fakt dotyczy kogoś innego o tym nazwisku.",
  },
};

/** What a vote in this category asserts, for any surface that has to say so
 * before the reader has clicked anything. */
export function voteMeaning(category: VoteCategory): string {
  return voteCategoryConfig[category].meaning;
}

/** What each step of the -5..5 scale is meant to say.
 *
 * The number alone tells a voter nothing about where to stop, so every step
 * gets a phrase. Only categories that are actually voted on the wide scale
 * need an entry - the rest fall back to the category's own label. */
const scaleLabels: Partial<Record<VoteCategory, Record<number, string>>> = {
  interesting: {
    5: "Bezczelne",
    4: "Grube koryto",
    3: "Koryciarz",
    2: "Dobre znalezisko",
    1: "Ciekawe",
    [-1]: "Nie mogę znaleźć informacji",
    [-2]: "Wygląda w porządku",
    [-3]: "Nic tu nie ma",
    [-4]: "Pomyłka w danych",
    [-5]: "Nie powinno tu być",
  },
};

/** The phrase for one step of the scale, or undefined outside -5..5 and for
 * categories with no ladder of their own. */
export function voteLevelLabel(
  category: VoteCategory,
  value: number,
): string | undefined {
  return scaleLabels[category]?.[value];
}

/** The whole ladder as one sentence, for places that have to explain the scale
 * before the reader has clicked anything. */
export function voteScaleSummary(category: VoteCategory): string | undefined {
  const labels = scaleLabels[category];
  if (!labels) return undefined;
  const steps = [5, 4, 3, 2, 1, -1, -2, -3, -4, -5]
    .filter((value) => labels[value])
    .map((value) => `${value > 0 ? "+" : ""}${value} ${labels[value]}`);
  return `Skala od -5 do +5: ${steps.join(", ")}.`;
}

/** What each scoring model looks at, in the language of somebody reading the
 * site rather than of the pipeline that wrote the vote.
 *
 * Keyed by the `model_tag` each model in `data/pipelines/src/analysis/scores/`
 * declares, which is also the `userUid` its votes are stored under. The two
 * lists drift - a model can be added, renamed or retired without this file
 * knowing - so `scoreModelLabel` falls back to the uid rather than showing
 * nothing, and an unlabelled model reads as a slightly ugly name instead of
 * disappearing from a breakdown that claims to be complete. */
const scoreModelLabels: Record<string, string> = {
  pipeline: "Publiczni pracodawcy",
  "pipeline-pagerank": "Sieć powiązań",
  "pipeline-together": "Wspólne zarządy",
  "pipeline-turnover": "Posada po wyborach",
  "pipeline-succession": "Następca na stanowisku",
  "pipeline-capture": "Przejęta instytucja",
  "pipeline-facts": "Artykuły w bazie",
};

/** A readable name for the model behind one pipeline vote. */
export function scoreModelLabel(uid: string): string {
  // `|| uid` rather than `?? uid`: stripping the prefix off a bare "pipeline"
  // leaves an empty string, not undefined, and an unnamed row is worse than an
  // ugly one.
  return scoreModelLabels[uid] || uid.replace(/^pipeline-?/, "") || uid;
}

/** A vote targets a graph node or an extraction fact; the target picks which
 * id field is set, so the id itself never needs inspecting. */
export type VoteTarget = "node" | "extraction";

/** The one vote document this reader owns for this target, and the only place
 * in the app that writes it.
 *
 * `votes/${targetId}_${uid}` is a single document per (target, reader) - the
 * shape firestore.rules pins the document id to, so „one person, one vote” is
 * enforced by a rule rather than by convention - and everything a reader can
 * say about a target lives in its `categoryVotes` map: the five `VoteCategory`
 * axes, and since the badges a `badge:<id>` key per badge (shared/badges.ts).
 *
 * Pulled out of `useVotes` because badge voting reads and writes that same
 * document. Two composables each calling `useDocument` on one id would be two
 * Firestore listeners for one document - paid twice on a page that already
 * mounts one vote control per category - and free to disagree for as long as
 * one of them has seen a write the other has not, which on a toggle control
 * looks like an arrow springing back. It also keeps the `setDoc` in one place:
 * `npm run check:duplication` (jscpd) would count a second copy of this write
 * as a clone, and it would be right to.
 */
export function useVoteDocument(
  targetId: MaybeRef<string>,
  target: VoteTarget = "node",
) {
  const { user } = useAuthState();
  // Named explicitly, like every other client call site. `useFirestore()` is
  // `getFirestore(app)` with no database id, i.e. `(default)` - a database this
  // project does not use, whose rules are not deployed and which the emulator
  // plugin never connects. See the same note in composables/auth.ts.
  const db = getFirestore(useFirebaseApp(), "koryta-pl");
  const router = useRouter();
  const route = useRoute();

  const idValue = computed(() => toValue(targetId));

  /** Null exactly when nobody is signed in - the document id carries the uid,
   * so before there is a user there is no document to read. `useDocument`
   * takes null to mean „no document” and opens no listener for it. */
  const documentRef = computed(() =>
    user.value ? doc(db, "votes", `${idValue.value}_${user.value.uid}`) : null,
  );
  const voteDocument = useDocument<VoteDocument>(documentRef);

  /** What this reader has said about this target, keyed the way the document
   * stores it. Never undefined, so a caller may index it before the first
   * snapshot has arrived. */
  const categoryVotes = computed<Record<string, number>>(
    () => voteDocument.value?.categoryVotes || {},
  );

  /** Merge `patch` into this reader's `categoryVotes`, or send them to /login.
   *
   * Returns false when there was no user: nothing was written and the caller
   * has been redirected. Returns true when the write landed, and throws
   * whatever Firestore threw otherwise - which is the point of the `await`.
   * `castVote` used to fire the `setDoc` and drop the promise, so a rules
   * rejection was a click that did nothing, reported nowhere, on a page that
   * went on showing the old number. The rules over this document are being
   * tightened right now (a cap on how many keys one `categoryVotes` may carry,
   * `MAX_VOTE_KEYS` in shared/badges.ts), and a silent PERMISSION_DENIED is the
   * one failure nobody could diagnose from a bug report.
   *
   * Every write carries the whole identifying set rather than only the patch,
   * however certain we are that the document already exists. `onVoteWritten`
   * re-reads every vote on the node and hands them to `computeVoteStats`
   * (shared/stats.ts), which reads `categoryVotes` without a guard: one
   * document created by a merge that carried only the patch would throw inside
   * the trigger and stop the aggregate for the *whole person* updating, for
   * every voter, until somebody noticed.
   */
  async function write(patch: Record<string, number>): Promise<boolean> {
    if (!user.value) {
      router.push({
        path: "/login",
        query: { redirect: route.fullPath },
      });
      return false;
    }

    await setDoc(
      doc(db, "votes", `${idValue.value}_${user.value.uid}`),
      {
        [target === "extraction" ? "extractionId" : "nodeId"]: idValue.value,
        userUid: user.value.uid,
        categoryVotes: patch,
        updatedAt: new Date().toISOString(),
      } as VoteDocument,
      // merge:true, so a verdict in one category - or on one badge - leaves
      // every other key of the map alone. Firestore merges the nested map key
      // by key, which is what makes a per-key patch safe here.
      { merge: true },
    );
    return true;
  }

  return { voteDocument, categoryVotes, write, user };
}

export function useVotes(
  targetId: MaybeRef<string>,
  category: VoteCategory,
  target: VoteTarget = "node",
) {
  const { categoryVotes, write, user } = useVoteDocument(targetId, target);
  const config = voteCategoryConfig[category];
  const loading = ref(false);

  /** Move this reader's verdict in `category` by `value`, clamped to the -5..5
   * the rules allow, and resolve once Firestore has taken it.
   *
   * It used to resolve as soon as the write was *started*: `setDoc` was called
   * and its promise dropped, so a rejected write was a click that changed
   * nothing and said nothing. It now propagates, which is a real change in
   * behaviour and the only one in this refactor - `button/vote/Number.vue`
   * awaits this before it emits `voted`, so a failed write no longer counts as
   * a review. That is the point: the rules over this document are being
   * tightened, and an error the app swallows is one no bug report can describe.
   */
  const castVote = async (value: number) => {
    loading.value = true;
    try {
      const currentVote = categoryVotes.value[category] ?? 0;
      const newValue = Math.max(-5, Math.min(5, currentVote + value));

      // Nothing to write once the scale is at its end. `&& user.value` keeps
      // the signed-out path bit for bit what it was before this was rewritten
      // around `write`: a reader with no votes at all sits at 0, so `castVote(0)`
      // would otherwise return here instead of reaching `write` and being sent
      // to /login. Nothing calls it with 0 today - button/vote/Number.vue
      // passes ±1 - but the redirect is the only thing a logged-out click does,
      // and losing it in a refactor that promised no behaviour change is not
      // worth the saved line.
      if (newValue === currentVote && user.value) return;

      await write({ [category]: newValue });
    } finally {
      // In a `finally` because `write` now propagates: an arrow left disabled
      // forever is how a rules rejection would present to a reader.
      loading.value = false;
    }
  };

  return {
    userCategoryVotes: categoryVotes,
    config,
    loading,
    castVote,
  };
}

/** Fire-and-forget vote write that opens no Firestore listeners.
 *
 * `useVotes` sets up live `useDocument`/`useCollection` subscriptions, which
 * are bound to the current effect scope for cleanup. Calling it from an event
 * handler (outside any component setup scope) leaks a listener on every call.
 * Use this for one-shot writes such as the review flow, where the reactive
 * state is not needed. Returns false if there is no signed-in user. */
export async function castVoteOnce(
  targetId: string,
  category: VoteCategory,
  value: number,
  target: VoteTarget = "node",
): Promise<boolean> {
  const user = useCurrentUser();
  if (!user.value) return false;

  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");
  const clamped = Math.max(-5, Math.min(5, value));

  await setDoc(
    doc(db, "votes", `${targetId}_${user.value.uid}`),
    {
      [target === "extraction" ? "extractionId" : "nodeId"]: targetId,
      userUid: user.value.uid,
      categoryVotes: { [category]: clamped },
      updatedAt: new Date().toISOString(),
    } as VoteDocument,
    // Use merge:true to preserve existing votes in other categories.
    { merge: true },
  );
  return true;
}

/** Attach a free-text comment to the caller's vote on a target.
 *
 * Shares the one-doc-per-(target, user) layout of `castVoteOnce`, so a comment
 * written before any verdict still lands on the same document. Returns false if
 * there is no signed-in user. */
export async function saveCommentOnce(
  targetId: string,
  comment: string,
  target: VoteTarget = "node",
): Promise<boolean> {
  const user = useCurrentUser();
  if (!user.value) return false;

  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");

  await setDoc(
    doc(db, "votes", `${targetId}_${user.value.uid}`),
    {
      [target === "extraction" ? "extractionId" : "nodeId"]: targetId,
      userUid: user.value.uid,
      // The aggregation trigger reads this field unconditionally, so it has to
      // exist even on the path where the comment arrives before any verdict.
      categoryVotes: {},
      comment,
      updatedAt: new Date().toISOString(),
    } as VoteDocument,
    { merge: true },
  );
  return true;
}

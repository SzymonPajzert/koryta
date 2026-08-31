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

/** A vote targets a graph node or an extraction fact; the target picks which
 * id field is set, so the id itself never needs inspecting. */
export type VoteTarget = "node" | "extraction";

export function useVotes(
  targetId: MaybeRef<string>,
  category: VoteCategory,
  target: VoteTarget = "node",
) {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");
  const config = voteCategoryConfig[category];

  const idValue = computed(() => toValue(targetId));

  const voteNodeUserRef = computed(() => {
    if (!user.value) return null;
    return doc(db, "votes", `${idValue.value}_${user.value.uid}`);
  });
  const voteNodeUserDoc = useDocument(voteNodeUserRef);

  const userCategoryVotes = computed(() => {
    return voteNodeUserDoc.value?.categoryVotes || {};
  });

  const router = useRouter();
  const route = useRoute();
  const loading = ref(false);

  // Expose function to cast or toggle a vote
  const castVote = async (value: number) => {
    if (!user.value) {
      router.push({
        path: "/login",
        query: { redirect: route.fullPath },
      });
      return;
    }

    loading.value = true;
    const currentVote = userCategoryVotes.value[category] ?? 0;
    const newValue = Math.max(-5, Math.min(5, currentVote + value));

    if (newValue === currentVote) {
      loading.value = false;
      return;
    }

    setDoc(
      doc(db, "votes", `${idValue.value}_${user.value.uid}`),
      {
        [target === "extraction" ? "extractionId" : "nodeId"]: idValue.value,
        userUid: user.value.uid,
        categoryVotes: {
          [category]: newValue,
        },
        updatedAt: new Date().toISOString(),
      } as VoteDocument,
      // Use merge:true to preserve existing votes
      { merge: true },
    );
    loading.value = false;
  };

  return {
    userCategoryVotes,
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

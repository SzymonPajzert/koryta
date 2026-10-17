import { sendEmailVerification } from "firebase/auth";
import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { useAuthState } from "@/composables/auth";
import { trackGoal } from "~/composables/analytics";
import {
  newsletterQuestionDue,
  type CampaignTopic,
  type NewsletterAskPlace,
  type NewsletterChangeVia,
} from "~~/shared/campaigns";

/** Set once a sign-in in this tab has put the newsletter question to the
 * reader - on /login or in the sign-in dialog - so that the layout's card
 * (components/mail/OptInPrompt.vue) does not ask it a second time in the same
 * visit: not while the dialog is asking, and not right after somebody closed
 * the dialog rather than answer. */
export function useNewsletterAskedOnSignIn() {
  return useState("newsletter-asked-on-sign-in", () => false);
}

/** Saves newsletter topics on the reader's own `users/{uid}`, with when and
 * where they changed. The same document /profil's switches show and the
 * server reads before it sends a campaign. */
export function useNewsletterChoice() {
  // Named, like every other client call site - see composables/auth.ts.
  const firestore = getFirestore(useFirebaseApp(), "koryta-pl");
  return async (
    uid: string,
    topics: Partial<Record<CampaignTopic, boolean>>,
    via: NewsletterChangeVia,
  ) => {
    await setDoc(
      doc(firestore, "users", uid),
      {
        newsletter: topics,
        newsletterUpdated: { at: serverTimestamp(), via },
      },
      { merge: true },
    );
  };
}

/** The newsletter question, for the places that put it to a reader. */
export function useNewsletterQuestion() {
  const { user, userConfig, isAdmin } = useAuthState();
  const save = useNewsletterChoice();

  // The stored document is read for the account signed in now, and is
  // unknown until it is: vuefire keeps the previous account's document while
  // the next one's loads. The claims need no such care - `isAdmin` goes back
  // to unknown when nobody is signed in, which Firebase always passes through
  // between two accounts.
  const config = computed(() => {
    if (!user.value || userConfig?.pending?.value) return undefined;
    const data = userConfig?.data?.value;
    // A stored document carries its id; one for another account is stale.
    if (data && (data as { id?: string }).id !== user.value.uid) {
      return undefined;
    }
    return data;
  });

  /** See `newsletterQuestionDue`: `undefined` until it can be known. Nobody
   * signed in counts as not known yet, rather than as no: the places that ask
   * look right after a sign-in, and a page's own `onAuthStateChanged` can hear
   * of it before vuefire's user does - for that moment the reader would
   * otherwise look signed out, and not to be asked. */
  const due = computed(() =>
    user.value
      ? newsletterQuestionDue({
          signedIn: true,
          isAdmin: isAdmin.value,
          config: config.value,
        })
      : undefined,
  );

  /** `due` once it is known, for a caller that has just signed somebody in
   * and has to choose between asking and moving on. After `timeoutMs` it moves
   * on: a reader not asked now is asked by the layout's card later. */
  function whenKnown(timeoutMs = 5000): Promise<boolean> {
    if (due.value !== undefined) return Promise.resolve(due.value);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stop();
        resolve(false);
      }, timeoutMs);
      const stop = watch(due, (value) => {
        if (value === undefined) return;
        clearTimeout(timer);
        stop();
        resolve(value);
      });
    });
  }

  /** Saves the answer to both topics at once, as the question offers them,
   * and counts it.
   *
   * Nothing is ever sent to an unconfirmed address, so a yes from an account
   * whose address is not confirmed also sends the confirmation link - unless
   * one went out a moment ago with a new account. Returns whether the
   * newsletter is still waiting on that confirmation. */
  async function answer(
    yes: boolean,
    where: NewsletterAskPlace,
    options: { verificationSent?: boolean } = {},
  ): Promise<{ awaitingConfirmation: boolean }> {
    const current = user.value;
    if (!current) throw new Error("Nobody is signed in to answer");
    await save(current.uid, { callsToAction: yes, recentPeople: yes }, where);
    trackGoal("mail-prompt:answer", { answer: yes ? "yes" : "no", where });

    const awaitingConfirmation = yes && !current.emailVerified;
    if (awaitingConfirmation && !options.verificationSent) {
      try {
        await sendEmailVerification(current);
      } catch (error) {
        // The answer is saved either way, and both /profil and /login offer
        // to send the link again.
        console.error("Failed to send the verification email:", error);
      }
    }
    return { awaitingConfirmation };
  }

  return { due, whenKnown, answer };
}

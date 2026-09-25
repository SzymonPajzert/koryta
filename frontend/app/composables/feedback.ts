import type { RouteLocationNormalizedLoaded } from "vue-router";
import {
  mdiAlertCircleOutline,
  mdiBug,
  mdiCheckCircleOutline,
  mdiLightbulbOutline,
  mdiDatabaseEdit,
  mdiDotsHorizontal,
  mdiProgressClock,
} from "@mdi/js";
import { parseEntityUrlSlug, seoTypes, type SeoType } from "./slugs";
import { anonymousRequest, authRequest } from "./auth";
import { feedbackKindLabels } from "~~/shared/model";
import type { FixState } from "~~/shared/feedbackFixes";
import type {
  FeedbackContext,
  FeedbackKind,
  FeedbackStatus,
} from "~~/shared/model";

/** Titles come from `shared/model.ts` so the Slack card and the dialog cannot
 * drift apart; everything else here is UI-only. */
export const feedbackKindConfig: Record<
  FeedbackKind,
  { title: string; hint: string; icon: string; color: string }
> = {
  bug: {
    title: feedbackKindLabels.bug,
    hint: "Co się stało i czego się spodziewałaś/eś?",
    icon: mdiBug,
    color: "error",
  },
  data: {
    title: feedbackKindLabels.data,
    hint: "Co jest nie tak i skąd to wiadomo?",
    icon: mdiDatabaseEdit,
    color: "warning",
  },
  idea: {
    title: feedbackKindLabels.idea,
    hint: "Co moglibyśmy zrobić lepiej?",
    icon: mdiLightbulbOutline,
    color: "primary",
  },
  other: {
    title: feedbackKindLabels.other,
    hint: "Napisz, co Ci leży na sercu.",
    icon: mdiDotsHorizontal,
    color: "grey",
  },
};

export const feedbackStatusConfig: Record<
  FeedbackStatus,
  { title: string; color: string }
> = {
  new: { title: "Nowe", color: "error" },
  in_progress: { title: "W trakcie", color: "warning" },
  resolved: { title: "Załatwione", color: "success" },
  wont_fix: { title: "Nie robimy", color: "grey" },
};

/** How a fix claimed on the QA list reads on a report (`shared/feedbackFixes.ts`).
 * Ink colours: the chip is tonal and the icon stands alone in the ordering
 * rows, so the colour has to be readable as text. */
export const fixStateConfig: Record<
  FixState,
  { label: string; icon: string; color: string }
> = {
  awaiting: {
    label: "czeka na sprawdzenie",
    icon: mdiProgressClock,
    color: "ink-neutral",
  },
  works: { label: "działa", icon: mdiCheckCircleOutline, color: "ink-success" },
  broken: {
    label: "nie działa",
    icon: mdiAlertCircleOutline,
    color: "ink-danger",
  },
};

/** The node the route is about, when it is about one.
 *
 * Entity URLs carry the id in their last slug segment (`/osoba/jan-kowalski-abc123`),
 * and the older `/entity/:destination/:id` form carries it as a param.
 */
function entityIdFromRoute(
  route: RouteLocationNormalizedLoaded,
): string | undefined {
  const { seoType, slug, id, destination } = route.params;

  if (
    typeof seoType === "string" &&
    typeof slug === "string" &&
    (seoTypes as readonly string[]).includes(seoType as SeoType)
  ) {
    return parseEntityUrlSlug(slug).id || undefined;
  }

  if (typeof destination === "string" && typeof id === "string") return id;

  return undefined;
}

/** One thing on a page a report is about, when that is narrower than the
 * page - a finding among the 420 on /eksploruj/umowy, whose url is the same
 * for all of them.
 *
 * `route` is the thing's own address, which the admin queue turns into a link
 * (so site-relative, as the API insists), and `title` is what the dialog shows
 * beside it. */
export type FeedbackSubject = { route: string; title: string };

/** Set by a „Zgłoś błąd" button just before it opens the dialog, and taken by
 * `captureFeedbackContext`, so the next report from the floating „Zgłoś" is
 * about the page again. `useState` for the reason `useFeedbackDialog` gives. */
export const useFeedbackSubject = () =>
  useState<FeedbackSubject | null>("feedback-subject", () => null);

/** What the reporter was looking at. Called when the dialog opens, so the
 * title and viewport are the ones they actually had in front of them - or,
 * when the dialog was opened from one item's own button, that item. */
export function captureFeedbackContext(
  route: RouteLocationNormalizedLoaded,
): FeedbackContext {
  const context: FeedbackContext = { route: route.fullPath.slice(0, 500) };

  const nodeId = entityIdFromRoute(route);
  if (nodeId) context.nodeId = nodeId;

  if (import.meta.client) {
    if (document.title) context.pageTitle = document.title.slice(0, 300);
    context.viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Client only: a subject is set by a click, and there are no clicks on
    // the server.
    const subject = useFeedbackSubject();
    if (subject.value) {
      context.route = subject.value.route.slice(0, 500);
      context.pageTitle = subject.value.title.slice(0, 300);
      subject.value = null;
    }
  }

  return context;
}

/** One report, as the form (or the QA page) has it before it is sent. */
export type FeedbackDraft = {
  kind: FeedbackKind;
  message: string;
  /** Volunteered so we can reply. Its presence is also what decides
   * attribution - see `submitFeedback`. */
  contact?: string;
  /** The dialog's honeypot. Never set anywhere a person types. */
  website?: string;
  context: FeedbackContext;
};

/** The one way a report reaches the server, wherever on the site it was
 * written: the "Zgłoś" dialog, and a verdict left on a QA changelog entry.
 * Both land in `feedback`, both go to the same Slack channel and the same
 * admin queue - which is the point of routing them through here rather than
 * letting each screen invent its own call.
 *
 * `attribute` decides whether an ID token goes with the request. It is not a
 * flag the server is asked to respect: without the token there is nothing to
 * attribute the report to, so "anonimowo" is a property of what was sent, not
 * a promise about what we do with it.
 */
export async function submitFeedback(
  draft: FeedbackDraft,
  options: { attribute: boolean },
): Promise<{ id: string | null }> {
  const body = {
    kind: draft.kind,
    message: draft.message,
    ...(draft.contact ? { contact: draft.contact } : {}),
    ...(draft.website ? { website: draft.website } : {}),
    context: draft.context,
  };

  if (options.attribute) {
    return await authRequest<{ id: string | null }>("/api/feedback/create", {
      method: "POST",
      body,
    });
  }

  // Deliberately not authRequest: it would attach the ID token, and the server
  // attributes any report that carries one.
  return await anonymousRequest<{ id: string | null }>("/api/feedback/create", {
    method: "POST",
    body,
  });
}

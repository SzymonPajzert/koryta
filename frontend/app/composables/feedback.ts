import type {
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
} from "vue-router";
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
import type { RowTone } from "./rowTone";
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

/** The kind as one of the ink/surface pairs in shared/colors.ts, for the
 * admin rows: `ink-<tone>` for a bare icon, the pair for the row itself. The
 * `color`s above are Vuetify's, which are too pale to be read as text. */
export const feedbackKindTone: Record<FeedbackKind, RowTone> = {
  bug: "danger",
  data: "warning",
  idea: "sage",
  other: "neutral",
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

/** Where a link to one report leads. On the page that lists every report it
 * is the hash alone, which that page follows by opening and outlining the row
 * (/admin/opinie); from a page showing only some of them, `page` is where the
 * rest are, and the link goes there with the same hash. */
export const feedbackReportLink = (
  id: string,
  page?: string,
): RouteLocationRaw => (page ? `${page}#fb-${id}` : { hash: `#fb-${id}` });

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

/** What the reporter was looking at. Called when the dialog opens, so the
 * title and viewport are the ones they actually had in front of them. */
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

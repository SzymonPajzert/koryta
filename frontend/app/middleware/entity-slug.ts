import type { Node, NodeType } from "~~/shared/model";
import {
  generateEntityUrl,
  healedLocation,
  SLUG_REDIRECT_CODE,
} from "~/composables/slugs";

/** Sends /entity/:type/:id on to the readable url for that node.
 *
 * This belongs in middleware rather than in the page's setup: `navigateTo`
 * there schedules the redirect but does not stop the render, so on the server
 * the redirect headers went out and the detail view carried on rendering - the
 * response never ended, and both curl and Chromium hung on every /entity url.
 * Returning it from middleware aborts the navigation, which is what makes the
 * redirect a complete response. */
export default defineNuxtRouteMiddleware(async (to) => {
  const id = to.params.id as string;
  const destination = to.params.destination as NodeType;

  // A node we cannot read is not a reason to fail the navigation - the page
  // renders the detail view for it and reports its own errors.
  const node = await $fetch<{ node: Node }>(`/api/nodes/${id}`)
    .then((response) => response.node)
    .catch(() => undefined);
  if (!node?.name) return;

  const seoUrl = generateEntityUrl(destination, id, node.name);
  if (to.path === seoUrl) return;

  // A push, not a replace, and that is what makes the back button work.
  //
  // The client reaches this url by following a link - from the graph, from a
  // relation card, from the revision queue - so a `router.push` is already in
  // flight when the guard runs. A guard redirect resolves before that push is
  // committed, so at this moment the entry `replace` would overwrite is not
  // the /entity/ url that is on its way in, it is the page the reader came
  // from. Replacing it took the way back out of the history: double-clicking a
  // company in a person's graph landed on the company and then back had
  // nowhere to go.
  //
  // Pushing leaves no stray /entity/ entry behind either - the navigation this
  // one supersedes never became one.
  return navigateTo(
    healedLocation(seoUrl, to),
    import.meta.server ? { redirectCode: SLUG_REDIRECT_CODE } : undefined,
  );
});

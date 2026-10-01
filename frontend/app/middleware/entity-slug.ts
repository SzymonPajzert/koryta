import type { Node, NodeType } from "~~/shared/model";
import { generateEntityUrl, generateNodeUrl } from "~/composables/slugs";
import { redirectToNodeUrl } from "~/composables/slugRedirect";

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
  // renders the detail view for it and reports its own errors. The status line
  // says it too, or a crawler files the url as a page: the same soft 404
  // `[seoType]/[slug].vue` answers for.
  const node = await $fetch<{ node: Node }>(`/api/nodes/${id}`)
    .then((response) => response.node)
    .catch(() => undefined);
  if (!node?.name) {
    if (import.meta.server) setResponseStatus(useRequestEvent()!, 404);
    return;
  }

  // Straight to where the node lives, not to the readable url of the type the
  // link happened to name: a region went /entity/ -> /region/ -> the table, two
  // redirects into a page robots.txt keeps Google out of.
  const seoUrl =
    generateNodeUrl(node) ?? generateEntityUrl(destination, id, node.name);
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
  return import.meta.server ? redirectToNodeUrl(seoUrl) : navigateTo(seoUrl);
});

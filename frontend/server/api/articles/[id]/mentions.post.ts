import { changeArticleEdges, MENTIONS } from "~~/server/utils/articleEdges";

/** Records that an article names somebody, or takes that back.
 *
 * Until this existed the only way to say it from the app was the generic edge
 * editor, which asks for both ends and is not on the article's page at all -
 * so in practice every mention came from the extraction pipeline. Somebody
 * reading an article is the one who can see a name the model missed.
 *
 * Institutions as well as people: the section on the article page has always
 * been "Wspomniane osoby i instytucje", and `mentions` joins an article to
 * either. The kind itself lives in `articleEdges.ts`, because promoting a
 * note's source writes the same relation and the two must agree on it.
 */
export default defineEventHandler(async (event) => {
  const mentions = await changeArticleEdges(event, MENTIONS);
  return { mentions };
});

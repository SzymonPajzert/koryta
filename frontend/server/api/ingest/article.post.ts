import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { ensureArticleNode } from "~~/server/utils/articles";
import { addArticleMentions } from "~~/server/utils/articleEdges";
import { withHttpScheme } from "~~/shared/url";
import { z } from "zod";

const articleRequestSchema = z.object({
  /** Given a scheme if it was pasted without one, so that what is stored is
   * always an absolute address: a bare `example.pl/a` rendered as an `href`
   * resolves against koryta.pl, and `/api/revisions/create` validates the same
   * field with `.url()`, so a node stored without one could not be edited
   * afterwards without correcting the url in the same pass. */
  url: z
    .string()
    .trim()
    .min(1)
    .transform(withHttpScheme)
    .refine((url) => URL.canParse(url), "Nie wygląda na adres strony."),
  name: z.string().min(1),
  publishedDate: z.string().optional(),
  meta: z.any().optional(),
  /** Nodes this article names, recorded in the same commit as the article.
   *
   * The promotion of a note's source passes the node the note hangs off: a url
   * somebody filed under a person is a claim that the page is about them, and
   * before this the article arrived joined to nothing. Ignored for anything
   * that is not a person or a company - see `addArticleMentions`.
   */
  mentions: z.array(z.string().min(1)).optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    articleRequestSchema.parse(body),
  );
  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();
  const { nodeId, created } = await ensureArticleNode(db, batch, user, body);
  // On the same batch as the article, so a reader never ends up with a page
  // joined to nobody because a second request failed. Read-then-write, so it
  // has to happen before the commit rather than after it.
  const mentions = await addArticleMentions(
    db,
    batch,
    user,
    nodeId,
    body.mentions ?? [],
  );
  await batch.commit();

  return { nodeId, created, mentions, status: "ok" };
});

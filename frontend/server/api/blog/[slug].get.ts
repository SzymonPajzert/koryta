import {
  BLOG_PATH,
  BLOG_SLUG,
  localizeFootnotes,
  type BlogPost,
  type MinimarkBody,
} from "~~/shared/blog";
import { blogPosts, blogShowsDrafts, blogSummary } from "~~/server/utils/blog";

/** One post, body included, for /blog/[slug]. */
export default defineEventHandler(async (event): Promise<BlogPost> => {
  const slug = getRouterParam(event, "slug") ?? "";
  // A draft answers exactly what a missing post does, so that a production
  // reader cannot tell one from the other.
  const notFound = () =>
    createError({ statusCode: 404, message: "Nie ma takiego wpisu." });

  // Checked before the query rather than left to it: the slug goes into the
  // path the query matches on, and nothing that is not a file name can be one.
  if (!BLOG_SLUG.test(slug)) throw notFound();
  const post = await blogPosts(event).path(`${BLOG_PATH}/${slug}`).first();
  if (!post) throw notFound();
  if (post.draft && !blogShowsDrafts(event)) throw notFound();

  return {
    ...blogSummary(post),
    body: localizeFootnotes(post.body as MinimarkBody),
  };
});

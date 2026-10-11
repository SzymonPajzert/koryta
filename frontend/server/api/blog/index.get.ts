import { listedPosts, type BlogPostSummary } from "~~/shared/blog";
import { blogPosts, blogShowsDrafts, blogSummary } from "~~/server/utils/blog";

/** Every post /blog lists, newest first, without their bodies. */
export default defineEventHandler(async (event): Promise<BlogPostSummary[]> => {
  const posts = await blogPosts(event).all();
  return listedPosts(posts.map(blogSummary), {
    includeDrafts: blogShowsDrafts(event),
  });
});

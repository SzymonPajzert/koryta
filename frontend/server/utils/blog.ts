import type { H3Event } from "h3";
import type { CollectionQueryBuilder } from "@nuxt/content";
import { queryCollection } from "@nuxt/content/server";
import {
  readingMinutes,
  slugFromPath,
  type BlogPostSummary,
  type MinimarkBody,
} from "~~/shared/blog";

/** A post as the `blog` collection stores it (content.config.ts).
 *
 * Spelt out, and `blogPosts` typed with it, because the lint's type program
 * does not load Nuxt's generated `.nuxt/content/types.d.ts`: without it the
 * collection reads as `never`, every post found as `null`, and
 * no-unnecessary-condition flags each check that one was found. */
export type StoredPost = {
  path: string;
  title: string;
  description: string;
  date: string;
  authors: string[];
  tags?: string[];
  image?: string;
  draft?: boolean;
  body: unknown;
};

/** The blog's posts, read on the server.
 *
 * The pages ask /api/blog rather than calling `queryCollection` themselves,
 * because in the browser Nuxt Content answers a query by downloading
 * @sqlite.org/sqlite-wasm - 865 KB of WebAssembly - and the whole collection
 * into it. On a server render that never happens, but every click from one
 * post to another, or from the home page to /blog, is a navigation in the
 * browser. The routes keep the database on the server, and give the posts one
 * door, which is where posts kept anywhere else will come in too. */
export function blogPosts(event: H3Event): CollectionQueryBuilder<StoredPost> {
  return queryCollection(event, "blog");
}

/** Drafts are for local builds: dev, the emulators, the e2e and visual runs.
 * The production build has `isLocal` false and serves none of them. */
export function blogShowsDrafts(event: H3Event): boolean {
  return useRuntimeConfig(event).public.isLocal === true;
}

export function blogSummary(post: StoredPost): BlogPostSummary {
  return {
    slug: slugFromPath(post.path),
    path: post.path,
    title: post.title,
    description: post.description,
    date: post.date,
    authors: post.authors,
    tags: post.tags,
    image: post.image,
    draft: post.draft === true,
    readingMinutes: readingMinutes(post.body as MinimarkBody),
  };
}

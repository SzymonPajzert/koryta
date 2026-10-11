import { defineContentConfig, defineCollection, z } from "@nuxt/content";

export default defineContentConfig({
  collections: {
    // The documents under /plik: the terms and the privacy policy.
    content: defineCollection({
      type: "page",
      source: { include: "**/*.md", exclude: ["blog/**"] },
    }),
    // /blog. The columns a post is stored with; what a post must hold is
    // `blogPostMetaSchema` in shared/blog.ts, which tests/content checks every
    // file against - Nuxt Content itself stores whatever it is given.
    blog: defineCollection({
      type: "page",
      source: "blog/*.md",
      schema: z.object({
        date: z.string(),
        authors: z.array(z.string()),
        tags: z.array(z.string()).optional(),
        image: z.string().optional(),
        draft: z.boolean().default(false),
      }),
    }),
  },
});

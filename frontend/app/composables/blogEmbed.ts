import { useAttrs } from "vue";
import { parseEmbedProps, type BlogEmbedName } from "~~/shared/blog";

/** What a blog embed was given, checked against the schema the post lint
 * holds the files to (`blogEmbeds` in shared/blog.ts).
 *
 * Read off the attributes rather than declared as props, so that the schema is
 * the one description of what an embed takes: a declared Boolean prop would
 * also turn `stacked=false`, which arrives as the string "false", into `true`.
 * The embeds set `inheritAttrs: false`, or a chart's whole series would be
 * written onto its root element as html attributes.
 *
 * Read once. The post page keys the body by its slug, so moving to another
 * post mounts new embeds rather than handing these new attributes. */
export function useBlogEmbed<N extends BlogEmbedName>(name: N) {
  return parseEmbedProps(name, { ...useAttrs() });
}

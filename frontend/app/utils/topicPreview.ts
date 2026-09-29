import type { Revision, Topic } from "~~/shared/model";

/** What a topic page shows of itself: its heading and the lead under it. */
export type TopicWording = Pick<Topic, "name" | "description">;

/** The topic as a proposal would leave it, or undefined where the revision is
 * not one to render here.
 *
 * `?revisionId=` is where /profil's „Podgląd tej wersji” and the history on
 * /admin/rewizje send a reader, the same as for a person or a company. Only the
 * two fields the page shows are taken from the revision; everything else - its
 * articles, whether it is live - is the stored topic's, because a proposal says
 * nothing about those.
 *
 * A revision of some other node is not a preview of this one, whatever the url
 * says, so it is ignored rather than drawn over the wrong page.
 */
export function topicPreview(
  topicId: string,
  revision: Pick<Revision, "data" | "node_id" | "nodeId"> | null | undefined,
): TopicWording | undefined {
  if (!revision?.data) return undefined;
  const target = revision.node_id ?? revision.nodeId;
  if (target !== topicId) return undefined;

  const data = revision.data as Partial<Topic>;
  return {
    name: typeof data.name === "string" ? data.name : "",
    description:
      typeof data.description === "string" ? data.description : undefined,
  };
}

import type { Region } from "~~/shared/model";
import { nodeLinkUrl } from "~~/shared/slugs";
import { wojewodztwoLabel, wojewodztwoOf } from "~~/shared/teryt";

/** The regions above one, widest first, for the line under its name: a
 * gmina's województwo and powiat, a powiat's województwo, nothing for a
 * województwo.
 *
 * Read by TERYT prefix rather than off the page's own graph, which reaches
 * only the region directly above: a gmina's graph holds its powiat and not
 * the województwo above that. Two small reads of public nodes, cached like
 * every node read. */
export function useRegionAncestors(
  teryt: MaybeRefOrGetter<string | undefined>,
) {
  return useAsyncData(
    () => `region-ancestors-${toValue(teryt) ?? "none"}`,
    async () => {
      const code = toValue(teryt);
      if (!code) return [];
      const ids = [wojewodztwoOf(code), code.slice(0, 4)]
        .filter(
          (prefix): prefix is string => !!prefix && prefix.length < code.length,
        )
        .map((prefix) => `teryt${prefix}`);
      const nodes = await Promise.all(
        ids.map((id) =>
          $fetch<{ node: Region }>(`/api/nodes/${id}`)
            .then((response) => response.node)
            .catch(() => undefined),
        ),
      );
      return ids.flatMap((id, index) => {
        const node = nodes[index];
        if (!node?.name) return [];
        // Nine of the sixteen województwa are stored by their bare name -
        // „łódzkie” - and seven as „Województwo mazowieckie” (task
        // fb10-wojewodztwa-i-etykiety). The line reads as Szymon wrote it,
        // „Województwo X > Powiat X”, which is what the table's region filter
        // already shows.
        const name =
          id.length === "teryt".length + 2
            ? wojewodztwoLabel(node.name)
            : node.name;
        return [
          {
            id,
            name,
            url: nodeLinkUrl({ ...node, id, type: "region" }),
          },
        ];
      });
    },
    { watch: [() => toValue(teryt)], default: () => [] },
  );
}

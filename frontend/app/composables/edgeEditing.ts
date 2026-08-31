import type { EdgeNode } from "~/composables/edges";
import { edgeSentence } from "~/utils/edgeSentence";
import { useAuthState } from "@/composables/auth";

/** The "this relation says the wrong thing" flow, for whichever surface is
 * listing the relations.
 *
 * The twin of `useEdgeRemoval`, and for the same reason: five surfaces draw a
 * node's relations, they look nothing alike, and the flow is identical every
 * time - one dialog for the whole page rather than one per row, and a refetch
 * afterwards rather than splicing the row in the browser, because the same
 * relation is usually drawn in more than one place from a single response.
 *
 * Where the two differ is who may do it. Removing is an admin's decision
 * outright; correcting is open to anyone signed in, because a wrong job title
 * is exactly the sort of thing the reader on the page is best placed to fix and
 * `/api/edges/update` files a contributor's version as a proposal rather than
 * applying it. `canApply` is what the dialog promises about that.
 *
 * @param subjectName the page the relations are being read from, for the
 *   caption - see `edgeSentence`.
 * @param refresh how this surface re-reads its relations.
 */
export function useEdgeEditing(options: {
  subjectName: () => string | undefined;
  refresh: () => unknown;
}) {
  const { user, isAdmin } = useAuthState();

  /** Whether the pencil is on the rows at all. */
  const canEdit = computed(() => !!user.value);
  /** Whether this reader's correction is live at once or joins the queue. */
  const canApply = computed(() => isAdmin.value === true);

  const editOpen = ref(false);
  const editEdge = ref<EdgeNode | undefined>(undefined);
  /** Which notice to show, or none. The two verdicts read differently enough
   * that one flag and one wording would be a lie to whichever reader got the
   * other. */
  const editedOutcome = ref<"applied" | "proposed" | undefined>(undefined);

  const editLabel = computed(() =>
    edgeSentence(options.subjectName(), editEdge.value),
  );

  function openEdit(edge: EdgeNode) {
    editEdge.value = edge;
    editOpen.value = true;
  }

  async function onEdgeEdited(applied: boolean) {
    editedOutcome.value = applied ? "applied" : "proposed";
    // Refetched either way. A proposal changes nothing a reader can see, but
    // the surfaces here are the ones a signed-in reader uses, and reading back
    // what is actually stored is what stops a stale row being taken as the save
    // having failed.
    await options.refresh();
  }

  return {
    canEdit,
    canApply,
    editOpen,
    editEdge,
    editedOutcome,
    editLabel,
    openEdit,
    onEdgeEdited,
  };
}

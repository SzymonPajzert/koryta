import { computed, ref, watch, type Ref } from "vue";
import type { NodeType } from "~~/shared/model";
import { parties } from "~~/shared/misc";
import { useEdges } from "~/composables/edges";
import { useEntityMutation } from "./useEntityMutation";
import { useNodeData } from "./useNodeData";
import { anyNode } from "~~/shared/empty";

interface UseNodeEditOptions {
  route?: ReturnType<typeof useRoute>;
  router?: ReturnType<typeof useRouter>;
  idToken?: Ref<string>;
}

export async function useNodeEdit(options: UseNodeEditOptions = {}) {
  const route = options.route || useRoute();
  const router = options.router || useRouter();
  const { idToken: authIdToken } = useAuthState();
  const idToken = options.idToken || authIdToken;

  const paramId = computed(() => route.params.id as string | undefined);
  const isNew = computed(
    () => !paramId.value || paramId.value === "new" || paramId.value === "NEW",
  );
  const node_id = computed(() => (isNew.value ? undefined : paramId.value));
  const tab = ref("content");

  // State keys should include node_id to avoid sharing across different nodes if navigated
  const stateKey = computed(() => `node-edit-${node_id.value || "new"}`);

  const { save } = useEntityMutation();

  const { current, revisions, loading, fetchRevisions } = useNodeData({
    nodeId: node_id,
    isNew,
    stateKey,
    initialType: (route.query.type as NodeType | undefined) ?? "person",
  });

  const {
    sources,
    targets,
    referencedIn,
    refresh: refreshEdges,
  } = await useEdges(() => node_id.value);

  const allEdges = computed(() => [
    ...sources.value,
    ...targets.value,
    ...referencedIn.value,
  ]);

  const partiesDefault = computed<string[]>(() => [...parties, "inne"]);

  watch(
    () => route.query.type,
    (newType) => {
      if (isNew.value && newType) {
        current.value.type = newType as NodeType;
      }
    },
    { immediate: true },
  );

  async function saveNode() {
    if (!idToken.value) {
      alert("Czekam na autoryzację...");
      return;
    }
    if (loading.value) {
      return;
    }

    loading.value = true;

    try {
      if (isNew.value) {
        await save({
          isNew: true,
          createEndpoint: "/api/nodes/create",
          revisionEndpoint: "",
          payload: { ...current.value },
          onSuccess: async (res: any) => {
            const { id } = res;
            if (id) {
              await router.push(`/edit/node/${id}`);
              // Reset current for the next "new" visit to clean state
              current.value = anyNode({});
            }
          },
        });
      } else {
        await save({
          isNew: false,
          createEndpoint: "",
          revisionEndpoint: "/api/revisions/create",
          payload: { ...current.value, node_id: node_id.value },
          successMessage: "Zapisano!",
          onSuccess: async () => {
            await fetchRevisions();
            if (node_id.value) {
              await router.push(
                `/entity/${current.value.type}/${node_id.value}`,
              );
            }
          },
        });
      }
    } finally {
      loading.value = false;
    }
  }

  return {
    node_id,
    stateKey,
    isNew,
    tab,
    current,
    loading,
    revisions,
    allEdges,
    refreshEdges,
    partiesDefault,
    idToken,
    saveNode,
    fetchRevisions,
  };
}

import { computed, ref, type Ref } from "vue";
import { parties } from "~~/shared/misc";
import { useEdges } from "~/composables/edges";

interface UseNodeEditOptions {
  route?: ReturnType<typeof useRoute>;
  router?: ReturnType<typeof useRouter>;
  idToken?: Ref<string>;
}

export async function useNodeEdit(options: UseNodeEditOptions = {}) {
  const route = options.route || useRoute();
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

  async function saveNode() {
    if (!idToken.value) {
      alert("Czekam na autoryzację...");
      return;
    }

    throw new Error("Not implemented");
    // TODO implement
    // await $fetch("/api/nodes/edit", {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Bearer ${idToken.value}`,
    //   },
    // });
  }

  return {
    node_id,
    stateKey,
    isNew,
    tab,
    allEdges,
    refreshEdges,
    partiesDefault,
    idToken,
    saveNode,
  };
}

import { computed, ref, watch, onMounted, type Ref } from "vue";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import type {
  Person,
  Node,
  Revision,
  Article,
  NodeType,
  Edge,
} from "~~/shared/model";
import { parties } from "~~/shared/misc";
import { useEdges } from "~/composables/edges";

interface UseNodeEditOptions {
  route?: ReturnType<typeof useRoute>;
  router?: ReturnType<typeof useRouter>;
  idToken?: Ref<string>;
}

type EditablePage = Partial<Node> &
  Partial<Omit<Person, "type">> &
  Partial<Omit<Article, "type">>;

export async function useNodeEdit(options: UseNodeEditOptions = {}) {
  const route = options.route || useRoute();
  const router = options.router || useRouter();
  const { idToken: authIdToken } = useAuthState();
  const idToken = options.idToken || authIdToken;
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  const paramId = computed(() => route.params.id as string | undefined);
  const isNew = computed(
    () => !paramId.value || paramId.value === "new" || paramId.value === "NEW",
  );
  const node_id = computed(() => (isNew.value ? undefined : paramId.value));
  const tab = ref("content");

  // State
  // TODO this should be inferred by the set type.
  const current = ref<EditablePage>({
    name: isNew.value ? (route.query.name as string) || "" : "",
    type: isNew.value ? (route.query.type as NodeType) || "person" : "person",
    parties: [],
    content: "",
    sourceURL: "",
    shortName: "",
  });
  const lastFetchedId = ref<string | undefined>(undefined);
  const isSaving = ref(false);

  /* eslint-disable @typescript-eslint/naming_convention */
  const edgeTypeOptions = [
    {
      value: "owns",
      label: "Właściciel",
      sourceType: "person",
      targetType: "place",
    },
    {
      value: "connection",
      label: "Powiązanie z",
      sourceType: "person",
      targetType: "person",
    },
    {
      value: "mentions_person",
      label: "Wspomina osobę",
      // sourceType: "person", // Generic source
      targetType: "person",
      realType: "mentions",
    },
    {
      value: "employed",
      label: "Zatrudniony/a w",
      sourceType: "person",
      targetType: "place",
    },
    {
      value: "mentions_place",
      label: "Wspomina firmę/urząd",
      // sourceType: "person", // Generic source
      targetType: "place",
      realType: "mentions",
    },
  ];
  /* eslint-enable @typescript-eslint/naming_convention */

  const newEdge = ref<Partial<Edge>>({
    type: "connection",
    target: "",
    name: "",
    content: "",
    start_date: "",
    end_date: "",
    // @ts-ignore
    direction: "outgoing",
  });
  const edgeType = ref<string>("connection"); // Isolated ref for v-select

  // Sync edgeType -> newEdge.type
  watch(edgeType, (t) => {
    newEdge.value.type = t as any;
  });

  const pickerTarget = ref<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const isEditingEdge = computed(() => !!newEdge.value.id);

  const revisions = ref<Revision[]>([]);
  const loading = ref(false);

  const {
    sources,
    targets,
    refresh: refreshEdges,
  } = await useEdges(() => node_id.value);
  const allEdges = computed(() => [...sources.value, ...targets.value]);

  const availableEdgeTypes = computed(() => {
    // @ts-ignore
    const dir = newEdge.value.direction || "outgoing";
    const myType = current.value.type;

    return edgeTypeOptions.filter((o) => {
      // @ts-ignore
      const reqSource = o.sourceType;
      // @ts-ignore
      const reqTarget = o.targetType;

      if (dir === "outgoing") {
        // I am Source.
        return !reqSource || reqSource === myType;
      } else {
        // I am Target.
        return !reqTarget || reqTarget === myType;
      }
    });
  });

  // Handle direction switch and type validation
  watch(
    [() => (newEdge.value as any).direction, availableEdgeTypes],
    ([newDir], [oldDir]) => {
      // Direction change detection via checking if just triggered?
      // Watch triggers on availableEdgeTypes change too.
      // Simply enforce consistency.
      
      if (!isEditingEdge.value) {
        // If direction actually changed or types changed, validate edgeType
        if (!availableEdgeTypes.value.find((o) => o.value === edgeType.value)) {
          edgeType.value = availableEdgeTypes.value[0]?.value || "";
        }
      }
    }
  );

  // Watch direction specifically for clearing picker
  watch(
    () => (newEdge.value as any).direction,
    () => {
      if (!isEditingEdge.value) {
        pickerTarget.value = null;
      }
    }
  );

  const edgeTargetType = computed<NodeType>(() => {
    const option = edgeTypeOptions.find((o) => o.value === edgeType.value);
    // @ts-ignore
    const dir = newEdge.value.direction;
    if (dir === "incoming") {
      // I am Target. Picker is Source.
      // @ts-ignore
      return (option?.sourceType as NodeType) || "person";
    }
    // I am Source. Picker is Target.
    // @ts-ignore
    return (option?.targetType as NodeType) || "person";
  });

  watch(edgeType, () => {
    if (!isEditingEdge.value) {
      pickerTarget.value = null;
    }
  });

  const partiesDefault = computed<string[]>(() => [...parties, "inne"]);

  const authHeaders = computed<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (idToken.value) {
      headers.Authorization = `Bearer ${idToken.value}`;
    }
    return headers;
  });

  async function fetchRevisions() {
    if (!node_id.value) return;
    try {
      const res = await $fetch<{ revisions: Revision[] }>(
        `/api/revisions/${node_id.value}`,
        {
          headers: authHeaders.value,
        },
      );
      revisions.value = res.revisions || [];
    } catch (e) {
      console.error("Error fetching revisions", e);
    }
  }

  async function fetchData() {
    const id = node_id.value;

    if (isSaving.value) return;
    if (id === lastFetchedId.value && id !== undefined) return;

    if (!isNew.value && id && idToken.value) {
      lastFetchedId.value = id;
      try {
        const snap = await getDoc(doc(db, "nodes", id));
        if (snap.exists()) {
          const data = snap.data();
          const type = data.type || "person";

          const { node } = await $fetch<{ node: Node }>(
            `/api/nodes/entry/${id}`,
            {
              query: { type },
              headers: authHeaders.value,
            },
          );

          const v: EditablePage = {
            name: node.name || "",
            type: node.type,
            content: node.content || "",
          };
          if (node.type === "person") {
            v.parties = (node as Partial<Person>).parties || [];
          }
          if (node.type === "article") {
            v.sourceURL = (node as Partial<Article>).sourceURL || "";
            v.shortName = (node as Partial<Article>).shortName || "";
          }
          current.value = v;
        }
      } catch (e) {
        console.error("Error fetching node data", e);
      }
      await fetchRevisions();
    } else if (isNew.value && lastFetchedId.value !== undefined) {
      lastFetchedId.value = undefined;
      const initialType = (route.query.type as NodeType) || "person";
      current.value = {
        name: "",
        type: initialType,
        parties: [],
        content: "",
        sourceURL: "",
        shortName: "",
      };
      revisions.value = [];
    }
  }

  watch(
    [() => node_id.value, () => idToken.value],
    () => {
      if (idToken.value) {
        fetchData();
      }
    },
    { immediate: true },
  );

  watch(
    () => route.query.type,
    (newType) => {
      if (isNew.value && newType) {
        current.value.type = newType as NodeType;
      }
    },
    { immediate: true },
  );

  onMounted(() => {
    if (idToken.value) {
      fetchData();
    }
  });

  async function saveNode() {
    if (!idToken.value) {
      alert("Czekam na autoryzację...");
      return;
    }
    if (loading.value || isSaving.value) {
      return;
    }

    loading.value = true;
    isSaving.value = true;
    try {
      if (isNew.value) {
        const { id } = await $fetch<{ id: string }>("/api/nodes/create", {
          method: "POST",
          body: { ...current.value },
          headers: authHeaders.value,
        });
        if (id) {
          lastFetchedId.value = id;
          await router.push(`/edit/node/${id}`);
        }
      } else {
        await $fetch<{ id: string }>("/api/revisions/create", {
          method: "POST",
          body: { ...current.value, node_id: node_id.value },
          headers: authHeaders.value,
        });
        alert("Zapisano!");
        await fetchRevisions();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.error(e);
      const msg = e.data?.statusMessage || e.message || "Unknown error";
      alert("Błąd zapisu: " + msg);
    } finally {
      loading.value = false;
      setTimeout(() => {
        isSaving.value = false;
      }, 500);
    }
  }

  function resetEdgeForm() {
    newEdge.value = {
      type: "connection",
      target: "",
      name: "",
      content: "",
      start_date: "",
      end_date: "",
      // @ts-ignore
      direction: "outgoing",
    };
    edgeType.value = "connection";
    pickerTarget.value = null;
  }

  function openEditEdge(edge: any) {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    let type = edge.type;
    const targetType = edge.richNode?.type || "person";
    if (type === "mentions") {
      type = targetType === "place" ? "mentions_place" : "mentions_person";
    }

    // Determine direction relative to current node
    const direction = edge.source === node_id.value ? "outgoing" : "incoming";

    newEdge.value = {
      ...edge,
      type,
      direction,
    };
    edgeType.value = type;
    pickerTarget.value = edge.richNode;
    // Scroll to form if needed?
  }

  function cancelEditEdge() {
    resetEdgeForm();
  }

  async function processEdge() {
    if (isEditingEdge.value) {
      await saveEdgeRevision();
    } else {
      await addEdge();
    }
  }

  function getRealType(uiType: string | undefined): string {
    const option = edgeTypeOptions.find((o) => o.value === uiType);
    return (option as any)?.realType || uiType;
  }

  async function addEdge() {
    if (!node_id.value || !pickerTarget.value) return;

    // @ts-ignore
    const direction = newEdge.value.direction || "outgoing";
    const source =
      direction === "outgoing" ? node_id.value : pickerTarget.value.id;
    const target =
      direction === "outgoing" ? pickerTarget.value.id : node_id.value;

    try {
      await $fetch<any>("/api/edges/create", {
        method: "POST",
        headers: authHeaders.value,
        body: {
          source,
          target,
          type: getRealType(newEdge.value.type),
          name: newEdge.value.name,
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
        },
      });
      resetEdgeForm();
      alert("Dodano powiązanie");
      await refreshEdges();
    } catch (e: any) {
      console.error(e);
      const msg = e.data?.statusMessage || e.message || "Unknown error";
      alert("Błąd dodawania powiązania: " + msg);
    }
  }

  async function saveEdgeRevision() {
    if (!newEdge.value.id || !newEdge.value.source) return;

    try {
      await $fetch<{ id: string }>("/api/revisions/create", {
        method: "POST",
        body: {
          node_id: newEdge.value.id,
          collection: "edges",
          source: newEdge.value.source, // Keep required context
          target: newEdge.value.target,
          type: getRealType(newEdge.value.type),
          name: newEdge.value.name,
          // text: newEdge.value.content, // Deprecated
          content: newEdge.value.content,
          start_date: newEdge.value.start_date,
          end_date: newEdge.value.end_date,
        },
        headers: authHeaders.value,
      });
      alert("Zapisano propozycję zmiany!");
      resetEdgeForm();
      await refreshEdges();
    } catch (e: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error(e);
      const msg = e.data?.statusMessage || e.message || "Unknown error";
      alert("Błąd zapisu: " + msg);
    }
  }

  return {
    isNew,
    tab,
    current,
    loading,
    edgeTypeOptions,
    newEdge,
    pickerTarget,
    revisions,
    allEdges,
    partiesDefault,
    idToken,
    saveNode,
    processEdge,
    cancelEditEdge,
    isEditingEdge,
    fetchRevisions,
    openEditEdge,
    edgeTargetType,
    edgeType,
    availableEdgeTypes,
  };
}

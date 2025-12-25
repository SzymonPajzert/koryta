import { computed, ref, watch, onMounted, type Ref } from "vue";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import type {
  Person,
  Node,
  Revision,
  Article,
  NodeType,
} from "~~/shared/model";
import { parties } from "~~/shared/misc";

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
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  const paramId = computed(() => route.params.id as string | undefined);
  const isNew = computed(
    () => !paramId.value || paramId.value === "new" || paramId.value === "NEW",
  );
  const node_id = computed(() => (isNew.value ? undefined : paramId.value));
  const tab = ref("content");

  // State
  // TODO this should be inferred by the set type.
  const current = ref<Node & Person & Partial<Article>>({
    name: "",
    type: isNew.value ? (route.query.type as NodeType) || "person" : "person",
    parties: [],
    content: "",
    sourceURL: "",
    shortName: "",
  });
  const lastFetchedId = ref<string | undefined>(undefined);
  const isSaving = ref(false);

  const revisions = ref<Revision[]>([]);
  const loading = ref(false);

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

          const { node } = await $fetch<{ node: Person }>(
            `/api/nodes/entry/${id}`,
            {
              query: { type },
              headers: authHeaders.value,
            },
          );

          current.value = {
            name: node.name || "",
            type: (node as Node).type || "person",
            parties: Array.isArray(node.parties) ? node.parties : [],
            content: node.content || "",
            sourceURL: (node as Article).sourceURL || "",
            shortName: (node as Article).shortName || "",
          };
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

  return {
    isNew,
    tab,
    current,
    loading,
    revisions,
    partiesDefault,
    idToken,
    saveNode,
  };
}

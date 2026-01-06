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
import { useEdges } from "~/composables/edges";
import { getPageTitle } from "~/composables/useFunctions";

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

  // State keys should include node_id to avoid sharing across different nodes if navigated
  const stateKey = computed(() => `node-edit-${node_id.value || "new"}`);

  const current = useState<EditablePage>(`${stateKey.value}-current`, () => ({
    name: isNew.value ? (route.query.name as string) || "" : "",
    type: isNew.value
      ? ((route.query.type as NodeType | undefined) ?? "person")
      : "person",
    parties: [],
    content: "",
    sourceURL: "",
    shortName: "",
  }));

  const lastFetchedId = useState<string | undefined>(
    `${stateKey.value}-lastFetchedId`,
    () => undefined,
  );
  const isSaving = useState(`${stateKey.value}-isSaving`, () => false);
  const revisions = useState<Revision[]>(
    `${stateKey.value}-revisions`,
    () => [],
  );
  const loading = useState(`${stateKey.value}-loading`, () => false);

  const {
    sources,
    targets,
    refresh: refreshEdges,
  } = await useEdges(() => node_id.value);
  const allEdges = computed(() => [...sources.value, ...targets.value]);

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
        `/api/revisions/node/${node_id.value}`,
        {
          headers: authHeaders.value,
        },
      );
      revisions.value = res.revisions;
    } catch (e) {
      console.error("Error fetching revisions", e);
    }
  }

  async function fetchData() {
    const id = node_id.value;

    if (isSaving.value) return;
    if (id === lastFetchedId.value && id !== undefined) return;

    if (!isNew.value && id && idToken.value) {
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
          lastFetchedId.value = id;
        }
      } catch (e) {
        console.error("Error fetching node data", e);
      }
      await fetchRevisions();
    } else if (isNew.value && lastFetchedId.value !== undefined) {
      lastFetchedId.value = undefined;
      const initialType =
        (route.query.type as NodeType | undefined) ?? "person";
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

  async function fetchPageTitle() {
    if (!current.value.sourceURL || current.value.type !== "article") return;
    loading.value = true;
    try {
      const title = await getPageTitle(current.value.sourceURL);
      if (title && !current.value.name) {
        current.value.name = title;
      }
    } catch (e) {
      console.error("Error fetching page title", e);
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    if (idToken.value) {
      fetchData();
    }
  });

  watch(
    () => current.value.sourceURL,
    (newUrl) => {
      if (newUrl && current.value.type === "article" && !current.value.name) {
        fetchPageTitle();
      }
    },
  );

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
    node_id,
    stateKey,
    isNew,
    tab,
    current,
    loading,
    revisions,
    allEdges,
    authHeaders,
    refreshEdges,
    partiesDefault,
    idToken,
    saveNode,
    fetchRevisions,
  };
}

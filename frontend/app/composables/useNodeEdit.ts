import { computed, ref, watch, onMounted } from "vue";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import type { Person, NodeType, EdgeType } from "~~/shared/model";
import { parties } from "~~/shared/misc";
import { useEdges } from "~/composables/edges";

interface UseNodeEditOptions {
    route?: any;
    router?: any;
    idToken?: any;
}

export async function useNodeEdit(options: UseNodeEditOptions = {}) {
    const route = options.route || useRoute();
    const router = options.router || useRouter();
    const { idToken: authIdToken } = useAuthState();
    const idToken = options.idToken || authIdToken;
    const db = getFirestore(useFirebaseApp(), "koryta-pl");

    const paramId = computed(() => route.params.id as string | undefined);
    const isNew = computed(() => !paramId.value || paramId.value === 'new');
    const node_id = computed(() => isNew.value ? undefined : paramId.value);
    const tab = ref("content");

    // State
    const current = ref<any>({ name: "", type: "person", parties: [], content: "" });
    const lastFetchedId = ref<string | undefined>(undefined);
    const isSaving = ref(false);
    
    const edgeTypeOptions = [
        { value: "employed", label: "Zatrudniony/a w", targetType: "place" },
        { value: "owns", label: "Właściciel", targetType: "place" },
        { value: "connection", label: "Powiązanie z", targetType: "person" },
        { value: "mentions", label: "Wspomina o", targetType: "person" },
    ];

    const newEdge = ref({ type: "connection" as EdgeType, target: "", targetType: "person" as NodeType, name: "", text: "" });
    const pickerTarget = ref<any>(null);
    const newComment = ref("");
    const revisions = ref<any[]>([]);
    const loading = ref(false);

    // Initialise edges
    // useEdges is async, so this composable also needs to be async or we handle it differently.
    // The original component used top-level await. We can do the same here since this function is async.
    const { sources, targets, refresh: refreshEdges } = await useEdges(() => node_id.value);
    const allEdges = computed(() => [...sources.value, ...targets.value]);

    watch(() => newEdge.value.type, (newType) => {
        const option = edgeTypeOptions.find(o => o.value === newType);
        if (option) {
            newEdge.value.targetType = option.targetType as NodeType;
        }
        pickerTarget.value = null;
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
            const res = await $fetch<{ revisions: any[] }>(`/api/revisions/${node_id.value}`, {
                 headers: authHeaders.value
            });
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
                    
                    const { node } = await $fetch<{ node: Person }>(`/api/nodes/entry/${id}`, {
                        query: { type },
                        headers: authHeaders.value
                    });
    
                    current.value = {
                        name: node.name || "",
                        type: (node as any).type || "person",
                        parties: Array.isArray(node.parties) ? node.parties : [],
                        content: node.content || ""
                    };
                }
            } catch (e) {
                console.error("Error fetching node data", e);
            }
            await fetchRevisions();
        } else if (isNew.value && lastFetchedId.value !== undefined) {
            lastFetchedId.value = undefined;
            current.value = { name: "", type: "person", parties: [], content: "" };
            revisions.value = [];
        }
    }

    watch([() => node_id.value, () => idToken.value], () => {
        if (idToken.value) {
            fetchData();
        }
    }, { immediate: true });

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
                    headers: authHeaders.value
                });
                if (id) {
                    lastFetchedId.value = id; 
                    await router.push(`/edit/node/${id}`);
                }
            } else {
                await $fetch<{ id: string }>("/api/revisions/create", {
                    method: "POST",
                    body: { ...current.value, node_id: node_id.value },
                    headers: authHeaders.value
                }); 
                alert("Zapisano!");
                await fetchRevisions();
            }
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
        edgeTypeOptions,
        newEdge,
        pickerTarget,
        newComment,
        revisions,
        allEdges,
        partiesDefault,
        idToken,
        saveNode,
    };
}

import { watch, type Ref } from "vue";
import type {
  Person,
  Node,
  Revision,
  Article,
  NodeType,
  Company,
} from "~~/shared/model";
import { getPageTitle } from "~/composables/useFunctions";
import { anyNode } from "~~/shared/empty";
import { useAuthState } from "./auth";

export type EditablePage = Partial<Node> &
  Partial<Omit<Person, "type">> &
  Partial<Omit<Article, "type">> &
  Partial<Omit<Company, "type">>;

interface UseNodeDataOptions {
  nodeId: Ref<string | undefined>;
  isNew: Ref<boolean>;
  authHeaders: Ref<Record<string, string>>;
  initialType?: NodeType;
  stateKey: Ref<string>;
  idToken: Ref<string>;
}

export function useNodeData(options: UseNodeDataOptions) {
  const { nodeId, isNew, authHeaders, stateKey, idToken } = options;
  const { user } = useAuthState();

  const current = useState<EditablePage>(`${stateKey.value}-current`, () =>
    anyNode({ type: options.initialType }),
  );

  const revisions = useState<Revision[]>(
    `${stateKey.value}-revisions`,
    () => [],
  );
  const loading = useState(`${stateKey.value}-loading`, () => false);
  const lastFetchedId = useState<string | undefined>(
    `${stateKey.value}-lastFetchedId`,
    () => undefined,
  );

  async function fetchRevisions() {
    if (!nodeId.value) return;
    try {
      // TODO don't use fetch, use authFetch here
      const res = await $fetch<{ revisions: Revision[] }>(
        `/api/revisions/node/${nodeId.value}`,
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
    const id = nodeId.value;

    if (loading.value) return; // Basic guard
    if (id === lastFetchedId.value && id !== undefined) return;

    if (!isNew.value && id && idToken.value) {
      try {
        const { node } = await $fetch<{ node: Node }>(
          `/api/nodes/entry/${id}`,
          {
            headers: authHeaders.value,
          },
        );

        if (node) {
          const v: EditablePage = {
            name: node.name || "",
            type: node.type,
            content: node.content || "",
            visibility: node.visibility,
          };
          if (node.type === "person") {
            v.parties = (node as Partial<Person>).parties || [];
            v.wikipedia = (node as Partial<Person>).wikipedia || "";
            v.rejestrIo = (node as Partial<Person>).rejestrIo || "";
          }
          if (node.type === "article") {
            v.sourceURL = (node as Partial<Article>).sourceURL || "";
            v.shortName = (node as Partial<Article>).shortName || "";
          }
          if (node.type === "place") {
            v.krsNumber = (node as Partial<Company>).krsNumber || "";
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
      // Reset for new
      current.value = anyNode({ type: options.initialType });
      revisions.value = [];
    }
  }

  async function fetchPageTitleIfNeeded() {
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

  watch(
    () => current.value.sourceURL,
    (newUrl) => {
      if (
        newUrl &&
        current.value.type === "article" &&
        !current.value.name &&
        isNew.value
      ) {
        fetchPageTitleIfNeeded();
      }
    },
  );

  watch(
    () => [current.value, user.value],
    () => {
      if (
        current.value.visibility === false && // Explicitly false
        !user.value
      ) {
        showError({
          statusCode: 404,
          statusMessage: "Page not found",
        });
      }
    },
    { deep: true },
  );

  return {
    current,
    revisions,
    loading,
    lastFetchedId,
    fetchData,
    fetchRevisions,
  };
}

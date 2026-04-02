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
import { useAuthState, authFetch } from "./auth";

export type EditablePage = Partial<Node> &
  Partial<Omit<Person, "type">> &
  Partial<Omit<Article, "type">> &
  Partial<Omit<Company, "type">>;

interface UseNodeDataOptions {
  nodeId: Ref<string | undefined>;
  isNew: Ref<boolean>;
  initialType?: NodeType;
  stateKey: Ref<string>;
}

export function useNodeData(options: UseNodeDataOptions) {
  const { nodeId, isNew, stateKey } = options;
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
      const { data: res } = await authFetch<{ revisions: Revision[] }>(
        `/api/revisions/node/${nodeId.value}`,
      );
      revisions.value = res.value?.revisions || [];
    } catch (e) {
      console.error("Error fetching revisions", e);
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
    fetchRevisions,
  };
}

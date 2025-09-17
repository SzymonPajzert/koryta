import { computed } from "vue";
import { useAuthState } from "@/composables/auth"; // Assuming auth store path
import type { Article } from "@/../shared/model";

export interface EnrichedStatus {
  enrichedStatus: {
    isAssignedToCurrentUser: boolean;
    hideArticle: boolean;
  };
}

export function useArticles() {
  const db = getDatabase();
  const { user, isAdmin } = useAuthState();

  const assignToArticle = async (articleId: string, setAssigned: boolean) => {
    if (!user.value) return;
    if (setAssigned) {
      set(
        dbRef(db, `data/${articleId}/status/signedUp/${user.value.uid}`),
        Date.now(),
      );
    } else {
      remove(dbRef(db, `data/${articleId}/status/signedUp/${user.value.uid}`));
    }
  };

  const markArticleAsDone = async (articleId: string) => {
    if (!user.value) return;
    set(
      dbRef(db, `data/${articleId}/status/markedDone/${user.value.uid}`),
      Date.now(),
    );
    if (isAdmin.value) {
      set(dbRef(db, `data/${articleId}/status/confirmedDone`), true);
    }
  };

  function removeOlderEntries(
    entries: Record<string, number>,
  ): Record<string, number> {
    return Object.fromEntries(
      Object.entries(entries).filter(([_, date]) => {
        const now = new Date();
        const diff = now.getTime() - date;
        return diff < 1000 * 3600 * 24;
      }),
    );
  }

  const allArticlesUnfiltered = useAsyncData(
    "nodes/article",
    () => $fetch("/api/nodes/article"),
    { lazy: true },
  );
  const allArticles = computed<[string, Article & EnrichedStatus][]>(() => {
    // Don't show any articles if the user is not logged in or there's no data yet.
    if (!user.value) return [];
    if (!allArticlesUnfiltered.value) return [];
    if (!user.value?.uid) return [];

    const result: [string, Article & EnrichedStatus][] = Object.entries(
      allArticlesUnfiltered.value,
    )
      .map(([articleId, articleData]) => {
        // remove status entries older than 24hs
        articleData.status = {
          signedUp: removeOlderEntries(articleData.status?.signedUp ?? {}),
          markedDone: removeOlderEntries(articleData.status?.markedDone ?? {}),
          confirmedDone: articleData.status?.confirmedDone ?? false,
          tags: articleData.status?.tags ?? [],
        };
        const status = articleData.status;

        if (!user.value)
          return [articleId, articleData] as [string, Article & EnrichedStatus];
        const userMarkedAsDone: boolean = !!status.markedDone[user.value.uid];
        const twoUsersMarkedAsDone: boolean =
          Object.keys(status.markedDone).length > 1;
        const userAssignedToThemselves: boolean =
          !!status.signedUp[user.value.uid];
        const assignedToAnotherUser: boolean =
          Object.keys(status.signedUp).filter((uid) => uid !== user.value?.uid)
            .length > 0;

        return [
          articleId,
          {
            ...articleData,
            enrichedStatus: {
              isAssignedToCurrentUser: userAssignedToThemselves,
              hideArticle:
                status.confirmedDone ||
                userMarkedAsDone ||
                twoUsersMarkedAsDone ||
                assignedToAnotherUser,
            },
          },
        ] as [string, Article & EnrichedStatus];
      })
      .filter(([_, article]) => !article.enrichedStatus?.hideArticle)
      .sort(([_1, articleA], [_2, articleB]) => {
        return (articleA.date ?? 0) - (articleB.date ?? 0);
      });
    return result;
  });

  const articlesAssigned = computed<[string, Article & EnrichedStatus][]>(() =>
    allArticles.value.filter(
      ([_, a]) => a.enrichedStatus?.isAssignedToCurrentUser,
    ),
  );
  const articlesUnssigned = computed<[string, Article & EnrichedStatus][]>(() =>
    allArticles.value.filter(
      ([_, a]) => !a.enrichedStatus?.isAssignedToCurrentUser,
    ),
  );

  type entityArticlesT = Record<
    string,
    Record<string, Article & EnrichedStatus>
  >;
  const entityArticles = computed<entityArticlesT>(() => {
    const result: entityArticlesT = {};
    allArticles.value.forEach(([id, a]) => {
      Object.entries(a.people ?? {}).forEach(([_, person]) => {
        if (!(person.id in result)) result[person.id] = {};
        result[person.id][id] = a;
      });

      Object.entries(a.companies ?? {}).forEach(([_, company]) => {
        if (!(company.id in result)) result[company.id] = {};
        result[company.id][id] = a;
      });
    });
    return result;
  });

  const articles = computed<Record<string, Article & EnrichedStatus>>(() =>
    Object.fromEntries(allArticles.value),
  );

  return {
    markArticleAsDone,
    articles,
    assignToArticle,
    articlesAssigned,
    articlesUnssigned,
    entityArticles,
  };
}

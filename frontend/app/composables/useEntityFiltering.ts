import { computed, type Ref, type ComputedRef } from "vue";
import { useAuthState } from "@/composables/auth";

export interface EntityWithVisibility {
  visibility?: boolean;
}

export function useEntityFiltering<
  T extends EntityWithVisibility,
  C extends T[] | Record<string, T>,
>(entities: Ref<C | undefined> | ComputedRef<C | undefined>) {
  const { user } = useAuthState();

  const filtered = computed(() => {
    const raw = entities.value;
    if (!raw) return raw as C | undefined;

    if (Array.isArray(raw)) {
      return (raw as T[]).filter((entity) => {
        if (user.value) return true;
        return entity.visibility !== false;
      }) as C;
    } else {
      return Object.fromEntries(
        Object.entries(raw as Record<string, T>).filter(([_, entity]) => {
          if (!entity) return false;
          if (user.value) return true;
          return entity.visibility !== false;
        }),
      ) as C;
    }
  });

  return filtered;
}

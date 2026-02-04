import type { Ref } from "vue";

interface UseEntityMutationOptions {
  authHeaders: Ref<Record<string, string>>;
}

interface MutationParams<T = any> {
  isNew: boolean;
  createEndpoint: string;
  revisionEndpoint: string;
  payload: T;
  onSuccess?: (response: any) => Promise<void> | void;
  successMessage?: string;
}

export function useEntityMutation(options: UseEntityMutationOptions) {
  const isSaving = ref(false);

  async function save<Result = { id: string }>({
    isNew,
    createEndpoint,
    revisionEndpoint,
    payload,
    onSuccess,
    successMessage,
  }: MutationParams) {
    if (isSaving.value) return;

    isSaving.value = true;
    try {
      const endpoint = isNew ? createEndpoint : revisionEndpoint;

      const response = await $fetch<Result>(endpoint, {
        method: "POST",
        body: payload,
        headers: options.authHeaders.value,
      });

      if (successMessage) {
        alert(successMessage);
      } else if (!isNew) {
        alert("Zapisano propozycję zmiany!");
      }

      if (onSuccess) {
        await onSuccess(response);
      }
      return response;
    } catch (e: any) {
      console.error(e);
      const msg =
        e.data?.message ||
        e.data?.statusMessage ||
        e.message ||
        "Unknown error";
      alert("Błąd zapisu: " + msg);
      throw e; // Re-throw so caller knows it failed if they care
    } finally {
      isSaving.value = false;
    }
  }

  return {
    isSaving,
    save,
  };
}

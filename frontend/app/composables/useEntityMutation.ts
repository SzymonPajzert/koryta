interface MutationParams<Payload = unknown, Result = any> {
  isNew: boolean;
  createEndpoint: string;
  revisionEndpoint: string;
  payload: Payload;
  onSuccess?: (response: Result) => Promise<void> | void;
  successMessage?: string;
}

export function useEntityMutation() {
  const isSaving = ref(false);
  const { authHeaders } = useAuthState(); // Ensure auth state is ready

  async function save<
    Result = { id: string },
    Payload extends Record<string, any> = any,
  >({
    isNew,
    createEndpoint,
    revisionEndpoint,
    payload,
    onSuccess,
    successMessage,
  }: MutationParams<Payload, Result>) {
    if (isSaving.value) return;

    isSaving.value = true;
    try {
      const endpoint = isNew ? createEndpoint : revisionEndpoint;

      const response = await $fetch<Result>(endpoint, {
        method: "POST",
        body: payload,
        headers: authHeaders.value,
      });

      if (successMessage) {
        alert(successMessage);
      } else if (!isNew) {
        alert("Zapisano propozycję zmiany!");
      }

      if (onSuccess) {
        await onSuccess(response as unknown as Result);
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

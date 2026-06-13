import { getFunctions, httpsCallable } from "firebase/functions";

export async function getPageMeta(url: string): Promise<{ title: string, meta?: any } | undefined> {
  const functions = getFunctions(useFirebaseApp(), "europe-west1");
  const callGetPageMeta = httpsCallable<{ url: string }, { title: string, meta?: any }>(
    functions,
    "getPageMeta",
  );
  const result = await callGetPageMeta({ url: url });
  if (result.data.title !== undefined) {
    if (result.data.meta?.ldJson && typeof result.data.meta.ldJson === "string") {
      try {
        result.data.meta.ldJson = JSON.parse(result.data.meta.ldJson);
      } catch (e) {
        console.error("Failed to parse ldJson", e);
      }
    }
    return result.data;
  }
  return undefined;
}

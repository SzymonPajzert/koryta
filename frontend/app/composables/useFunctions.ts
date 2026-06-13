import { getFunctions, httpsCallable } from "firebase/functions";

export type PageMeta = {
  title: string;
  meta?: {
    ldJson?: {
      mainEntityOfPage?: {
        url?: string;
      };
      dateModified?: string;
      datePublished?: string;
    };
  };
  url?: string;
};

export async function getPageMeta(url: string): Promise<PageMeta | undefined> {
  const functions = getFunctions(useFirebaseApp(), "europe-west1");
  const callGetPageMeta = httpsCallable<{ url: string }, PageMeta>(
    functions,
    "getPageMeta",
  );
  const result = await callGetPageMeta({ url: url });
  if (result.data.meta?.ldJson && typeof result.data.meta.ldJson === "string") {
    try {
      result.data.meta.ldJson = JSON.parse(result.data.meta.ldJson);
      // Prefer canonical URL from ld+json if available, otherwise use the provided URL
      result.data.url = result.data.meta.ldJson?.mainEntityOfPage?.url;
    } catch (e) {
      console.error("Failed to parse ldJson", e);
      return undefined;
    }
  }
  return result.data;
}

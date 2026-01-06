import { getFunctions, httpsCallable } from "firebase/functions";

export async function getPageTitle(url: string): Promise<string | undefined> {
  const functions = getFunctions(useFirebaseApp(), "europe-west1");
  const getPageTitle = httpsCallable<{ url: string }, { title: string }>(
    functions,
    "getPageTitle",
  );
  const result = await getPageTitle({ url: url });
  if (result.data.title) {
    return result.data.title;
  }
  return undefined;
}

import { computed, ref } from "vue";
import { useCurrentUser } from "vuefire";
import { authRequest } from "~/composables/auth";
import { normalizeUrl } from "~~/shared/url";
import type { ArticleCapture } from "~~/shared/capture";

/** Whether this account may capture pages at all.
 *
 * `/api/ingest/page` and `/api/pages` both refuse anyone outside the
 * datascience group, so the UI asks first rather than showing an affordance
 * that answers 403.
 */
export function useCanCapture() {
  const user = useCurrentUser();
  const canCapture = ref(false);

  watchEffect(async () => {
    if (!user.value) {
      canCapture.value = false;
      return;
    }
    const result = await user.value.getIdTokenResult();
    canCapture.value = result.claims.datascience === true;
  });

  return canCapture;
}

/** Recent captures, indexed by normalized url.
 *
 * `/zrodla` has a list of articles and wants to say, for each, whether anyone
 * has actually got its text. The two are joined on the normalized url — the
 * same rule the extraction ingest matches on, and for the same reason: the
 * crawler stores `https://www.example.pl/a/` where a capture might carry
 * `example.pl/a`.
 */
export function useCaptures(enabled: Ref<boolean>) {
  const captures = ref<ArticleCapture[]>([]);
  const pending = ref(false);
  const error = ref<string | null>(null);

  async function refresh() {
    if (!enabled.value) return;
    pending.value = true;
    error.value = null;
    try {
      const response = await authRequest<{ captures: ArticleCapture[] }>(
        "/api/pages",
        { method: "GET", query: { limit: 300 } },
      );
      captures.value = response.captures;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      pending.value = false;
    }
  }

  const byUrl = computed(() => {
    const map = new Map<string, ArticleCapture>();
    // Newest first from the API, so the first one seen for a url is the one to
    // keep — a page captured twice shows its latest run.
    for (const capture of captures.value) {
      if (!map.has(capture.normalizedUrl))
        map.set(capture.normalizedUrl, capture);
    }
    return map;
  });

  function forUrl(url: string | undefined): ArticleCapture | undefined {
    return url ? byUrl.value.get(normalizeUrl(url)) : undefined;
  }

  watchEffect(() => {
    if (enabled.value) refresh();
  });

  return { captures, byUrl, forUrl, refresh, pending, error };
}

/** Sends html someone saved by hand — the fallback for anyone without the
 * extension, and the only path an end-to-end test can drive. */
export async function submitCapturedHtml(options: {
  url: string;
  html: string;
  title?: string | null;
}): Promise<{ pageId: string; duplicate: boolean }> {
  // The endpoint takes base64 either way; a pasted page is small enough that
  // compressing it in the browser buys nothing.
  const bytes = new TextEncoder().encode(options.html);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return await authRequest("/api/ingest/page", {
    method: "POST",
    body: {
      url: options.url,
      html: btoa(binary),
      htmlEncoding: "base64",
      title: options.title ?? null,
      source: "paste",
    },
  });
}

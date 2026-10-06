/** An access token for this instance's own service account.
 *
 * App Hosting runs the server on Cloud Run, whose metadata server hands one
 * out the way a Google client library would get it - which is what lets the
 * few Google APIs the server calls (Cloud Tasks, Compute) go over REST rather
 * than through a library each. Only reachable on Cloud Run: locally there is
 * no metadata server, which is why every caller has an "off" or "direct" mode.
 */
export async function metadataAccessToken(): Promise<string> {
  const response = await $fetch<{ access_token: string }>(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  return response.access_token;
}

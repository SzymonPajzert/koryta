/** Handing a captured page to the extractor running on Cloud Run.
 *
 * The extraction is two or three LLM round trips — tens of seconds — so it
 * cannot happen inside the request that uploads the page, and it cannot be
 * fired and forgotten either: this process is itself on Cloud Run, where the
 * cpu is throttled the moment a response is written and anything still running
 * simply stops. So the work is handed to Cloud Tasks, which owns the retries
 * and the timeout, and calls the extractor with an OIDC token of its own.
 *
 * Talking to Cloud Tasks over its REST API rather than through
 * `@google-cloud/tasks` keeps a 40 MB dependency out of the frontend for what
 * is one POST; the access token comes from the metadata server the same way the
 * library would get it.
 */

export type ExtractorJob = {
  pageId: string;
  url: string;
  storagePath: string;
  htmlSha256: string;
  /** Who captured the page. The extractor stamps it on the facts it submits, so
   * a contribution is credited to the person who found the article rather than
   * to the service account that parsed it. */
  uploaderUid: string;
  articleNodeId?: string;
  /** The passage the reader picked out, when they picked one. The extractor
   * prefers it to anything a selector finds — see `oneshot.parse_page` — which
   * is the point: the person sending it was looking at the page, and the
   * selector is a guess made from other pages on the same domain. */
  contentOverride?: string;
};

type ExtractorConfig = {
  mode: "tasks" | "direct" | "off";
  url: string;
  queue: string;
  location: string;
  project: string;
  serviceAccount: string;
};

function extractorConfig(): ExtractorConfig {
  const config = useRuntimeConfig();
  const mode = String(config.extractorDispatch || "off");
  return {
    mode: mode === "tasks" || mode === "direct" ? mode : "off",
    url: String(config.extractorUrl || ""),
    queue: String(config.extractorQueue || ""),
    location: String(config.extractorLocation || ""),
    project: String(config.gcpProject || ""),
    serviceAccount: String(config.extractorServiceAccount || ""),
  };
}

/** An access token for this instance's own service account.
 *
 * Only reachable on Cloud Run; locally there is no metadata server, which is
 * exactly why `direct` mode exists.
 */
async function metadataAccessToken(): Promise<string> {
  const response = await $fetch<{ access_token: string }>(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  return response.access_token;
}

async function enqueueTask(
  config: ExtractorConfig,
  job: ExtractorJob,
): Promise<void> {
  const token = await metadataAccessToken();
  const parent = `projects/${config.project}/locations/${config.location}/queues/${config.queue}`;

  await $fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: {
      task: {
        httpRequest: {
          httpMethod: "POST",
          url: `${config.url.replace(/\/$/, "")}/extract`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(job), "utf8").toString("base64"),
          // Audience is the bare service url: Cloud Run checks the token
          // against the service, not against the path being called.
          oidcToken: {
            serviceAccountEmail: config.serviceAccount,
            audience: config.url,
          },
        },
        // A page is only worth extracting while someone is waiting for it. Past
        // this the nightly pipeline will reach it anyway, from `url_store`.
        dispatchDeadline: "1800s",
      },
    },
  });
}

/** Asks the extractor to process a stored capture.
 *
 * Never throws: a capture whose extraction could not be started is still a
 * capture, the html is already in the bucket, and the nightly pipeline reads it
 * regardless. The caller records the failure on the document instead of losing
 * the upload to it.
 */
export async function dispatchExtraction(
  job: ExtractorJob,
): Promise<{ dispatched: boolean; error?: string }> {
  const config = extractorConfig();
  if (config.mode === "off" || !config.url) {
    return { dispatched: false, error: "extractor not configured" };
  }

  try {
    if (config.mode === "tasks") {
      await enqueueTask(config, job);
    } else {
      // Development: the extractor is a process on this machine, and there is
      // no metadata server to mint a token with.
      //
      // Deliberately not awaited. The service does the whole extraction inside
      // the request — that is the contract Cloud Tasks wants — so waiting here
      // would hold the upload open for the entire LLM round trip and make the
      // popup behave nothing like it does in production. Locally there is no
      // cpu throttling after the response, so the call really does finish.
      void $fetch(`${config.url.replace(/\/$/, "")}/extract`, {
        method: "POST",
        body: job,
        headers: { "X-Koryta-Dispatch": "direct" },
      }).catch((error) =>
        console.error("Local extractor call failed", job.pageId, error),
      );
    }
    return { dispatched: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to dispatch extraction", job.pageId, message);
    return { dispatched: false, error: message };
  }
}

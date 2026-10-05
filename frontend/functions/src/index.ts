/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";
import axios from "axios";
import * as cheerio from "cheerio";
import { v1 } from "@google-cloud/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

interface incomingUrl {
  url: string;
}

export const getPageMeta = functions.https.onCall<incomingUrl>(
  {
    region: "europe-west1",
  },
  async (request, _context) => {
    let url = request.data.url;
    if (!url) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `The function must be called with one argument 'url ' that is a string: ${request}`,
      );
    }
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      url = "https://" + url;
    }

    try {
      const response = await axios.get(url, {
        // Ustawienie User-Agent może pomóc w uniknięciu blokowania przez niektóre serwery
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        },
        // Ustawienie timeoutu, aby uniknąć zbyt długiego oczekiwania
        timeout: 10000, // 10 sekund
      });

      const html = response.data;
      const $ = cheerio.load(html);
      const title = $("title").first().text().trim();

      let meta: { ldJson?: string } | undefined = undefined;
      const ldJsonScript = $('script[type="application/ld+json"]')
        .first()
        .html();
      if (ldJsonScript) {
        try {
          JSON.parse(ldJsonScript); // Verify it's valid JSON
          meta = { ldJson: ldJsonScript };
        } catch (e: unknown) {
          functions.logger.warn(`Failed to parse ld+json for URL: ${url}: `, e);
        }
      }

      if (!title) {
        // Jeśli tytuł jest pusty, ale strona została pobrana
        functions.logger.warn(`No title found for URL: ${url}`);
        return { title: "", ...(meta ? { meta } : {}) };
      }

      return { title: title, ...(meta ? { meta } : {}) };
    } catch (error: unknown) {
      functions.logger.error(
        `Error fetching page title for URL: ${url}`,
        error,
      );

      // Rzucanie bardziej szczegółowych błędów w zależności od przyczyny
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // Serwer odpowiedział statusem błędu (4xx, 5xx)
          throw new functions.https.HttpsError(
            "unavailable",
            `Failed to fetch the page. Status: ${error.response.status}`,
          );
        } else if (error.request) {
          // Żądanie zostało wysłane, ale nie otrzymano odpowiedzi
          throw new functions.https.HttpsError(
            "deadline-exceeded",
            "No response received from the server.",
          );
        } else {
          // Coś poszło nie tak przy konfiguracji żądania
          throw new functions.https.HttpsError(
            "internal",
            "Error setting up the request.",
          );
        }
      }
      // Inne błędy (np. błąd parsowania, błąd sieciowy nieobsłużony przez axios)
      throw new functions.https.HttpsError(
        "internal",
        "An unexpected error occurred while fetching the page title.",
      );
    }
  },
);

const adminClient = new v1.FirestoreAdminClient();

/**
 * The nightly dump the scrapers read (`snapshot.py`) and `npm run db:pull`
 * seeds the emulator from, taken at 04:00 Warsaw time.
 *
 * Once a day, not twice, because an export is billed one document read per
 * document exported - 94,103 of them as of 12 August 2026, and the reads do
 * not show up in the console's usage figures, so this was a third of the
 * database's daily cost while being invisible in the place anyone would look
 * for it. Nothing consumes the second run: `latest_export` and `pull-db.sh`
 * both take the newest directory, and the pipelines that read it are daily.
 *
 * Disaster recovery does not rest on this either: the invoice carries a Cloud
 * Firestore Zonal Backup Storage line, so the database also has Firestore's own
 * backup schedule, which is billed by stored size rather than by read.
 */
export const scheduledFirestoreExport = onSchedule(
  {
    // 04:00 in Warsaw, where the people who read the dump are, rather than in
    // UTC - which would be 06:00 for half the year and 05:00 for the other.
    schedule: "every day 04:00",
    timeZone: "Europe/Warsaw",
    region: "europe-west1",
  },
  async (_event: unknown) => {
    const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
    if (!projectId) {
      logger.error("No project ID found");
      throw new Error("No project ID found");
    }

    const databaseName = adminClient.databasePath(projectId, "koryta-pl");
    const bucketPrefix = "gs://koryta-pl-crawled/hostname=koryta.pl";
    const timestamp = new Date().toISOString();
    const outputUriPrefix = `${bucketPrefix}/date=${timestamp}`;

    try {
      const [response] = await adminClient.exportDocuments({
        name: databaseName,
        outputUriPrefix: outputUriPrefix,
        collectionIds: [
          "comments",
          "edges",
          "nodes",
          "notes",
          "revisions",
          "stats",
          "votes",
          "extractions",
          "feedback",
        ],
      });

      logger.info(`Operation Name: ${response.name}`);
    } catch (err) {
      logger.error(err);
      throw new Error("Export operation failed", { cause: err });
    }
  },
);

export { onVoteWritten } from "./votes";
export { onNoteWritten } from "./notes";
export { onEdgeWritten, sweepEdgeStats } from "./edges";
export { onNodeWritten } from "./nodes";
export { onRevisionWritten } from "./revisions";
export { onFeedbackCreated } from "./feedback";

export * from "./votes";

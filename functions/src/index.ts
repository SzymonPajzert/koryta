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

export const getPageTitle = functions.https.onCall<incomingUrl>(
  {
    region: "europe-west1",
  },
  async (request, context) => {
    let url = request.data.url;
    if (!url) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `The function must be called with one argument 'url ' that is a string: ${request}`
      );
    }
    logger.warn(url);
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

      if (!title) {
        // Jeśli tytuł jest pusty, ale strona została pobrana
        functions.logger.warn(`No title found for URL: ${url}`);
        return { title: "" };
      }

      return { title: title };
    } catch (error: any) {
      functions.logger.error(
        `Error fetching page title for URL: ${url}`,
        error
      );

      // Rzucanie bardziej szczegółowych błędów w zależności od przyczyny
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // Serwer odpowiedział statusem błędu (4xx, 5xx)
          throw new functions.https.HttpsError(
            "unavailable",
            `Failed to fetch the page. Status: ${error.response.status}`
          );
        } else if (error.request) {
          // Żądanie zostało wysłane, ale nie otrzymano odpowiedzi
          throw new functions.https.HttpsError(
            "deadline-exceeded",
            "No response received from the server."
          );
        } else {
          // Coś poszło nie tak przy konfiguracji żądania
          throw new functions.https.HttpsError(
            "internal",
            "Error setting up the request."
          );
        }
      }
      // Inne błędy (np. błąd parsowania, błąd sieciowy nieobsłużony przez axios)
      throw new functions.https.HttpsError(
        "internal",
        "An unexpected error occurred while fetching the page title."
      );
    }
  }
);

const adminClient = new v1.FirestoreAdminClient();

export const scheduledFirestoreExport = onSchedule(
  {
    schedule: "every 12 hours",
    region: "europe-west1",
  },
  async (event: any) => {
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
        collectionIds: ["nodes", "edges"],
      });

      logger.info(`Operation Name: ${response.name}`);
    } catch (err) {
      logger.error(err);
      throw new Error("Export operation failed");
    }
  }
);

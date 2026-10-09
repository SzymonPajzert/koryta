import { defineEventHandler, getRequestURL, sendRedirect } from "h3";

/** A browser that opens the `List-Unsubscribe` address instead of posting to
 * it lands on the page that asks first. A GET changes nothing: link scanners
 * open every URL in a message. */
export default defineEventHandler((event) =>
  sendRedirect(event, `/wypisz${getRequestURL(event).search}`, 302),
);

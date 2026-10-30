import { registerEndpoint } from "@nuxt/test-utils/runtime";
import {
  createError,
  getQuery,
  setResponseHeaders,
  setResponseStatus,
  type H3Event,
} from "h3";
// The error handler of a production build, which every `/api/` error goes
// through on the site: Nuxt's own handler leaves JSON requests to it.
import { defaultHandler } from "nitropack/runtime/internal/error/prod";

/** A request turned down: the status, and the words, if any, that the
 * handler gave `createError`. */
export type Refusing = { status: number; message?: string };

/**
 * Answers as the site's server does when a handler throws
 * `createError({ statusCode, message })`: through Nitro's error handler, as
 * a production build runs it. Not h3's bare one, which `registerEndpoint`
 * would use for an error thrown in a handler: that leaves the message out of
 * the body, and a test against it would prove the page right for a shape no
 * server sends.
 */
export function refuse(event: H3Event, { status, message }: Refusing) {
  const response = defaultHandler(
    createError({ statusCode: status, message }),
    event,
  );
  setResponseHeaders(event, response.headers);
  setResponseStatus(event, response.status, response.statusText);
  return response.body;
}

const REFUSAL = "/api/test/refusal";
let registered = false;

/** The error `$fetch` fails with when the server turns a request down with
 * `status` and `message`: fetched for real, through the ofetch the page's
 * requests go out with, from an endpoint that answers with `refuse`. For a
 * mocked `authRequest` to fail with, as a signed-in reader's request does. */
export async function failedWith(
  status: number,
  message?: string,
): Promise<unknown> {
  if (!registered) {
    registered = true;
    registerEndpoint(REFUSAL, (event) => {
      const query = getQuery(event);
      return refuse(event, {
        status: Number(query.status),
        message: typeof query.message === "string" ? query.message : undefined,
      });
    });
  }
  return await $fetch(REFUSAL, {
    query: message === undefined ? { status } : { status, message },
  }).then(
    () => {
      throw new Error(`${REFUSAL} answered 200`);
    },
    (err: unknown) => err,
  );
}

/** The error `$fetch` fails with when no answer comes at all: a real request
 * to a port nothing listens on. */
export async function noAnswer(): Promise<unknown> {
  return await $fetch("http://127.0.0.1:9/", { retry: 0 }).then(
    () => {
      throw new Error("something answered on port 9");
    },
    (err: unknown) => err,
  );
}

/** The server's words as it turns a reader down
 * (server/utils/declarations.ts and server/api/declarations/). */
export const REFUSED = {
  /** 429: the day's answers, or asks, without a vote are used up, for a
   * reader without an account (`votelessRefusal`). */
  noAccount:
    "Na dziś przyjęliśmy już tyle odczytów bez konta, ile możemy. Zaloguj się albo załóż konto, żeby czytać dalej.",
  /** 429: the same, for an account whose address nobody confirmed. */
  notConfirmed:
    "Na dziś przyjęliśmy już tyle odczytów bez potwierdzonego adresu e-mail, ile możemy. Potwierdź adres (link przyszedł po rejestracji), żeby czytać dalej.",
  /** 429: one reader's answers for the day (`READER_DAILY_LIMIT`). */
  dailyLimit: "Na dziś wystarczy - dziękujemy! Wróć jutro.",
  /** 404: a crop withdrawn, or whose declaration failed. */
  gone: "Nie ma takiego wycinka.",
  /** 403: a claim by an account whose address nobody confirmed. */
  claimNotConfirmed:
    "Potwierdź adres e-mail (link przyszedł po rejestracji), a odczyty z tej przeglądarki przejdą na Twoje konto.",
  /** 401: a token the server will not take (`getUser`). */
  badToken:
    "Błąd uwierzytelniania: nieważny token. Proszę zalogować się ponownie.",
  /** 401: neither a token nor a reader id (`getReader`). */
  noReader:
    "Błąd uwierzytelniania: brak tokenu ani identyfikatora czytelnika. Proszę się zalogować.",
} as const;

/** What /oswiadczenia says in the server's place, where the server's words
 * would mislead (app/composables/declarationQueue.ts). */
export const PAGE_SAYS = {
  /** For a 401, whose words speak of a token (`SIGNED_OUT_LINE`). */
  signedOut: "Sesja wygasła. Spróbuj ponownie albo zaloguj się jeszcze raz.",
  /** For an answer to a crop that is gone, which the server's „Nie ma
   * takiego wycinka.” would seem to say of the next one (`GONE_LINE`). */
  gone: "Jeden z wycinków zniknął z kolejki, zanim zdążyliśmy zapisać Twoją odpowiedź.",
} as const;

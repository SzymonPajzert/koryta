import * as Sentry from "@sentry/nuxt";

const config = useRuntimeConfig();
const { appEnv, release, buildTime } = config.public.buildInfo;

Sentry.init({
  // If set up, you can use your runtime config here
  // dsn: useRuntimeConfig().public.sentry.dsn,
  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  // Both backends report into the same Sentry project, so without these an
  // issue on autopush is indistinguishable from one in front of real users,
  // and no issue can be traced to the deploy that introduced it. "unknown"
  // means a backend has no Environment name set in the App Hosting console.
  environment: appEnv,
  release,

  tracesSampleRate: config.public.sentry.tracesSampleRate,
  replaysSessionSampleRate: config.public.sentry.replaysSessionSampleRate,

  // If the entire session is not sampled, use the below sample rate to sample
  // sessions when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // If you don't want to use Session Replay, just remove the line below:
  integrations: [],

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Separates two rollouts of the same commit, and is the only identity a
  // build has when its build environment exposes no sha.
  initialScope: { tags: { buildTime } },
});

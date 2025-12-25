import { vi } from "vitest";

// We do NOT mock vuefire or firebase/firestore here because we want to connect to the emulators.
// However, we might want to mock other unrelated things like Sentry.

vi.mock("@sentry/nuxt", () => ({
  init: vi.fn(),
  replayIntegration: vi.fn(),
}));

console.log("Integration test setup loaded.");

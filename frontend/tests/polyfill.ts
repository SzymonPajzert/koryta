import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextDecoder, TextEncoder });
if (typeof window !== "undefined") {
  Object.assign(window, { TextDecoder, TextEncoder });
}
if (typeof global !== "undefined") {
  Object.assign(global, { TextDecoder, TextEncoder });
}

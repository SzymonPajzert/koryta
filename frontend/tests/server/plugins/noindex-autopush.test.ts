import { afterEach, describe, expect, it, vi } from "vitest";
import { createSiteConfigStack } from "site-config-stack";
import plugin from "../../../server/plugins/noindex-autopush";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineNitroPlugin = (fn: any) => fn;
});

type InitHook = (ctx: {
  siteConfig: ReturnType<typeof createSiteConfigStack>;
}) => void;

/** Runs the plugin as the backend `service` would, and returns the
 * `site-config:init` hook it registered, if any. */
function register(service: string | undefined): InitHook | undefined {
  vi.stubEnv("K_SERVICE", service);
  let registered: InitHook | undefined;
  const nitro = {
    hooks: {
      hook: (name: string, fn: InitHook) => {
        if (name === "site-config:init") registered = fn;
      },
    },
  };
  (plugin as unknown as (nitro: unknown) => void)(nitro);
  return registered;
}

/** The site config the way a deployed build resolves it: indexable, at the
 * highest priority the module itself uses. */
function deployedSiteConfig() {
  const siteConfig = createSiteConfigStack();
  siteConfig.push({
    _context: "runtimeEnv",
    _priority: 0,
    url: "https://koryta.pl",
    indexable: true,
  });
  return siteConfig;
}

describe("noindex-autopush", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("marks autopush as not indexable", () => {
    const hook = register("autopush");
    const siteConfig = deployedSiteConfig();
    hook!({ siteConfig });
    expect(siteConfig.get().indexable).toBe(false);
    expect(siteConfig.get().url).toBe("https://koryta.pl");
  });

  it.each([["prod"], [undefined]])("leaves %s alone", (service) => {
    expect(register(service)).toBeUndefined();
  });
});

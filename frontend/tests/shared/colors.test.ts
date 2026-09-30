import { describe, it, expect } from "vitest";
import {
  AA_LARGE_TEXT,
  AA_TEXT,
  brand,
  contrastRatio,
  hexToRgb,
  ink,
  meetsAaText,
  readableInkOn,
  relativeLuminance,
  role,
  statusFill,
  surface,
  themeColors,
} from "../../shared/colors";

/** Two decimals is how the ratios are quoted in colors.ts and in reports. */
const ratio = (fg: string, bg: string) =>
  Math.round(contrastRatio(fg, bg) * 100) / 100;

describe("relativeLuminance", () => {
  it("pins the ends of the scale", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
  });

  it("weights green above red above blue", () => {
    const red = relativeLuminance([255, 0, 0]);
    const green = relativeLuminance([0, 255, 0]);
    const blue = relativeLuminance([0, 0, 255]);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(red + green + blue).toBeCloseTo(1, 10);
  });

  it("applies the sRGB linearisation below the 0.03928 knee", () => {
    // A channel of 10/255 = 0.0392 sits under the knee, so it divides by
    // 12.92 instead of taking the power. Getting this branch wrong shifts
    // every dark colour and would let a too-light ink pass.
    expect(relativeLuminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 12);
  });
});

describe("contrastRatio", () => {
  it("matches the published value for #767676 on white", () => {
    // The WCAG reference example: #767676 is the lightest grey that passes AA
    // on white, at 4.54:1. A formula that misses this cannot be trusted to
    // judge the palette below.
    expect(ratio("#767676", "#ffffff")).toBe(4.54);
  });

  it("spans 1:1 to 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#a8c79f", "#a8c79f")).toBeCloseTo(1, 10);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio(ink.sage, surface.white)).toBe(
      contrastRatio(surface.white, ink.sage),
    );
  });

  it("reads shorthand hex the same as the long form", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(contrastRatio("#fff", "#000")).toBe(
      contrastRatio("#ffffff", "#000000"),
    );
  });

  it("rejects anything that is not a hex colour", () => {
    expect(() => contrastRatio("primary", "#ffffff")).toThrow();
    expect(() => contrastRatio("rgb(0,0,0)", "#ffffff")).toThrow();
    expect(() => contrastRatio("#12345", "#ffffff")).toThrow();
  });
});

describe("ink tokens", () => {
  it("clears AA for body text on every surface", () => {
    // The whole point of the ramp: any ink may be put on any surface without
    // going back to the calculator. Reported as a table so a failure names the
    // pair rather than just a number.
    const failing = Object.entries(ink).flatMap(([name, colour]) =>
      Object.entries(surface)
        .filter(([, background]) => !meetsAaText(colour, background))
        .map(([surfaceName, background]) => ({
          pair: `ink.${name} on surface.${surfaceName}`,
          ratio: ratio(colour, background),
        })),
    );
    expect(failing).toEqual([]);
  });

  it("clears AA on the blush fill", () => {
    // Chips and highlights are painted in brand.secondary, which is the
    // tightest background any ink here is meant to land on and therefore what
    // fixes how dark the ramp has to be. brand.primary is deliberately not in
    // this list: it takes black, via readableInkOn.
    const failing = Object.entries(ink)
      .filter(([, colour]) => !meetsAaText(colour, brand.secondary))
      .map(([name, colour]) => ({
        pair: `ink.${name} on brand.secondary`,
        ratio: ratio(colour, brand.secondary),
      }));
    expect(failing).toEqual([]);
  });

  it("keeps headroom on white for 10-12px text", () => {
    // AA is the floor; the chips and meta lines these serve run 10-12px, so
    // each ink is held a third above it. An ink at exactly 4.5 would pass the
    // letter of the check above and still read badly at that size.
    const thin = Object.entries(ink)
      .filter(([, colour]) => contrastRatio(colour, surface.white) < 6)
      .map(([name, colour]) => ({
        ink: name,
        onWhite: ratio(colour, surface.white),
      }));
    expect(thin).toEqual([]);
  });

  it("records the exact measured ratios quoted in colors.ts", () => {
    expect({
      sage: ratio(ink.sage, surface.white),
      success: ratio(ink.success, surface.white),
      warning: ratio(ink.warning, surface.white),
      danger: ratio(ink.danger, surface.white),
      info: ratio(ink.info, surface.white),
      neutral: ratio(ink.neutral, surface.white),
      strong: ratio(ink.strong, surface.white),
    }).toEqual({
      sage: 6.43,
      success: 6.73,
      warning: 6.5,
      danger: 6.54,
      info: 6.35,
      neutral: 6.5,
      strong: 19.68,
    });
  });

  it("pairs each surface with its own ink", () => {
    expect({
      sage: ratio(ink.sage, surface.sage),
      success: ratio(ink.success, surface.success),
      warning: ratio(ink.warning, surface.warning),
      danger: ratio(ink.danger, surface.danger),
      info: ratio(ink.info, surface.info),
      neutral: ratio(ink.neutral, surface.muted),
    }).toEqual({
      sage: 5.57,
      success: 5.57,
      warning: 5.54,
      danger: 5.2,
      info: 5.17,
      neutral: 5.75,
    });
  });
});

describe("brand fills", () => {
  it("pins black on the brand colours", () => {
    // These two are the reason the brand works as a fill. If somebody
    // repaints primary or secondary, this fails here rather than quietly
    // dimming every chip and header band on the site.
    expect(ratio(ink.strong, brand.primary)).toBe(10.62);
    expect(ratio("#000000", brand.primary)).toBe(11.33);
    expect(ratio("#000000", brand.secondary)).toBe(15.29);
  });

  it("records that the brand colours are unusable as ink on white", () => {
    // The bug this palette exists to fix: text-primary on a white card.
    // Pinned so nobody "fixes" a contrast complaint by reaching for them.
    expect(ratio(brand.primary, surface.white)).toBe(1.85);
    expect(ratio(brand.secondary, surface.white)).toBe(1.37);
    expect(meetsAaText(brand.primary, surface.white)).toBe(false);
  });

  it("keeps every surface light enough for black", () => {
    for (const background of Object.values(surface)) {
      expect(contrastRatio("#000000", background)).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("roles", () => {
  it("names each part with the colour it was already painted", () => {
    // The roles only gave the parts names; nothing on the site changed with
    // them. A palette change is the moment these move.
    expect(role.band).toBe(brand.primary);
    expect(role.cta).toBe(ink.info);
    expect(role.ctaPale).toBe(surface.info);
    expect(role.background).toBe(surface.white);
  });

  it("records the ratios quoted beside them", () => {
    expect({
      blackOnBand: ratio("#000000", role.band),
      whiteOnCta: ratio(surface.white, role.cta),
      paleOnCta: ratio(role.ctaPale, role.cta),
      whiteOnCtaDeep: ratio(surface.white, role.ctaDeep),
    }).toEqual({
      blackOnBand: 11.33,
      whiteOnCta: 6.35,
      paleOnCta: 5.17,
      whiteOnCtaDeep: 7.8,
    });
  });

  it("keeps the call to action's bar segments visible on their strip", () => {
    // Fills, not text: 3:1 is what a segment needs to be seen against the
    // groove it sits in.
    expect(ratio(role.ctaPublished, role.ctaDeep)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT,
    );
    expect(ratio(role.ctaReviewed, role.ctaDeep)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT,
    );
  });

  it("hands every role to Vuetify under its kebab-cased name", () => {
    const kebab = (name: string) =>
      name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    for (const [name, colour] of Object.entries(role)) {
      if (name === "focusRing") continue; // drawn on a canvas, not by Vuetify
      expect({
        name,
        colour: themeColors[kebab(name) as keyof typeof themeColors],
      }).toEqual({
        name,
        colour,
      });
    }
  });
});

describe("readableInkOn", () => {
  it("puts white on a dark party colour", () => {
    // Konfederacja's #102440 with the old fixed dark label measured 1.29:1.
    expect(readableInkOn("#102440")).toBe(surface.white);
    expect(
      contrastRatio(readableInkOn("#102440"), "#102440"),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("puts dark ink on a light party colour", () => {
    expect(readableInkOn("#f5c400")).toBe(ink.strong);
  });

  it("always picks the higher-contrast pole", () => {
    for (const fill of [
      "#000000",
      "#ffffff",
      "#808080",
      "#7f7f7f",
      "#102440",
    ]) {
      const chosen = readableInkOn(fill);
      const other = chosen === surface.white ? ink.strong : surface.white;
      expect(contrastRatio(chosen, fill)).toBeGreaterThanOrEqual(
        contrastRatio(other, fill),
      );
    }
  });

  it("clears AA for body text on both brand fills", () => {
    for (const fill of [brand.primary, brand.secondary]) {
      expect({ fill, ok: meetsAaText(readableInkOn(fill), fill) }).toEqual({
        fill,
        ok: true,
      });
    }
  });

  it("clears AA for large text on every chart series colour", () => {
    // The categorical slots are fills for bars and dots with a bold label on
    // them, so 3:1 is the bar. Body-size text is out of reach on the mid-tone
    // slots whichever pole is chosen - #2a78d6 peaks at 4.46:1 - which is why
    // this asks for AA_LARGE_TEXT and not AA_TEXT.
    const fills = [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ];
    const failing = fills
      .map((fill) => ({ fill, ratio: ratio(readableInkOn(fill), fill) }))
      .filter(({ ratio: r }) => r < AA_LARGE_TEXT);
    expect(failing).toEqual([]);
  });
});

describe("themeColors", () => {
  it("exposes every ink and surface under a kebab-cased Vuetify name", () => {
    for (const [name, colour] of Object.entries(ink)) {
      expect(themeColors[`ink-${name}` as keyof typeof themeColors]).toBe(
        colour,
      );
    }
    for (const [name, colour] of Object.entries(surface)) {
      if (name === "white") continue; // Vuetify already ships `surface`.
      expect(themeColors[`surface-${name}` as keyof typeof themeColors]).toBe(
        colour,
      );
    }
  });

  it("carries the brand fills, so the Vuetify config needs none of its own", () => {
    // They used to be typed into nuxt.config.ts beside the copy in `brand` -
    // two sources for one colour, which is how a theme drifts. The config now
    // hands over `themeColors` whole; colourLiterals.test.ts keeps it so.
    expect(themeColors.primary).toBe(brand.primary);
    expect(themeColors.secondary).toBe(brand.secondary);
  });

  it("declares Vuetify's status fills at the values Vuetify ships", () => {
    // Inherited silently until they were declared here; declaring them must
    // not have repainted a single alert.
    expect(statusFill).toEqual({
      success: "#4caf50",
      info: "#2196f3",
      warning: "#fb8c00",
      error: "#b00020",
    });
    for (const [name, colour] of Object.entries(statusFill)) {
      expect(themeColors[name as keyof typeof themeColors]).toBe(colour);
    }
  });

  it("gives every on-* entry AA on the surface it names", () => {
    // Vuetify paints `color: on-<name>` whenever a component wears
    // `bg-<name>`, so an on-* entry that fails is a chip nobody can read even
    // though every token in it passed on its own.
    const pairs = Object.entries(themeColors).filter(([name]) =>
      name.startsWith("on-"),
    );
    expect(pairs.length).toBeGreaterThan(0);
    const failing = pairs
      .map(([name, colour]) => ({
        name,
        background:
          themeColors[name.slice("on-".length) as keyof typeof themeColors],
        colour,
      }))
      .filter(({ colour, background }) => !meetsAaText(colour, background))
      .map(({ name, colour, background }) => ({
        name,
        ratio: ratio(colour, background),
      }));
    expect(failing).toEqual([]);
  });
});

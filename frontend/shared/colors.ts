/**
 * The site's colours, and the WCAG maths that keeps them honest.
 *
 * The brand palette is two pale surface colours - primary #a8c79f (sage) and
 * secondary #fad3d0 (blush). They are excellent fills: black on sage measures
 * 11.33:1 and black on blush 15.29:1. They are not text colours, and the app
 * had been using them as text anyway - `text-primary` on a white card paints
 * 12px labels at 1.85:1, well under the 4.5:1 AA needs. The same happened to
 * the status colours: #fb8c00 as the "szkic" chip's ink is 2.37:1 and
 * #0ca30c is 3.35:1.
 *
 * So this module adds the half of the palette that was missing: an `ink.*`
 * ramp, one per hue, dark enough to be read at 10-12px, and a `surface.*`
 * ramp of pale tints to put them on. Every ink here clears 4.5:1 on every
 * surface here and on brand.secondary, so a component may pair any ink with
 * any of them without re-measuring. Ratios in the comments were measured with
 * `contrastRatio` below and are pinned by tests/shared/colors.test.ts.
 *
 * The one background they do not cover is brand.primary, which is dark enough
 * that only black reads on it: sage ink on it is 3.47:1, black 10.62:1. Text
 * on primary, on a party colour or on a chart series colour asks
 * `readableInkOn` instead.
 *
 * This is also the one place the site's colours are written down. nuxt.config
 * hands `themeColors` to Vuetify whole, components ask for a token
 * (`bg-cta`, `rgb(var(--v-theme-band))`) rather than a hex, and
 * tests/shared/colourLiterals.test.ts fails on a hex anywhere else. Data has
 * palettes of its own - charts in app/utils/chartTheme.ts, the relation graph
 * in shared/graph, parties in shared/misc.ts - because a series colour answers
 * a different question from a button's. Trying a new palette on the site is an
 * edit to `brand`, `role` and the ink/surface ramps below, and nothing else.
 */

/** An `#rgb` or `#rrggbb` colour. */
export type Hex = string;

/** Channel triple, 0-255, in sRGB. */
export type Rgb = readonly [number, number, number];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parses `#abc` and `#aabbcc`. Throws rather than returning a default: a
 * silently black colour would make `contrastRatio` report 21:1 for a typo and
 * bless a palette nobody can read.
 */
export function hexToRgb(hex: Hex): Rgb {
  if (!HEX_RE.test(hex)) throw new Error(`not a hex colour: ${hex}`);
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * WCAG 2.1 relative luminance of an sRGB triple.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(rgb: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
  );
}

/**
 * WCAG 2.1 contrast ratio, 1:1 to 21:1. Symmetric, so the argument names are
 * documentation rather than a constraint.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export function contrastRatio(fg: Hex, bg: Hex): number {
  const a = relativeLuminance(hexToRgb(fg));
  const b = relativeLuminance(hexToRgb(bg));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for body text (and for icons carrying meaning). */
export const AA_TEXT = 4.5;

/** WCAG AA for text at 18.66px bold or 24px, and for UI component edges. */
export const AA_LARGE_TEXT = 3;

/**
 * The brand. Fills only - see the module comment. Repainting either is a
 * palette change, and tests/shared/colors.test.ts pins what black measures on
 * both so that it is made on purpose.
 */
export const brand = {
  /** Sage. Header bands, card accents, buttons. Black on it: 11.33:1. */
  primary: "#a8c79f",
  /** Blush. Secondary buttons and highlights. Black on it: 15.29:1. */
  secondary: "#fad3d0",
} as const;

/**
 * Text and icon colours. Each is the darkest useful step of its hue rather
 * than the lightest that passes: chips and meta lines on this site run
 * 10-12px, where 4.5:1 is the floor and not a target, so every ink here keeps
 * at least a third again of headroom on white.
 *
 * Ratios listed as white / surface.sage / brand.secondary - the lightest
 * background and the two most common tinted ones. brand.secondary is the
 * tightest of the three and is what sets how dark the ramp has to be.
 */
export const ink = {
  /** The companion `text-primary` never had. 6.43 / 5.57 / 4.68 */
  sage: "#46673c",
  /** "Opublikowane", done states. Darkened from the #0ca30c fill, which as
   * text measured 3.35:1. 6.73 / 5.84 / 4.90 */
  success: "#096b09",
  /** "szkic" and other cautions. Darkened from the #fb8c00 fill, which as the
   * chip's 10px label measured 2.37:1. 6.50 / 5.63 / 4.73 */
  warning: "#8a5008",
  /** Errors, removals, conflict counts. 6.54 / 5.67 / 4.76 */
  danger: "#b3261e",
  /** Links and "sprawdzone, nieopublikowane". 6.35 / 5.50 / 4.63 */
  info: "#1f5fae",
  /** Meta lines and secondary labels; replaces #607d8b, which was 4.37:1 on
   * white and therefore never passed. 6.50 / 5.64 / 4.74 */
  neutral: "#4c616b",
  /** Body copy and the dark pole of `readableInkOn`. 19.68 / 17.06 / 14.33 */
  strong: "#0b0b0b",
} as const;

/**
 * Pale backgrounds for chips, pills and callouts. The sage one is
 * `brand.primary` at 25% over white, so a pill reads as the same colour as
 * the header band it sits under; the rest are their status hue tinted to a
 * comparable lightness.
 *
 * Ratio listed is against the ink of the same name, which is the pairing the
 * components use.
 */
export const surface = {
  /** The page and the cards. */
  white: "#ffffff",
  /** Meta pills, "od 12 kwietnia 2024". ink.sage on it: 5.57:1 */
  sage: "#e9f1e7",
  /** ink.success on it: 5.57:1 */
  success: "#d8f0d8",
  /** ink.warning on it: 5.54:1 */
  warning: "#feead1",
  /** ink.danger on it: 5.20:1 */
  danger: "#f7e0e0",
  /** ink.info on it: 5.17:1 */
  info: "#dde9f8",
  /** Counts, inactive chips, table zebra. ink.neutral on it: 5.75:1 */
  muted: "#f2f1ed",
} as const;

/**
 * Vuetify's own status fills - `color="error"`, `type="info"`, `bg-success`.
 * These are the values Vuetify ships and the site had been inheriting without
 * saying so; declared here so they are one more line to change rather than a
 * default nobody can see. Fills only, like `brand`: as text #fb8c00 is 2.37:1
 * and #4caf50 2.78:1, which is what the `ink.*` ramp is for.
 */
export const statusFill = {
  success: "#4caf50",
  info: "#2196f3",
  warning: "#fb8c00",
  error: "#b00020",
} as const;

/**
 * The parts of a page that carry the palette, named for what they do rather
 * than for their hue, so that a new palette changes values here and no
 * component has to be opened.
 *
 * Every value is the colour the part was already painted, so this table
 * changes nothing on the site; it only gives each of them a name. `band` and
 * `brand.primary` are the same sage today and are kept apart so that a
 * palette can darken the buttons without darkening the hero band.
 */
export const role = {
  /** The page itself, behind the cards. */
  background: surface.white,
  /** The page behind the cards on /o-nas and /pomoc (the `gray` layout). It
   * was Vuetify's `grey-lighten-4`. */
  backdrop: "#f5f5f5",
  /** The home page's hero band and the footer. Black on it: 11.33:1 */
  band: brand.primary,
  /** The home call to action: the pane with the figures, and its button.
   * White on it: 6.35:1 */
  cta: ink.info,
  /** The strip under the call to action's figures that the bar sits in, a
   * shade darker than `cta`. White on it: 7.80:1 */
  ctaDeep: "#1a5296",
  /** The pale labels on the call to action's pane - „Sprawdziliśmy już”, the
   * legend. On `cta`: 5.17:1 */
  ctaPale: surface.info,
  /** The bar in that strip: published is the pale end of the site's green,
   * checked-but-unpublished the pale end of its blue, lightened until they
   * hold 3:1 against `ctaDeep` (5.7:1 and 3.7:1). */
  ctaPublished: "#bfe6b8",
  ctaReviewed: "#8fb6ea",
  /** What is left to check: a groove, laid at 42% over `ctaDeep`. */
  ctaGroove: "#041634",
  /** The ring round the subject of a relation graph - sage, a shade darker
   * than `brand.primary`, which is too pale to read as a ring on white. */
  focusRing: "#5f7a54",
} as const;

/** Colours that belong to somebody else and are used as theirs. */
export const external = {
  /** Zrzutka.pl's pink, on the buttons that send a reader to the fundraiser. */
  zrzutka: "#e64164",
} as const;

/**
 * The notification emails. Mail clients drop stylesheets, so these go inline
 * as literals rather than as theme variables.
 */
export const email = {
  text: "#1c1c1c",
  rule: "#e0e0e0",
  muted: "#666666",
} as const;

/**
 * `ink.strong` or white, whichever is legible on `background`.
 *
 * Party chips take their colour from the party, and that palette runs from
 * #f5c400 to near-black; a fixed dark label put #090707 on Konfederacja's
 * #102440 at 1.29:1, which is invisible.
 *
 * This picks the better of two poles, which is not the same as passing AA: a
 * mid-tone fill can be too dark for black and too light for white at once
 * (#2a78d6 tops out at 4.46:1). A chip that has to carry body-size text on
 * such a colour needs the fill darkened, not a cleverer label.
 */
export function readableInkOn(background: Hex): Hex {
  return contrastRatio(ink.strong, background) >=
    contrastRatio(surface.white, background)
    ? ink.strong
    : surface.white;
}

/** True when `fg` on `bg` clears AA for body text. */
export function meetsAaText(fg: Hex, bg: Hex): boolean {
  return contrastRatio(fg, bg) >= AA_TEXT;
}

/**
 * The tokens as Vuetify wants them, kebab-cased so the generated utility
 * classes read `text-ink-sage` / `bg-surface-sage`. The `on-surface-*` entries
 * are declared rather than left to Vuetify's own black-or-white pick, so that
 * `bg-surface-sage` alone paints a pill in matching ink.
 *
 * nuxt.config.ts hands this to the light theme as it is, so it carries every
 * colour Vuetify is given - the brand fills and Vuetify's status fills too,
 * which used to be written into the config and inherited from Vuetify's
 * defaults respectively. `on-cta` and `on-cta-deep` are declared for the same
 * reason as the surfaces': the pane's white type is part of the design, not
 * Vuetify's black-or-white guess.
 */
export const themeColors = {
  primary: brand.primary,
  secondary: brand.secondary,
  background: role.background,
  success: statusFill.success,
  info: statusFill.info,
  warning: statusFill.warning,
  error: statusFill.error,
  backdrop: role.backdrop,
  band: role.band,
  cta: role.cta,
  "on-cta": surface.white,
  "cta-deep": role.ctaDeep,
  "on-cta-deep": surface.white,
  "cta-pale": role.ctaPale,
  "cta-published": role.ctaPublished,
  "cta-reviewed": role.ctaReviewed,
  "cta-groove": role.ctaGroove,
  "ink-sage": ink.sage,
  "ink-success": ink.success,
  "ink-warning": ink.warning,
  "ink-danger": ink.danger,
  "ink-info": ink.info,
  "ink-neutral": ink.neutral,
  "ink-strong": ink.strong,
  "surface-sage": surface.sage,
  "surface-success": surface.success,
  "surface-warning": surface.warning,
  "surface-danger": surface.danger,
  "surface-info": surface.info,
  "surface-muted": surface.muted,
  "on-surface-sage": ink.sage,
  "on-surface-success": ink.success,
  "on-surface-warning": ink.warning,
  "on-surface-danger": ink.danger,
  "on-surface-info": ink.info,
  "on-surface-muted": ink.neutral,
} as const;

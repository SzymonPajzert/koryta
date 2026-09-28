// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MAX_FEEDBACK_SCREENSHOT_BYTES,
  MAX_FEEDBACK_SCREENSHOT_DATA_URL_LENGTH,
  fitsFeedbackScreenshotLimits,
  sniffImage,
} from "../../shared/feedbackScreenshots";
import { feedbackScreenshotsLabel } from "../../shared/model";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

const be32 = (n: number) => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const be16 = (n: number) => [n >>> 8, n & 255];
const le16 = (n: number) => [n & 255, n >>> 8];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, n >>> 16];

/** The headers each format opens with, as far as `sniffImage` reads. */
const png = (width: number, height: number) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    "IHDR",
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0],
  );

const jpeg = (width: number, height: number) =>
  bytes(
    [0xff, 0xd8],
    // An APP0 (JFIF) segment before the frame, as every encoder writes one.
    [0xff, 0xe0],
    be16(16),
    "JFIF",
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    // Baseline start of frame: precision, height, width.
    [0xff, 0xc0],
    be16(17),
    [8],
    be16(height),
    be16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );

const riff = (chunk: string, payload: number[]) =>
  bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], payload);

const webpLossy = (width: number, height: number) =>
  riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]);

const webpLossless = (width: number, height: number) => {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8L", [
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
    0,
    0,
    0,
    0,
    0,
  ]);
};

const webpExtended = (width: number, height: number) =>
  riff("VP8X", [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);

describe("sniffImage", () => {
  it.each([
    ["PNG", png(1920, 1080), "image/png", 1920, 1080],
    ["JPEG", jpeg(1170, 2532), "image/jpeg", 1170, 2532],
    ["lossy WebP", webpLossy(1280, 720), "image/webp", 1280, 720],
    ["lossless WebP", webpLossless(1000, 3000), "image/webp", 1000, 3000],
    // What a canvas writes for an image with transparency.
    ["extended WebP", webpExtended(3840, 2160), "image/webp", 3840, 2160],
  ])(
    "reads the type and size of a %s",
    (_, image, contentType, width, height) => {
      expect(sniffImage(image)).toEqual({ contentType, width, height });
    },
  );

  it("skips padding and standalone markers before a JPEG's frame", () => {
    const image = bytes(
      [0xff, 0xd8, 0xff, 0xff, 0xff, 0xd0],
      [...jpeg(10, 20)].slice(2),
    );
    expect(sniffImage(image)).toMatchObject({ width: 10, height: 20 });
  });

  // Anything the admin's browser could be talked into treating as a page, or
  // simply a format the dialog never writes.
  it.each([
    [
      "an SVG",
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    ],
    ["HTML", bytes("<!doctype html><html><body>hi</body></html>")],
    ["a GIF", bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0])],
    [
      "a JPEG that scans before any frame",
      bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]),
    ],
    ["a truncated PNG", png(10, 10).slice(0, 20)],
    [
      "a PNG whose first chunk is not IHDR",
      bytes([...png(10, 10)].map((b, i) => (i === 12 ? 0x58 : b))),
    ],
    [
      "a RIFF that is not WebP",
      bytes("RIFF", [0, 0, 0, 0], "WAVE", "fmt ", Array(20).fill(0)),
    ],
    ["nothing", new Uint8Array()],
  ])("refuses %s", (_, image) => {
    expect(sniffImage(image)).toBeNull();
  });
});

describe("fitsFeedbackScreenshotLimits", () => {
  it("takes a screenshot at twice its CSS size, and a long capture", () => {
    expect(fitsFeedbackScreenshotLimits({ width: 3840, height: 2160 })).toBe(
      true,
    );
    expect(fitsFeedbackScreenshotLimits({ width: 1000, height: 8000 })).toBe(
      true,
    );
  });

  // A few kilobytes can declare a canvas the admin's browser would choke on.
  it("refuses what the dialog would have scaled down", () => {
    expect(fitsFeedbackScreenshotLimits({ width: 8001, height: 10 })).toBe(
      false,
    );
    expect(fitsFeedbackScreenshotLimits({ width: 4000, height: 4000 })).toBe(
      false,
    );
    expect(fitsFeedbackScreenshotLimits({ width: 0, height: 10 })).toBe(false);
  });
});

describe("limits", () => {
  it("leaves room in the data url for the largest image allowed", () => {
    const base64 = Math.ceil(MAX_FEEDBACK_SCREENSHOT_BYTES / 3) * 4;
    expect(MAX_FEEDBACK_SCREENSHOT_DATA_URL_LENGTH).toBeGreaterThanOrEqual(
      "data:image/webp;base64,".length + base64,
    );
  });
});

describe("feedbackScreenshotsLabel", () => {
  it.each([
    [1, "1 zrzut ekranu"],
    [2, "2 zrzuty ekranu"],
    [3, "3 zrzuty ekranu"],
    [5, "5 zrzutów ekranu"],
    [12, "12 zrzutów ekranu"],
    [22, "22 zrzuty ekranu"],
  ])("%i reads as %s", (count, label) => {
    expect(feedbackScreenshotsLabel(count)).toBe(label);
  });
});

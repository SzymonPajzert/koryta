import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  filesIn,
  useFeedbackScreenshots,
} from "../../app/composables/feedbackScreenshots";
import {
  ImageUploadError,
  prepareImage,
  type PreparedImage,
} from "~/utils/imageUpload";

// Drawing on a canvas is the browser's; here each file resolves when the test
// says so, which is what the ordering cases need.
vi.mock("~/utils/imageUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/imageUpload")>()),
  prepareImage: vi.fn(),
}));

const prepared = (name: string): PreparedImage => ({
  dataUrl: `data:image/webp;base64,${btoa(name)}`,
  width: 10,
  height: 10,
  bytes: 4,
});

const image = (name: string) => new File(["x"], name, { type: "image/png" });

/** Hands out each file's preparation, to be settled by the test. */
function deferPreparation() {
  const pending = new Map<
    string,
    { resolve: (s: PreparedImage) => void; reject: (e: unknown) => void }
  >();
  vi.mocked(prepareImage).mockImplementation(
    (file) =>
      new Promise((resolve, reject) =>
        pending.set((file as File).name, { resolve, reject }),
      ),
  );
  return pending;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("useFeedbackScreenshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("holds an image from the moment it is added, and fills it in when ready", async () => {
    const pending = deferPreparation();
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png")]);
    expect(shots.attached.value).toHaveLength(1);
    expect(shots.preparing.value).toBe(true);
    expect(shots.ready.value).toEqual([]);

    pending.get("a.png")!.resolve(prepared("a"));
    await settle();

    expect(shots.preparing.value).toBe(false);
    expect(shots.ready.value).toEqual([prepared("a")]);
    // Prepared to a screenshot's limits, not an avatar's or a portrait's.
    expect(prepareImage).toHaveBeenCalledWith(expect.any(File), "feedback");
  });

  it("keeps the order they were added in, whichever is ready first", async () => {
    const pending = deferPreparation();
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png"), image("b.png")]);
    pending.get("b.png")!.resolve(prepared("b"));
    pending.get("a.png")!.resolve(prepared("a"));
    await settle();

    expect(shots.ready.value).toEqual([prepared("a"), prepared("b")]);
  });

  it("takes three at most, and says so", async () => {
    vi.mocked(prepareImage).mockImplementation(async (file) =>
      prepared((file as File).name),
    );
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png"), image("b.png")]);
    shots.add([image("c.png"), image("d.png")]);
    await settle();

    expect(
      shots.ready.value.map(({ dataUrl }) => atob(dataUrl.split(",")[1]!)),
    ).toEqual(["a.png", "b.png", "c.png"]);
    expect(shots.full.value).toBe(true);
    expect(shots.error.value).toBe("Można dołączyć najwyżej 3 zrzuty ekranu.");
  });

  it("takes the images from a drop that also held other files", async () => {
    vi.mocked(prepareImage).mockResolvedValue(prepared("a"));
    const shots = useFeedbackScreenshots();

    shots.add([
      image("a.png"),
      new File(["%PDF"], "umowa.pdf", { type: "application/pdf" }),
    ]);
    await settle();

    expect(shots.attached.value).toHaveLength(1);
    expect(shots.error.value).toBe("Można dołączyć tylko obrazy.");
  });

  it("drops an image it could not read, with the reason", async () => {
    vi.mocked(prepareImage).mockRejectedValue(
      new ImageUploadError("Ten obraz jest pusty."),
    );
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png")]);
    await settle();

    expect(shots.attached.value).toEqual([]);
    expect(shots.error.value).toBe("Ten obraz jest pusty.");
  });

  it("names the file when something unexpected went wrong", async () => {
    vi.mocked(prepareImage).mockRejectedValue(new Error("boom"));
    const shots = useFeedbackScreenshots();

    shots.add([image("zrzut.png")]);
    await settle();

    expect(shots.error.value).toBe("Nie udało się dołączyć „zrzut.png”.");
  });

  // Removed, or sent and cleared, while still being prepared: it must not come
  // back when the preparation finishes.
  it("forgets an image removed while it was being prepared", async () => {
    const pending = deferPreparation();
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png"), image("b.png")]);
    shots.remove(shots.attached.value[0]!.key);
    pending.get("a.png")!.resolve(prepared("a"));
    pending.get("b.png")!.resolve(prepared("b"));
    await settle();

    expect(shots.ready.value).toEqual([prepared("b")]);
  });

  it("stays empty after a clear, and quiet about a failure it no longer holds", async () => {
    const pending = deferPreparation();
    const shots = useFeedbackScreenshots();

    shots.add([image("a.png")]);
    shots.clear();
    pending.get("a.png")!.reject(new ImageUploadError("Ten obraz jest pusty."));
    await settle();

    expect(shots.attached.value).toEqual([]);
    expect(shots.error.value).toBe("");
  });
});

describe("filesIn", () => {
  it("reads the files of a drop", () => {
    const file = image("a.png");
    expect(filesIn({ files: [file] } as unknown as DataTransfer)).toEqual([
      file,
    ]);
  });

  // How some browsers hand over a pasted screenshot.
  it("falls back to the items when there are no files", () => {
    const file = image("a.png");
    const data = {
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => file },
      ],
    } as unknown as DataTransfer;

    expect(filesIn(data)).toEqual([file]);
  });

  it("has nothing for nothing", () => {
    expect(filesIn(null)).toEqual([]);
  });
});

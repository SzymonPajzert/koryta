import { computed, ref } from "vue";
import {
  ImageUploadError,
  prepareImage,
  type PreparedImage,
} from "~/utils/imageUpload";
import { MAX_FEEDBACK_SCREENSHOTS } from "~~/shared/images";
import { feedbackScreenshotsLabel } from "~~/shared/model";

/** One image in the dialog: being prepared until `screenshot` is set. */
export type AttachedScreenshot = {
  key: number;
  screenshot?: PreparedImage;
};

/** The images a report is about to go out with, however they came in - picked,
 * pasted or dropped on the dialog.
 *
 * Each is prepared in the background (`prepareImage`), so the list holds
 * it from the moment it is added and fills it in once it is ready. One removed,
 * or a list cleared, while still being prepared is simply not found when it is
 * done. */
export function useFeedbackScreenshots() {
  const attached = ref<AttachedScreenshot[]>([]);
  /** Why the last thing added was not, when it was not. */
  const error = ref("");
  let nextKey = 0;

  const ready = computed(() =>
    attached.value.flatMap((item) => item.screenshot ?? []),
  );
  const preparing = computed(() =>
    attached.value.some((item) => !item.screenshot),
  );
  const full = computed(
    () => attached.value.length >= MAX_FEEDBACK_SCREENSHOTS,
  );

  const has = (key: number) => attached.value.some((item) => item.key === key);

  async function prepare(key: number, file: File) {
    try {
      const screenshot = await prepareImage(file, "feedback");
      attached.value = attached.value.map((item) =>
        item.key === key ? { ...item, screenshot } : item,
      );
    } catch (err) {
      if (!has(key)) return;
      attached.value = attached.value.filter((item) => item.key !== key);
      if (err instanceof ImageUploadError) {
        error.value = err.message;
      } else {
        console.error("Failed to prepare a screenshot", err);
        error.value = `Nie udało się dołączyć „${file.name || "obrazu"}”.`;
      }
    }
  }

  /** Takes the images among `files`, as many as there is room for. */
  function add(files: readonly File[]) {
    error.value = "";
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length < files.length) {
      error.value = "Można dołączyć tylko obrazy.";
    }

    const room = MAX_FEEDBACK_SCREENSHOTS - attached.value.length;
    if (images.length > room) {
      error.value = `Można dołączyć najwyżej ${feedbackScreenshotsLabel(MAX_FEEDBACK_SCREENSHOTS)}.`;
    }

    const taken = images
      .slice(0, Math.max(0, room))
      .map((file) => ({ key: nextKey++, file }));
    attached.value = [...attached.value, ...taken.map(({ key }) => ({ key }))];
    for (const { key, file } of taken) void prepare(key, file);
  }

  function remove(key: number) {
    attached.value = attached.value.filter((item) => item.key !== key);
    error.value = "";
  }

  function clear() {
    attached.value = [];
    error.value = "";
  }

  return { attached, error, ready, preparing, full, add, remove, clear };
}

/** The files in a paste or a drop. `items` where `files` is empty, which is
 * how some browsers hand over a pasted screenshot. */
export function filesIn(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  if (data.files.length > 0) return [...data.files];
  return [...data.items].flatMap((item) =>
    item.kind === "file" ? (item.getAsFile() ?? []) : [],
  );
}

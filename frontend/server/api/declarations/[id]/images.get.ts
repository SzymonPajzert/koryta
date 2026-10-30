import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import {
  cropImages,
  type CropImages,
} from "~~/server/utils/declarationDecisions";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";

/**
 * The crop itself, for a row an admin opens on /admin/oswiadczenia: the line
 * with the date and, where the job cut one, the name. Asked for when the row
 * opens rather than with the overview, since a list of crops is a list of
 * handwriting nobody asked to see yet.
 *
 * Admins only, checked before anything is read, and never cached: it is a
 * named person's handwriting. Readers get crops only through the reading
 * task, which never says whose page they are for.
 */
export default defineEventHandler(async (event): Promise<CropImages> => {
  await requireAdmin(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const id = getRouterParam(event, "id") ?? "";
  const images = EXTRACT_ID_PATTERN.test(id)
    ? await cropImages(getFirestore(getApp(), "koryta-pl"), id)
    : null;
  if (!images) {
    throw createError({ statusCode: 404, message: "Nie ma takiego wycinka." });
  }
  return images;
});

import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import {
  cropImages,
  type CropImages,
} from "~~/server/utils/declarationDecisions";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";

/**
 * The crop itself: the line with the date and, where the job cut one, the
 * name. Asked for when it is drawn - a row an admin opens on
 * /admin/oswiadczenia, a draft's page (`PersonDeclarationClip`) - rather
 * than with the list, since a list of crops is a list of handwriting nobody
 * asked to see yet.
 *
 * Signed-in readers only, checked before anything is read, as a draft's page
 * shows its crops to them (decision on 2026-11-20); the reading task sends
 * crops to anybody, without saying whose they are. Never cached: it is a
 * named person's handwriting.
 */
export default defineEventHandler(async (event): Promise<CropImages> => {
  await getUser(event);
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

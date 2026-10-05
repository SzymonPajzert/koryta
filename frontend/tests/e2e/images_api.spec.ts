import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { USERS } from "./helpers/auth";
import { sniffImage } from "../../shared/images";
import type { PersonPhoto } from "../../shared/model";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = () =>
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
const db = () => getFirestore(app(), "koryta-pl");

/** An ID token for a seeded account, straight from the auth emulator. */
async function idToken(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
    {
      data: { email, password: USERS.admin.password, returnSecureToken: true },
    },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).idToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** An image as the browser prepares one: drawn on a canvas and written as
 * WebP, at `width`×`height`. */
async function webp(page: Page, width: number, height: number) {
  return page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w!;
      canvas.height = h!;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2e7d32";
      context.fillRect(0, 0, w!, h!);
      context.fillStyle = "#fbc02d";
      context.fillRect(w! / 4, h! / 4, w! / 2, h! / 2);
      return canvas.toDataURL("image/webp", 0.9);
    },
    [width, height],
  );
}

test.describe("Obrazy przez API", () => {
  test("profilowe: widać je wszędzie, a zmienione albo usunięte znika", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/o-nas");

    // An address nobody confirmed hosts no public picture: the seeded user
    // never clicked a verification link, so they are turned away.
    const unconfirmed = await request.post("/api/users/avatar", {
      headers: bearer(await idToken(request, USERS.normal.email)),
      data: { image: await webp(page, 256, 256) },
    });
    expect(unconfirmed.status()).toBe(403);

    // The rest runs as an account of its own with a confirmed address, made
    // for this test so that its picture is nobody else's.
    const email = `avatar-${Date.now()}@koryta.pl`;
    await getAuth(app()).createUser({
      email,
      password: USERS.admin.password,
      emailVerified: true,
    });
    const token = await idToken(request, email);
    const account = () => getAuth(app()).getUserByEmail(email);

    const first = await request.post("/api/users/avatar", {
      headers: bearer(token),
      data: { image: await webp(page, 256, 256) },
    });
    expect(first.status()).toBe(200);
    const { photoURL } = (await first.json()) as { photoURL: string };
    const path = new URL(photoURL).pathname;
    expect(path).toMatch(/^\/api\/images\/[A-Za-z0-9]+$/);

    // Public: anybody can load it, and every cache may keep it.
    const served = await request.get(path);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/webp");
    expect(served.headers()["cache-control"]).toMatch(/^public/);
    expect(sniffImage(await served.body())).toMatchObject({
      width: 256,
      height: 256,
    });

    // Everybody else sees it through the account; the user through their
    // own document.
    expect((await account()).photoURL).toBe(photoURL);
    const uid = (await account()).uid;
    expect(
      (await db().collection("users").doc(uid).get()).get("photoURL"),
    ).toBe(photoURL);

    // A picture that is not square is not an avatar.
    const oblong = await request.post("/api/users/avatar", {
      headers: bearer(token),
      data: { image: await webp(page, 300, 200) },
    });
    expect(oblong.status()).toBe(400);

    // Replaced: the old one is gone, so a user keeps one picture however
    // often they change it.
    const second = await request.post("/api/users/avatar", {
      headers: bearer(token),
      data: { image: await webp(page, 512, 512) },
    });
    expect(second.status()).toBe(200);
    const secondPath = new URL(
      ((await second.json()) as { photoURL: string }).photoURL,
    ).pathname;
    expect((await request.get(path)).status()).toBe(404);
    expect((await request.get(secondPath)).status()).toBe(200);

    // Removed: back to no picture, for a password account.
    const removed = await request.delete("/api/users/avatar", {
      headers: bearer(token),
    });
    expect(removed.status()).toBe(200);
    expect((await request.get(secondPath)).status()).toBe(404);
    expect((await account()).photoURL).toBeUndefined();
    await getAuth(app()).deleteUser((await account()).uid);
  });

  test("zdjęcie osoby: widać je dopiero po zatwierdzeniu, i tylko na opublikowanej stronie", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/o-nas");
    const stamp = Date.now();
    // No hyphens in the id: other specs' seeds parse the last dash segment.
    const nodeId = `zdjecie${stamp}`;
    const name = `Osoba Ze Zdjęciem ${stamp}`;
    await db()
      .collection("nodes")
      .doc(nodeId)
      .set({ type: "person", name, published: true });

    const [user, admin] = await Promise.all([
      idToken(request, USERS.normal.email),
      idToken(request, USERS.admin.email),
    ]);

    const uploaded = await request.post("/api/images/person", {
      headers: bearer(user),
      data: { nodeId, image: await webp(page, 600, 800) },
    });
    expect(uploaded.status()).toBe(200);
    const { image } = (await uploaded.json()) as {
      image: { imageId: string };
    };
    const path = `/api/images/${image.imageId}`;

    // Uploaded, not approved: reviewers only.
    expect((await request.get(path)).status()).toBe(404);
    expect((await request.get(path, { headers: bearer(user) })).status()).toBe(
      404,
    );
    const forReviewer = await request.get(path, { headers: bearer(admin) });
    expect(forReviewer.status()).toBe(200);
    expect(forReviewer.headers()["cache-control"]).toMatch(/^private/);

    const source = "https://commons.wikimedia.org/wiki/File:Test.jpg";
    const proposed = await request.post("/api/revisions/create", {
      headers: bearer(user),
      data: {
        node_id: nodeId,
        name,
        photo: { imageId: image.imageId, source, license: "CC BY-SA 4.0" },
      },
    });
    expect(proposed.status()).toBe(200);
    const { id: revisionId } = (await proposed.json()) as { id: string };

    // Proposed, not approved: still reviewers only.
    expect((await request.get(path)).status()).toBe(404);

    const approved = await request.post("/api/revisions/approve", {
      headers: bearer(admin),
      data: { revision_id: revisionId },
    });
    expect(approved.status()).toBe(200);

    // The page now shows it, and so anybody may load it.
    const photo = (await db().collection("nodes").doc(nodeId).get()).get(
      "photo",
    ) as PersonPhoto;
    expect(photo).toMatchObject({
      imageId: image.imageId,
      contentType: "image/webp",
      width: 600,
      height: 800,
      source,
      license: "CC BY-SA 4.0",
    });
    const published = await request.get(path);
    expect(published.status()).toBe(200);
    expect(published.headers()["cache-control"]).toMatch(/^public/);

    // Taken down with its page, with nothing else to remember.
    await db()
      .collection("nodes")
      .doc(nodeId)
      .set({ published: false }, { merge: true });
    expect((await request.get(path)).status()).toBe(404);
  });
});

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
    const token = await idToken(request, USERS.normal.email);
    const account = () => getAuth(app()).getUserByEmail(USERS.normal.email);

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
  });
});

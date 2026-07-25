/**
 * Captures mobile screenshots + overflow diagnostics for a list of routes.
 *
 * Usage: node scripts/mobile-shots.mjs <outDir> [baseUrl]
 *
 * Logs in as the seeded admin so authenticated pages render real content.
 */
import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const outDir = process.argv[2] || "/tmp/shots/before";
const baseUrl = process.argv[3] || "http://127.0.0.1:3001";

const ROUTES = [
  ["home", "/"],
  ["tabela", "/eksploruj/tabela"],
  ["nowe", "/eksploruj/nowe"],
  ["osoba", "/osoba/jan-kowalski-1"],
  ["statystyki", "/eksploruj/statystyki"],
  ["zrodla", "/zrodla"],
  ["o-nas", "/o-nas"],
  ["pomoc", "/pomoc"],
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  locale: "pl-PL",
});
// The emulator's dev-only warning banner is a nowrap <p> that inflates the
// document width; it does not exist in production, so keep it out of the way.
await context.addInitScript(() => {
  const hide = () => {
    const s = document.createElement("style");
    s.textContent =
      ".firebase-emulator-warning{display:none !important}" +
      "#nuxt-devtools-container,nuxt-devtools-inspect-panel," +
      "#vue-tracer-overlay{display:none !important}";
    document.head?.appendChild(s);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
});

const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

async function settle(label) {
  try {
    await page.waitForSelector("body *", { timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    // Firestore long-polling keeps the network busy; the page is still usable.
  }
  await page.waitForTimeout(3000);
  if (label && consoleErrors.length) {
    console.log(`  [${label}] console: ${consoleErrors.slice(-3).join(" | ")}`);
  }
}

// --- Log in so authenticated pages (nowe, drafts in tabela) render content.
await page.goto(baseUrl + "/login", {
  waitUntil: "domcontentloaded",
  timeout: 180_000,
});
await settle();
try {
  await page.getByLabel("Email").first().fill("admin@koryta.pl");
  await page.getByLabel("Hasło").first().fill("password123");
  await page
    .getByRole("button", { name: /^Zaloguj się$/i })
    .last()
    .click();
  await page.waitForTimeout(6000);
  console.log("login: submitted");
} catch (e) {
  console.log("login failed: " + e.message.split("\n")[0]);
}

const report = [];

for (const [name, path] of ROUTES) {
  consoleErrors.length = 0;
  try {
    await page.goto(baseUrl + path, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
  } catch (err) {
    console.log(`  ${name}: goto issue: ${err.message.split("\n")[0]}`);
  }
  await settle(name);

  const diag = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") continue;
        // Only the outermost offender in a chain is worth reporting.
        if (el.parentElement) {
          const pr = el.parentElement.getBoundingClientRect();
          if (pr.right > vw + 1 || pr.left < -1) continue;
        }
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 70),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    return {
      viewportWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      docHeight: document.documentElement.scrollHeight,
      offenders: offenders.slice(0, 8),
    };
  });

  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  await page.screenshot({ path: `${outDir}/${name}-fold.png` });

  report.push({ name, path, ...diag, consoleErrors: [...consoleErrors] });
  console.log(
    `${name.padEnd(14)} scrollW=${diag.scrollWidth} vw=${diag.viewportWidth} ` +
      `height=${String(diag.docHeight).padStart(6)} overflow=${diag.offenders.length}`,
  );
}

await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log("\n=== OVERFLOW OFFENDERS ===");
for (const r of report) {
  if (r.offenders.length)
    console.log(
      r.name,
      r.offenders.map((o) => `${o.tag}.${o.cls.split(" ")[0]}[${o.right}]`),
    );
}

await browser.close();

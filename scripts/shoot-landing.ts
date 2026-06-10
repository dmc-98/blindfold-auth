import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dirname, "../landing/index.html");
const out = resolve(__dirname, "../output");

const browser: any = await chromium.launch();
// Full-page desktop
const d: any = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const dp: any = await d.newPage();
await dp.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
await dp.waitForTimeout(900);
// trigger reveals by scrolling through
await dp.evaluate(async () => {
  await new Promise<void>((r) => {
    let y = 0;
    const t = setInterval(() => { window.scrollTo(0, y); y += 600; if (y > document.body.scrollHeight) { clearInterval(t); r(); } }, 30);
  });
});
await dp.waitForTimeout(500);
await dp.evaluate(() => window.scrollTo(0, 0));
await dp.waitForTimeout(400);
await dp.screenshot({ path: `${out}/landing-hero.png` });
await dp.screenshot({ path: `${out}/landing-full.png`, fullPage: true });

// Mobile
const m: any = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp: any = await m.newPage();
await mp.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${out}/landing-mobile.png` });

await browser.close();
console.log("shots written to output/");

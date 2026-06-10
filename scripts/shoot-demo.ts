import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "@blindfold/example-demo-app";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../output");
const srv = await createDemoServer({ storage: "memory" });
const { url } = await srv.listen(0);
const browser: any = await chromium.launch();
const ctx: any = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const page: any = await ctx.newPage();

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/demo-1-login.png` });

// Admin (Alice)
await page.click('.quick button[data-email="alice@acme.co"]');
await page.click("#loginBtn");
await page.waitForSelector("#rows tr");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/demo-2-admin.png` });

// Support (Bob)
await page.click("#logoutBtn");
await page.click('.quick button[data-email="bob@acme.co"]');
await page.click("#loginBtn");
await page.waitForSelector("#rows tr");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/demo-3-support.png` });

await browser.close();
await srv.close();
console.log("demo shots written");

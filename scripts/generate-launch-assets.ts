import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import gifenc from "gifenc";
import { createAuth, createMemoryStorage } from "@dmc--98/blindfold-auth";
import { startStudio } from "@dmc--98/blindfold-auth-studio";
import { attachVirtualAuthenticator, createHarness, waitForText } from "../e2e/support/harness.js";

const { GIFEncoder, applyPalette, quantize } = gifenc;

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const launchDir = join(rootDir, "docs", "assets", "launch");
const frameDir = join(rootDir, "output", "playwright", "launch");

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function closeServer(server: any) {
  await new Promise<void>((resolve, reject) => {
    server.close((error: any) => (error ? reject(error) : resolve()));
  });
}

async function writeGif(path: string, frameBuffers: any[], { delay = 900 }: any = {}) {
  if (!frameBuffers.length) {
    throw new Error("Cannot write a GIF with no frames");
  }

  const pngFrames = frameBuffers.map((buffer: any) => PNG.sync.read(buffer));
  const { width, height } = pngFrames[0];
  const gif = GIFEncoder();
  gif.writeHeader();

  for (const frame of pngFrames) {
    const palette = quantize(frame.data, 256);
    const indexed = applyPalette(frame.data, palette);
    gif.writeFrame(indexed, width, height, { palette, delay });
  }

  gif.finish();
  await writeFile(path, Buffer.from(gif.bytesView()));
}

async function createBootstrapStudioHarness() {
  const auth = createAuth({
    workspaceId: "workspace_launch_bootstrap",
    secret: "launch-bootstrap-secret",
    storage: createMemoryStorage()
  });
  const studio = await startStudio({ auth, port: 0 });

  return {
    studio,
    async close() {
      await closeServer(studio.server).catch(() => {});
    }
  };
}

async function captureBootstrapGif(browser: any) {
  const harness = await createBootstrapStudioHarness();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 }
  });
  const page = await context.newPage();
  const frames: any[] = [];

  try {
    await page.goto(harness.studio.url);
    await page.waitForTimeout(250);
    frames.push(await page.screenshot());

    await page.click("#bootstrapButton");
    await waitForText(page, "#metrics", "Blindfold Workspace");
    frames.push(await page.screenshot());

    await page.waitForTimeout(250);
    frames.push(await page.screenshot());

    await writeGif(join(launchDir, "bootstrap-to-studio.gif"), frames, { delay: 850 });
  } finally {
    await context.close();
    await harness.close();
  }
}

async function captureStudioAssets(browser: any) {
  const harness: any = await createHarness({
    skip(message: any) {
      throw new Error(`Cannot create harness for launch assets: ${message}`);
    }
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1180 }
  });
  const page = await context.newPage();

  try {
    await page.goto(harness.studio.url);
    await waitForText(page, "#statusBox", "Snapshot refreshed.");

    await page.locator(".shell").screenshot({
      path: join(launchDir, "studio-overview.png")
    });

    await page.locator("#applicationProvidersCard").scrollIntoViewIfNeeded();
    await page.locator("#applicationProvidersCard").screenshot({
      path: join(launchDir, "provider-bindings.png")
    });

    await page.fill('#debugForm [name="applicationId"]', harness.application.id);
    await page.fill('#debugForm [name="principalId"]', harness.financePrincipal.id);
    await page.fill('#debugForm [name="resource"]', "invoice");
    await page.fill('#debugForm [name="action"]', "read");
    await page.fill('#debugForm [name="field"]', "internalNotes");
    await page.fill('#debugForm [name="resourceAttributes"]', "{}");
    await page.click('#debugForm button[type="submit"]');
    await waitForText(page, "#debugOutput", '"effect": "mask"');
    await page.locator("#policyDebuggerCard").scrollIntoViewIfNeeded();
    await page.locator("#policyDebuggerCard").screenshot({
      path: join(launchDir, "policy-debugger.png")
    });
  } finally {
    await context.close();
    await harness.close();
  }
}

async function captureRuntimeAssets(browser: any) {
  const harness: any = await createHarness({
    skip(message: any) {
      throw new Error(`Cannot create harness for launch assets: ${message}`);
    }
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1180 }
  });
  const page = await context.newPage();
  const authenticator = await attachVirtualAuthenticator(page);

  try {
    await page.goto(harness.runtime.url);
    await page.locator("#passkeyCard").screenshot({
      path: join(launchDir, "passkey-login.png")
    });

    const magicLinkFrames: any[] = [];
    magicLinkFrames.push(await page.screenshot());

    await page.click("#requestMagicLinkButton");
    await waitForText(page, "#magicLinkOutput", '"token"');
    magicLinkFrames.push(await page.screenshot());

    await page.click("#consumeMagicLinkButton");
    await waitForText(page, "#authOutput", '"authStrength": "magic_link"');
    magicLinkFrames.push(await page.screenshot());

    await page.click("#passkeyEnrollButton");
    await waitForText(page, "#authOutput", '"credential"');
    magicLinkFrames.push(await page.screenshot());

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');
    magicLinkFrames.push(await page.screenshot());

    await page.click("#passkeyLoginButton");
    await waitForText(page, "#authOutput", '"authStrength": "passkey"');
    magicLinkFrames.push(await page.screenshot());

    await writeGif(join(launchDir, "magic-link-to-passkey.gif"), magicLinkFrames, {
      delay: 850
    });

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');

    const federationFrames: any[] = [];
    federationFrames.push(await page.screenshot());

    await page.click("#useOidcProfileButton");
    federationFrames.push(await page.screenshot());

    await page.click("#oidcButton");
    await page.waitForFunction((selector: any) => {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      try {
        const parsed = JSON.parse(node.textContent || "{}");
        return parsed?.status === 200 && parsed?.payload?.session?.authStrength === "oidc";
      } catch {
        return false;
      }
    }, "#authOutput");
    federationFrames.push(await page.screenshot());

    await writeGif(join(launchDir, "domain-routing-sso.gif"), federationFrames, {
      delay: 950
    });
  } finally {
    await authenticator.close();
    await context.close();
    await harness.close();
  }
}

async function main() {
  await ensureDir(launchDir);
  await rm(frameDir, { recursive: true, force: true });
  await ensureDir(frameDir);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  try {
    await captureBootstrapGif(browser);
    await captureStudioAssets(browser);
    await captureRuntimeAssets(browser);
  } finally {
    await browser.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    assets: [
      "studio-overview.png",
      "passkey-login.png",
      "provider-bindings.png",
      "policy-debugger.png",
      "bootstrap-to-studio.gif",
      "magic-link-to-passkey.gif",
      "domain-routing-sso.gif"
    ]
  };
  await writeFile(join(frameDir, "launch-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Launch assets generated in ${launchDir}`);
}

main().catch((error: any) => {
  console.error(error);
  process.exitCode = 1;
});

import { mkdir, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    const nodeModulesPath = process.env.PLAYWRIGHT_NODE_MODULES;
    if (!nodeModulesPath) {
      throw error;
    }

    return createRequire(join(nodeModulesPath, "noop.js"))("playwright");
  }
}

const { chromium } = loadPlaywright();

const baseUrl = process.env.COREY_DEMO_BASE_URL ?? "http://localhost:4001?inline-popups=1";
const root = resolve(import.meta.dirname, "..");
const mediaDir = join(root, "public", "docs-media", "demo-workflow");
const modelPath = join(root, "public", "resources", "Demo_RevitSampleProject.ifc");
const clauseTemplatePath = join(root, "public", "resources", "starter-essential-elements.json");

const screenshots = {
  loadedViewer: join(mediaDir, "01-loaded-viewer.png"),
  starterClauses: join(mediaDir, "02-starter-clauses.png"),
  validationSummary: join(mediaDir, "03-validation-summary.png"),
  dataTable: join(mediaDir, "04-data-table.png"),
};

async function readRulesConfig() {
  try {
    const response = await fetch(new URL("/api/rules/config", baseUrl), { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

async function writeRulesConfig(config) {
  try {
    const response = await fetch(new URL("/api/rules/config", baseUrl), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForViewerReady(page) {
  console.log("Waiting for the IFC viewport to finish indexing");
  await page.getByText(/Demo_RevitSampleProject\.ifc/i).first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("Demo_RevitSampleProject.ifc ready."),
    null,
    { timeout: 180_000 },
  );
  console.log("Viewport indexed");
  await page
    .getByText(/Validation idle|Validation clear|\d+ flagged/i)
    .first()
    .waitFor({ timeout: 180_000 });
  console.log("Validation status visible");
}

async function waitForDataTableReady(page) {
  await page.getByText("Table Filters").first().waitFor({ timeout: 180_000 });
  await page.getByText(/loaded/i).first().waitFor({ timeout: 180_000 });
  await page.getByText(/\d+ elements/i).first().waitFor({ timeout: 180_000 });
}

async function screenshot(page, path) {
  await page.screenshot({ path, fullPage: false });
  console.log(`Captured ${path}`);
}

async function waitForInputValue(page, value) {
  await page.waitForFunction(
    (expectedValue) =>
      [...document.querySelectorAll("input")].some((input) => input.value === expectedValue),
    value,
  );
}

await mkdir(mediaDir, { recursive: true });
const originalRulesConfig = await readRulesConfig();
await writeRulesConfig({ version: 3, clauses: [] });

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-gl=swiftshader"],
});

const context = await browser.newContext({
  viewport: { width: 1680, height: 1000 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
  recordVideo: {
    dir: mediaDir,
    size: { width: 1680, height: 1000 },
  },
});

const page = await context.newPage();
page.setDefaultTimeout(180_000);

page.on("console", (message) => {
  if (message.type() === "error") {
    console.error(`[browser:${message.type()}] ${message.text()}`);
  }
});

try {
  console.log(`Opening ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Upload$/i }).first().waitFor();

  console.log(`Loading ${modelPath}`);
  await page.locator('input[type="file"][accept*=".ifc"]').setInputFiles(modelPath);
  await waitForViewerReady(page);
  await page.waitForTimeout(2_000);
  await screenshot(page, screenshots.loadedViewer);

  console.log("Loading demo wall clauses");
  await page.getByRole("link", { name: /clauses/i }).click();
  const loadedStarter = await page
    .getByText("Demo IfcWall")
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  if (loadedStarter) {
    const templateCard = page
      .getByRole("heading", { name: "Demo IfcWall" })
      .locator("xpath=ancestor::section[1]");
    await templateCard.getByRole("button", { name: "Load" }).click();
  } else {
    await page.getByRole("button", { name: "Import JSON" }).click();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(clauseTemplatePath);
  }

  await waitForInputValue(page, "Element identity");
  await waitForInputValue(page, "Fire rating metadata");
  await page.waitForTimeout(1_000);
  await screenshot(page, screenshots.starterClauses);

  console.log("Waiting for validation summary");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByText(/Validating|Validated|\d+ flagged/i).first().waitFor({ timeout: 180_000 });
  await page
    .getByText(/\d+ flagged · \d+ clauses|Validation clear/i)
    .first()
    .waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1_500);
  await screenshot(page, screenshots.validationSummary);

  console.log("Opening data table");
  await page.getByRole("button", { name: /open data table/i }).click();
  await waitForDataTableReady(page);
  await page.waitForTimeout(1_500);
  await screenshot(page, screenshots.dataTable);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();

  if (video) {
    await rename(await video.path(), join(mediaDir, "demo-workflow.webm"));
  }

  if (originalRulesConfig) {
    await writeRulesConfig(originalRulesConfig);
  }
}

console.log(`Captured demo workflow media in ${mediaDir}`);

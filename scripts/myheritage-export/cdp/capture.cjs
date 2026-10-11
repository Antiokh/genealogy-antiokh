const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");
const { classifyPayload } = require("./payload.cjs");

const rootDir = __dirname;
const exportDir = path.resolve(rootDir, process.env.EXPORT_DIR || "myheritage-export");
const profileDir = path.resolve(rootDir, ".myheritage-chrome-profile");
const port = Number.parseInt(process.env.CDP_PORT || "9222", 10);
const cdpUrl = `http://127.0.0.1:${port}`;
const startUrl = process.env.MYHERITAGE_URL || "https://www.myheritage.com/";
const chromePath = process.env.CHROME_PATH ||
  [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  ].find((candidate) => require("node:fs").existsSync(candidate));

let browser;
let sequence = 0;
const loggedDomStates = new Map();
let writeTail = Promise.resolve();
let stopping = false;
let finishCapture;

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

async function readLastSequence() {
  const manifestPath = path.join(exportDir, "raw", "manifest.jsonl");
  let content;
  try {
    content = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let lastSequence = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (Number.isInteger(entry.sequence)) lastSequence = Math.max(lastSequence, entry.sequence);
  }
  return lastSequence;
}

function safePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "(unavailable)";
  }
}

function safePersonPathSegment(id) {
  return encodeURIComponent(id).replaceAll(".", "%2E");
}

function isMyHeritageUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host === "myheritage.com" || host.endsWith(".myheritage.com");
  } catch {
    return false;
  }
}

async function cdpIsReady() {
  try {
    const response = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Chrome CDP did not become available at ${cdpUrl} within 30 seconds`);
}

async function launchChrome() {
  if (await cdpIsReady()) {
    log(`[cdp] Using existing endpoint ${cdpUrl}`);
    return;
  }
  if (!chromePath) {
    throw new Error("Chrome was not found. Set CHROME_PATH to chrome.exe or start Chrome with remote debugging enabled.");
  }

  await fs.mkdir(profileDir, { recursive: true });
  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--incognito",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    startUrl,
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  log(`[cdp] Launched isolated Chrome profile; sign in to MyHeritage in that window`);
  await waitForCdp();
}

function saveResponse(response) {
  const task = async () => {
    const requestUrl = response.url();
    if (!isMyHeritageUrl(requestUrl)) return;

    let contentType = "";
    try {
      contentType = (await response.allHeaders())["content-type"] || "";
    } catch (error) {
      log(`[network] Could not read response headers (${safePath(requestUrl)}): ${error.message}`);
      return;
    }
    const declaredJson = contentType.toLowerCase().includes("json");
    if (!declaredJson && !contentType.toLowerCase().startsWith("text/plain")) return;

    let body;
    let payload;
    try {
      body = await response.text();
      payload = JSON.parse(body);
    } catch (error) {
      if (declaredJson) {
        log(`[network] JSON response could not be parsed (${safePath(requestUrl)}): ${error.message}`);
      }
      return;
    }

    sequence += 1;
    const id = String(sequence).padStart(6, "0");
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const classification = classifyPayload(payload);
    const subdirectory = classification.kind === "tree"
      ? "tree"
      : classification.kind === "profile" && classification.personId
        ? `people/${safePersonPathSegment(classification.personId)}`
        : "responses";
    const relativePath = path.join("raw", subdirectory, `${id}-${timestamp}.json`);
    const absolutePath = path.join(exportDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, body, "utf8");

    const entry = {
      sequence,
      capturedAt: new Date().toISOString(),
      url: safePath(requestUrl),
      method: response.request().method(),
      status: response.status(),
      classification: classification.kind,
      personId: classification.personId || null,
      personIdField: classification.personIdField || null,
      sha256: crypto.createHash("sha256").update(body).digest("hex"),
      file: relativePath,
    };
    await fs.appendFile(path.join(exportDir, "raw", "manifest.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");

    if (classification.kind === "tree") {
      log(`[tree] ${relativePath}; cards=${classification.personCount}; familyTreeSize=${classification.familyTreeSize ?? "unknown"}; root=${classification.rootIndividualId ?? "unknown"}`);
    } else if (classification.kind === "profile") {
      log(`[profile-candidate] id=${classification.personId ?? "unresolved"} idField=${classification.personIdField ?? "unresolved"} fields=${classification.fields.join(",")}; ${relativePath}`);
    } else {
      log(`[json] ${relativePath}; ${safePath(requestUrl)}`);
    }
  };

  writeTail = writeTail.then(task).catch((error) => {
    log(`[capture-error] ${error.stack || error.message}`);
  });
}

function monitorPage(page) {
  page.on("response", saveResponse);
  page.on("close", () => loggedDomStates.delete(page));
  void inspectPage(page);
}

async function inspectPage(page) {
  while (!stopping && !page.isClosed()) {
    try {
      const frames = page.frames();
      for (const frame of frames) {
        const url = frame.url();
        if (!isMyHeritageUrl(url)) continue;
        const state = await frame.evaluate(() => {
          const cards = [...document.querySelectorAll('g[data-type="_svgOuterGroup"][data-individual-id]')];
          const ridges = [...document.querySelectorAll('.ridgeIcon[aria-label="View family branch"]')];
          const relationships = ridges.slice(0, 8).map((ridge) => {
            const parent = ridge.parentElement;
            if (!parent) return "no-parent";
            const siblings = [...parent.children];
            const index = siblings.indexOf(ridge);
            const previous = siblings.slice(0, index).reverse().find((item) => item.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
            const next = siblings.slice(index + 1).find((item) => item.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
            return previous ? "previous-sibling-card" : next ? "following-sibling-card" : "not-direct-card-sibling";
          });
          return {
            cardCount: cards.length,
            sampleIds: cards.slice(0, 5).map((card) => card.getAttribute("data-individual-id")),
            ridgeCount: ridges.length,
            ridgeRelationships: [...new Set(relationships)],
            hasCardWrapper: Boolean(cards[0]?.querySelector('g[data-type="frameGroup"].cardWrapper')),
          };
        });

        if (state.cardCount || state.ridgeCount) {
          const key = JSON.stringify(state);
          if (loggedDomStates.get(page) !== key) {
            loggedDomStates.set(page, key);
            log(`[dom] url=${safePath(url)} cards=${state.cardCount} sampleIds=${state.sampleIds.join(",") || "-"} cardWrapper=${state.hasCardWrapper} ridges=${state.ridgeCount} relationships=${state.ridgeRelationships.join(",") || "-"}`);
          }
        }
      }
    } catch (error) {
      if (!page.isClosed()) log(`[dom-error] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CDP_PORT must be a valid TCP port");
  }
  await fs.mkdir(exportDir, { recursive: true });
  await fs.mkdir(path.join(exportDir, "raw"), { recursive: true });
  sequence = await readLastSequence();
  await launchChrome();

  browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("CDP browser has no default context");
  const context = contexts[0];
  context.on("page", monitorPage);
  for (const page of context.pages()) monitorPage(page);
  browser.on("disconnected", () => {
    if (!stopping) log("[cdp] Browser disconnected");
    stopping = true;
    finishCapture?.();
  });

  log(`[ready] CDP capture active; output=${exportDir}`);
  log("[ready] Open a MyHeritage tree, wait for cards, then click one card's cardWrapper manually. The logger will save JSON and report detected shape.");
  await new Promise((resolve) => {
    finishCapture = resolve;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      log("[shutdown] Flushing captured responses");
      await writeTail;
      await browser?.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

main().catch((error) => {
  process.stderr.write(`[fatal] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

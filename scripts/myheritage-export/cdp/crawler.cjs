const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { classifyPayload, extractProfile, extractTree } = require("./payload.cjs");

const outputDir = path.resolve(__dirname, process.env.EXPORT_DIR || "myheritage-export");
const port = Number.parseInt(process.env.CDP_PORT || "9222", 10);
const cdpUrl = `http://127.0.0.1:${port}`;
const responseTimeoutMs = Number.parseInt(process.env.RESPONSE_TIMEOUT_MS || "20000", 10);
const mutationTimeoutMs = Number.parseInt(process.env.MUTATION_TIMEOUT_MS || "12000", 10);
const maxPersonAttempts = 3;
const maxRidgeAttempts = 2;
const crawlerVersion = 12;
const treeSelector = 'g[data-type="_svgOuterGroup"][data-individual-id]';
const ridgeSelector = '.ridgeIcon[aria-label="View family branch"]';

const state = {
  knownIds: new Set(),
  treeCards: new Map(),
  profileFiles: new Map(),
  profiles: new Map(),
  expandedRidges: new Set(),
  ridgeAttempts: new Map(),
  personAttempts: new Map(),
  photoIndex: new Map(),
  familyTreeSize: null,
  rootIndividualId: null,
  latestTreeFile: null,
  treeResponseCount: 0,
};

let browser;
let sequence = 0;
let activeProfileClick;
let responseQueue = Promise.resolve();
let stopping = false;
let dailyUsageLimited = false;
let shutdownResolve;
let lastPassNewIds = 0;

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function safePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "(unavailable)";
  }
}

function safeSegment(value) {
  return encodeURIComponent(String(value)).replaceAll(".", "%2E");
}

function profileUrlId(requestUrl) {
  try {
    const params = new URL(requestUrl).searchParams;
    for (const key of ["individualID", "individualId", "individual_id", "personId", "personID"]) {
      const value = params.get(key);
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

async function writeJsonAtomic(filename, value) {
  const target = path.join(outputDir, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
}

async function readState() {
  const filename = path.join(outputDir, "state.json");
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Cannot load crawler state at ${filename}: ${error.message}`);
    }
    saved = {};
  }

  for (const id of saved.knownIds || []) {
    if (/^\d+$/.test(String(id))) state.knownIds.add(String(id));
  }
  for (const [id, card] of Object.entries(saved.treeCards || {})) {
    if (/^\d+$/.test(id)) state.treeCards.set(id, card);
  }
  for (const [id, file] of Object.entries(saved.profileFiles || {})) {
    if (!/^\d+$/.test(id)) continue;
    state.profileFiles.set(id, file);
    try {
      const payload = JSON.parse(await fs.readFile(path.join(outputDir, file), "utf8"));
      const profile = extractProfile(payload);
      if (profile) state.profiles.set(id, profile);
      else log(`[state-warning] Saved profile for ${id} is not readable as personData; it will be fetched again`);
    } catch (error) {
      log(`[state-warning] Saved profile for ${id} could not be restored: ${error.message}`);
    }
  }
  for (const key of saved.expandedRidges || []) state.expandedRidges.add(key);
  for (const [key, attempts] of Object.entries(saved.ridgeAttempts || {})) state.ridgeAttempts.set(key, attempts);
  for (const [id, attempts] of Object.entries(saved.personAttempts || {})) state.personAttempts.set(id, attempts);
  for (const [id, photo] of Object.entries(saved.photos || {})) state.photoIndex.set(id, photo);
  const resetAttempts = saved.crawlerVersion !== crawlerVersion;
  if (resetAttempts) {
    state.personAttempts.clear();
    state.ridgeAttempts.clear();
    state.expandedRidges.clear();
    log(`[state] resetting attempts for crawler version ${crawlerVersion}`);
  }
  state.familyTreeSize = saved.familyTreeSize ?? null;
  state.rootIndividualId = resetAttempts ? null : (saved.rootIndividualId ?? null);
  state.latestTreeFile = saved.latestTreeFile ?? null;

  let treeEntries = [];
  try {
    treeEntries = (await fs.readFile(path.join(outputDir, "raw", "manifest.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.classification === "tree");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (state.treeCards.size === 0 || state.familyTreeSize === null) {
    for (const entry of [...treeEntries].sort((left, right) => right.sequence - left.sequence)) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(outputDir, entry.file), "utf8"));
        const tree = extractTree(payload);
        if (!tree) continue;
        absorbTree(tree);
        state.latestTreeFile = entry.file.split(path.sep).join("/");
        break;
      } catch (error) {
        log(`[state-warning] Cannot restore raw tree ${entry.file}: ${error.message}`);
      }
    }
  }

  if (!state.rootIndividualId) {
    for (const entry of [...treeEntries].sort((left, right) => left.sequence - right.sequence)) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(outputDir, entry.file), "utf8"));
        const tree = extractTree(payload);
        const rootId = tree?.rootIndividualID ?? tree?.rootIndividualId ?? tree?.rootId;
        if (rootId !== undefined && rootId !== null) {
          state.rootIndividualId = String(rootId);
          break;
        }
      } catch (error) {
        log(`[state-warning] Cannot restore root ID from ${entry.file}: ${error.message}`);
      }
    }
  }
  log(`[state] restored known=${state.knownIds.size} profiles=${state.profiles.size} expandedRidges=${state.expandedRidges.size}`);
  await saveState();
}

async function saveState() {
  await writeJsonAtomic("state.json", {
    updatedAt: new Date().toISOString(),
    crawlerVersion,
    knownIds: [...state.knownIds],
    treeCards: Object.fromEntries(state.treeCards),
    profileFiles: Object.fromEntries(state.profileFiles),
    expandedRidges: [...state.expandedRidges],
    ridgeAttempts: Object.fromEntries(state.ridgeAttempts),
    personAttempts: Object.fromEntries(state.personAttempts),
    photos: Object.fromEntries(state.photoIndex),
    familyTreeSize: state.familyTreeSize,
    rootIndividualId: state.rootIndividualId,
    latestTreeFile: state.latestTreeFile,
  });
}

async function nextSequence() {
  if (sequence === 0) {
    try {
      const manifest = await fs.readFile(path.join(outputDir, "crawl-manifest.jsonl"), "utf8");
      for (const line of manifest.split(/\r?\n/)) {
        if (!line) continue;
        const entry = JSON.parse(line);
        if (Number.isInteger(entry.sequence)) sequence = Math.max(sequence, entry.sequence);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  sequence += 1;
  return String(sequence).padStart(6, "0");
}

function absorbTree(tree) {
  const cards = Array.isArray(tree.personCards) ? tree.personCards : [];
  let added = 0;
  for (const card of cards) {
    if (card?.id === undefined || card?.id === null) continue;
    const id = String(card.id);
    if (!/^\d+$/.test(id)) continue;
    if (!state.knownIds.has(id)) added += 1;
    state.knownIds.add(id);
    state.treeCards.set(id, card);
  }

  const size = tree.familyTreeSize ?? tree.treeSize ?? tree.familySize;
  if (size !== undefined && size !== null && Number.isFinite(Number(size))) {
    state.familyTreeSize = Number(size);
  }
  const rootId = tree.rootIndividualID ?? tree.rootIndividualId ?? tree.rootId;
  if ((state.rootIndividualId === null || state.rootIndividualId === undefined) &&
    rootId !== undefined && rootId !== null) {
    state.rootIndividualId = String(rootId);
  }
  state.treeResponseCount += 1;
  lastPassNewIds += added;
  return { added, count: cards.length };
}

function storeProfile(personId, file, profile) {
  if (state.profiles.has(personId)) return false;
  state.profiles.set(personId, profile);
  state.profileFiles.set(personId, file);
  return true;
}

async function captureResponse(response) {
  const url = response.url();
  if (!/^(?:[^:]+:\/\/)?(?:[^/]+\.)?myheritage\.com(?:\/|$)/i.test(url)) return;

  let headers;
  try {
    headers = await response.allHeaders();
  } catch (error) {
    log(`[network-warning] Cannot read headers for ${safePath(url)}: ${error.message}`);
    return;
  }
  const contentType = headers["content-type"] || "";
  const declaredJson = contentType.toLowerCase().includes("json");
  if (!declaredJson && !contentType.toLowerCase().startsWith("text/plain")) return;

  let body;
  let payload;
  try {
    body = await response.body();
    payload = JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (declaredJson) log(`[network-warning] JSON body unavailable for ${safePath(url)}: ${error.message}`);
    return;
  }

  const classification = classifyPayload(payload);
  const request = response.request();
  const requestProfileId = profileUrlId(url);
  const isExtendedProfile = safePath(url).toLowerCase().endsWith("/get-extended-card-content.php");
  let responsePage = null;
  try {
    responsePage = response.frame().page();
  } catch {
    responsePage = null;
  }
  let personId = classification.kind === "profile"
    ? (classification.personId || requestProfileId ||
      (activeProfileClick?.page === responsePage ? activeProfileClick.personId : null))
    : null;
  if (isExtendedProfile && classification.kind === "profile" && requestProfileId) {
    personId = requestProfileId;
  }

  const fileSequence = await nextSequence();
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  let relativePath = path.join("raw", "responses", `crawl-${fileSequence}-${timestamp}.json`);
  if (classification.kind === "tree") {
    relativePath = path.join("raw", "tree", `crawl-${fileSequence}-${timestamp}.json`);
  } else if (classification.kind === "profile" && personId) {
    relativePath = path.join("raw", "people", safeSegment(personId), `crawl-${fileSequence}-${timestamp}.json`);
  }
  const normalizedPath = relativePath.split(path.sep).join("/");
  const absolutePath = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, body);

  const manifestEntry = {
    sequence: Number(fileSequence),
    capturedAt: new Date().toISOString(),
    url: safePath(url),
    method: request.method(),
    status: response.status(),
    classification: classification.kind,
    personId: personId || null,
    personIdSource: classification.personId
      ? "response"
      : requestProfileId
        ? "request-url"
        : personId
          ? "active-card-click"
          : null,
    personIdField: classification.personIdField || null,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    file: normalizedPath,
  };
  await fs.appendFile(path.join(outputDir, "crawl-manifest.jsonl"), `${JSON.stringify(manifestEntry)}\n`, "utf8");

  if (classification.kind === "tree") {
    const tree = extractTree(payload);
    if (tree) {
      const result = absorbTree(tree);
      state.latestTreeFile = normalizedPath;
      log(`[tree] +${result.added} ids; batch=${result.count} known=${state.knownIds.size} familyTreeSize=${state.familyTreeSize ?? "unknown"} root=${state.rootIndividualId ?? "unknown"}`);
      await saveState();
      await writeJsonAtomic("tree.json", {
        ...payload,
        data: {
          ...tree,
          rootIndividualID: state.rootIndividualId,
          familyTreeSize: state.familyTreeSize,
          personCards: [...state.treeCards.values()],
        },
      });
    }
  } else if (classification.kind === "profile") {
    const profile = extractProfile(payload);
    if (profile && personId) {
      const stored = storeProfile(personId, normalizedPath, profile);
      log(`[profile] id=${personId} facts=${Array.isArray(profile.facts) ? profile.facts.length : 0} relatives=${Array.isArray(profile.relatives) ? profile.relatives.length : 0} photos=${Array.isArray(profile.photos) ? profile.photos.length : 0}`);
      if (stored) await saveState();
      if (activeProfileClick?.personId === personId && activeProfileClick.page === responsePage) {
        activeProfileClick.resolve({ personId, file: normalizedPath, profile });
        activeProfileClick = null;
      }
    } else if (profile) {
      log(`[profile-unmatched] ${safePath(url)} saved raw but not assigned; person ID is not in response/request`);
    }
  }
}

function queueResponse(response) {
  responseQueue = responseQueue.then(() => captureResponse(response)).catch((error) => {
    log(`[capture-error] ${error.stack || error.message}`);
  });
}

async function domSnapshot(page) {
  return page.evaluate(({ cardSelector, branchSelector }) => {
    const cards = [...document.querySelectorAll(cardSelector)];
    const ridges = [...document.querySelectorAll(branchSelector)];
    const viewport = document.querySelector("#NewTreeOuter")?.getBoundingClientRect();
    const viewportLeft = viewport?.left ?? 0;
    const viewportTop = viewport?.top ?? 0;
    const viewportRight = viewport?.right ?? 0;
    const viewportBottom = viewport?.bottom ?? 0;
    const ids = cards.map((card) => card.getAttribute("data-individual-id"))
      .filter((id) => id && /^\d+$/.test(id));
    const visibleCardIds = cards.flatMap((card) => {
      const id = card.getAttribute("data-individual-id");
      const wrapper = card.querySelector('g[data-type="frameGroup"].cardWrapper');
      if (!id || !/^\d+$/.test(id) || !wrapper || !viewport) return [];
      const rect = wrapper.getBoundingClientRect();
      const left = Math.max(rect.left, viewportLeft);
      const right = Math.min(rect.right, viewportRight);
      const top = Math.max(rect.top, viewportTop);
      const bottom = Math.min(rect.bottom, viewportBottom);
      if (right - left < 20 || bottom - top < 20) return [];
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return hit && (wrapper.contains(hit) || hit.contains(wrapper)) ? [id] : [];
    });
    const ridgeData = ridges.map((ridge) => {
      const parent = ridge.parentElement;
      if (!parent) return { key: `orphan-${ridges.indexOf(ridge)}`, ownerId: null };
      const siblings = [...parent.children];
      const index = siblings.indexOf(ridge);
      const previous = siblings.slice(0, index).reverse().find((node) =>
        node.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
      const next = siblings.slice(index + 1).find((node) =>
        node.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
      const previousId = previous?.getAttribute("data-individual-id") || "";
      const nextId = next?.getAttribute("data-individual-id") || "";
      const rect = ridge.getBoundingClientRect();
      const visible = Boolean(viewport && rect.right > viewportLeft && rect.left < viewportRight &&
        rect.bottom > viewportTop && rect.top < viewportBottom);
      return {
        key: `${previousId}|${nextId}`,
        ownerId: previousId || nextId || null,
        visible,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    const vector = document.querySelector("#NewTreeVector");
    return {
      ids: [...new Set(ids)],
      visibleCardIds: [...new Set(visibleCardIds)],
      ridges: ridgeData,
      signature: JSON.stringify({ ids: [...new Set(ids)].sort(), ridges: ridgeData.map((ridge) => ridge.key).sort() }),
      scrollLeft: vector?.scrollLeft ?? 0,
      maxScrollLeft: vector ? vector.scrollWidth - vector.clientWidth : 0,
      viewportWidth: vector?.clientWidth ?? 0,
      treeLeft: viewportLeft,
      treeRight: viewportRight,
      treeTop: viewportTop,
      treeBottom: viewportBottom,
    };
  }, { cardSelector: treeSelector, branchSelector: ridgeSelector });
}

async function clickProfile(page, personId) {
  const attempts = (state.personAttempts.get(personId) || 0) + 1;
  state.personAttempts.set(personId, attempts);
  await saveState();

  let resolveProfile;
  const profileReady = new Promise((resolve) => {
    resolveProfile = resolve;
  });
  activeProfileClick = { page, personId, resolve: resolveProfile };
  const escapedId = personId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const wrapper = page.locator(`${treeSelector}[data-individual-id="${escapedId}"] g[data-type="frameGroup"].cardWrapper`).first();

  try {
    if (await wrapper.count() === 0) {
      activeProfileClick = null;
      log(`[profile-skip] id=${personId} has no rendered cardWrapper`);
      return false;
    }
    await wrapper.click({ timeout: 10000 });
  } catch (error) {
    activeProfileClick = null;
    log(`[profile-click-error] id=${personId} attempt=${attempts}: ${error.message.split("\n")[0]}`);
    return false;
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), responseTimeoutMs);
  });
  const result = await Promise.race([profileReady, timeout]);
  clearTimeout(timer);
  if (activeProfileClick?.personId === personId) activeProfileClick = null;
  if (!result) {
    log(`[profile-timeout] id=${personId} attempt=${attempts} waited=${responseTimeoutMs}ms`);
    return false;
  }
  await page.keyboard.press("Escape").catch((error) => {
    log(`[profile-dismiss-warning] id=${personId}: ${error.message}`);
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  return true;
}

async function expandRidge(page, ridge, index, previousSignature) {
  const attempts = (state.ridgeAttempts.get(ridge.key) || 0) + 1;
  state.ridgeAttempts.set(ridge.key, attempts);
  await saveState();
  const treeCountBefore = state.treeResponseCount;
  const locator = page.locator(ridgeSelector).nth(index);
  try {
    const point = await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = document.querySelector("#NewTreeOuter")?.getBoundingClientRect();
      if (!viewport) return null;
      const left = Math.max(bounds.left, viewport.left);
      const right = Math.min(bounds.right, viewport.right);
      const top = Math.max(bounds.top, viewport.top);
      const bottom = Math.min(bounds.bottom, viewport.bottom);
      for (let y = top + 1; y < bottom - 1; y += 3) {
        for (let x = left + 1; x < right - 1; x += 3) {
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === element || element.contains(hit))) return { x, y };
        }
      }
      return null;
    });
    if (!point) {
      log(`[ridge-blocked] near=${ridge.ownerId || "unknown"} attempt=${attempts}: no unoccluded point`);
      return false;
    }
    await page.mouse.click(point.x, point.y);
  } catch (error) {
    const detail = error.message.split("\n").slice(-3).join(" | ");
    log(`[ridge-click-error] near=${ridge.ownerId || "unknown"} attempt=${attempts}: ${detail}`);
    return false;
  }

  const deadline = Date.now() + mutationTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const snapshot = await domSnapshot(page).catch(() => null);
    if ((snapshot && snapshot.signature !== previousSignature) || state.treeResponseCount > treeCountBefore) {
      state.expandedRidges.add(ridge.key);
      const newIds = snapshot ? snapshot.ids.filter((id) => !state.knownIds.has(id)) : [];
      const addedFromTree = lastPassNewIds;
      if (snapshot) {
        for (const id of snapshot.ids) state.knownIds.add(id);
      }
      await saveState();
      log(`[ridge] expanded near=${ridge.ownerId || "unknown"} domAdded=${newIds.length} treeAdded=${addedFromTree}`);
      return true;
    }
  }

  log(`[ridge-no-change] near=${ridge.ownerId || "unknown"} attempt=${attempts}/${maxRidgeAttempts}`);
  return false;
}

async function scrollTreeRight(page, snapshot) {
  if (!snapshot.viewportWidth || snapshot.scrollLeft >= snapshot.maxScrollLeft) return false;
  const next = Math.min(snapshot.maxScrollLeft, snapshot.scrollLeft + Math.max(500, Math.floor(snapshot.viewportWidth * 0.75)));
  if (next <= snapshot.scrollLeft + 1) return false;
  await page.locator("#NewTreeVector").evaluate((element, scrollLeft) => {
    element.scrollLeft = scrollLeft;
  }, next);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  log(`[scroll] tree viewport ${Math.round(snapshot.scrollLeft)} -> ${Math.round(next)}/${Math.round(snapshot.maxScrollLeft)}`);
  return true;
}

async function panTree(page, snapshot, pendingIds, pendingRidgeKeys, blockedDirections) {
  if (!pendingIds.length && !pendingRidgeKeys.length) return { moved: false, directionKey: null };
  const measure = () => page.evaluate(({ selector, ids, ridgeSelector, ridgeKeys, top, bottom }) => {
    const cards = [...document.querySelectorAll(selector)].filter((card) => ids.includes(card.getAttribute("data-individual-id")));
    const cardPositions = cards.flatMap((card) => {
      const rect = card.querySelector('g[data-type="frameGroup"].cardWrapper')?.getBoundingClientRect();
      return rect ? [[card.getAttribute("data-individual-id"), rect.left, rect.top, rect.right, rect.bottom]] : [];
    });
    const ridgePositions = [...document.querySelectorAll(ridgeSelector)].flatMap((ridge) => {
      const parent = ridge.parentElement;
      if (!parent) return [];
      const siblings = [...parent.children];
      const index = siblings.indexOf(ridge);
      const previous = siblings.slice(0, index).reverse().find((node) =>
        node.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
      const next = siblings.slice(index + 1).find((node) =>
        node.matches?.('g[data-type="_svgOuterGroup"][data-individual-id]'));
      const key = `${previous?.getAttribute("data-individual-id") || ""}|${next?.getAttribute("data-individual-id") || ""}`;
      if (!ridgeKeys.includes(key)) return [];
      const rect = ridge.getBoundingClientRect();
      return [[`ridge:${key}`, rect.left, rect.top, rect.right, rect.bottom]];
    });
    const positions = [...cardPositions, ...ridgePositions];
    const { left, right } = document.querySelector("#NewTreeOuter").getBoundingClientRect();
    const leftCount = positions.filter(([, , , rectRight]) => rectRight < left + 15).length;
    const rightCount = positions.filter(([, rectLeft]) => rectLeft > right - 15).length;
    const above = positions.filter(([, , , , rectBottom]) => rectBottom < top + 15).length;
    const below = positions.filter(([, , rectTop]) => rectTop > bottom - 15).length;
    return {
      left: leftCount,
      right: rightCount,
      above,
      below,
      positionX: positions.length
        ? positions.reduce((sum, [, rectLeft, , rectRight]) => sum + (rectLeft + rectRight) / 2, 0) / positions.length
        : null,
      positionY: positions.length
        ? positions.reduce((sum, [, , rectTop, , rectBottom]) => sum + (rectTop + rectBottom) / 2, 0) / positions.length
        : null,
    };
  }, {
    selector: treeSelector,
    ids: pendingIds,
    ridgeSelector,
    ridgeKeys: pendingRidgeKeys,
    top: snapshot.treeTop,
    bottom: snapshot.treeBottom,
  });
  const offscreen = await measure();
  const candidates = [
    { axis: "x", sign: 1, count: offscreen.left },
    { axis: "x", sign: -1, count: offscreen.right },
    { axis: "y", sign: 1, count: offscreen.above },
    { axis: "y", sign: -1, count: offscreen.below },
  ].filter((candidate) => candidate.count > 0 && !blockedDirections.has(`${candidate.axis}:${candidate.sign}`))
    .sort((left, right) => right.count - left.count);
  const candidate = candidates[0];
  if (!candidate) return { moved: false, directionKey: null };

  const directionKey = `${candidate.axis}:${candidate.sign}`;
  const pageSize = { width: await page.evaluate(() => innerWidth), height: await page.evaluate(() => innerHeight) };
  const treeHeight = Math.max(100, snapshot.treeBottom - snapshot.treeTop);
  const treeWidth = Math.max(100, snapshot.treeRight - snapshot.treeLeft);
  let x = Math.floor(snapshot.treeLeft + treeWidth * 0.5);
  let y = Math.floor(snapshot.treeTop + treeHeight * 0.5);
  const delta = candidate.sign * (candidate.axis === "x" ? 300 : 150);
  let deltaX = 0;
  let deltaY = 0;
  if (candidate.axis === "x") {
    x = Math.floor(pageSize.width * 0.5);
    deltaX = candidate.sign * Math.min(Math.abs(delta), candidate.sign > 0 ? pageSize.width - x - 20 : x - 20);
  } else {
    const maxDelta = delta > 0 ? pageSize.height - y - 20 : y - 20;
    deltaY = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(30, maxDelta));
  }
  try {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 10 });
    await page.mouse.up();
  } catch (error) {
    await page.mouse.up().catch(() => {});
    log(`[pan-error] ${error.message}`);
    return { moved: false, directionKey };
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = await measure();
  const beforePosition = candidate.axis === "x" ? offscreen.positionX : offscreen.positionY;
  const afterPosition = candidate.axis === "x" ? after.positionX : after.positionY;
  const moved = beforePosition !== null && afterPosition !== null &&
    Math.abs(afterPosition - beforePosition) >= 5;
  log(`[pan] axis=${candidate.axis} delta=${candidate.axis === "x" ? deltaX : deltaY} left=${offscreen.left} right=${offscreen.right} above=${offscreen.above} below=${offscreen.below} moved=${moved}`);
  return { moved, directionKey };
}

function collectPhotoRecords() {
  for (const [ownerId, profile] of state.profiles) {
    if (!Array.isArray(profile.photos)) continue;
    for (const photo of profile.photos) {
      if (photo?.id === undefined || photo?.id === null) continue;
      const photoId = String(photo.id);
      const current = state.photoIndex.get(photoId) || {
        id: photoId,
        owners: [],
        metadata: photo,
        originalUrl: photo.largeUrl || photo.thumbUrl || null,
        downloaded: false,
        file: null,
      };
      if (!current.owners.includes(ownerId)) current.owners.push(ownerId);
      if (!current.originalUrl) current.originalUrl = photo.largeUrl || photo.thumbUrl || null;
      if (!current.metadata || (!current.metadata.largeUrl && photo.largeUrl)) current.metadata = photo;
      state.photoIndex.set(photoId, current);
    }
  }
}

function extensionFor(contentType, url) {
  const contentExtensions = new Map([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"],
    ["image/tiff", ".tif"],
    ["image/bmp", ".bmp"],
  ]);
  const fromContent = contentExtensions.get((contentType || "").split(";")[0].trim().toLowerCase());
  if (fromContent) return fromContent;
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/.test(extension)) return extension;
  } catch {
    return ".bin";
  }
  return ".bin";
}

async function downloadPhotos(context) {
  collectPhotoRecords();
  const total = state.photoIndex.size;
  let downloaded = 0;
  let failed = 0;
  log(`[photos] starting unique=${total}`);
  for (const [photoId, photo] of state.photoIndex) {
    if (photo.downloaded && photo.file) {
      try {
        await fs.access(path.join(outputDir, photo.file));
        downloaded += 1;
        continue;
      } catch {
        photo.downloaded = false;
      }
    }
    if (!photo.originalUrl) {
      photo.error = "No download URL in personData";
      failed += 1;
      continue;
    }

    const url = new URL(photo.originalUrl, "https://www.myheritage.com").toString();
    let succeeded = false;
    for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
      try {
        const response = await context.request.get(url, { timeout: 30000 });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const contentType = response.headers()["content-type"] || "";
        const bytes = await response.body();
        const relativePath = path.join("photos", `${safeSegment(photoId)}${extensionFor(contentType, url)}`);
        const absolutePath = path.join(outputDir, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, bytes);
        await fs.rename(temporaryPath, absolutePath);
        photo.file = relativePath.split(path.sep).join("/");
        photo.originalUrl = url;
        photo.contentType = contentType;
        photo.size = bytes.length;
        photo.downloaded = true;
        delete photo.error;
        succeeded = true;
        downloaded += 1;
      } catch (error) {
        photo.error = error.message;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!succeeded) failed += 1;
    if ((downloaded + failed) % 25 === 0 || downloaded + failed === total) {
      log(`[photos] progress=${downloaded + failed}/${total} downloaded=${downloaded} failed=${failed}`);
    }
    await writeJsonAtomic("photos.json", Object.fromEntries(state.photoIndex));
  }
  await writeJsonAtomic("photos.json", Object.fromEntries(state.photoIndex));
  log(`[photos] complete unique=${total} downloaded=${downloaded} failed=${failed}`);
  return { total, downloaded, failed };
}

async function writeExport() {
  const people = {};
  for (const id of state.knownIds) {
    people[id] = {
      treeCard: state.treeCards.get(id) || null,
      personData: state.profiles.get(id) || null,
    };
  }
  const photosFound = state.photoIndex.size;
  const photosDownloaded = [...state.photoIndex.values()].filter((photo) => photo.downloaded).length;
  await writeJsonAtomic("export.json", {
    meta: {
      source: "MyHeritage",
      exportedAt: new Date().toISOString(),
      familyTreeSize: state.familyTreeSize,
      rootIndividualId: state.rootIndividualId,
    },
    people,
    families: {},
    photos: Object.fromEntries(state.photoIndex),
    stats: {
      knownIndividuals: state.knownIds.size,
      profilesCaptured: state.profiles.size,
      photosFound,
      photosDownloaded,
    },
  });
}

function monitorPage(page) {
  page.on("response", queueResponse);
}

async function findTreePage(context) {
  return context.pages().find((page) => /myheritage\.com\/family-trees\//i.test(page.url()));
}

async function waitForTreePage(context) {
  while (!stopping) {
    const page = await findTreePage(context);
    if (page) return page;
    log("[waiting] Open the authorized MyHeritage family tree in this private Chrome window");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
}

async function hasDailyUsageLimitDialog(page) {
  return page.locator("dialog").evaluateAll((dialogs) =>
    dialogs.some((dialog) => dialog.open &&
      /maximum daily usage limit/i.test(dialog.innerText || "")));
}

async function crawl(page) {
  let pass = 0;
  let horizontalScanComplete = false;
  const blockedPanDirections = new Set();
  while (!stopping && pass < 5000) {
    pass += 1;
    lastPassNewIds = 0;
    if (await hasDailyUsageLimitDialog(page)) {
      dailyUsageLimited = true;
      log("[limit] MyHeritage daily feature-usage limit reached; stopping tree interactions");
      break;
    }
    let snapshot;
    try {
      snapshot = await domSnapshot(page);
    } catch (error) {
      log(`[dom-warning] Cannot inspect tree: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    for (const id of snapshot.ids) {
      if (!state.knownIds.has(id)) {
        state.knownIds.add(id);
        state.treeCards.set(id, { id });
        lastPassNewIds += 1;
      }
    }
    if (lastPassNewIds) {
      blockedPanDirections.clear();
      await saveState();
    }

    const visible = new Set(snapshot.visibleCardIds);
    let acted = false;
    for (const id of snapshot.visibleCardIds) {
      if (state.profiles.has(id) || (state.personAttempts.get(id) || 0) >= maxPersonAttempts) continue;
      if (await clickProfile(page, id)) blockedPanDirections.clear();
      acted = true;
      break;
    }

    const ridgeSnapshot = await domSnapshot(page).catch(() => snapshot);
    const unexpanded = ridgeSnapshot.ridges
      .map((ridge, index) => ({ ...ridge, index }))
      .find((ridge) => ridge.visible && !state.expandedRidges.has(ridge.key) &&
        (state.ridgeAttempts.get(ridge.key) || 0) < maxRidgeAttempts);
    if (!acted && unexpanded) {
      if (await expandRidge(page, unexpanded, unexpanded.index, ridgeSnapshot.signature)) {
        horizontalScanComplete = false;
        blockedPanDirections.clear();
      }
      acted = true;
    }

    const missingVisible = ridgeSnapshot.visibleCardIds.some((id) =>
      !state.profiles.has(id) && (state.personAttempts.get(id) || 0) < maxPersonAttempts);
    const missingKnown = [...state.knownIds].some((id) =>
      !state.profiles.has(id) && (state.personAttempts.get(id) || 0) < maxPersonAttempts);
    log(`[pass ${pass}] known=${state.knownIds.size} completed=${state.profiles.size} visible=${visible.size} ridges=${ridgeSnapshot.ridges.length} added=${lastPassNewIds}`);

    if (acted) continue;
    if (missingVisible) continue;
    if (missingKnown && !horizontalScanComplete && await scrollTreeRight(page, ridgeSnapshot)) {
      continue;
    }
    if (missingKnown && !horizontalScanComplete) {
      const viewport = page.locator("#NewTreeVector");
      const currentLeft = await viewport.evaluate((element) => element.scrollLeft).catch(() => 0);
      if (currentLeft > 0) {
        await viewport.evaluate((element) => { element.scrollLeft = 0; }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1000));
        horizontalScanComplete = true;
        continue;
      }
      horizontalScanComplete = true;
    }

    const unexpandedRidges = ridgeSnapshot.ridges.filter((ridge) =>
      !state.expandedRidges.has(ridge.key));
    const pendingRidges = unexpandedRidges.filter((ridge) =>
      (state.ridgeAttempts.get(ridge.key) || 0) < maxRidgeAttempts);
    const pendingRenderedPeople = ridgeSnapshot.ids.filter((id) =>
      !state.profiles.has(id) && (state.personAttempts.get(id) || 0) < maxPersonAttempts);
    const panResult = await panTree(page, ridgeSnapshot, pendingRenderedPeople, pendingRidges.map((ridge) => ridge.key), blockedPanDirections);
    if (panResult.moved) {
      continue;
    }
    if (panResult.directionKey) {
      blockedPanDirections.add(panResult.directionKey);
      continue;
    }
    const exhaustedRidges = unexpandedRidges.filter((ridge) =>
      (state.ridgeAttempts.get(ridge.key) || 0) >= maxRidgeAttempts);
    if (exhaustedRidges.length) {
      log(`[warning] ${exhaustedRidges.length} unexpanded ridge(s) reached ${maxRidgeAttempts} attempts`);
    }
    if (missingKnown) log("[warning] Some known IDs still have no profile and no reachable rendered card");
    break;
  }
  if (pass >= 5000) log("[warning] Stopped at safety cap of 5000 crawler passes");
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CDP_PORT must be a valid TCP port");
  if (!Number.isInteger(responseTimeoutMs) || responseTimeoutMs < 1000) throw new Error("RESPONSE_TIMEOUT_MS must be at least 1000");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "raw"), { recursive: true });
  await readState();

  browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP browser has no default context");
  context.on("page", monitorPage);
  for (const page of context.pages()) monitorPage(page);
  browser.on("disconnected", () => {
    if (!stopping) log("[cdp] Browser disconnected");
    stopping = true;
    shutdownResolve?.();
  });

  const page = await waitForTreePage(context);
  if (!page) return;
  log(`[ready] tree=${safePath(page.url())}; beginning traversal`);
  do {
    await crawl(page);
    await responseQueue;
  } while (!stopping && lastPassNewIds > 0);
  collectPhotoRecords();
  await saveState();
  await writeExport();
  if (stopping) {
    log("[paused] progress saved; rerun npm run crawl to resume");
    return;
  }
  const photoStats = dailyUsageLimited
    ? {
      total: state.photoIndex.size,
      downloaded: [...state.photoIndex.values()].filter((photo) => photo.downloaded).length,
      failed: [...state.photoIndex.values()].filter((photo) => photo.error).length,
    }
    : await downloadPhotos(context);
  if (dailyUsageLimited) log("[limit] Skipping additional photo requests; saved photo records are retained");
  await writeExport();

  const missing = [...state.knownIds].filter((id) => !state.profiles.has(id));
  const noRidges = (await domSnapshot(page).catch(() => ({ ridges: [] }))).ridges.length === 0;
  const complete = missing.length === 0 && noRidges && lastPassNewIds === 0 &&
    (state.familyTreeSize === null || state.knownIds.size === state.familyTreeSize);
  if (complete) {
    log(`[complete] known=${state.knownIds.size} profiles=${state.profiles.size} photos=${photoStats.total} downloaded=${photoStats.downloaded}`);
  } else {
    const mismatch = state.familyTreeSize !== null && state.knownIds.size !== state.familyTreeSize
      ? ` familyTreeSize=${state.familyTreeSize} known=${state.knownIds.size}`
      : "";
    log(`[incomplete] known=${state.knownIds.size} profiles=${state.profiles.size} missing=${missing.length} ridgesRemaining=${noRidges ? 0 : "yes"} photoFailures=${photoStats.failed}${mismatch}`);
    if (missing.length) log(`[missing-ids] ${missing.join(",")}`);
    if (dailyUsageLimited) log("[limit] Resume after the daily usage allowance resets and the MyHeritage dialog is dismissed");
  }
  await new Promise((resolve) => {
    shutdownResolve = resolve;
    if (stopping) resolve();
  });
}

main().catch((error) => {
  process.stderr.write(`[fatal] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

process.once("SIGINT", () => {
  if (stopping) return;
  stopping = true;
  log("[shutdown] will save progress after the current browser action");
  shutdownResolve?.();
});

process.once("SIGTERM", () => {
  stopping = true;
  shutdownResolve?.();
});

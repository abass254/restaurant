/**
 * Patches for @open-wa/wa-automate@4.76.0 (unmaintained).
 *
 * 1) WhatsApp Web no longer exposes window.Debug — wait hung for 30s (#3346).
 * 2) customUserAgent is only read when inDocker — default UA is Chrome/104,
 *    which WhatsApp rejects with "Chrome 100+" (#3330 / #3348).
 *
 * Run after npm install (postinstall).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "node_modules", "@open-wa", "wa-automate", "dist");

const MODERN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

function patchFile(relPath, transform) {
  const target = path.join(ROOT, relPath);
  if (!fs.existsSync(target)) {
    console.warn(`[patch-openwa] missing ${relPath} — skip`);
    return;
  }
  const before = fs.readFileSync(target, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`[patch-openwa] ${relPath}: already applied or no match`);
    return;
  }
  fs.writeFileSync(target, after);
  console.log(`[patch-openwa] ${relPath}: patched`);
}

// --- 1) Debug wait ---
patchFile("controllers/initializer.js", (src) => {
  let out = src;
  const oldWait =
    "yield waPage.waitForFunction('window.Debug!=undefined && window.Debug.VERSION!=undefined && require');";
  const newWait =
    'yield waPage.waitForFunction(\'typeof require !== "undefined"\', { timeout: 120000 });';
  if (out.includes(oldWait)) out = out.replace(oldWait, newWait);

  const oldVersion =
    "const WA_VERSION = yield waPage.evaluate(() => window.Debug ? window.Debug.VERSION : 'I think you have been TOS_BLOCKed');";
  const newVersion =
    "const WA_VERSION = yield waPage.evaluate(() => (window.Debug && window.Debug.VERSION) || 'md-no-debug');";
  if (out.includes(oldVersion)) out = out.replace(oldVersion, newVersion);

  // Always honor config.customUserAgent (was Docker-only).
  const dockerOnly =
    "if (config === null || config === void 0 ? void 0 : config.inDocker) {\n" +
    "            //try to infer config variables from process.env\n" +
    "            config = Object.assign(Object.assign({}, config), (0, tools_1.getConfigFromProcessEnv)(exports.configWithCases));\n" +
    "            config.chromiumArgs = (config === null || config === void 0 ? void 0 : config.chromiumArgs) || [];\n" +
    "            customUserAgent = config.customUserAgent;\n" +
    "        }";
  const dockerFixed =
    "if (config === null || config === void 0 ? void 0 : config.inDocker) {\n" +
    "            //try to infer config variables from process.env\n" +
    "            config = Object.assign(Object.assign({}, config), (0, tools_1.getConfigFromProcessEnv)(exports.configWithCases));\n" +
    "            config.chromiumArgs = (config === null || config === void 0 ? void 0 : config.chromiumArgs) || [];\n" +
    "        }\n" +
    "        customUserAgent = (config === null || config === void 0 ? void 0 : config.customUserAgent) || customUserAgent;";
  if (out.includes(dockerOnly)) out = out.replace(dockerOnly, dockerFixed);

  return out;
});

// --- 2) Default UA fallback ---
patchFile("config/puppeteer.config.js", (src) => {
  const oldCreate =
    "const createUserAgent = (waVersion) => `WhatsApp/${waVersion} Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36`;";
  const newCreate = `const createUserAgent = (waVersion) => ${JSON.stringify(MODERN_UA)};`;
  if (!src.includes(oldCreate)) return src;
  let out = src.replace(oldCreate, newCreate);
  // Keep export stable; ignore waVersion prefix entirely.
  out = out.replace(
    "exports.useragent = (0, exports.createUserAgent)('2.2147.16');",
    `exports.useragent = ${JSON.stringify(MODERN_UA)};`,
  );
  return out;
});

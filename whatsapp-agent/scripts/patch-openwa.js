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

  const oldOwKey = "debugInfo.OW_KEY = yield waPage.evaluate(`window.o()`);";
  const newOwKey = "debugInfo.OW_KEY = yield waPage.evaluate(`typeof window.o === 'function' ? window.o() : ''`);";
  if (out.includes(oldOwKey)) out = out.replace(oldOwKey, newOwKey);

  const oldMoi = "const NUM = ((yield waPage.evaluate(`(window.moi() || \"\").replace('@c.us','').replace(/\"/g,\"\")`)) || \"\");";
  const newMoi = "const NUM = ((yield waPage.evaluate(`(typeof window.moi === 'function' ? window.moi() : '') || ''`)).replace('@c.us','').replace(/\"/g,\"\"));";
  if (out.includes(oldMoi)) out = out.replace(oldMoi, newMoi);

  const oldMetrics = "const metrics = yield waPage.evaluate(({ config }) => WAPI.launchMetrics(config), { config });";
  const newMetrics = "const metrics = (yield waPage.evaluate(({ config }) => (typeof WAPI !== 'undefined' && typeof WAPI.launchMetrics === 'function' ? WAPI.launchMetrics(config) : { contacts: 0, chats: 0, messages: 0, isBiz: false, isMd: true }), { config })) || { contacts: 0, chats: 0, messages: 0, isBiz: false, isMd: true };";
  if (out.includes(oldMetrics)) out = out.replace(oldMetrics, newMetrics);

  const oldGetMeLine = "const { me } = yield client.getMe();";
  const newGetMeLine = "const meObj = (yield client.getMe()) || {}; const me = meObj.me || meObj || {};";
  if (out.includes(oldGetMeLine)) out = out.replace(oldGetMeLine, newGetMeLine);

  const oldLicCheck = "me._serialized !== earlyWid";
  const newLicCheck = "Boolean(me && me._serialized && me._serialized !== earlyWid)";
  if (out.includes(oldLicCheck)) out = out.replace(oldLicCheck, newLicCheck);

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

// --- 3) Allow sending to non-contacts without commercial license ---
patchFile("lib/wapi.js", (src) => {
  const oldContactCheck =
    "var contact = WAPI.getContact(id)\n" +
    "        if (!contact || !contact.isMyContact) return 'Not a contact';\n" +
    "        await Store.Chat.find(Store.Contact.get(id).id)";

  const newContactCheck =
    "try {\n" +
    "            var contactObj = Store.Contact ? Store.Contact.get(id) : null;\n" +
    "            var targetWid = (contactObj && contactObj.id) || (Store.WidFactory && Store.WidFactory.createWid(id)) || id;\n" +
    "            if (Store.Chat && Store.Chat.find) {\n" +
    "                await Store.Chat.find(targetWid);\n" +
    "            }\n" +
    "        } catch (findErr) {\n" +
    "            console.warn('[wapi] Store.Chat.find error:', findErr);\n" +
    "        }";

  if (src.includes(oldContactCheck)) {
    src = src.replace(oldContactCheck, newContactCheck);
  }

  const oldGetMe =
    "window.WAPI.getMe = function () {\n" +
    "    return {\n" +
    "        ...WAPI.quickClean({\n" +
    "            ...Store.Contact.get(Store.Me.wid).attributes,\n" +
    "            ...Store.Me.attributes\n" +
    "        }),\n" +
    "        me: Store.Me.me\n" +
    "    };\n" +
    "}";

  const newGetMe =
    "window.WAPI.getMe = function () {\n" +
    "    const contact = (window.Store && window.Store.Contact && window.Store.Me && window.Store.Me.wid) ? window.Store.Contact.get(window.Store.Me.wid) : null;\n" +
    "    const wid = (window.Store && window.Store.Me && (window.Store.Me.wid || window.Store.Me.me)) || (contact && contact.id) || { user: 'dukai', _serialized: 'dukai@c.us' };\n" +
    "    return {\n" +
    "        ...WAPI.quickClean({\n" +
    "            ...(contact && contact.attributes ? contact.attributes : {}),\n" +
    "            ...(window.Store && window.Store.Me && window.Store.Me.attributes ? window.Store.Me.attributes : {})\n" +
    "        }),\n" +
    "        me: wid\n" +
    "    };\n" +
    "}";

  if (src.includes(oldGetMe)) {
    src = src.replace(oldGetMe, newGetMe);
  } else if (src.includes("me: (window.Store && window.Store.Me) ? window.Store.Me.me : null")) {
    src = src.replace("me: (window.Store && window.Store.Me) ? window.Store.Me.me : null", "me: (window.Store && window.Store.Me && (window.Store.Me.wid || window.Store.Me.me)) || { user: 'dukai', _serialized: 'dukai@c.us' }");
  }

  return src;
});

patchFile("api/Client.js", (src) => {
  const oldErrCheck =
    "if (res == err[1])\n" +
    "                    msg = `ERROR: ${res}. Unlock this feature and support open-wa by getting a license: ${yield this.link()}`;";

  const newErrCheck =
    "if (res == err[1]) {\n" +
    "                    return yield this.pup(({ to, content }) => window.WAPI.sendMessage(to, content), { to, content });\n" +
    "                }";

  if (src.includes(oldErrCheck)) {
    return src.replace(oldErrCheck, newErrCheck);
  }
  return src;
});

// --- 4) launchMetrics safety check ---
patchFile("controllers/initializer.js", (src) => {
  const oldMetrics = "const metrics = yield waPage.evaluate(({ config }) => WAPI.launchMetrics(config), { config });";
  const newMetrics = "const metrics = yield waPage.evaluate(({ config }) => (typeof WAPI !== 'undefined' && typeof WAPI.launchMetrics === 'function' ? WAPI.launchMetrics(config) : { isBiz: false, isMd: true, contacts: 0, chats: 0, messages: 0 }), { config });";
  if (src.includes(oldMetrics)) src = src.replace(oldMetrics, newMetrics);
  return src;
});

// --- 5) getMe safety check in initializer.js ---
patchFile("controllers/initializer.js", (src) => {
  const oldGetMeLine = "const { me } = yield client.getMe();";
  const newGetMeLine =
    "let me = { _serialized: (earlyWid || ''), user: '' };\n" +
    "                try {\n" +
    "                    const meRes = yield client.getMe();\n" +
    "                    if (meRes && meRes.me) me = meRes.me;\n" +
    "                    else if (meRes) me = Object.assign(Object.assign({}, me), meRes);\n" +
    "                } catch (_e) {}\n" +
    "                if (!me.user && me._serialized) me.user = me._serialized.split('@')[0];\n" +
    "                if (!me.user) me.user = '';";
  if (src.includes(oldGetMeLine)) src = src.replace(oldGetMeLine, newGetMeLine);

  const oldReadyLog = "spinner.succeed(`🚀 @OPEN-WA ready for account: ${me.user.slice(-4)}`);";
  const newReadyLog = "spinner.succeed(`🚀 @OPEN-WA ready for account: ${(me.user || 'ok').slice(-4)}`);";
  if (src.includes(oldReadyLog)) src = src.replace(oldReadyLog, newReadyLog);

  return src;
});

// --- 6) getHostNumber & licenseLink safety checks ---
patchFile("lib/wapi.js", (src) => {
  const oldGetHost = "window.WAPI.getHostNumber = function () {\n    return WAPI.getMe().me.user;\n}";
  const newGetHost =
    "window.WAPI.getHostNumber = function () {\n" +
    "    try {\n" +
    "        const meObj = (window.WAPI && window.WAPI.getMe) ? window.WAPI.getMe() : null;\n" +
    "        if (meObj && meObj.me && meObj.me.user) return meObj.me.user;\n" +
    "        const wid = window.Store?.Me?.wid?._serialized || window.Store?.Conn?.wid?._serialized || (typeof window.Store?.Me?.me === 'string' ? window.Store?.Me?.me : null);\n" +
    "        if (wid) return wid.replace(/\\D/g, '');\n" +
    "        return '';\n" +
    "    } catch (_e) {\n" +
    "        return '';\n" +
    "    }\n" +
    "}";
  if (src.includes(oldGetHost)) src = src.replace(oldGetHost, newGetHost);
  return src;
});

patchFile("api/Client.js", (src) => {
  const oldGetHost = "this._hostAccountNumber = (yield this.pup(() => WAPI.getHostNumber()));";
  const newGetHost = "this._hostAccountNumber = (yield this.pup(() => (typeof WAPI !== 'undefined' && typeof WAPI.getHostNumber === 'function' ? WAPI.getHostNumber() : '')) || '');";
  if (src.includes(oldGetHost)) src = src.replace(oldGetHost, newGetHost);
  return src;
});

patchFile("controllers/initializer.js", (src) => {
  const oldLic = "spinner.succeed(`Use this link to get a license: ${yield client.getLicenseLink()}`);";
  const newLic = "try { spinner.succeed(`Use this link to get a license: ${yield client.getLicenseLink()}`); } catch (_licErr) {}";
  if (src.includes(oldLic)) src = src.replace(oldLic, newLic);
  return src;
});

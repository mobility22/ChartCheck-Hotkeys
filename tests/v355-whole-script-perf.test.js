const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.55', /@version\s+3\.55\b/.test(src));
ok('no leftover 3.54', !/\b3\.54\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('interval refresh stays 800ms', src.includes('const SITE_GRAY_REFRESH_MS = 800') && src.includes('setInterval(refreshPatientSiteGray, SITE_GRAY_REFRESH_MS)'));
ok('one shared debounced observer queues at 300ms', src.includes('function queueSiteGrayRefresh(') && src.includes('function markPageScanDirty(') && /setTimeout\(\(\) => \{[\s\S]*?refreshPatientSiteGray\(\);\s*\}, SITE_GRAY_MUTATION_DEBOUNCE_MS\)/.test(src) && src.includes('SITE_GRAY_MUTATION_DEBOUNCE_MS = 300'));
ok('observer still ignores panel and DOM-copy mutations', src.includes('function mutationIsOutsidePanel(') && src.includes("el.closest('#chartcheck-panel')") && src.includes("el.closest('#chartcheck-dom-copy')"));
ok('observer marks caches dirty then queues the shared refresh', /function startSiteGrayRefresh\([\s\S]*?markPageScanDirty\(\);\s*queueSiteGrayRefresh\(\);/.test(src));
ok('v3.52 gray-out cache is unchanged', src.includes('function cachedGrayFractions(') && src.includes('function grayFractionPageSignature(') && src.includes('SITE_GRAY_MUTATION_DEBOUNCE_MS = 300'));
ok('idle refresh skips work when the page signature is unchanged', /function refreshPatientSiteGray\([\s\S]*?function cheapIdleSignature\(|function cheapIdleSignature\([\s\S]*?function refreshPatientSiteGray\(/.test(src) && /if \(changed \|\| lastAppliedSite == null \|\| lastAppliedSite === 'unknown'\) \{\s*applyPatientSiteGray\(detectPatientSite\(\)\);/.test(src));
ok('refresh still calls maybeAutoCopy and updateSiteFrame', /function refreshPatientSiteGray\([\s\S]*?maybeAutoCopyPatientMrn\(\);\s*updateSiteFrame\(\);/.test(src));
ok('buttons and selects are collected with a targeted query, not a recursive * walk', src.includes("function collectDeepByQuery(") && /function findButtons\([\s\S]*?collectDeepByQuery\(root, 'button'/.test(src) && /function findSelects\([\s\S]*?collectDeepByQuery\(root, 'select'/.test(src) && !/function findSelects\([\s\S]*?walkDom\(root, el => \{[\s\S]*?findSelects\(el\.shadowRoot\)/.test(src));
ok('template selects and overview documents are cached until the DOM is dirty', /function getTemplateSelects\([\s\S]*?cachedTemplateSelects/.test(src) && /function overviewDocuments\([\s\S]*?cachedOverviewDocs/.test(src) && /function findPatientsSidebar\([\s\S]*?cachedPatientsSidebar/.test(src));
ok('center-line text is reused from a cached connected element', /function findCenterLineText\([\s\S]*?cachedCenterLineEl/.test(src));
ok('visible template selects skip getComputedStyle', /function isLikelyVisibleSelect\([\s\S]*?if \(wide > 0 \|\| tall > 0\) return true;/.test(src));
ok('already-copied MRN skips the banner document walk', /if \(copiedIdentity === identity && !awaitingFreshBanner\) \{\s*return;\s*\}[\s\S]*?const obs = bannerObservation\(\);/.test(src));
ok('site frame skips style writes when the box is unchanged', /function updateSiteFrame\([\s\S]*?if \(key === lastSiteFrameKey\) return;/.test(src));
ok('overview signatures hash table text, not only length', src.includes('function cheapTextHash(') && /function cheapOverviewTextSignature\([\s\S]*?hash \^= cheapTextHash\(text\)/.test(src));
ok('self-mutations are still ignored while applying site gray', /function queueSiteGrayRefresh\([\s\S]*?if \(applyingSiteGray \|\| siteGrayQueued\) return;/.test(src) && /const observer = new MutationObserver\([\s\S]*?if \(applyingSiteGray \|\| siteGrayQueued\) return;/.test(src));

const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
ok('helper extract', muteEnd > muteStart && normEnd > normStart);

const helpers = new Function(
    src.slice(normStart, normEnd)
    + src.slice(muteStart, muteEnd)
    + '\nreturn { cheapTextHash, cheapOverviewTextSignature, grayFractionPageSignature, cachedGrayFractions, shouldMuteSiteSbrt, isSiteTemplateMuted };'
)();

ok('cheapTextHash is stable for the same text', helpers.cheapTextHash('10 / 10 19 / 20') === helpers.cheapTextHash('10 / 10 19 / 20'));
ok('cheapTextHash changes when a same-length fraction total changes', helpers.cheapTextHash('10 / 10') !== helpers.cheapTextHash('11 / 10'));

const pageOne = helpers.grayFractionPageSignature([{ value: 'ros', options: [{ text: 'ROS_Standard' }], selectedIndex: 0 }]);
const pageOneAgain = helpers.grayFractionPageSignature([{ value: 'ros', options: [{ text: 'ROS_Standard' }], selectedIndex: 0 }]);
ok('page signatures stay stable when selects and overview text are unchanged', pageOne === pageOneAgain);

let computeCalls = 0;
const first = helpers.cachedGrayFractions(pageOne, function () { computeCalls++; return 20; });
const second = helpers.cachedGrayFractions(pageOne, function () { computeCalls++; return 99; });
ok('gray-out cache still reuses the computed value', first === 20 && second === 20 && computeCalls === 1);
ok('Roseville long-course SBRT mute rules are unchanged', helpers.isSiteTemplateMuted('roseville', 20, 'ros', true) === true && helpers.isSiteTemplateMuted('roseville', 20, 'ros', false) === false && helpers.isSiteTemplateMuted('roseville', 20, 'rco', true) === true);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

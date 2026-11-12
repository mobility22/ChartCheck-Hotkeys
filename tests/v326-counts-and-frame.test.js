const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

function extract(label, start, end) {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a);
    if (a < 0 || b < 0 || b <= a) {
        ok(label + ' extract', false);
        return '';
    }
    return src.slice(a, b);
}

ok('@version 3.27', /@version\s+3\.27\b/.test(src));
ok('no leftover 3.26', !/\b3\.26\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('loaded log uses SCRIPT_VERSION', src.includes('ChartCheck Hotkeys v${SCRIPT_VERSION} Loaded') || src.includes('ChartCheck Hotkeys v${SCRIPT_VERSION}'));
ok('grants GM_getValue', /@grant\s+GM_getValue/.test(src));
ok('grants GM_setValue', /@grant\s+GM_setValue/.test(src));
ok('README not mentioned in script change notes only: empty readme stays empty', fs.statSync(path.join(path.dirname(srcPath), 'README.md')).size === 0);

ok('reset button class present', src.includes("resetBtn.className = 'chartcheck-count-reset'"));
ok('reset button label is ↺', src.includes("resetBtn.textContent = '↺'"));
const resetClick = extract(
    'reset click handler',
    "        resetBtn.addEventListener('click', (event) => {",
    "        ranchoLine.appendChild(resetBtn);"
);
ok('reset click only calls resetPersistedSiteCounts', resetClick.includes('resetPersistedSiteCounts();'));
ok('reset click does not start review', !/(startAuto|reviewUntilFail|reviewApproveUntilFail|approveOnce|loadNextPatient|openFirstFail)/.test(resetClick));
ok('reset log is counters reset only', src.includes("console.log('counters reset')"));

const reviewUntil = extract(
    'reviewUntilFail',
    '    async function reviewUntilFail',
    '    async function reviewApproveUntilFail'
);
ok('reviewUntilFail resets autoReviewCount only', reviewUntil.includes('autoReviewCount = 0'));
ok('reviewUntilFail does not zero site counts', !/rosevilleReviewCount\s*=\s*0/.test(reviewUntil) && !/ranchoReviewCount\s*=\s*0/.test(reviewUntil));
ok('reviewUntilFail does not call resetPersistedSiteCounts', !reviewUntil.includes('resetPersistedSiteCounts'));
ok('reviewUntilFail does not call resetReviewCounts', !reviewUntil.includes('resetReviewCounts'));

const reviewApprove = extract(
    'reviewApproveUntilFail',
    '    async function reviewApproveUntilFail',
    '    // ============================================================\n    // Actions'
);
ok('reviewApproveUntilFail resets autoReviewCount only', reviewApprove.includes('autoReviewCount = 0'));
ok('reviewApproveUntilFail does not zero site counts', !/rosevilleReviewCount\s*=\s*0/.test(reviewApprove) && !/ranchoReviewCount\s*=\s*0/.test(reviewApprove));
ok('reviewApproveUntilFail does not call resetPersistedSiteCounts', !reviewApprove.includes('resetPersistedSiteCounts'));

ok('no daily or startup site-count auto-reset helper leftover', !src.includes('resetReviewCounts') && !/new Date|getDate\(|toDateString|localStorage/.test(src));
ok('loads persisted counts at init', /\/\/ Init[\s\S]*loadSiteCounts\(\);[\s\S]*window\.addEventListener\('load'/.test(src));

const buttonOrder = extract('buttonOrder', '        const buttonOrder = [', '        ];');
ok('ROS/RCO four items are buttons 7-10 (grid rows 4-5)', /'Q',\s*'W',\s*'⇧Q',\s*'⇧W'/.test(buttonOrder));
ok('site frame class is created', src.includes("siteFrame.className = 'chartcheck-site-frame'"));
ok('site frame is 2px yellow and covers grid rows 4-5', /#chartcheck-panel \.chartcheck-site-frame\s*\{[\s\S]*?grid-row:\s*4\s*\/\s*span\s*2;[\s\S]*?border:\s*2px solid rgba\(255,\s*214,\s*0,\s*0\.7\);/.test(src));
ok('site frame ignores pointer events', /#chartcheck-panel \.chartcheck-site-frame\s*\{[\s\S]*?pointer-events:\s*none;/.test(src));

// Persist, accumulate, and reset with a mocked GM store.
const start = src.indexOf('    const SITE_COUNT_KEYS = {');
const end = src.indexOf('    // ============================================================\n    // Generic Finders');
ok('count helper extract', start >= 0 && end > start);
const helpers = src.slice(start, end);
const storeA = {};
const logs = [];
const api = new Function(
    'rosevilleReviewCount',
    'ranchoReviewCount',
    'autoReviewCount',
    'GM_getValue',
    'GM_setValue',
    'updateOverlay',
    'console',
    helpers +
        '\nreturn {\n' +
        '  loadSiteCounts, persistSiteCounts, resetPersistedSiteCounts, recordReviewedChart,\n' +
        '  getRoseville: () => rosevilleReviewCount,\n' +
        '  getRancho: () => ranchoReviewCount,\n' +
        '  getAuto: () => autoReviewCount,\n' +
        '  SITE_COUNT_KEYS\n' +
        '};'
)(
    0,
    0,
    0,
    (key, fallback) => (Object.prototype.hasOwnProperty.call(storeA, key) ? storeA[key] : fallback),
    (key, value) => { storeA[key] = value; },
    () => {},
    { log: (msg) => logs.push(msg) }
);

api.recordReviewedChart('roseville');
api.recordReviewedChart('roseville');
api.recordReviewedChart('rancho');
api.recordReviewedChart('other');
ok('record increments site counts and the run total', api.getRoseville() === 2 && api.getRancho() === 1 && api.getAuto() === 4);
ok('record persists both site counts', storeA[api.SITE_COUNT_KEYS.roseville] === 2 && storeA[api.SITE_COUNT_KEYS.rancho] === 1);
ok('run total is not persisted', !Object.values(storeA).includes(4));

// Simulate a reload: new memory starts at 0, then loadSiteCounts.
const storeB = { ...storeA };
const apiReload = new Function(
    'rosevilleReviewCount',
    'ranchoReviewCount',
    'autoReviewCount',
    'GM_getValue',
    'GM_setValue',
    'updateOverlay',
    'console',
    helpers +
        '\nloadSiteCounts();\n' +
        'return {\n' +
        '  getRoseville: () => rosevilleReviewCount,\n' +
        '  getRancho: () => ranchoReviewCount,\n' +
        '  getAuto: () => autoReviewCount,\n' +
        '  recordReviewedChart, resetPersistedSiteCounts\n' +
        '};'
)(
    0,
    0,
    0,
    (key, fallback) => (Object.prototype.hasOwnProperty.call(storeB, key) ? storeB[key] : fallback),
    (key, value) => { storeB[key] = value; },
    () => {},
    { log: (msg) => logs.push(msg) }
);
ok('reload restores accumulated site counts', apiReload.getRoseville() === 2 && apiReload.getRancho() === 1);
ok('reload does not restore the run total', apiReload.getAuto() === 0);
apiReload.recordReviewedChart('rancho');
ok('counts keep accumulating after reload', apiReload.getRoseville() === 2 && apiReload.getRancho() === 2);

apiReload.resetPersistedSiteCounts();
ok('reset zeros both site counts', apiReload.getRoseville() === 0 && apiReload.getRancho() === 0);
ok('reset persists zeros', storeB[api.SITE_COUNT_KEYS.roseville] === 0 && storeB[api.SITE_COUNT_KEYS.rancho] === 0);
ok('reset logs a single summary line', logs.filter((m) => m === 'counters reset').length === 1 && logs.every((m) => m === 'counters reset'));

const apiBad = new Function(
    'rosevilleReviewCount',
    'ranchoReviewCount',
    'autoReviewCount',
    'GM_getValue',
    'GM_setValue',
    'updateOverlay',
    'console',
    helpers +
        '\nloadSiteCounts();\n' +
        'return { getRoseville: () => rosevilleReviewCount, getRancho: () => ranchoReviewCount };'
)(
    0,
    0,
    0,
    (key) => (key.includes('roseville') ? 'nope' : -3),
    () => {},
    () => {},
    { log: () => {} }
);
ok('invalid stored values load as 0', apiBad.getRoseville() === 0 && apiBad.getRancho() === 0);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

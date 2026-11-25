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
ok('mutation refresh is debounced 250-400ms', /const SITE_GRAY_MUTATION_DEBOUNCE_MS = (25\d|3\d\d|400)\b/.test(src) && src.includes('SITE_GRAY_MUTATION_DEBOUNCE_MS)'));
ok('observer is no longer debounced at 150ms', !/setTimeout\([\s\S]*?refreshPatientSiteGray\(\);\s*\}, 150\)/.test(src));
ok('observer ignores panel and DOM-copy mutations', src.includes('function mutationIsOutsidePanel(') && src.includes("el.closest('#chartcheck-panel')") && src.includes("el.closest('#chartcheck-dom-copy')"));
ok('gray fractions are cached by a page signature', src.includes('function grayFractionPageSignature(') && src.includes('function cachedGrayFractions(') && src.includes('function grayFractionSelectSignature('));
ok('signature uses select values, plan count, and overview text length or URL', src.includes('function cheapOverviewTextSignature(') && /location\.href/.test(src) && src.includes('getElementsByTagName(\'table\')'));
ok('readTemplateGrayFractions reuses the cache', /function readTemplateGrayFractions\([\s\S]*?cachedGrayFractions\(grayFractionPageSignature\(selects\)/.test(src));
ok('hotkey mute reuses the cached readTemplateGrayFractions', /function isTemplateHotkeyMuted\([\s\S]*?readTemplateGrayFractions\(\)/.test(src));
ok('applyPatientSiteGray still uses readTemplateGrayFractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('page-wide scan runs only when the per-plan match has no known total', /function computeTemplateGrayFractions\([\s\S]*?if \(isKnownFractionTotal\(fromPlans\) \|\| \(match\.contexts \|\| \[\]\)\.length > 1\) \{\s*(return|result =) sbrtGrayFractionsWithFallback\(match\.contexts, null\);/.test(src));
ok('single-plan unknown still falls back to readTotalFractions', /function computeTemplateGrayFractions\([\s\S]*?sbrtGrayFractionsWithFallback\(match\.contexts, readTotalFractions\(\)\)/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && muteEnd > muteStart && normEnd > normStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(helperStart, helperEnd)
    + src.slice(muteStart, muteEnd)
    + '\nreturn { resolvePlanTemplateMatch, sbrtGrayFractionsFromPlans, sbrtGrayFractionsWithFallback, shouldMuteSiteSbrt, isSiteTemplateMuted, grayFractionSelectSignature, grayFractionPageSignature, cachedGrayFractions, computeTemplateGrayFractions };'
)();

function selectStub(value, text) {
    return {
        value: value,
        selectedIndex: 0,
        options: [{ text: text || value }]
    };
}

const sigA = helpers.grayFractionSelectSignature([selectStub('ros', 'ROS_Standard')]);
const sigB = helpers.grayFractionSelectSignature([selectStub('ros', 'ROS_Standard')]);
const sigC = helpers.grayFractionSelectSignature([selectStub('rco', 'RCO_Standard')]);
const sigTwo = helpers.grayFractionSelectSignature([
    selectStub('ros', 'ROS_Standard'),
    selectStub('rco', 'RCO_Standard')
]);
ok('select signatures are stable for the same values', sigA === sigB && /ROS_Standard/.test(sigA));
ok('select signatures change when the template value changes', sigA !== sigC);
ok('select signatures include every plan', sigTwo !== sigA && /ROS_Standard/.test(sigTwo) && /RCO_Standard/.test(sigTwo));

const pageOne = helpers.grayFractionPageSignature([selectStub('ros', 'ROS_Standard')]);
const pageOneAgain = helpers.grayFractionPageSignature([selectStub('ros', 'ROS_Standard')]);
const pageTwo = helpers.grayFractionPageSignature([
    selectStub('ros', 'ROS_Standard'),
    selectStub('rco', 'RCO_Standard')
]);
ok('page signatures stay stable when selects and overview length are unchanged', pageOne === pageOneAgain);
ok('page signatures include the plan count, so one vs two plans differ', pageOne !== pageTwo && pageOne.indexOf('\n1\n') >= 0 && pageTwo.indexOf('\n2\n') >= 0);

let computeCalls = 0;
const first = helpers.cachedGrayFractions(pageOne, function () {
    computeCalls++;
    return 30;
});
const second = helpers.cachedGrayFractions(pageOne, function () {
    computeCalls++;
    return 99;
});
ok('a repeated signature reuses the cached gray-fraction value', first === 30 && second === 30 && computeCalls === 1);

const third = helpers.cachedGrayFractions(pageTwo, function () {
    computeCalls++;
    return 5;
});
ok('a changed signature recomputes the gray-fraction value', third === 5 && computeCalls === 2);

const filledLong = helpers.resolvePlanTemplateMatch(
    [{ filled: true, unselected: false, courseName: 'C1', planName: 'PlanA', text: 'ROS_Standard' }],
    [{ courseName: 'C1', planName: 'PlanA', totalFractions: 30, order: 1 }]
);
const filledFx = helpers.sbrtGrayFractionsFromPlans(filledLong.contexts);
ok('v3.51 behavior: a filled single plan at 30 fx still mutes SBRT', filledFx === 30 && helpers.shouldMuteSiteSbrt(filledFx) === true && helpers.isSiteTemplateMuted('roseville', filledFx, 'ros', true) === true && helpers.isSiteTemplateMuted('roseville', filledFx, 'ros', false) === false);

const filled28 = helpers.sbrtGrayFractionsFromPlans(helpers.resolvePlanTemplateMatch(
    [{ filled: true, unselected: false, courseName: 'C1', planName: 'PlanA', text: 'ROS_Standard' }],
    [{ courseName: 'C1', planName: 'PlanA', totalFractions: 28, order: 1 }]
).contexts);
ok('v3.51 behavior: a filled single plan at 28 fx still mutes SBRT', filled28 === 28 && helpers.shouldMuteSiteSbrt(filled28) === true);

const shortKeepsEnabled = helpers.sbrtGrayFractionsFromPlans(helpers.resolvePlanTemplateMatch(
    [{ filled: true, unselected: false, courseName: 'C1', planName: 'PlanA', text: 'ROS_Standard' }],
    [{ courseName: 'C1', planName: 'PlanA', totalFractions: 5, order: 1 }]
).contexts);
ok('v3.51 behavior: a filled single plan at 5 fx still leaves SBRT enabled', shortKeepsEnabled === 5 && helpers.shouldMuteSiteSbrt(shortKeepsEnabled) === false);

const twoFilled = helpers.sbrtGrayFractionsFromPlans(helpers.resolvePlanTemplateMatch(
    [
        { filled: true, unselected: false, courseName: 'C1', planName: 'PlanA', text: 'ROS_Standard' },
        { filled: true, unselected: false, courseName: 'C2', planName: 'PlanB', text: 'ROS_Standard' }
    ],
    [
        { courseName: 'C1', planName: 'PlanA', totalFractions: 17, order: 1 },
        { courseName: 'C2', planName: 'PlanB', totalFractions: 30, order: 2 }
    ]
).contexts);
ok('v3.51 behavior: two filled long-course plans still mute SBRT', twoFilled === 17 && helpers.shouldMuteSiteSbrt(twoFilled) === true);

const mixed = helpers.sbrtGrayFractionsWithFallback(
    [
        { filled: true, unselected: false, tableFound: false, totalFractions: null },
        { filled: false, unselected: true, tableFound: false, totalFractions: null }
    ],
    17
);
ok('v3.51 behavior: a multi-plan unknown match still does not use the first-table total', mixed == null);

const fallback = helpers.sbrtGrayFractionsWithFallback(
    [{ filled: true, unselected: false, tableFound: false, totalFractions: null }],
    30
);
ok('v3.51 behavior: a single unknown plan still uses the page-wide fallback total', fallback === 30 && helpers.shouldMuteSiteSbrt(fallback) === true);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

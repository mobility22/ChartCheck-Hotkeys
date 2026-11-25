const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.51', /@version\s+3\.51\b/.test(src));
ok('no leftover 3.50', !/\b3\.50\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('gray-out helper was renamed to consider every plan', src.includes('function sbrtGrayFractionsFromPlans(') && !src.includes('function sbrtGrayFractionsFromUnselected('));
ok('readTemplateGrayFractions uses the plan helper with a page-wide fallback', /function readTemplateGrayFractions\([\s\S]*?sbrtGrayFractionsWithFallback\(match\.contexts, readTotalFractions\(\)\)/.test(src));
ok('applyPatientSiteGray uses the same plan fraction source', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('template clicks use the same plan fraction source', /function isTemplateHotkeyMuted\([\s\S]*?readTemplateGrayFractions\(\)/.test(src));
ok('filled or already-selected plans are no longer skipped', !/state\.filled \|\| state\.unselected === false/.test(src));

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
    + '\nreturn { resolvePlanTemplateMatch, templateReviewDecision, resolveReviewSite, sbrtGrayFractionsFromPlans, shouldMuteSiteSbrt, isSiteTemplateMuted, formatReviewReason };'
)();

const filledLong = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 28 }
]);
ok('a single already-selected plan at 28 fx mutes SBRT', filledLong === 28 && helpers.shouldMuteSiteSbrt(filledLong) === true);
ok('RCO SBRT is muted at Rancho for that 28-fx selected plan', helpers.isSiteTemplateMuted('rancho', filledLong, 'rco', true) === true);
ok('RCO Standard stays enabled at Rancho for that 28-fx selected plan', helpers.isSiteTemplateMuted('rancho', filledLong, 'rco', false) === false);

const filledShort = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 5 }
]);
ok('a single already-selected plan at 5 fx leaves SBRT enabled', filledShort === 5 && helpers.shouldMuteSiteSbrt(filledShort) === false);

const filledShortUnselectedLong = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 5 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 17 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 30 }
]);
ok('a selected short-course plan keeps SBRT enabled even if unselected plans are long', filledShortUnselectedLong === 5 && helpers.shouldMuteSiteSbrt(filledShortUnselectedLong) === false);

const filledLongUnselectedShort = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 28 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 5 }
]);
ok('an unselected short-course plan keeps SBRT enabled even if a selected plan is long', filledLongUnselectedShort === 5 && helpers.shouldMuteSiteSbrt(filledLongUnselectedShort) === false);

const allSelectedLong = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 28 },
    { filled: true, unselected: false, tableFound: true, totalFractions: 17 }
]);
ok('SBRT is muted when every plan is already selected and every known fx is >5', allSelectedLong === 28 && helpers.shouldMuteSiteSbrt(allSelectedLong) === true);

const unknownSelected = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: false, totalFractions: 28 }
]);
ok('a selected plan with unknown fx leaves SBRT enabled', unknownSelected == null && helpers.shouldMuteSiteSbrt(unknownSelected) === false);

const mixedUnknown = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 28 },
    { filled: false, unselected: true, tableFound: false, totalFractions: null }
]);
ok('a long-course selected plan plus an unknown fx still leaves SBRT enabled', mixedUnknown == null && helpers.shouldMuteSiteSbrt(mixedUnknown) === false);

ok('ROS is muted at Rancho regardless of fractions', helpers.isSiteTemplateMuted('rancho', 5, 'ros', true) === true && helpers.isSiteTemplateMuted('rancho', 5, 'ros', false) === true && helpers.isSiteTemplateMuted('rancho', 28, 'ros', true) === true);
ok('RCO is muted at Roseville regardless of fractions', helpers.isSiteTemplateMuted('roseville', 5, 'rco', true) === true && helpers.isSiteTemplateMuted('roseville', 5, 'rco', false) === true && helpers.isSiteTemplateMuted('roseville', 28, 'rco', false) === true);
ok('Standard is never muted by fraction count', helpers.isSiteTemplateMuted('rancho', 28, 'rco', false) === false && helpers.isSiteTemplateMuted('roseville', 28, 'ros', false) === false);
ok('site SBRT stays enabled at fx 5 and is muted at fx>5', helpers.isSiteTemplateMuted('rancho', 5, 'rco', true) === false && helpers.isSiteTemplateMuted('roseville', 5, 'ros', true) === false && helpers.isSiteTemplateMuted('roseville', 28, 'ros', true) === true);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

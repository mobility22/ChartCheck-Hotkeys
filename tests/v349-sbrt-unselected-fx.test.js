const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.54', /@version\s+3\.54\b/.test(src));
ok('no leftover 3.53', !/\b3\.53\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('gray-out reads plan fractions from 3.48 matching', src.includes('function sbrtGrayFractionsFromPlans(') && src.includes('function readTemplateGrayFractions(') && src.includes('resolvePlanTemplateMatch('));
ok('applyPatientSiteGray no longer uses the page-wide first fraction total', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src) && /function applyPatientSiteGray\([\s\S]*?readTotalFractions\(\);/.test(src) === false);
ok('template clicks use the same plan fraction source', /function isTemplateHotkeyMuted\([\s\S]*?readTemplateGrayFractions\(\)/.test(src));
ok('SBRT gray-out still uses the site-muted class', src.includes("row.classList.toggle('chartcheck-site-muted', mute)"));

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

function filled(course, plan) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: 'ROS_Standard' };
}

function unselected(course, plan) {
    return { filled: false, unselected: true, courseName: course, planName: plan, text: 'OAK_Standard' };
}

const threeCourse = helpers.resolvePlanTemplateMatch(
    [
        filled('C1- Alpha', 'PlanA'),
        filled('C2- Beta', 'PlanB'),
        unselected('C3- Gamma', 'PlanC')
    ],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 17, order: 1 },
        { courseName: 'C2- Beta', planName: 'PlanB', totalFractions: 5, order: 2 },
        { courseName: 'C3- Gamma', planName: 'PlanC', totalFractions: 5, order: 3 }
    ]
);
ok('the unselected third-course plan matches its own fx 5, not the first table fx 17', threeCourse.contexts[2].tableFound === true && threeCourse.contexts[2].totalFractions === 5 && threeCourse.contexts[0].filled === true && threeCourse.contexts[1].filled === true);

const grayFx = helpers.sbrtGrayFractionsFromPlans(threeCourse.contexts);
ok('gray-out fx is the unselected plan 5, not the first course 17', grayFx === 5);
ok('SBRT stays enabled when the unselected plan has 5 fractions', helpers.shouldMuteSiteSbrt(grayFx) === false);
ok('ROS SBRT and ROS Standard both stay enabled at fx 5', helpers.isSiteTemplateMuted('roseville', grayFx, 'ros', true) === false && helpers.isSiteTemplateMuted('roseville', grayFx, 'ros', false) === false);

const firstTableWouldMute = helpers.shouldMuteSiteSbrt(17);
ok('the page-wide first table fx 17 would have muted SBRT, which is the live bug', firstTableWouldMute === true);

const review = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [
        { text: 'ROS_Standard' },
        { text: 'ROS_SBRT/SRS' },
        { text: 'OAK_Standard' }
    ]),
    threeCourse.contexts
);
ok('Review still stops with fx<=5 for the unselected 5-fx plan', review.action === 'stop' && review.reason === 'fx<=5');

const twoUnselected = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: false, totalFractions: null },
    { filled: false, unselected: true, tableFound: true, totalFractions: 17 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 5 }
]);
ok('multiple unselected plans enable SBRT if any has fx<=5', twoUnselected === 5 && helpers.shouldMuteSiteSbrt(twoUnselected) === false);

const allLong = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 28 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 17 },
    { filled: false, unselected: true, tableFound: true, totalFractions: 30 }
]);
ok('SBRT is muted only when every plan has fx>5', allLong === 28 && helpers.shouldMuteSiteSbrt(allLong) === true);
ok('Standard stays enabled even when every plan has fx>5', helpers.isSiteTemplateMuted('roseville', allLong, 'ros', false) === false && helpers.isSiteTemplateMuted('roseville', allLong, 'ros', true) === true);

const unknownFx = helpers.sbrtGrayFractionsFromPlans([
    { filled: false, unselected: true, tableFound: false, totalFractions: null }
]);
ok('unknown unselected fx leaves SBRT enabled', unknownFx == null && helpers.shouldMuteSiteSbrt(unknownFx) === false && helpers.isSiteTemplateMuted('roseville', unknownFx, 'ros', true) === false);

const mixedUnknown = helpers.sbrtGrayFractionsFromPlans([
    { filled: false, unselected: true, tableFound: true, totalFractions: 17 },
    { filled: false, unselected: true, tableFound: false, totalFractions: null }
]);
ok('a long-course unselected plus an unknown fx still leaves SBRT enabled', mixedUnknown == null && helpers.shouldMuteSiteSbrt(mixedUnknown) === false);

const noneUnselected = helpers.sbrtGrayFractionsFromPlans([
    { filled: true, unselected: false, tableFound: true, totalFractions: 17 }
]);
ok('when every plan is already selected, a known fx>5 still mutes SBRT', noneUnselected === 17 && helpers.shouldMuteSiteSbrt(noneUnselected) === true);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

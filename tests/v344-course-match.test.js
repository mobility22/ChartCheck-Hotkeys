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
ok('visible stop text is still only Template needed', /setReviewNote\('Template needed'/.test(src) && !src.includes("'Template needed: checks not ready, pick manually'"));
ok('stop reason is stored on the status note title', /note\.title = value \+ ' \(' \+ detail \+ '\)'/.test(src) && /pointer-events:\s*auto;/.test(src));
ok('course titles are matched before plan names and order', src.includes('function courseKeysMatch(') && src.includes('function findCourseLabelNearSelect(') && src.includes('function resolveReviewSite('));
ok('SBRT gray-out uses unselected-plan fractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const fieldEnd = src.indexOf('    function isDoseUnitContext(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const fxStart = src.indexOf('    function isDoseUnitContext(');
const fxEnd = src.indexOf('    function collectDeepText(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && fieldEnd > labelStart && normEnd > normStart && fxEnd > fxStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, fieldEnd)
    + src.slice(fxStart, fxEnd)
    + src.slice(helperStart, helperEnd)
    + '\nreturn { normalizeText, readTotalFractionsFromCells, isOakTemplateDefault, planNameFromLabeledText, readPlanNameFromCells, planNamesMatch, courseKeysMatch, inferPatientSiteFromTemplates, resolveReviewSite, resolvePlanTemplateContexts, templateReviewDecision };'
)();

const sameCell = 'Plan name\nPlanB';
ok('same-cell Plan name + newline + PlanB is parsed', helpers.planNameFromLabeledText(sameCell) === 'PlanB');
ok('Plan name PlanB matches tree Plan: PlanB', helpers.planNamesMatch(sameCell, 'Plan: PlanB') && helpers.planNamesMatch('PlanB', sameCell));
ok('course keys match with or without a space after the hyphen', helpers.courseKeysMatch('C2- Beta', 'C2-Beta') && helpers.courseKeysMatch('Course: C2- Beta', 'C2 - Beta'));

const overviewCells = [
    'Prescription / Plan Overview',
    'Rx name\nRxB',
    'Plan name\nPlanB',
    'Approval Status',
    'Site',
    'Method of delivery',
    'Dose Per Fraction',
    'Delivered / Total Fractions',
    '17',
    '1 / 17',
    'Delivered / Total Dose',
    'Energy'
];
ok('3-column overview header yields PlanB from the same header cell', helpers.readPlanNameFromCells(overviewCells) === 'PlanB');
ok('3-column overview uses Plan cell 1 / 17 as total 17', helpers.readTotalFractionsFromCells(overviewCells) === 17);

function filled(course, plan) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: 'ROS_SBRT/SRS' };
}

function unselected(course, plan) {
    return { filled: false, unselected: true, courseName: course, planName: plan, text: 'OAK_Standard' };
}

const courseMatch = helpers.resolvePlanTemplateContexts(
    [filled('C1- Alpha', 'PlanA'), unselected('C2- Beta', 'PlanB')],
    [
        { courseName: 'C1- Alpha', planName: 'Plan name\nPlanA', totalFractions: 3 },
        { courseName: 'C2-Beta', planName: 'Plan name\nPlanB', totalFractions: 17 }
    ]
);
ok('course title maps the unselected plan to the C2 section fx 17, not the first table fx 3', courseMatch[0].filled === true && courseMatch[1].tableFound === true && courseMatch[1].totalFractions === 17);

const courseOnly = helpers.resolvePlanTemplateContexts(
    [filled('C1- Alpha', ''), unselected('C2- Beta', '')],
    [
        { courseName: 'C1- Alpha', planName: '', totalFractions: 3 },
        { courseName: 'C2- Beta', planName: '', totalFractions: 17 }
    ]
);
ok('course match works when plan names are missing', courseOnly[1].totalFractions === 17);

const decided = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [
        { text: 'ROS_SBRT/SRS' },
        { text: 'OAK_Standard', optionTexts: ['OAK_Standard', 'ROS_Standard', 'ROS_SBRT/SRS'] }
    ]),
    courseMatch
);
ok('unknown center-line site is inferred as ROS from an already-selected ROS template', helpers.inferPatientSiteFromTemplates(['ROS_SBRT/SRS', 'OAK_Standard']) === 'roseville');
ok('two-course structure auto-selects Standard only on the unselected plan', decided.action === 'auto' && decided.templateName === 'ROS_Standard' && JSON.stringify(decided.unfilledIndexes) === JSON.stringify([1]));

const siteStop = helpers.templateReviewDecision('unknown', courseMatch);
ok('if site still cannot be inferred, status is Template needed with site? reason', siteStop.action === 'stop' && siteStop.message === 'Template needed' && siteStop.reason === 'site?');

const matchStop = helpers.templateReviewDecision('roseville', [{
    filled: false,
    unselected: true,
    tableFound: false,
    totalFractions: null
}]);
ok('a failed table match uses Template needed with match? reason', matchStop.reason === 'match?' && matchStop.message === 'Template needed');

const fxStop = helpers.templateReviewDecision('roseville', [{
    filled: false,
    unselected: true,
    tableFound: true,
    totalFractions: 3
}]);
ok('fx<=5 uses Template needed with fx<=5 reason', fxStop.reason === 'fx<=5' && fxStop.message === 'Template needed');

const oneTable = helpers.resolvePlanTemplateContexts(
    [unselected('', '')],
    [{ courseName: '', planName: '', totalFractions: 17 }]
);
ok('one unselected plan and one table uses process of elimination', oneTable[0].tableFound === true && oneTable[0].totalFractions === 17);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

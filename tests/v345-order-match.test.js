const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.46', /@version\s+3\.46\b/.test(src));
ok('no leftover 3.45', !/\b3\.45\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('document-order scan is used to pair selects with preceding labels', src.includes('function scanTemplateMatchPage(') && src.includes('function nearestPrecedingLabel(') && src.includes('function walkElementsInOrder('));
ok('equal select and block counts map by document-order index', src.includes('list.length === rows.length') && src.includes('scan.overviews'));
ok('tooltip reason can include non-PHI counts', src.includes('function formatReviewReason(') && src.includes(" + ' sel=' + countValue('sel')") && src.includes(" + ' unsel=' + countValue('unsel')"));
ok('SBRT gray-out still uses the page-wide first fraction read', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTotalFractions\(\);/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const fieldEnd = src.indexOf('    function isDoseUnitContext(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && fieldEnd > labelStart && normEnd > normStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, fieldEnd)
    + src.slice(helperStart, helperEnd)
    + '\nreturn { labelsMatchLoose, joinSplitPrefixedLabel, nearestPrecedingLabel, formatReviewReason, resolvePlanTemplateContexts, templateReviewDecision, resolveReviewSite };'
)();

ok('loose course match allows a trailing diagnosis on the same line', helpers.labelsMatchLoose('C2- Beta', 'C2- Beta extra note') === true);
ok('loose plan match ignores the Plan name prefix and case', helpers.labelsMatchLoose('Plan: PlanB', 'Plan name\nPlanB') === true);
ok('split Course: + following sibling text is joined', helpers.joinSplitPrefixedLabel('Course:', ['C2- Beta extra note']) === 'Course: C2- Beta extra note');
ok('split Plan: + following sibling text is joined', helpers.joinSplitPrefixedLabel('Plan:', ['PlanB']) === 'Course: PlanB' ? false : helpers.joinSplitPrefixedLabel('Plan:', ['PlanB']) === 'Plan: PlanB');

const flatTree = [
    { order: 1, text: 'C1- Alpha' },
    { order: 3, text: 'C2- Beta extra note' }
];
ok('flat sibling document order uses the nearest preceding course', helpers.nearestPrecedingLabel(4, flatTree) === 'C2- Beta extra note');
ok('the first select uses only the course that precedes it', helpers.nearestPrecedingLabel(2, flatTree) === 'C1- Alpha');

ok('tooltip keeps Template needed short and adds counts only', helpers.formatReviewReason('match?', { sel: 2, unsel: 1, blocks: 2, rows: 2, courses: 2, planLabels: 2, matched: 0, fail: 'name,course,index' }) === 'match? sel=2 unsel=1 blocks=2 rows=2 courses=2 planLabels=2 matched=0 fail=name,course,index');

function filled(course, plan) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: 'ROS_SBRT/SRS' };
}

function unselected(course, plan) {
    return { filled: false, unselected: true, courseName: course, planName: plan, text: 'OAK_Standard' };
}

const indexFallback = helpers.resolvePlanTemplateContexts(
    [filled('Other1', 'OtherPlan1'), unselected('Other2', 'OtherPlan2')],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 3 },
        { courseName: 'C2- Beta', planName: 'PlanB', totalFractions: 17 }
    ]
);
ok('when names do not match, equal counts still map the second select to the second block fx 17', indexFallback[0].filled === true && indexFallback[1].tableFound === true && indexFallback[1].totalFractions === 17);

const auto = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [{ text: 'ROS_SBRT/SRS' }, { text: 'OAK_Standard' }]),
    indexFallback
);
ok('the index-mapped unselected plan auto-selects Standard', auto.action === 'auto' && auto.templateName === 'ROS_Standard' && JSON.stringify(auto.unfilledIndexes) === JSON.stringify([1]));

const oneBlock = helpers.resolvePlanTemplateContexts(
    [filled('C1- Alpha', 'PlanA'), unselected('C2- Beta', 'PlanB')],
    [{ courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 3 }]
);
ok('a single block that belongs to a selected plan is not given to the unselected plan', oneBlock[1].tableFound === false);

const divBlocks = helpers.resolvePlanTemplateContexts(
    [
        unselected('C1- Alpha', 'PlanA'),
        unselected('C2- Beta', 'PlanB')
    ],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 30 },
        { courseName: 'C2- Beta extra note', planName: 'PlanB', totalFractions: 17 }
    ]
);
ok('div-grid style blocks still pair by document order and loose course text', divBlocks[0].totalFractions === 30 && divBlocks[1].totalFractions === 17);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

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
ok('overview blocks are deduped and expanded into plan rows', src.includes('function dedupeOverviewBlocks(') && src.includes('function extractPlanRowsFromCells(') && src.includes('function resolvePlanTemplateMatch('));
ok('tooltip counts include unsel, rows, planLabels, matched, and fail stages', src.includes(" + ' unsel=' + countValue('unsel')") && src.includes(" + ' rows=' + countValue('rows')") && src.includes(" + ' planLabels=' + countValue('planLabels')") && src.includes(" + ' matched=' + countValue('matched')") && src.includes("text += ' fail=' +"));
ok('SBRT gray-out uses unselected-plan fractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const fieldEnd = src.indexOf('    function collectDeepText(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && fieldEnd > labelStart && normEnd > normStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, fieldEnd)
    + src.slice(helperStart, helperEnd)
    + '\nreturn { parseCourseLabel, joinSplitPrefixedLabel, labelsMatchLoose, extractPlanRowsFromCells, dedupeOverviewBlocks, formatReviewReason, resolvePlanTemplateContexts, resolvePlanTemplateMatch, templateReviewDecision, resolveReviewSite };'
)();

ok('Course: prefix still parses', helpers.parseCourseLabel('Course: C2- Beta') === 'C2- Beta');
ok('Course ID prefix parses', helpers.parseCourseLabel('Course ID C2- Beta') === 'C2- Beta');
ok('Course ID: prefix parses', helpers.parseCourseLabel('Course ID: C2- Beta') === 'C2- Beta');
ok('Course without a colon parses', helpers.parseCourseLabel('Course C2- Beta') === 'C2- Beta');
ok('bare C-number heading parses', helpers.parseCourseLabel('C2- Beta') === 'C2- Beta');
ok('fullwidth colon still parses as a course label', helpers.parseCourseLabel('Course：C2- Beta') === 'C2- Beta');
ok('empty course words are ignored', helpers.parseCourseLabel('Course') === '' && helpers.parseCourseLabel('Course ID') === '');
ok('split Course ID + following text is joined', helpers.joinSplitPrefixedLabel('Course ID', ['C2- Beta']) === 'Course: C2- Beta');
ok('split Course without a colon is joined', helpers.joinSplitPrefixedLabel('Course', ['C2- Beta extra note']) === 'Course: C2- Beta extra note');
ok('loose match still allows a trailing note', helpers.labelsMatchLoose('C2- Beta', 'C2- Beta extra note') === true);

const multiRowCells = [
    'Rx name',
    'RxA',
    'Plan name\nPlanA1',
    'Delivered / Total Fractions',
    '0 / 3',
    'Rx name',
    'RxB',
    'Plan name\nPlanA2',
    'Delivered / Total Fractions',
    '1 / 17'
];
const extracted = helpers.extractPlanRowsFromCells(multiRowCells, 'C1- Alpha');
ok('one overview block can yield multiple plan rows', extracted.length === 2 && extracted[0].planName === 'PlanA1' && extracted[0].totalFractions === 3 && extracted[1].planName === 'PlanA2' && extracted[1].totalFractions === 17 && extracted[0].courseName === 'C1- Alpha');

ok('blocks with no plan row and no fractions are dropped', helpers.dedupeOverviewBlocks([
    { id: 'empty', ancestorIds: [], planName: '', totalFractions: null }
]).length === 0);

const nested = [];
const plans = ['PlanA1', 'PlanA2', 'PlanA3', 'PlanA4', 'PlanB1', 'PlanB2', 'PlanB3', 'PlanB4'];
const fractions = [3, 5, 8, 12, 2, 4, 6, 17];
plans.forEach((name, index) => {
    const id = 'inner' + index;
    const wrap = 'wrap' + index;
    nested.push({ id: wrap, ancestorIds: [], planName: name, totalFractions: fractions[index] });
    nested.push({ id, ancestorIds: [wrap], planName: name, totalFractions: fractions[index] });
});
const deduped = helpers.dedupeOverviewBlocks(nested);
ok('nested wrapper blocks collapse to one container per plan', deduped.length === 8 && deduped.every(block => String(block.id).indexOf('inner') === 0));

const shared = { id: 'shared' };
ok('repeated fraction labels in the same container stay one block', helpers.dedupeOverviewBlocks([
    { id: 'shared', container: shared, planName: 'PlanA1', totalFractions: 3 },
    { id: 'shared', container: shared, planName: 'PlanA1', totalFractions: 3 }
]).length === 1);

function filled(course, plan) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: 'ROS_SBRT/SRS' };
}

function unselected(course, plan) {
    return { filled: false, unselected: true, courseName: course, planName: plan, text: 'OAK_Standard' };
}

const eightPlans = [
    filled('C1- Alpha', 'PlanA1'),
    filled('C1- Alpha', 'PlanA2'),
    filled('C1- Alpha', 'PlanA3'),
    filled('C1- Alpha', 'PlanA4'),
    filled('C2- Beta', 'PlanB1'),
    filled('C2- Beta', 'PlanB2'),
    filled('C2- Beta', 'PlanB3'),
    unselected('C2- Beta', 'PlanB4')
];
const eightRows = plans.map((name, index) => ({
    courseName: index < 4 ? 'C1- Alpha' : 'Course C2- Beta extra note',
    planName: name,
    totalFractions: fractions[index]
}));

const named = helpers.resolvePlanTemplateMatch(eightPlans, eightRows);
ok('eight selects: filled plans keep their rows and the unselected plan matches fx 17', named.contexts[7].tableFound === true && named.contexts[7].totalFractions === 17 && named.contexts.slice(0, 7).every(state => state.filled && state.tableFound && state.totalFractions != null));
ok('eight-select name match reports counts without names', named.stats.sel === 8 && named.stats.unsel === 1 && named.stats.rows === 8 && named.stats.matched === 1 && named.stats.fail === '');

const auto = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', eightPlans),
    named.contexts
);
ok('the unmatched red OAK plan auto-selects Standard from its row fx 17', auto.action === 'auto' && auto.templateName === 'ROS_Standard' && JSON.stringify(auto.unfilledIndexes) === JSON.stringify([7]));

const otherPlans = eightPlans.map((plan, index) => (
    index === 7
        ? unselected('OtherCourse', 'OtherPlan')
        : filled('Other' + index, 'OtherPlan' + index)
));
const indexMatch = helpers.resolvePlanTemplateContexts(otherPlans, eightRows);
ok('when names miss, eight selects and eight rows still map the last unselected plan by index', indexMatch[7].tableFound === true && indexMatch[7].totalFractions === 17);

const leftoverPlans = [
    filled('C1- Alpha', 'PlanA1'),
    filled('C1- Alpha', 'PlanA2'),
    unselected('C2- Beta', 'OtherPlan')
];
const leftoverRows = [
    { courseName: 'C1- Alpha', planName: 'PlanA1', totalFractions: 3 },
    { courseName: 'C1- Alpha', planName: 'PlanA2', totalFractions: 5 },
    { courseName: 'C2- Beta', planName: 'PlanB4', totalFractions: 17 }
];
const leftover = helpers.resolvePlanTemplateContexts(leftoverPlans, leftoverRows);
ok('after filled plans claim their rows, one leftover unselected plan maps to the remaining row', leftover[2].tableFound === true && leftover[2].totalFractions === 17);

const guarded = helpers.resolvePlanTemplateContexts(
    [filled('C1- Alpha', 'PlanA1'), filled('', 'Missing'), unselected('', 'OtherPlan')],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA1', totalFractions: 3 },
        { courseName: 'C2- Beta', planName: 'PlanB4', totalFractions: 17 }
    ]
);
ok('a leftover row is not given to an unselected plan when a filled plan still has no row', guarded[2].tableFound === false);

const courseTitle = helpers.resolvePlanTemplateContexts(
    [unselected('C2- Beta', '')],
    [{ courseName: 'Course ID C2- Beta', planName: '', totalFractions: 17 }]
);
ok('a Course ID heading still pairs by loose course title', courseTitle[0].tableFound === true && courseTitle[0].totalFractions === 17);

const tooltip = helpers.formatReviewReason('match?', {
    sel: 8,
    unsel: 1,
    blocks: 8,
    rows: 8,
    courses: 2,
    planLabels: 8,
    matched: 0,
    fail: 'name,course,index'
});
ok('tooltip shows count-only match stats and failed stages', tooltip === 'match? sel=8 unsel=1 blocks=8 rows=8 courses=2 planLabels=8 matched=0 near=0 fail=name,course,index');
ok('tooltip omits fail when matching succeeded', helpers.formatReviewReason('prompt?', { sel: 8, unsel: 1, blocks: 8, rows: 8, courses: 2, planLabels: 8, matched: 1 }) === 'prompt? sel=8 unsel=1 blocks=8 rows=8 courses=2 planLabels=8 matched=1 near=0');

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

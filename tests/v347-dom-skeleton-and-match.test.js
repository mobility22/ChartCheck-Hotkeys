const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.50', /@version\s+3\.50\b/.test(src));
ok('no leftover 3.49', !/\b3\.49\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('Check Template selects are preferred over other ROS_/OAK_ dropdowns', src.includes('function filterCheckTemplateSelects(') && src.includes('function hasPrecedingCheckTemplateLabel(') && src.includes('function optionLooksLikeCheckTemplate('));
ok('date-filter selects are ignored', src.includes('function selectLooksLikeDateFilter('));
ok('course ids match on the leading C-number token', src.includes('function courseIdToken(') && src.includes('function courseKeysMatch('));
ok('Course: prefix joins a following title sibling', src.includes('A bare course/plan title'));
ok('rows can be paired by nearest document order when blocks are 0', src.includes('const allowNear = Number(settings.blocks) === 0 && rows.length > 0') && src.includes(" + ' near=' + countValue('near')"));
ok('masked DOM copy button is a separate fixed control', src.includes("btn.id = 'chartcheck-dom-copy'") && src.includes('function buildMaskedDomSkeleton(') && src.includes('function maskSkeletonText(') && /#chartcheck-dom-copy \{\s*[\s\S]*?position:\s*fixed;/.test(src));
ok('panel width rules are unchanged', /#chartcheck-panel \{\s*[\s\S]*?width:\s*max-content;/.test(src) && /#chartcheck-panel \.chartcheck-review-note \{\s*[\s\S]*?width:\s*0;[\s\S]*?min-width:\s*100%;/.test(src));
ok('SBRT gray-out uses unselected-plan fractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('the copy button does not log skeleton text', !/console\.(log|info|debug)\(\s*text/.test(src.slice(src.indexOf('async function copyMaskedDomSkeleton('), src.indexOf('function syncDomCopyButtonPosition('))));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const fieldEnd = src.indexOf('    function collectDeepText(');
const deepEnd = src.indexOf('    function isInnermostDeepText(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const filterStart = src.indexOf('    function optionLooksLikeCheckTemplate(');
const filterEnd = src.indexOf('    function clickButtonByText(');
const followStart = src.indexOf('    function followingSiblingTexts(');
const followEnd = src.indexOf('    function readPrefixedLabelAt(');
const maskStart = src.indexOf('    const SKELETON_WHITELIST_PHRASES = [');
const maskEnd = src.indexOf('    function elementHasShadow(');

ok('helper extract', helperStart >= 0 && helperEnd > helperStart && fieldEnd > labelStart && deepEnd > fieldEnd && normEnd > normStart && filterEnd > filterStart && followEnd > followStart && maskEnd > maskStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + 'function isInHotkeyPanel(){ return false; }\n'
    + 'function isInPatientsSidebar(){ return false; }\n'
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, deepEnd)
    + src.slice(helperStart, helperEnd)
    + src.slice(filterStart, filterEnd)
    + src.slice(followStart, followEnd)
    + src.slice(maskStart, maskEnd)
    + '\nreturn { parseCourseLabel, joinSplitPrefixedLabel, followingSiblingTexts, courseIdToken, courseKeysMatch, labelsMatchLoose, extractPlanRowsFromCells, formatReviewReason, resolvePlanTemplateMatch, resolvePlanTemplateContexts, templateReviewDecision, resolveReviewSite, optionLooksLikeCheckTemplate, selectLooksLikeDateFilter, isCheckTemplateLabelText, hasPrecedingCheckTemplateLabel, filterCheckTemplateSelects, isLikelyVisibleSelect, maskSkeletonText, isSkeletonTextSafe, isSafeSkeletonClassName };'
)();

ok('Course: plus following title still parses', helpers.parseCourseLabel('Course: C1- Alpha') === 'C1- Alpha');
ok('C2-Beta without a space is a course title', helpers.parseCourseLabel('C2-Beta') === 'C2-Beta');
ok('leading course tokens match across hyphen spacing', helpers.courseIdToken('C2- Beta extra note') === 'c2' && helpers.courseIdToken('Course: C2-Beta') === 'c2' && helpers.courseKeysMatch('C2', 'C2- Beta extra note') === true);
ok('different course tokens do not match', helpers.courseKeysMatch('C1- Alpha', 'C2- Beta') === false);
ok('sidebar Plan: PlanB matches a Plan name cell', helpers.labelsMatchLoose('Plan: PlanB', 'Plan name\nPlanB') === true);

const titleSib = {
    nodeType: 1,
    tagName: 'SPAN',
    childNodes: [{ nodeType: 3, nodeValue: 'C1- Alpha' }],
    children: [],
    nextSibling: null
};
const prefixEl = {
    nodeType: 1,
    tagName: 'SPAN',
    nextSibling: titleSib,
    childNodes: [{ nodeType: 3, nodeValue: 'Course:' }],
    children: []
};
ok('split Course: span joins the following title span', helpers.followingSiblingTexts(prefixEl).join(' ') === 'C1- Alpha');
ok('joined prefix plus title becomes a course label', helpers.parseCourseLabel(helpers.joinSplitPrefixedLabel('Course:', helpers.followingSiblingTexts(prefixEl))) === 'C1- Alpha');

const columnCells = [
    'Rx name\nRxA',
    'Plan name\nPlanA',
    'Plan name\nPlanB',
    'Approval Status',
    'Site',
    'Delivered / Total Fractions',
    '3',
    '0 / 3',
    '1 / 17',
    'Delivered / Total Dose'
];
const columns = helpers.extractPlanRowsFromCells(columnCells, 'C1- Alpha');
ok('a course card with two plan columns uses each Plan N/M total', columns.length === 2 && columns[0].planName === 'PlanA' && columns[0].totalFractions === 3 && columns[1].planName === 'PlanB' && columns[1].totalFractions === 17);

ok('OAK_Standard counts as a check-template option', helpers.optionLooksLikeCheckTemplate('OAK_Standard') === true);
ok('ROS_SBRT/SRS counts as a check-template option', helpers.optionLooksLikeCheckTemplate('ROS_SBRT/SRS') === true);
ok('Last 7 Days is not a check-template option', helpers.optionLooksLikeCheckTemplate('Last 7 Days') === false);
ok('a Last 7 Days dropdown is treated as a date filter', helpers.selectLooksLikeDateFilter({ options: [{ text: 'Last 7 Days' }, { text: 'Today' }] }) === true);
ok('Check Template is a recognized label', helpers.isCheckTemplateLabelText('Check Template') === true);

function textNode(text) {
    return { nodeType: 3, nodeValue: text };
}

function makeSelect(optionTexts, previousText, visible) {
    const label = previousText
        ? {
            tagName: 'DIV',
            nodeType: 1,
            previousElementSibling: null,
            parentElement: null,
            children: [],
            childNodes: [textNode(previousText)],
            textContent: previousText,
            id: ''
        }
        : null;
    const select = {
        tagName: 'SELECT',
        nodeType: 1,
        options: optionTexts.map(text => ({ text })),
        previousElementSibling: label,
        parentElement: {
            tagName: 'DIV',
            nodeType: 1,
            previousElementSibling: null,
            parentElement: null,
            children: [],
            childNodes: [],
            id: ''
        },
        hidden: visible === false,
        offsetWidth: visible === false ? 0 : 12,
        offsetHeight: visible === false ? 0 : 12,
        getBoundingClientRect: () => (
            visible === false ? { width: 0, height: 0 } : { width: 12, height: 12 }
        ),
        children: [],
        childNodes: [],
        id: ''
    };

    if (label) {
        label.nextElementSibling = select;
        select.parentElement.children = [label, select];
        label.parentElement = select.parentElement;
    }

    return select;
}

const dateSelect = makeSelect(['Last 7 Days', 'Today'], 'Date');
const extras = [
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], '', true),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], '', true),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], '', false),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], '', false)
];
const labeled = [
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], 'Check Template', true),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], 'Check Template', true),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], 'Check Template', false),
    makeSelect(['ROS_Standard', 'ROS_SBRT/SRS', 'OAK_Standard'], 'Check Template', false)
];
const filtered = helpers.filterCheckTemplateSelects(labeled.concat(extras).concat([dateSelect]));
ok('eight-looking template dropdowns collapse to the visible Check Template selects', filtered.length === 2 && filtered[0] === labeled[0] && filtered[1] === labeled[1]);
ok('a Check Template label precedes the kept selects', helpers.hasPrecedingCheckTemplateLabel(labeled[0]) === true);
ok('unlabeled leftover dropdowns are not kept when labeled ones exist', filtered.indexOf(extras[0]) < 0 && filtered.indexOf(dateSelect) < 0);

function filled(course, plan, order) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: 'ROS_SBRT/SRS', order: order };
}

function unselected(course, plan, order) {
    return { filled: false, unselected: true, courseName: course, planName: plan, text: 'OAK_Standard', order: order };
}

const structured = helpers.resolvePlanTemplateMatch(
    [
        filled('C1- Alpha', 'PlanA', 20),
        unselected('C2-Beta', 'PlanB', 28)
    ],
    [
        { courseName: 'Course: C1- Alpha', planName: 'PlanA', totalFractions: 3, order: 4 },
        { courseName: 'C2- Beta extra note', planName: 'PlanB', totalFractions: 17, order: 12 }
    ]
);
ok('sidebar plan id and course token map to the main Plan name and heading', structured.contexts[1].tableFound === true && structured.contexts[1].totalFractions === 17 && structured.contexts[0].filled === true);

const auto = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [{ text: 'ROS_SBRT/SRS' }, { text: 'OAK_Standard' }]),
    structured.contexts
);
ok('the unselected plan auto-selects Standard from its Plan column fx 17', auto.action === 'auto' && auto.templateName === 'ROS_Standard' && JSON.stringify(auto.unfilledIndexes) === JSON.stringify([1]));

const near = helpers.resolvePlanTemplateMatch(
    [
        filled('', '', 80),
        unselected('', '', 84),
        unselected('', '', 88),
        filled('', '', 90)
    ],
    [
        { courseName: '', planName: '', totalFractions: 3, order: 10 },
        { courseName: '', planName: '', totalFractions: 17, order: 20 }
    ],
    { blocks: 0 }
);
ok('when blocks=0, leftover unselected plans use the nearest document-order rows', near.contexts[1].tableFound === true && near.contexts[2].tableFound === true && (near.contexts[1].totalFractions === 17 || near.contexts[2].totalFractions === 17) && near.stats.near === 2 && near.stats.fail === '');

const tooltip = helpers.formatReviewReason('match?', {
    sel: 2,
    unsel: 1,
    blocks: 0,
    rows: 2,
    courses: 2,
    planLabels: 2,
    matched: 0,
    near: 0,
    fail: 'name,course,index,near'
});
ok('tooltip includes near and failed stages without names', tooltip === 'match? sel=2 unsel=1 blocks=0 rows=2 courses=2 planLabels=2 matched=0 near=0 fail=name,course,index,near');

const leaked = [
    'Alice Example',
    'MRN 12345',
    'C2- SecretTitle',
    'PlanSecret',
    'Birth 20010101',
    'OAK_Standard'
];
const sample = 'Course: C1- Alpha  Plan: PlanA  Check Template  Delivered / Total Fractions 1 / 17  Rx name RxA  Site  Last 7 Days  ' + leaked.join(' ');
const masked = helpers.maskSkeletonText(sample);

ok('whitelist header words survive masking', /Course/.test(masked) && /Plan/.test(masked) && /Check Template/i.test(masked) && /Delivered \/ Total Fractions/i.test(masked) && /Rx name/i.test(masked) && /Site/.test(masked) && /Last/.test(masked) && /Days/.test(masked));
ok('non-whitelisted names and titles are masked out', !/Alice/.test(masked) && !/Example/.test(masked) && !/SecretTitle/.test(masked) && !/PlanSecret/.test(masked) && !/Birth/.test(masked) && !/OAK_Standard/.test(masked) && !/Alpha/.test(masked) && !/PlanA/.test(masked));
ok('digits from content do not survive masking', !/[0-9]/.test(masked));
ok('masked text is considered PHI-safe', helpers.isSkeletonTextSafe(masked) === true);
ok('unmasked sample is not PHI-safe', helpers.isSkeletonTextSafe(sample) === false);
ok('digit-heavy or long class names are dropped', helpers.isSafeSkeletonClassName('dropdown') === true && helpers.isSafeSkeletonClassName('css-1a2b3c4d') === false && helpers.isSafeSkeletonClassName('PlanName_Secret_Patient_VeryLong') === false);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

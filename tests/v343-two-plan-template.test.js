const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.49', /@version\s+3\.49\b/.test(src));
ok('no leftover 3.48', !/\b3\.48\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));

ok('SBRT gray-out uses unselected-plan fractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('Review matches each unselected plan to its own overview table', src.includes('function resolvePlanTemplateContexts(') && src.includes('function findOverviewPlanRecords(') && src.includes('function findPlanNameNearSelect('));
const ensureStart = src.indexOf('    async function ensureReviewTemplates(');
const ensureEnd = src.indexOf('    // ============================================================\n    // Patient Navigation');
const ensureSrc = ensureStart >= 0 && ensureEnd > ensureStart ? src.slice(ensureStart, ensureEnd) : '';
ok('ensureReviewTemplates does not use a single page-wide fraction total', /resolvePlanTemplateMatch\([\s\S]*?templateReviewDecision\(/.test(ensureSrc) && !ensureSrc.includes('readTotalFractions()'));

ok('unselected plans use a red background and/or an OAK_ default', src.includes('function isOakTemplateDefault(') && src.includes('function hasRedTemplateBackground(') && src.includes('isOakTemplateDefault(text) || hasRedTemplateBackground(select)'));
ok('already-selected ROS_/RCO_ templates are never treated as unselected', /function isTemplateSelectUnselected\([\s\S]*?if \(isValidSiteTemplate\(text\)\) return false;/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
ok('template helper extract', helperStart >= 0 && helperEnd > helperStart);

const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const fieldStart = src.indexOf('    function isOverviewFieldLabel(');
const fieldEnd = src.indexOf('    function isDoseUnitContext(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
ok('label and normalize extract', labelStart >= 0 && fieldEnd > fieldStart && normEnd > normStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, fieldEnd)
    + src.slice(helperStart, helperEnd)
    + '\nreturn { isValidSiteTemplate, isOakTemplateDefault, isRedTemplateColor, parsePlanTreeLabel, readPlanNameFromCells, resolvePlanTemplateContexts, templateReviewDecision };'
)();

ok('OAK_Standard is an unselected default', helpers.isOakTemplateDefault('OAK_Standard') === true);
ok('ROS_SBRT/SRS is not an OAK default', helpers.isOakTemplateDefault('ROS_SBRT/SRS') === false);
ok('ROS_Standard is a valid site template', helpers.isValidSiteTemplate('ROS_Standard') === true);
ok('OAK_Standard is not a valid site template', helpers.isValidSiteTemplate('OAK_Standard') === false);
ok('red rgb counts as a red template background', helpers.isRedTemplateColor('rgb(220, 53, 69)') === true);
ok('hex red counts as a red template background', helpers.isRedTemplateColor('#ff0000') === true);
ok('panel green is not a red template background', helpers.isRedTemplateColor('rgb(0, 255, 102)') === false);
ok('transparent is not a red template background', helpers.isRedTemplateColor('transparent') === false);

ok('tree label Plan: PlanB yields PlanB', helpers.parsePlanTreeLabel('Plan: PlanB') === 'PlanB');
ok('overview Plan name cell is read from the header row', helpers.readPlanNameFromCells([
    'Plan name', 'PlanB',
    'Delivered / Total Fractions', '1 / 17'
]) === 'PlanB');

function filledPlan(name) {
    return { filled: true, unselected: false, planName: name, text: 'ROS_SBRT/SRS' };
}

function unselectedPlan(name) {
    return { filled: false, unselected: true, planName: name, text: 'OAK_Standard' };
}

const twoPlanNamed = helpers.resolvePlanTemplateContexts(
    [filledPlan('PlanA'), unselectedPlan('PlanB')],
    [
        { planName: 'PlanA', totalFractions: 3 },
        { planName: 'PlanB', totalFractions: 17 }
    ]
);
ok('filled PlanA is ignored and has no fraction decision', twoPlanNamed[0].filled === true && twoPlanNamed[0].totalFractions == null);
ok('unselected PlanB uses its own table fx 17, not the first table fx 3', twoPlanNamed[1].tableFound === true && twoPlanNamed[1].totalFractions === 17);

const namedDecision = helpers.templateReviewDecision('roseville', twoPlanNamed);
ok('two-plan named match auto-selects Standard only on PlanB', namedDecision.action === 'auto' && namedDecision.templateName === 'ROS_Standard' && JSON.stringify(namedDecision.unfilledIndexes) === JSON.stringify([1]));

const twoPlanOrder = helpers.resolvePlanTemplateContexts(
    [filledPlan(''), unselectedPlan('')],
    [
        { planName: '', totalFractions: 3 },
        { planName: '', totalFractions: 17 }
    ]
);
ok('without names, the second dropdown uses the second table fx 17', twoPlanOrder[1].tableFound === true && twoPlanOrder[1].totalFractions === 17);
ok('order fallback still auto-selects only the unselected plan', helpers.templateReviewDecision('roseville', twoPlanOrder).action === 'auto' && JSON.stringify(helpers.templateReviewDecision('roseville', twoPlanOrder).unfilledIndexes) === JSON.stringify([1]));

const swappedNames = helpers.resolvePlanTemplateContexts(
    [filledPlan('PlanA'), unselectedPlan('PlanB')],
    [
        { planName: 'PlanB', totalFractions: 17 },
        { planName: 'PlanA', totalFractions: 3 }
    ]
);
ok('name match still works when table order differs', swappedNames[1].totalFractions === 17 && helpers.templateReviewDecision('roseville', swappedNames).action === 'auto');

const missingTable = helpers.resolvePlanTemplateContexts(
    [filledPlan('PlanA'), unselectedPlan('PlanB')],
    [{ planName: 'PlanA', totalFractions: 3 }]
);
ok('missing overview table for an unselected plan stops Review', missingTable[1].tableFound === false && helpers.templateReviewDecision('roseville', missingTable).action === 'stop' && helpers.templateReviewDecision('roseville', missingTable).message === 'Template needed');

const nameMismatch = helpers.resolvePlanTemplateContexts(
    [unselectedPlan('PlanB')],
    [
        { planName: 'PlanA', totalFractions: 3 },
        { planName: 'PlanC', totalFractions: 17 }
    ]
);
ok('a plan name that does not match any table stops Review', nameMismatch[0].tableFound === false && helpers.templateReviewDecision('roseville', nameMismatch).action === 'stop');

const mixedFx = helpers.resolvePlanTemplateContexts(
    [unselectedPlan('PlanA'), unselectedPlan('PlanB')],
    [
        { planName: 'PlanA', totalFractions: 3 },
        { planName: 'PlanB', totalFractions: 17 }
    ]
);
ok('if any unselected plan is ambiguous, Review stops', helpers.templateReviewDecision('roseville', mixedFx).action === 'stop');

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

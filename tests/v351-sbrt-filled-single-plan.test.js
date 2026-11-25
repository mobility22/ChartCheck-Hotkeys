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
ok('filled-plan contexts now keep the matched row fractions', /if \(plan && plan\.filled\) \{\s*return \{\s*filled: true,\s*unselected: false,\s*tableFound: !!row,/.test(src));
ok('a single plan can use the only overview row', src.includes('A single plan can use the only overview row') && src.includes('function sbrtGrayFractionsWithFallback('));
ok('gray-out falls back to the page-wide total for a single plan', /function computeTemplateGrayFractions\([\s\S]*?sbrtGrayFractionsWithFallback\(match\.contexts, readTotalFractions\(\)\)/.test(src));
ok('applyPatientSiteGray still uses readTemplateGrayFractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('no selects still reads the page-wide total', /function computeTemplateGrayFractions\([\s\S]*?if \(!list\.length\) \{[\s\S]*?readTotalFractions\(\)/.test(src) || /function computeTemplateGrayFractions\([\s\S]*?if \(!list\.length\) return readTotalFractions\(\);/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
const labelStart = src.indexOf('    function fractionsLabelNorm(');
const deepEnd = src.indexOf('    function isInnermostDeepText(');
const sideStart = src.indexOf('    function ancestorChain(');
const sideEnd = src.indexOf('    function findCurrentPatientRow(');
const fracStart = src.indexOf('    function isFractionsLabelElement(');
const fracEnd = src.indexOf('    function scanTemplateMatchPage(');
const rowsStart = src.indexOf('    function collectOverviewRowsFromRoot(');
const rowsEnd = src.indexOf('    function describeTemplateSelect(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && muteEnd > muteStart && normEnd > normStart && deepEnd > labelStart && fracEnd > fracStart && rowsEnd > rowsStart && sideEnd > sideStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, deepEnd)
    + src.slice(helperStart, helperEnd)
    + src.slice(sideStart, sideEnd)
    + src.slice(fracStart, fracEnd)
    + src.slice(rowsStart, rowsEnd)
    + src.slice(muteStart, muteEnd)
    + '\nreturn { resolvePlanTemplateMatch, templateReviewDecision, sbrtGrayFractionsFromPlans, sbrtGrayFractionsWithFallback, shouldMuteSiteSbrt, isSiteTemplateMuted, parseFractionPairTotal, readTotalFractionsFromCells, extractPlanRowsFromCells, collectOverviewRowsFromRoot, collectDeepText, isDeliveredTotalFractionsLabel, isDoseUnitContext };'
)();

function filled(course, plan, text) {
    return { filled: true, unselected: false, courseName: course, planName: plan, text: text || 'ROS_Standard' };
}

function grayOf(plans, rows) {
    const match = helpers.resolvePlanTemplateMatch(plans, rows);
    const fx = helpers.sbrtGrayFractionsFromPlans(match.contexts);
    return { match, fx, muteSbrt: helpers.shouldMuteSiteSbrt(fx) };
}

function rosevilleButtons(fx) {
    return {
        rosSbrt: helpers.isSiteTemplateMuted('roseville', fx, 'ros', true),
        rosStd: helpers.isSiteTemplateMuted('roseville', fx, 'ros', false),
        rcoSbrt: helpers.isSiteTemplateMuted('roseville', fx, 'rco', true),
        rcoStd: helpers.isSiteTemplateMuted('roseville', fx, 'rco', false)
    };
}

const live30 = grayOf(
    [filled('C1- Alpha', 'PlanA')],
    [{ courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 30, order: 1 }]
);
ok('named single filled plan at 1/30 (total 30) mutes SBRT', live30.match.contexts[0].tableFound === true && live30.fx === 30 && live30.muteSbrt === true);
const live30btns = rosevilleButtons(live30.fx);
ok('Roseville ROS SBRT is muted and RCO is site-muted at 30 fx', live30btns.rosSbrt === true && live30btns.rcoSbrt === true && live30btns.rcoStd === true);
ok('Roseville ROS Standard stays enabled at 30 fx', live30btns.rosStd === false);
ok('Review stays ok when the only plan is already selected', helpers.templateReviewDecision('roseville', live30.match.contexts).action === 'ok');

const live28 = grayOf(
    [filled('C1- Alpha', 'PlanA')],
    [{ courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 28, order: 1 }]
);
ok('named single filled plan at 28/28 mutes SBRT', live28.fx === 28 && live28.muteSbrt === true && rosevilleButtons(live28.fx).rosSbrt === true);

const variants = [
    [16, true],
    [15, true],
    [10, true],
    [6, true],
    [5, false],
    [3, false],
    [1, false]
];
ok('filled single-plan totals mute SBRT only when fx>5', variants.every(([fx, mute]) => {
    const got = grayOf(
        [filled('C1', 'PlanA', 'RCO_Standard')],
        [{ courseName: 'C1', planName: 'PlanA', totalFractions: fx, order: 1 }]
    );
    return got.fx === fx && got.muteSbrt === mute;
}));

const nameless = grayOf(
    [filled('', '', 'ROS_Standard')],
    [{ courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 30, order: 1 }]
);
ok('a single filled plan still uses the only overview row when names miss', nameless.fx === 30 && nameless.muteSbrt === true);

const headingPlus = grayOf(
    [filled('C9', 'Other', 'ROS_Standard')],
    [
        { courseName: 'C1- Alpha', planName: '', totalFractions: null, headingOnly: true, order: 0 },
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 25, order: 1 }
    ]
);
ok('a single filled plan uses the only row that has a known total', headingPlus.fx === 25 && headingPlus.muteSbrt === true);

const twoFilledLong = grayOf(
    [filled('C1- Alpha', 'PlanA'), filled('C2- Beta', 'PlanB')],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 17, order: 1 },
        { courseName: 'C2- Beta', planName: 'PlanB', totalFractions: 30, order: 2 }
    ]
);
ok('two filled long-course plans mute SBRT', twoFilledLong.fx === 17 && twoFilledLong.muteSbrt === true);

const filledShortAndLong = grayOf(
    [filled('C1- Alpha', 'PlanA'), filled('C2- Beta', 'PlanB')],
    [
        { courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 5, order: 1 },
        { courseName: 'C2- Beta', planName: 'PlanB', totalFractions: 30, order: 2 }
    ]
);
ok('a filled short-course plan among filled long courses keeps SBRT enabled', filledShortAndLong.fx === 5 && filledShortAndLong.muteSbrt === false);

const ranchoFilled = grayOf(
    [filled('C1- Alpha', 'PlanA', 'RCO_Standard')],
    [{ courseName: 'C1- Alpha', planName: 'PlanA', totalFractions: 30, order: 1 }]
);
ok('Rancho RCO SBRT is muted at 30 fx and ROS is site-muted', helpers.isSiteTemplateMuted('rancho', ranchoFilled.fx, 'rco', true) === true && helpers.isSiteTemplateMuted('rancho', ranchoFilled.fx, 'ros', true) === true && helpers.isSiteTemplateMuted('rancho', ranchoFilled.fx, 'rco', false) === false);

const fallbackSingle = helpers.sbrtGrayFractionsWithFallback(
    [{ filled: true, unselected: false, tableFound: false, totalFractions: null }],
    30
);
ok('page-wide fallback supplies 30 when a single filled plan has no match', fallbackSingle === 30 && helpers.shouldMuteSiteSbrt(fallbackSingle) === true);

const fallbackShort = helpers.sbrtGrayFractionsWithFallback(
    [{ filled: true, unselected: false, tableFound: false, totalFractions: null }],
    5
);
ok('page-wide fallback of 5 leaves SBRT enabled', fallbackShort === 5 && helpers.shouldMuteSiteSbrt(fallbackShort) === false);

const noStatesFallback = helpers.sbrtGrayFractionsWithFallback([], 28);
ok('no template selects can still use the page-wide 28 total', noStatesFallback === 28 && helpers.shouldMuteSiteSbrt(noStatesFallback) === true);

const multiUnknown = helpers.sbrtGrayFractionsWithFallback(
    [
        { filled: true, unselected: false, tableFound: false, totalFractions: null },
        { filled: false, unselected: true, tableFound: false, totalFractions: null }
    ],
    17
);
ok('a multi-plan unknown match does not use the page-wide first-table total', multiUnknown == null && helpers.shouldMuteSiteSbrt(multiUnknown) === false);

ok('parse 1 / 30 as total 30', helpers.parseFractionPairTotal('1 / 30') === 30);
ok('parse 28 / 28 as total 28', helpers.parseFractionPairTotal('28 / 28') === 28);
ok('parse 0 / 30 as total 30', helpers.parseFractionPairTotal('0 / 30') === 30);
ok('a dose pair 200cGy / 6000cGy is not a fraction total', helpers.parseFractionPairTotal('200cGy / 6000cGy') == null && helpers.isDoseUnitContext('200cGy / 6000cGy', 0, '200cGy / 6000cGy'.length) === true);
ok('a 1 / 30 fraction cell stays 30 when a later dose label starts a new row', helpers.parseFractionPairTotal('1 / 30') === 30 && helpers.parseFractionPairTotal('200cGy / 6000cGy') == null && helpers.readTotalFractionsFromCells(['Delivered / Total Fractions', '1 / 30', 'Total Dose', '200cGy / 6000cGy']) === 30);
ok('cells 1 / 30 after the fractions label read as 30', helpers.readTotalFractionsFromCells(['Delivered / Total Fractions', '1 / 30']) === 30);
ok('cells 28 / 28 after the fractions label read as 28', helpers.readTotalFractionsFromCells(['Delivered / Total Fractions', '28 / 28']) === 28);
ok('Rx 30 and plan 1 / 30 still use plan total 30', helpers.readTotalFractionsFromCells(['Delivered / Total Fractions', '30', '1 / 30']) === 30);

const liveCells = [
    'Plan name', 'PlanA',
    'Dose Per Fraction', '200cGy/fx',
    'Total Dose', '200cGy / 6000cGy',
    'Delivered / Total Fractions', '1 / 30',
    '30 Sessions'
];
const fromLiveCells = helpers.extractPlanRowsFromCells(liveCells, 'C1- Alpha');
ok('flat overview cells with dose and 1 / 30 still yield fx 30', fromLiveCells.length === 1 && fromLiveCells[0].totalFractions === 30);

function createMiniDoc() {
    function attach(parent, child) {
        child.parentNode = parent;
        child.parentElement = parent && parent.nodeType === 1 ? parent : null;
        child.ownerDocument = parent.ownerDocument || (parent.nodeType === 9 ? parent : parent.ownerDocument);
        parent.childNodes.push(child);
        if (child.nodeType === 1) parent.children.push(child);
        return child;
    }

    function node(nodeType, tagName) {
        const el = {
            nodeType,
            tagName: tagName ? String(tagName).toUpperCase() : undefined,
            childNodes: [],
            children: [],
            parentNode: null,
            parentElement: null,
            shadowRoot: null,
            host: null,
            id: '',
            className: '',
            ownerDocument: null,
            attributes: [],
            appendChild(child) { return attach(el, child); },
            attachShadow() {
                const root = node(11);
                root.host = el;
                root.ownerDocument = el.ownerDocument;
                el.shadowRoot = root;
                return root;
            },
            getRootNode() {
                let cur = el;
                while (cur.parentNode) cur = cur.parentNode;
                return cur;
            },
            querySelectorAll(sel) {
                const want = String(sel || '*').toLowerCase();
                const out = [];
                function rec(parent) {
                    (parent.childNodes || []).forEach(child => {
                        if (child.nodeType !== 1) return;
                        const tag = (child.tagName || '').toLowerCase();
                        if (want === '*' || tag === want) out.push(child);
                        rec(child);
                    });
                }
                rec(el);
                return out;
            },
            getAttribute() { return ''; }
        };
        return el;
    }

    const doc = node(9);
    const html = node(1, 'html');
    const body = node(1, 'body');
    html.ownerDocument = doc;
    body.ownerDocument = doc;
    doc.ownerDocument = doc;
    doc.documentElement = html;
    doc.body = body;
    attach(doc, html);
    attach(html, body);
    doc.createElement = tag => {
        const el = node(1, tag);
        el.ownerDocument = doc;
        return el;
    };
    return { doc, body };
}

function addText(el, value) {
    el.childNodes.push({
        nodeType: 3,
        nodeValue: value,
        parentNode: el,
        parentElement: el,
        childNodes: [],
        children: []
    });
}

function addRow(doc, tbody, label, rx, plan) {
    const tr = doc.createElement('tr');
    const th = doc.createElement('th');
    addText(th, label);
    const tdRx = doc.createElement('td');
    addText(tdRx, rx);
    const tdPlan = doc.createElement('td');
    addText(tdPlan, plan);
    tr.appendChild(th);
    tr.appendChild(tdRx);
    tr.appendChild(tdPlan);
    tbody.appendChild(tr);
}

function buildSinglePlanPage(pairText) {
    const mini = createMiniDoc();
    const doc = mini.doc;
    const heading = doc.createElement('h2');
    addText(heading, 'Course: C1- Alpha');
    mini.body.appendChild(heading);
    const table = doc.createElement('table');
    const thead = doc.createElement('thead');
    const head = doc.createElement('tr');
    head.appendChild(doc.createElement('th'));
    const rxH = doc.createElement('th');
    addText(rxH, 'Rx name RxA');
    const planH = doc.createElement('th');
    addText(planH, 'Plan name PlanA');
    head.appendChild(rxH);
    head.appendChild(planH);
    thead.appendChild(head);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    addRow(doc, tbody, 'Dose Per Fraction', '200cGy/fx', '200cGy/fx');
    addRow(doc, tbody, 'Total Dose', '200cGy / 6000cGy', '200cGy / 6000cGy');
    addRow(doc, tbody, 'Delivered / Total Fractions', pairText, pairText);
    addRow(doc, tbody, 'Scheduling', '30 Sessions', '30 Sessions');
    table.appendChild(tbody);
    mini.body.appendChild(table);
    return mini;
}

function singlePlanFromDom(pairText) {
    const mini = buildSinglePlanPage(pairText);
    const rows = helpers.collectOverviewRowsFromRoot(mini.doc).filter(row => !row.headingOnly);
    return grayOf([filled('C1- Alpha', 'PlanA')], rows);
}

const dom30 = singlePlanFromDom('1 / 30');
ok('synthetic single-plan DOM 1 / 30 plus dose rows mutes ROS SBRT', dom30.fx === 30 && dom30.muteSbrt === true && rosevilleButtons(dom30.fx).rosSbrt === true);
const dom28 = singlePlanFromDom('28 / 28');
ok('synthetic single-plan DOM 28 / 28 mutes ROS SBRT', dom28.fx === 28 && dom28.muteSbrt === true && rosevilleButtons(dom28.fx).rosSbrt === true);
const dom5 = singlePlanFromDom('1 / 5');
ok('synthetic single-plan DOM 1 / 5 leaves SBRT enabled', dom5.fx === 5 && dom5.muteSbrt === false && rosevilleButtons(dom5.fx).rosSbrt === false);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

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
ok('overview columns are read from every header row', src.includes('function tableHeadRows(') && src.includes('function readPlanColumnsFromTable(') && src.includes('function combinedHeaderCellText('));
ok('readPlanRowsFromOverviewTable uses the multi-row column reader', /function readPlanRowsFromOverviewTable\([\s\S]*?readPlanColumnsFromTable\(table\)/.test(src));
ok('a fractions row with no header names still emits one row per total', /function readPlanRowsFromOverviewTable\([\s\S]*?readAllFractionTotalsFromCells\(texts\)/.test(src));
ok('v3.52 gray-out cache is unchanged', src.includes('function cachedGrayFractions(') && src.includes('function grayFractionPageSignature(') && src.includes('SITE_GRAY_MUTATION_DEBOUNCE_MS = 300'));
ok('applyPatientSiteGray still uses readTemplateGrayFractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function fractionsLabelNorm(');
const deepEnd = src.indexOf('    function isInnermostDeepText(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const fracStart = src.indexOf('    function isFractionsLabelElement(');
const fracEnd = src.indexOf('    function scanTemplateMatchPage(');
const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && deepEnd > labelStart && fracEnd > fracStart && muteEnd > muteStart && normEnd > normStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, deepEnd)
    + src.slice(helperStart, helperEnd)
    + src.slice(fracStart, fracEnd)
    + src.slice(muteStart, muteEnd)
    + '\nreturn { readPlanColumnsFromTable, readPlanRowsFromOverviewTable, extractPlanRowsFromCells, resolvePlanTemplateMatch, sbrtGrayFractionsFromPlans, shouldMuteSiteSbrt, isSiteTemplateMuted, templateReviewDecision, cachedGrayFractions, grayFractionPageSignature };'
)();

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
            getRootNode() {
                let cur = el;
                while (cur.parentNode) cur = cur.parentNode;
                return cur;
            },
            querySelectorAll() { return []; },
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

function addCell(doc, tr, tag, text) {
    const cell = doc.createElement(tag);
    if (Array.isArray(text)) {
        text.forEach((part, i) => {
            if (i) cell.appendChild(doc.createElement('br'));
            addText(cell, part);
        });
    } else if (text) {
        addText(cell, text);
    }
    tr.appendChild(cell);
}

function addRow(doc, parent, tag, values) {
    const tr = doc.createElement('tr');
    values.forEach(value => addCell(doc, tr, tag, value));
    parent.appendChild(tr);
    return tr;
}

function makeTable(headerRows, fracCells) {
    const mini = createMiniDoc();
    const table = mini.doc.createElement('table');
    const thead = mini.doc.createElement('thead');
    headerRows.forEach(row => addRow(mini.doc, thead, 'th', row));
    table.appendChild(thead);
    const tbody = mini.doc.createElement('tbody');
    addRow(mini.doc, tbody, 'td', ['Dose Per Fraction', '200cGy/fx', '200cGy/fx', '200cGy/fx', '200cGy/fx']);
    addRow(mini.doc, tbody, 'td', fracCells);
    table.appendChild(tbody);
    return table;
}

const frac = ['Delivered / Total Fractions', '23', '12 / 23', '10', '0 / 10'];

function filled(plan) {
    return { filled: true, unselected: false, courseName: 'C1- Chest', planName: plan, text: 'RCO_Standard' };
}

const twoFilled = [filled('PlanA'), filled('PlanB')];

function grayFromTable(table) {
    const rows = helpers.readPlanRowsFromOverviewTable(table, 'C1- Chest', 0);
    const match = helpers.resolvePlanTemplateMatch(twoFilled, rows);
    const fx = helpers.sbrtGrayFractionsFromPlans(match.contexts);
    return { rows, match, fx, muteSbrt: helpers.shouldMuteSiteSbrt(fx) };
}

function ranchoButtons(fx) {
    return {
        rcoSbrt: helpers.isSiteTemplateMuted('rancho', fx, 'rco', true),
        rcoStd: helpers.isSiteTemplateMuted('rancho', fx, 'rco', false),
        rosSbrt: helpers.isSiteTemplateMuted('rancho', fx, 'ros', true),
        rosStd: helpers.isSiteTemplateMuted('rancho', fx, 'ros', false)
    };
}

const splitHead = makeTable([
    ['', 'Rx name', 'Plan name', 'Rx name', 'Plan name'],
    ['', 'RxA', 'PlanA', 'RxB', 'PlanB']
], frac);
const split = grayFromTable(splitHead);
ok('split header rows find both plan columns 23 and 10', split.rows.length === 2 && split.rows[0].planName === 'PlanA' && split.rows[0].totalFractions === 23 && split.rows[1].planName === 'PlanB' && split.rows[1].totalFractions === 10);
ok('two filled RCO_Standard plans at 12/23 and 0/10 mute SBRT', split.fx === 23 && split.muteSbrt === true);
const splitBtns = ranchoButtons(split.fx);
ok('Rancho RCO SBRT is muted and ROS is site-muted on that two-plan page', splitBtns.rcoSbrt === true && splitBtns.rosSbrt === true && splitBtns.rosStd === true);
ok('Rancho RCO Standard stays enabled', splitBtns.rcoStd === false);
ok('Review stays ok when both plans already have a template', helpers.templateReviewDecision('rancho', split.match.contexts).action === 'ok');

const titled = grayFromTable(makeTable([
    ['Prescription / Plan Overview'],
    ['', ['Rx name', 'RxA'], ['Plan name', 'PlanA'], ['Rx name', 'RxB'], ['Plan name', 'PlanB']]
], frac));
ok('a title header row plus name headers still finds both plans', titled.rows.length === 2 && titled.rows[0].totalFractions === 23 && titled.rows[1].totalFractions === 10 && titled.muteSbrt === true && ranchoButtons(titled.fx).rcoSbrt === true);

const titledSplit = grayFromTable(makeTable([
    ['Prescription / Plan Overview'],
    ['', 'Rx name', 'Plan name', 'Rx name', 'Plan name'],
    ['', 'RxA', 'PlanA', 'RxB', 'PlanB']
], frac));
ok('title, label, and name header rows still mute RCO SBRT', titledSplit.rows.length === 2 && titledSplit.rows[0].planName === 'PlanA' && titledSplit.rows[1].planName === 'PlanB' && titledSplit.muteSbrt === true);

const sameCell = grayFromTable(makeTable([
    ['', ['Rx name', 'RxA'], ['Plan name', 'PlanA'], ['Rx name', 'RxB'], ['Plan name', 'PlanB']]
], frac));
ok('a single header row with Plan name plus plan id still works', sameCell.rows.length === 2 && sameCell.rows[0].totalFractions === 23 && sameCell.rows[1].totalFractions === 10 && sameCell.muteSbrt === true);

const labelsOnly = grayFromTable(makeTable([
    ['', 'Rx name', 'Plan name', 'Rx name', 'Plan name']
], frac));
ok('Plan name columns without ids still yield both 23 and 10 totals', labelsOnly.rows.length === 2 && labelsOnly.rows[0].totalFractions === 23 && labelsOnly.rows[1].totalFractions === 10 && labelsOnly.muteSbrt === true);

const flat = helpers.extractPlanRowsFromCells([
    'Rx name\nRxA', 'Plan name\nPlanA', 'Rx name\nRxB', 'Plan name\nPlanB',
    'Delivered / Total Fractions', '23', '12 / 23', '10', '0 / 10'
], 'C1- Chest');
ok('flat cells with Rx 23 / plan 12/23 and Rx 10 / plan 0/10 yield 23 and 10', flat.length === 2 && flat[0].totalFractions === 23 && flat[1].totalFractions === 10);

const shortKeepsOn = helpers.sbrtGrayFractionsFromPlans(helpers.resolvePlanTemplateMatch(
    twoFilled,
    [
        { courseName: 'C1- Chest', planName: 'PlanA', totalFractions: 23, order: 1 },
        { courseName: 'C1- Chest', planName: 'PlanB', totalFractions: 5, order: 2 }
    ]
).contexts);
ok('if either of the two plans has fx<=5, SBRT stays enabled', shortKeepsOn === 5 && helpers.shouldMuteSiteSbrt(shortKeepsOn) === false);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

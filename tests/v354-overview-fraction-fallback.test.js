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
ok('v3.52 gray-out cache is unchanged', src.includes('function cachedGrayFractions(') && src.includes('function grayFractionPageSignature(') && src.includes('SITE_GRAY_MUTATION_DEBOUNCE_MS = 300'));
ok('applyPatientSiteGray still uses readTemplateGrayFractions', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTemplateGrayFractions\(\);/.test(src));
ok('all fraction pair totals are collected, not just the last', src.includes('function parseAllFractionPairTotals(') && /function parseFractionPairTotal\([\s\S]*?parseAllFractionPairTotals\(text\)/.test(src));
ok('joined fraction cells keep every N / M total', /function readAllFractionTotalsFromCells\([\s\S]*?parseAllFractionPairTotals\(row\.join\(' '\)\)/.test(src));
ok('overview tables expand colspan so Rx/Plan values line up', src.includes('function tableRowCellSlots(') && src.includes('function cellColSpan(') && src.includes('function headerSlotSameCell('));
ok('per-plan unknown falls back to overview-wide totals', src.includes('function readAllOverviewFractionTotals(') && src.includes('function sbrtGrayFractionsFromOverviewTotals(') && src.includes('function sbrtGrayFractionsWithOverviewFallback('));
ok('compute uses the overview fallback only after a known match is missing', /function computeTemplateGrayFractions\([\s\S]*?if \(!isKnownFractionTotal\(result\)\) \{\s*overviewTotals = readAllOverviewFractionTotals\(\);/.test(src));
ok('opt-in gray debug is behind cc_debug_gray and logs counts only', src.includes("const GRAY_DEBUG_FLAG = 'cc_debug_gray'") && src.includes('function isGrayDebugEnabled(') && src.includes('function logGrayDebug(') && /console\.info\('\[ChartCheck\] gray'/.test(src) && /Counts only:/.test(src));

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
    + '\nreturn { parseAllFractionPairTotals, parseFractionPairTotal, parsePlanCellFractionTotal, readAllFractionTotalsFromCells, collectDeepText, readPlanColumnsFromTable, readPlanRowsFromOverviewTable, extractPlanRowsFromCells, resolvePlanTemplateMatch, sbrtGrayFractionsFromPlans, sbrtGrayFractionsWithFallback, sbrtGrayFractionsFromOverviewTotals, sbrtGrayFractionsWithOverviewFallback, shouldMuteSiteSbrt, isSiteTemplateMuted, templateReviewDecision, cachedGrayFractions, grayFractionPageSignature, isGrayDebugEnabled, logGrayDebug };'
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
            attributes: {},
            colSpan: 1,
            appendChild(child) { return attach(el, child); },
            getRootNode() {
                let cur = el;
                while (cur.parentNode) cur = cur.parentNode;
                return cur;
            },
            querySelectorAll() { return []; },
            getAttribute(name) {
                if (String(name).toLowerCase() === 'colspan') {
                    return el.colSpan != null ? String(el.colSpan) : '';
                }
                return el.attributes[name] || '';
            },
            setAttribute(name, value) {
                el.attributes[name] = String(value);
                if (String(name).toLowerCase() === 'colspan') {
                    el.colSpan = Number(value) || 1;
                }
            }
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

function addCell(doc, tr, tag, text, colSpan) {
    const cell = doc.createElement(tag);
    if (colSpan && colSpan > 1) {
        cell.colSpan = colSpan;
        cell.setAttribute('colspan', String(colSpan));
    }
    if (Array.isArray(text)) {
        text.forEach((part, i) => {
            if (i) cell.appendChild(doc.createElement('br'));
            addText(cell, part);
        });
    } else if (text) {
        addText(cell, text);
    }
    tr.appendChild(cell);
    return cell;
}

function addSplitFractionCell(doc, tr, delivered, total, colorDelivered) {
    const cell = doc.createElement('td');
    if (colorDelivered) {
        const colored = doc.createElement('span');
        colored.className = 'fx-delivered';
        addText(colored, String(delivered));
        cell.appendChild(colored);
    } else {
        addText(cell, String(delivered));
    }
    addText(cell, ' / ');
    const totalEl = doc.createElement('span');
    addText(totalEl, String(total));
    cell.appendChild(totalEl);
    tr.appendChild(cell);
    return cell;
}

function addRow(doc, parent, tag, values) {
    const tr = doc.createElement('tr');
    values.forEach(value => addCell(doc, tr, tag, value));
    parent.appendChild(tr);
    return tr;
}

ok('parseAllFractionPairTotals keeps both 10/10 and 19/20', (() => {
    const all = helpers.parseAllFractionPairTotals('10 / 10 19 / 20');
    return all.length === 2 && all[0] === 10 && all[1] === 20;
})());
ok('dose-only 200cGy / 6000cGy is not a fraction total', helpers.parseAllFractionPairTotals('200cGy / 6000cGy 200 cGy / 6000 cGy').length === 0);
ok('10/10 and 19/20 stay both totals on a fractions row without dose text', (() => {
    const all = helpers.parseAllFractionPairTotals('Delivered / Total Fractions 10 / 10 19 / 20 20 Sessions');
    return all.length === 2 && all[0] === 10 && all[1] === 20;
})());
ok('parseFractionPairTotal still returns the last pair', helpers.parseFractionPairTotal('10 / 10 19 / 20') === 20);

ok('innermost split cells 10 / 10 and 19 / 20 yield both totals', (() => {
    const totals = helpers.readAllFractionTotalsFromCells([
        'Delivered / Total Fractions',
        '10', '/', '10',
        '19', '/', '20'
    ]);
    return totals.length === 2 && totals[0] === 10 && totals[1] === 20;
})());

ok('bare Rx integers after the fractions label are accepted as totals', (() => {
    const totals = helpers.readAllFractionTotalsFromCells([
        'Delivered / Total Fractions', '10', '20'
    ]);
    return totals.length === 2 && totals[0] === 10 && totals[1] === 20;
})());

ok('a split-span 19 / 20 cell still parses as 20', (() => {
    const mini = createMiniDoc();
    const td = mini.doc.createElement('td');
    const red = mini.doc.createElement('span');
    addText(red, '19');
    td.appendChild(red);
    addText(td, ' / ');
    const total = mini.doc.createElement('a');
    addText(total, '20');
    td.appendChild(total);
    return helpers.parsePlanCellFractionTotal(helpers.collectDeepText(td)) === 20;
})());

function makeColspanSplitTable() {
    const mini = createMiniDoc();
    const table = mini.doc.createElement('table');
    const thead = mini.doc.createElement('thead');
    addRow(mini.doc, thead, 'th', ['', 'Rx name', 'Plan name', 'Rx name', 'Plan name']);
    addRow(mini.doc, thead, 'th', ['', 'RxA', 'PlanA', 'RxB', 'PlanB']);
    table.appendChild(thead);
    const tbody = mini.doc.createElement('tbody');
    const sched = mini.doc.createElement('tr');
    addCell(mini.doc, sched, 'td', 'Treatment Scheduling');
    addCell(mini.doc, sched, 'td', 'Plan completed', 2);
    addCell(mini.doc, sched, 'td', '20 Sessions', 2);
    tbody.appendChild(sched);
    const frac = mini.doc.createElement('tr');
    addCell(mini.doc, frac, 'td', 'Delivered / Total Fractions');
    const a = addSplitFractionCell(mini.doc, frac, '10', '10', false);
    a.colSpan = 2;
    a.setAttribute('colspan', '2');
    const b = addSplitFractionCell(mini.doc, frac, '19', '20', true);
    b.colSpan = 2;
    b.setAttribute('colspan', '2');
    tbody.appendChild(frac);
    const rx = mini.doc.createElement('tr');
    addCell(mini.doc, rx, 'td', 'Rx');
    addCell(mini.doc, rx, 'td', '10');
    addCell(mini.doc, rx, 'td', '');
    addCell(mini.doc, rx, 'td', '20');
    addCell(mini.doc, rx, 'td', '');
    tbody.appendChild(rx);
    table.appendChild(tbody);
    return table;
}

function filled(site, plan) {
    return { filled: true, unselected: false, courseName: 'C1- Chest', planName: plan, text: site };
}

const twoRos = [filled('ROS_Standard', 'PlanA'), filled('ROS_Standard', 'PlanB')];

function grayFromTable(table, plans) {
    const rows = helpers.readPlanRowsFromOverviewTable(table, 'C1- Chest', 0);
    const match = helpers.resolvePlanTemplateMatch(plans || twoRos, rows);
    const fx = helpers.sbrtGrayFractionsFromPlans(match.contexts);
    return { rows, match, fx, muteSbrt: helpers.shouldMuteSiteSbrt(fx) };
}

function rosevilleButtons(fx) {
    return {
        rosSbrt: helpers.isSiteTemplateMuted('roseville', fx, 'ros', true),
        rosStd: helpers.isSiteTemplateMuted('roseville', fx, 'ros', false),
        rcoSbrt: helpers.isSiteTemplateMuted('roseville', fx, 'rco', true),
        rcoStd: helpers.isSiteTemplateMuted('roseville', fx, 'rco', false)
    };
}

const live = grayFromTable(makeColspanSplitTable());
ok('colspan + split-span 10/10 and 19/20 rows find both plan totals', live.rows.length === 2 && live.rows[0].planName === 'PlanA' && live.rows[0].totalFractions === 10 && live.rows[1].planName === 'PlanB' && live.rows[1].totalFractions === 20);
ok('two filled ROS_Standard plans at 10/10 and 19/20 mute SBRT', live.fx === 10 && live.muteSbrt === true);
const liveBtns = rosevilleButtons(live.fx);
ok('Roseville ROS SBRT is muted and RCO is site-muted on that two-plan page', liveBtns.rosSbrt === true && liveBtns.rcoSbrt === true && liveBtns.rcoStd === true);
ok('Roseville ROS Standard stays enabled', liveBtns.rosStd === false);
ok('Review stays ok when both plans already have a template', helpers.templateReviewDecision('roseville', live.match.contexts).action === 'ok');

ok('overview totals [10, 20] with two selects mute SBRT', helpers.sbrtGrayFractionsFromOverviewTotals([10, 20], 2) === 10 && helpers.shouldMuteSiteSbrt(helpers.sbrtGrayFractionsFromOverviewTotals([10, 20], 2)) === true);
ok('overview totals fewer than plan selects do not mute', helpers.sbrtGrayFractionsFromOverviewTotals([10], 2) == null);
ok('overview totals stay enabled if any found total is <=5', helpers.sbrtGrayFractionsFromOverviewTotals([10, 5], 2) == null);
ok('a short course in the per-plan match is not overridden by long overview totals', helpers.sbrtGrayFractionsWithOverviewFallback(
    [
        { tableFound: true, totalFractions: 5 },
        { tableFound: true, totalFractions: 20 }
    ],
    null,
    [5, 20],
    2
) === 5);

ok('when one matched plan total is null, overview 10 and 20 still mute', (() => {
    const fx = helpers.sbrtGrayFractionsWithOverviewFallback(
        [
            { tableFound: true, totalFractions: 10 },
            { tableFound: true, totalFractions: null }
        ],
        null,
        [10, 20],
        2
    );
    return fx === 10 && helpers.shouldMuteSiteSbrt(fx) === true && rosevilleButtons(fx).rosSbrt === true;
})());

ok('bare Rx 10 and 20 with two selects mute through the overview fallback', (() => {
    const totals = helpers.readAllFractionTotalsFromCells([
        'Delivered / Total Fractions', '10', '20'
    ]);
    const fx = helpers.sbrtGrayFractionsWithOverviewFallback(
        [
            { tableFound: false, totalFractions: null },
            { tableFound: false, totalFractions: null }
        ],
        null,
        totals,
        2
    );
    return totals[0] === 10 && totals[1] === 20 && fx === 10 && helpers.shouldMuteSiteSbrt(fx) === true;
})());

const debugLogs = [];
const realInfo = console.info;
const store = Object.create(null);
global.localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
};
console.info = function () { debugLogs.push(Array.from(arguments)); };

ok('gray debug is off by default', helpers.isGrayDebugEnabled() === false);
helpers.logGrayDebug({ selects: 2, planCount: 2, planTotals: [10, 20], overviewTotals: [10, 20], usedOverviewFallback: false, result: 10 });
ok('gray debug does not log when the flag is unset', debugLogs.length === 0);

localStorage.setItem('cc_debug_gray', '1');
ok('gray debug turns on with localStorage cc_debug_gray=1', helpers.isGrayDebugEnabled() === true);
helpers.logGrayDebug({ selects: 2, planCount: 2, planTotals: [10, null], overviewTotals: [10, 20], usedOverviewFallback: true, result: 10, planName: 'SHOULD_NOT_APPEAR', courseName: 'SHOULD_NOT_APPEAR' });
const logged = debugLogs[0];
const payload = logged && logged[1];
const keys = payload ? Object.keys(payload).sort() : [];
ok('gray debug logs a counts-only object with no PHI keys', !!(logged && logged[0] === '[ChartCheck] gray' && payload && payload.selects === 2 && payload.planCount === 2 && payload.planTotals[0] === 10 && payload.planTotals[1] == null && payload.overviewTotals[0] === 10 && payload.overviewTotals[1] === 20 && payload.usedOverviewFallback === true && payload.result === 10 && keys.join(',') === 'overviewTotals,planCount,planTotals,result,selects,usedOverviewFallback' && payload.planName == null && payload.courseName == null));

localStorage.removeItem('cc_debug_gray');
console.info = realInfo;

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

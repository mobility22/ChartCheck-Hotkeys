const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.48', /@version\s+3\.48\b/.test(src));
ok('no leftover 3.47', !/\b3\.47\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('overview tables are read from composed shadow trees', src.includes('function walkComposedTree(') && src.includes('function collectOverviewRowsFromRoot(') && src.includes('function readPlanRowsFromOverviewTable('));
ok('3.46 row detection remains as a fallback', src.includes('function findOverviewPlanRecordsLegacy('));
ok('fraction labels match after whitespace and nbsp normalization', src.includes('function fractionsLabelNorm(') && src.includes("value.startsWith('delivered/total fractions')"));
ok('collectDeepText walks shadow roots', src.includes('if (node.nodeType === 11)') && src.includes("if (tag === 'br')"));
ok('pairing still reports fx? when a row is found without a total', /if \(!knownFx\) \{\s*shouldStop = true;\s*if \(!reason\) reason = 'fx\?';/.test(src));
ok('SBRT gray-out still uses the page-wide first fraction read', /function applyPatientSiteGray\([\s\S]*?const totalFractions = readTotalFractions\(\);/.test(src));
ok('tooltip counts still include rows and near', src.includes(" + ' rows=' + countValue('rows')") && src.includes(" + ' near=' + countValue('near')"));

const helperStart = src.indexOf('    function isValidSiteTemplate(');
const helperEnd = src.indexOf('    function checksNeedTemplatePrompt(');
const labelStart = src.indexOf('    function fractionsLabelNorm(');
const deepEnd = src.indexOf('    function isInnermostDeepText(');
const normStart = src.indexOf('    function normalizeText(');
const normEnd = src.indexOf('    function getCurrentPatientIdentity(');
const fracStart = src.indexOf('    function isFractionsLabelElement(');
const fracEnd = src.indexOf('    function scanTemplateMatchPage(');
const rowsStart = src.indexOf('    function collectOverviewRowsFromRoot(');
const rowsEnd = src.indexOf('    function describeTemplateSelect(');
const sideStart = src.indexOf('    function ancestorChain(');
const sideEnd = src.indexOf('    function findCurrentPatientRow(');
ok('helper extract', helperStart >= 0 && helperEnd > helperStart && deepEnd > labelStart && normEnd > normStart && fracEnd > fracStart && rowsEnd > rowsStart && sideEnd > sideStart);

const helpers = new Function(
    "const VALID_CHECK_TEMPLATES = ['ROS_Standard', 'ROS_SBRT/SRS', 'RCO_Standard', 'RCO_SBRT'];\n"
    + src.slice(normStart, normEnd)
    + src.slice(labelStart, deepEnd)
    + src.slice(helperStart, helperEnd)
    + src.slice(sideStart, sideEnd)
    + src.slice(fracStart, fracEnd)
    + src.slice(rowsStart, rowsEnd)
    + '\nreturn { fractionsLabelNorm, isDeliveredTotalFractionsLabel, parseCourseLabel, courseIdToken, courseKeysMatch, planNameFromLabeledText, planNameFromHeaderCell, parsePlanCellFractionTotal, extractPlanRowsFromCells, collectOverviewRowsFromRoot, mergeOverviewPlanRows, formatReviewReason, resolvePlanTemplateMatch, templateReviewDecision, resolveReviewSite, collectDeepText };'
)();

ok('nbsp and slash spacing still count as the fractions heading', helpers.isDeliveredTotalFractionsLabel('Delivered\u00A0/\u00A0Total Fractions') === true);
ok('split heading text joined with spaces still matches', helpers.isDeliveredTotalFractionsLabel('Delivered / Total Fractions 3 1 / 17') === true);
ok('a dose heading is not treated as fractions', helpers.isDeliveredTotalFractionsLabel('Delivered / Total Dose') === false);

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

    function text(value) {
        return {
            nodeType: 3,
            nodeValue: value,
            parentNode: null,
            parentElement: null,
            childNodes: [],
            children: []
        };
    }

    const doc = node(9);
    doc.nodeType = 9;
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
    doc.createTextNode = value => text(value);
    return { doc, body, el: (tag) => doc.createElement(tag), text, attach };
}

function addText(el, value) {
    const node = {
        nodeType: 3,
        nodeValue: value,
        parentNode: el,
        parentElement: el,
        childNodes: [],
        children: []
    };
    el.childNodes.push(node);
    return node;
}

function addBr(el) {
    const br = el.ownerDocument.createElement('br');
    el.appendChild(br);
    return br;
}

function headerCell(doc, label, value) {
    const th = doc.createElement('th');
    const wrap = doc.createElement('span');
    addText(wrap, label);
    addBr(wrap);
    addText(wrap, value);
    th.appendChild(wrap);
    return th;
}

function dummyRow(doc, label, rx, plan) {
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
    return tr;
}

function fractionsRow(doc) {
    const tr = doc.createElement('tr');
    const th = doc.createElement('th');
    const part1 = doc.createElement('span');
    addText(part1, 'Delivered /');
    const part2 = doc.createElement('span');
    addText(part2, 'Total\u00A0Fractions');
    th.appendChild(part1);
    th.appendChild(part2);

    const tdRx = doc.createElement('td');
    tdRx.className = 'strong-left';
    addText(tdRx, '3');

    const tdPlan = doc.createElement('td');
    const wrap = doc.createElement('div');
    const n = doc.createElement('span');
    addText(n, '1');
    const slash = doc.createElement('span');
    addText(slash, '/');
    const mHost = doc.createElement('phi-value');
    const mShadow = mHost.attachShadow({ mode: 'open' });
    const m = mShadow.ownerDocument.createElement('span');
    addText(m, '17');
    mShadow.appendChild(m);
    wrap.appendChild(n);
    wrap.appendChild(slash);
    wrap.appendChild(mHost);
    tdPlan.appendChild(wrap);

    tr.appendChild(th);
    tr.appendChild(tdRx);
    tr.appendChild(tdPlan);
    return tr;
}

function buildCourseView(body, courseTitle, planName, withTable) {
    const view = body.ownerDocument.createElement('weekly-plan-check-view');
    const viewShadow = view.attachShadow({ mode: 'open' });
    const main = body.ownerDocument.createElement('main');

    const heading = body.ownerDocument.createElement('h2');
    const courseLabel = body.ownerDocument.createElement('span');
    addText(courseLabel, 'Course:');
    const courseValue = body.ownerDocument.createElement('span');
    addText(courseValue, courseTitle);
    heading.appendChild(courseLabel);
    heading.appendChild(courseValue);
    main.appendChild(heading);

    const sidebar = body.ownerDocument.createElement('sections-sidebar');
    const sideShadow = sidebar.attachShadow({ mode: 'open' });
    const sideCourse = body.ownerDocument.createElement('div');
    addText(sideCourse, 'Course: ' + courseTitle);
    const sidePlan = body.ownerDocument.createElement('div');
    addText(sidePlan, 'Plan: ' + planName);
    sideShadow.appendChild(sideCourse);
    sideShadow.appendChild(sidePlan);
    main.appendChild(sidebar);

    if (withTable) {
        const section = body.ownerDocument.createElement('section');
        section.className = 'rx';
        const h4 = body.ownerDocument.createElement('h4');
        addText(h4, 'Prescription / Plan Overview');
        section.appendChild(h4);

        const host = body.ownerDocument.createElement('rx-pass-state-table');
        const tableShadow = host.attachShadow({ mode: 'open' });
        const wrap = body.ownerDocument.createElement('div');
        wrap.className = 'fixed-2 freeze-columns-0';
        const table = body.ownerDocument.createElement('table');
        const thead = body.ownerDocument.createElement('thead');
        const headRow = body.ownerDocument.createElement('tr');
        headRow.appendChild(body.ownerDocument.createElement('th'));
        headRow.appendChild(headerCell(body.ownerDocument, 'Rx name', 'RxA'));
        headRow.appendChild(headerCell(body.ownerDocument, 'Plan name', planName));
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = body.ownerDocument.createElement('tbody');
        const labels = [
            'Approval Status', 'Site', 'Method of delivery', 'Dose Per Fraction',
            'Energy', 'Technique', 'Modality', 'Frequency', 'Scheduling',
            'Gating', 'Total Dose', 'Comments', 'Notes'
        ];
        labels.forEach(label => tbody.appendChild(dummyRow(body.ownerDocument, label, 'x', 'x')));
        tbody.appendChild(fractionsRow(body.ownerDocument));
        table.appendChild(tbody);
        wrap.appendChild(table);
        tableShadow.appendChild(wrap);
        section.appendChild(host);
        main.appendChild(section);
    }

    viewShadow.appendChild(main);
    body.appendChild(view);
    return view;
}

const mini = createMiniDoc();
const view = buildCourseView(mini.body, 'C2- Beta', 'PlanB', true);
const joinedLabel = helpers.collectDeepText(
    // find the fractions th inside the table
    (function findTh(node, hits) {
        if (!node) return hits;
        if (node.nodeType === 1 && (node.tagName || '').toLowerCase() === 'th') hits.push(node);
        if (node.shadowRoot) findTh(node.shadowRoot, hits);
        (node.children || []).forEach(child => findTh(child, hits));
        return hits;
    })(view, []).find(th => /delivered/i.test(helpers.collectDeepText(th)))
);
ok('split Delivered / Total Fractions plus nbsp is collected as one heading', helpers.isDeliveredTotalFractionsLabel(joinedLabel) === true);

const rows = helpers.collectOverviewRowsFromRoot(mini.doc);
const planRows = rows.filter(row => !row.headingOnly);
ok('shadow rx-pass-state-table yields one plan row, not 14 wrappers', planRows.length === 1 && planRows[0].planName === 'PlanB' && planRows[0].totalFractions === 17);
ok('main Course: heading is attached from outside the table shadow', /c2/.test(helpers.courseIdToken(planRows[0].courseName) || '') && helpers.courseKeysMatch(planRows[0].courseName, 'C2- Beta'));
ok('the same table is not counted three times if reached from wrapper and host', planRows.length === 1);

const two = createMiniDoc();
buildCourseView(two.body, 'C1- Alpha', 'PlanA', true);
buildCourseView(two.body, 'C2- Beta', 'PlanB', true);
const twoRows = helpers.collectOverviewRowsFromRoot(two.doc).filter(row => !row.headingOnly);
ok('two shadow course cards stay two unique plan rows', twoRows.length === 2 && twoRows.some(row => row.planName === 'PlanA' && row.totalFractions === 17) && twoRows.some(row => row.planName === 'PlanB' && row.totalFractions === 17));

const headingsOnly = createMiniDoc();
buildCourseView(headingsOnly.body, 'C1- Alpha', 'PlanA', false);
buildCourseView(headingsOnly.body, 'C2- Beta', 'PlanB', false);
const headingRows = helpers.collectOverviewRowsFromRoot(headingsOnly.doc);
ok('main course headings are kept when the overview table is missing', headingRows.length === 2 && headingRows.every(row => row.headingOnly && helpers.courseIdToken(row.courseName)));

const paired = helpers.resolvePlanTemplateMatch(
    [
        { filled: true, unselected: false, courseName: 'C1- Alpha', planName: 'PlanA', text: 'ROS_SBRT/SRS' },
        { filled: false, unselected: true, courseName: 'C2-Beta', planName: 'PlanB', text: 'OAK_Standard' }
    ],
    headingRows
);
ok('one plan per course still pairs by course id when rows have no fx', paired.contexts[1].tableFound === true && paired.contexts[1].totalFractions == null && paired.contexts[0].filled === true);

const decision = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [{ text: 'ROS_SBRT/SRS' }, { text: 'OAK_Standard' }]),
    paired.contexts
);
ok('a successful sidebar pair without fx stops with fx? not match?', decision.action === 'stop' && decision.reason === 'fx?' && decision.message === 'Template needed');

const full = helpers.resolvePlanTemplateMatch(
    [
        { filled: true, unselected: false, courseName: 'C1- Alpha', planName: 'PlanA', text: 'ROS_SBRT/SRS' },
        { filled: false, unselected: true, courseName: 'C2-Beta', planName: 'PlanB', text: 'OAK_Standard' }
    ],
    twoRows
);
const auto = helpers.templateReviewDecision(
    helpers.resolveReviewSite('unknown', [{ text: 'ROS_SBRT/SRS' }, { text: 'OAK_Standard' }]),
    full.contexts
);
ok('plan-column M of 17 auto-selects Standard for the unselected course', auto.action === 'auto' && auto.templateName === 'ROS_Standard' && JSON.stringify(auto.unfilledIndexes) === JSON.stringify([1]));

ok('tooltip counts stay name-free', helpers.formatReviewReason('fx?', { sel: 2, unsel: 1, blocks: 1, rows: 2, courses: 2, planLabels: 2, matched: 1, near: 0 }) === 'fx? sel=2 unsel=1 blocks=1 rows=2 courses=2 planLabels=2 matched=1 near=0');

const splitCells = [
    'Plan name\nPlanA',
    'Delivered / Total\u00A0Fractions',
    '3',
    '1 / 17'
];
const splitExtract = helpers.extractPlanRowsFromCells(splitCells, 'C1- Alpha');
ok('nbsp in a flat cell list still yields plan fx 17', splitExtract.length === 1 && splitExtract[0].totalFractions === 17 && splitExtract[0].planName === 'PlanA');

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

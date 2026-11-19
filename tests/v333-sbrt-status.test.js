const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.33', /@version\s+3\.33\b/.test(src));
ok('no leftover 3.32', !/\b3\.32\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('template status line is in the status block', src.includes("templateStatus.className = 'chartcheck-template-status'"));
ok('template status stays in the status area, not the help list', /function buildStatusContent\([\s\S]*chartcheck-template-status[\s\S]*?^    \}/m.test(src));
ok('muted SBRT still uses chartcheck-site-muted on the row', src.includes("row.classList.toggle('chartcheck-site-muted', mute)"));
ok('applyPatientSiteGray updates the status line', /function applyPatientSiteGray\([\s\S]*?updateTemplateStatusLine\(site, totalFractions\)/.test(src));
ok('refresh starts if load already completed', src.includes("document.readyState === 'complete'") && src.includes('startSiteGrayRefresh()'));
ok('refresh also starts on load and DOMContentLoaded', src.includes("document.addEventListener('DOMContentLoaded', startSiteGrayRefresh)") && src.includes("window.addEventListener('load', startSiteGrayRefresh)"));
ok('MutationObserver re-evaluates outside the panel', src.includes('new MutationObserver') && src.includes('mutationIsOutsidePanel') && src.includes('setInterval(refreshPatientSiteGray, 800)'));
ok('deep text walks shadow roots', /function collectDeepText\([\s\S]*?if \(node\.shadowRoot\) visit\(node\.shadowRoot\)/.test(src));
ok('fraction reader looks at same-origin iframes', src.includes('el.contentDocument') && src.includes('function overviewDocuments('));
ok('sibling cells are used when ancestor text is not enough', src.includes('function readTotalFractionsFromCells(') && src.includes('function readTotalFractionsFromLabel('));

const helperStart = src.indexOf('    function normalizeText(');
const helperMid = src.indexOf('    function getCurrentPatientIdentity(');
const labelStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const cellsEnd = src.indexOf('    function collectDeepText(');
const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
const fmtStart = src.indexOf('    function siteStatusCode(');
const fmtEnd = src.indexOf('    function updateTemplateStatusLine(');

ok('parser extract', helperStart >= 0 && helperMid > helperStart && labelStart >= 0 && cellsEnd > labelStart);
ok('mute and status extract', muteStart >= 0 && muteEnd > muteStart && fmtStart >= 0 && fmtEnd > fmtStart);

const helpers = new Function(
    src.slice(helperStart, helperMid) +
    src.slice(labelStart, cellsEnd) +
    src.slice(muteStart, muteEnd) +
    src.slice(fmtStart, fmtEnd) +
    '\nreturn { normalizeText, isDeliveredTotalFractionsLabel, parseTotalFractionsFromRowText, readTotalFractionsFromCells, shouldMuteSiteSbrt, isSiteTemplateMuted, formatTemplateStatus };'
)();

const parse = helpers.parseTotalFractionsFromRowText;
const fromCells = helpers.readTotalFractionsFromCells;
const format = helpers.formatTemplateStatus;
const muted = helpers.isSiteTemplateMuted;

ok('nbsp in the label and 2 / 30 still parse', parse('Delivered\u00A0/\u00A0Total\u00A0Fractions 2\u00A0/\u00A030') === 30);
ok('Delivered/Total Fractions compact label', helpers.isDeliveredTotalFractionsLabel('Delivered/Total Fractions') === true);
ok('compact label plus 2/30', parse('Delivered/Total Fractions 2/30') === 30);
ok('unicode slash in 2／30', parse('Delivered / Total Fractions 2／30') === 30);
ok('2 of 30 is accepted', parse('Delivered / Total Fractions 2 of 30') === 30);
ok('plan cell after the label', fromCells(['Delivered / Total Fractions', '0 / 30', '2 / 30']) === 30);
ok('plan cell preferred when Rx and plan differ', fromCells(['Delivered / Total Fractions', '0 / 5', '2 / 30']) === 30);
ok('later field label is not treated as the total', fromCells([
    'Dose / Fraction', '200', '200',
    'Delivered / Total Fractions', '0 / 30', '2 / 30',
    'Total Dose', '400 / 6000', '400 / 6000'
]) === 30);
ok('unread cells return null', fromCells(['Frequency', 'Daily']) === null);
ok('empty cells return null', fromCells([]) === null);

ok('confirmed row: Rx 3 and Plan 2 / 3 uses M', fromCells(['Delivered / Total Fractions', '3', '2 / 3']) === 3);
ok('confirmed row with M in its own span', fromCells(['Delivered / Total Fractions', '3', '2 /', '3']) === 3);
ok('confirmed row with a 30-fraction plan', fromCells(['Delivered / Total Fractions', '30', '2 /', '30']) === 30);
ok('nbsp in a split plan cell 2 / 3', fromCells(['Delivered / Total Fractions', '3', '2\u00A0/', '3']) === 3);
ok('Rx lone total is used when Plan has no pair', fromCells(['Delivered / Total Fractions', '3']) === 3);
ok('Dose Per Fraction 1600cGy/fx is not used as M', fromCells([
    'Dose Per Fraction', '1600cGy/fx', '1600cGy/fx',
    'Delivered / Total Fractions', '3', '2 /', '3',
    'Total Dose', '400 of 6000 cGy'
]) === 3);
ok('1600cGy/fx alone is not a fraction total', parse('1600cGy/fx') === null);
ok('400 of 6000 cGy is not a fraction total', parse('400 of 6000 cGy') === null);
ok('400 / 6000 centigray is not a fraction total', parse('400 / 6000 centigray') === null);
ok('N of M fractions is still accepted', parse('2 of 30 fractions') === 30);
ok('N of M fx is still accepted', parse('2 of 20 fx') === 20);
ok('a number left of the label is not used when a plan pair exists', parse('3 Delivered / Total Fractions 2 / 30') === 30);
ok('a lone 3 left of Total Fractions is not used as the total', parse('3 Total Fractions') === null);

ok('status shows ROS, fx 30, SBRT off', format('roseville', 30, true) === 'ROS · fx 30 · SBRT off');
ok('status shows RCO, fx 5, SBRT on', format('rancho', 5, false) === 'RCO · fx 5 · SBRT on');
ok('unread total is fx ?', format('roseville', null, false) === 'ROS · fx ? · SBRT on');
ok('unknown site is ? with fx total', format('unknown', 30, false) === '? · fx 30 · SBRT on');
ok('roseville 30 still mutes only ROS SBRT among ROS', muted('roseville', 30, 'ros', true) === true && muted('roseville', 30, 'ros', false) === false);
ok('row cells are read as whole plan cells when possible', src.includes('function rowCellTextsFromLabel(') && src.includes('collectDeepText(child)'));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

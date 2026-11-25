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
ok('yellow site frame border unchanged', /#chartcheck-panel \.chartcheck-site-frame\s*\{[\s\S]*?border:\s*2px solid rgba\(255,\s*214,\s*0,\s*0\.7\);/.test(src));
ok('SBRT rows are marked on the help actions', src.includes("sbrt: true") && /name: 'ROS SBRT'[\s\S]*?sbrt: true[\s\S]*?run: applyRosSbrt/.test(src) && /name: 'RCO SBRT'[\s\S]*?sbrt: true[\s\S]*?run: applyRcoSbrt/.test(src));
ok('SBRT rows get dataset.sbrt', src.includes("row.dataset.sbrt = '1'"));
ok('muted SBRT uses the same site-muted class', src.includes("row.classList.toggle('chartcheck-site-muted', mute)"));
ok('applyPatientSiteGray uses isSiteTemplateMuted', /function applyPatientSiteGray\([\s\S]*?isSiteTemplateMuted\(site, totalFractions, pair, isSbrt\)/.test(src));
ok('template button clicks ignore muted rows', /button\.addEventListener\('click'[\s\S]*?isTemplateHotkeyMuted\(action\.sitePair, !!action\.sbrt\)[\s\S]*?return;[\s\S]*?action\.run\(\)/.test(src));
ok('keyboard template handlers are gone', !/e\.altKey/.test(src) && !/e\.shiftKey && key ===/.test(src) && !/handleHotkeys/.test(src));
ok('muted template clicks remain the only ignore path', /button\.addEventListener\('click'[\s\S]*?isTemplateHotkeyMuted\(action\.sitePair, !!action\.sbrt\)/.test(src));

const parseStart = src.indexOf('    function isDeliveredTotalFractionsLabel(');
const parseEnd = src.indexOf('    function collectDeepText(');
ok('parseTotalFractionsFromRowText extract', parseStart >= 0 && parseEnd > parseStart);

const muteStart = src.indexOf('    function shouldMuteSiteSbrt(');
const muteEnd = src.indexOf('    function isTemplateHotkeyMuted(');
ok('mute helper extract', muteStart >= 0 && muteEnd > muteStart);

const helpers = new Function(
    src.slice(src.indexOf('    function normalizeText('), src.indexOf('    function getCurrentPatientIdentity(')) +
    src.slice(parseStart, parseEnd) +
    src.slice(muteStart, muteEnd) +
    '\nreturn { parseTotalFractionsFromRowText, shouldMuteSiteSbrt, isSiteTemplateMuted };'
)();

const parse = helpers.parseTotalFractionsFromRowText;
const shouldMute = helpers.shouldMuteSiteSbrt;
const muted = helpers.isSiteTemplateMuted;

ok('plan total from 2 / 30', parse('Delivered / Total Fractions 0 / 30 2 / 30') === 30);
ok('plan total preferred when Rx and plan differ', parse('Delivered / Total Fractions 0 / 5 2 / 30') === 30);
ok('compact 2/30 is accepted', parse('Delivered / Total Fractions 2/30') === 30);
ok('Rx total used when it is the only pair', parse('Delivered / Total Fractions 0 / 12') === 12);
ok('Rx lone total used when plan is missing', parse('Delivered / Total Fractions 30') === 30);
ok('plan lone total preferred over Rx lone total', parse('Delivered / Total Fractions 10 30') === 30);
ok('unreadable text returns null', parse('Delivered / Total Fractions') === null);
ok('empty text returns null', parse('') === null);
ok('label without a total is ignored', parse('Frequency Daily') === null);

ok('6 fractions mutes SBRT', shouldMute(6) === true);
ok('30 fractions mutes SBRT', shouldMute(30) === true);
ok('5 fractions leaves SBRT enabled', shouldMute(5) === false);
ok('1 fraction leaves SBRT enabled', shouldMute(1) === false);
ok('unread total leaves SBRT enabled', shouldMute(null) === false);

ok('roseville 30 fr mutes ROS SBRT only among ROS', muted('roseville', 30, 'ros', true) === true && muted('roseville', 30, 'ros', false) === false);
ok('roseville 30 fr still mutes both RCO buttons', muted('roseville', 30, 'rco', true) === true && muted('roseville', 30, 'rco', false) === true);
ok('rancho 30 fr mutes RCO SBRT only among RCO', muted('rancho', 30, 'rco', true) === true && muted('rancho', 30, 'rco', false) === false);
ok('rancho 30 fr still mutes both ROS buttons', muted('rancho', 30, 'ros', true) === true && muted('rancho', 30, 'ros', false) === true);
ok('roseville 5 fr leaves ROS SBRT enabled', muted('roseville', 5, 'ros', true) === false && muted('roseville', 5, 'ros', false) === false);
ok('roseville unread total leaves ROS SBRT enabled', muted('roseville', null, 'ros', true) === false);
ok('unknown site leaves both SBRT buttons enabled', muted('unknown', 30, 'ros', true) === false && muted('unknown', 30, 'rco', true) === false);
ok('non-template rows are not muted', muted('roseville', 30, '', true) === false);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

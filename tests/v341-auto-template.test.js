const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.44', /@version\s+3\.44\b/.test(src));
ok('no leftover 3.43', !/\b3\.43\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));

ok('v3.34 debug status names stay gone', !src.includes('chartcheck-template-status') && !src.includes('templateStatus') && !src.includes('updateTemplateStatusLine') && !src.includes('formatTemplateStatus') && !src.includes('siteStatusCode'));
ok('Review uses a separate review note, not the removed debug line', src.includes("reviewNote.className = 'chartcheck-review-note'") && src.includes('function setReviewNote('));
ok('ambiguous stop uses the stated panel message', src.includes("'Template needed'"));
ok('unknown site or fx has a stop message', src.includes("'Template needed'"));
ok('Review loop waits for an auto-selected template before FAIL checks', /while \(autoReviewActive\) \{[\s\S]*ensureReviewTemplates\(\)[\s\S]*findFailLinks\(\)/.test(src));
ok('setTemplate still applies every matching dropdown for the buttons', /function setTemplate\([\s\S]*?getTemplateSelects\(\)[\s\S]*?selects\.forEach\(select =>/.test(src));
ok('auto Review path only assigns unfilled dropdowns', src.includes('function assignTemplateToSelects(') && src.includes('decision.unfilledIndexes'));
ok('auto Review waits for checks after Apply', src.includes('function applyTemplateAndWait(') && src.includes('waitForChecksReady') && src.includes('Apply Check Templates Update'));

const start = src.indexOf('    function templateReviewDecision(');
const end = src.indexOf('    function checksNeedTemplatePrompt(');
ok('templateReviewDecision extract', start >= 0 && end > start);

const templateReviewDecision = new Function(
    src.slice(start, end) + '\nreturn templateReviewDecision;'
)();

function decide(site, fx, states) {
    return templateReviewDecision(site, states.map((s) => ({
        filled: !!s.filled,
        unselected: !s.filled,
        tableFound: !s.filled && fx != null,
        totalFractions: s.filled ? null : fx
    })));
}

function unfilled() {
    return { filled: false, text: 'OAK_Standard' };
}

function filled(text) {
    return { filled: true, text: text };
}

const auto30 = decide('roseville', 30, [unfilled()]);
ok('fx 30 auto-selects ROS Standard and does not stop', auto30.action === 'auto' && auto30.templateName === 'ROS_Standard' && JSON.stringify(auto30.unfilledIndexes) === JSON.stringify([0]));

const auto30rco = decide('rancho', 16, [unfilled()]);
ok('fx 16 at Rancho auto-selects RCO Standard', auto30rco.action === 'auto' && auto30rco.templateName === 'RCO_Standard');

const stop5 = decide('roseville', 5, [unfilled()]);
ok('fx 5 stops for a manual Std or SBRT pick', stop5.action === 'stop' && stop5.message === 'Template needed');

const stop1 = decide('rancho', 1, [unfilled()]);
ok('fx 1 also stops as ambiguous', stop1.action === 'stop' && stop1.message === 'Template needed');

const stopUnknownFx = decide('roseville', null, [unfilled()]);
ok('unknown fx stops and does not guess', stopUnknownFx.action === 'stop' && stopUnknownFx.message === 'Template needed');

const stopUnknownSite = decide('unknown', 30, [unfilled()]);
ok('unknown site stops and does not guess', stopUnknownSite.action === 'stop' && stopUnknownSite.message === 'Template needed');

const already = decide('roseville', 30, [filled('ROS_Standard')]);
ok('already-selected template is left untouched', already.action === 'ok' && already.templateName == null && already.unfilledIndexes == null);

const alreadyLowFx = decide('roseville', 3, [filled('ROS_SBRT/SRS')]);
ok('already-selected SBRT at fx<=5 is left untouched', alreadyLowFx.action === 'ok');

const mixedAuto = decide('roseville', 30, [filled('ROS_Standard'), unfilled()]);
ok('fx 30 with a mixed page auto-selects only the unfilled dropdown', mixedAuto.action === 'auto' && mixedAuto.templateName === 'ROS_Standard' && JSON.stringify(mixedAuto.unfilledIndexes) === JSON.stringify([1]));

const mixedStop = decide('roseville', 5, [filled('ROS_Standard'), unfilled()]);
ok('fx<=5 stops if any dropdown is unfilled', mixedStop.action === 'stop' && mixedStop.message === 'Template needed');

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

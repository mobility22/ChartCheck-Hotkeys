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

ok('panel still sizes to its controls with max-content', /#chartcheck-panel \{\s*[\s\S]*?width:\s*max-content;/.test(src));
ok('review note cannot widen the max-content panel', /#chartcheck-panel \.chartcheck-review-note \{\s*[\s\S]*?width:\s*0;[\s\S]*?min-width:\s*100%;/.test(src));
ok('review note wraps inside the existing width', /#chartcheck-panel \.chartcheck-review-note \{\s*[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*break-word;/.test(src));
ok('review note keeps the small 16px status font', /#chartcheck-panel \.chartcheck-review-note \{\s*[\s\S]*?font-size:\s*16px;/.test(src));
ok('count status lines stay nowrap', /#chartcheck-panel \.chartcheck-status \{\s*[\s\S]*?white-space:\s*nowrap;/.test(src));

ok('fx<=5 and unknown stops both say Template needed', src.includes("'Template needed'") && !src.includes("'Template needed (fx<=5): pick Std or SBRT'") && !src.includes("'Template needed: site or fx unknown, pick manually'"));

const start = src.indexOf('    function templateReviewDecision(');
const end = src.indexOf('    function checksNeedTemplatePrompt(');
ok('templateReviewDecision extract', start >= 0 && end > start);
const templateReviewDecision = new Function(
    src.slice(start, end) + '\nreturn templateReviewDecision;'
)();

function plan(fx, filled) {
    return {
        filled: !!filled,
        unselected: !filled,
        tableFound: !filled && fx != null,
        totalFractions: filled ? null : fx
    };
}

ok('fx 5 status is Template needed', templateReviewDecision('roseville', [plan(5)]).message === 'Template needed');
ok('unknown fx status is Template needed', templateReviewDecision('roseville', [plan(null)]).message === 'Template needed');
ok('unknown site status is Template needed', templateReviewDecision('unknown', [plan(30)]).message === 'Template needed');
ok('fx 30 auto path is unchanged', templateReviewDecision('roseville', [plan(30)]).action === 'auto' && templateReviewDecision('roseville', [plan(30)]).templateName === 'ROS_Standard');

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

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

const buttonOrder = src.slice(
    src.indexOf('        const buttonOrder = ['),
    src.indexOf('        ];', src.indexOf('        const buttonOrder = ['))
);
ok('final grid order through Delay, templates, Fail, then Stop',
    /'S',\s*'A',\s*'⌃⇧R',\s*'R',\s*'NONSTOP',\s*'DELAY',\s*'Q',\s*'W',\s*'⇧Q',\s*'⇧W',\s*'D',\s*'F',\s*'X'/.test(buttonOrder));
ok('layout comment matches the swapped grid',
    src.includes('// Auto-approve | Review') && src.includes('// Nonstop | Delay') && !src.includes('// Auto-approve | Nonstop') && !src.includes('// Review | Delay'));
ok('switches were not moved to a bottom panel group', !src.includes('chartcheck-switches') && !src.includes('reviewSwitchActions') && !src.includes('chartcheck-help-spacer'));
ok('reset button stays on the Rancho count line', src.includes("ranchoLine.appendChild(resetBtn)") && src.includes("resetBtn.textContent = '↺'") && src.includes('resetPersistedSiteCounts();'));
ok('site counts stay in the status block', src.includes("rosevilleEl.className = 'chartcheck-roseville-count'") && src.includes("ranchoEl.className = 'chartcheck-rancho-count'"));
ok('Nonstop and Delay remain switch actions', /name: 'Nonstop'[\s\S]*?kind: 'switch'[\s\S]*?switchId: 'nonstop'/.test(src) && /name: 'Delay'[\s\S]*?kind: 'switch'[\s\S]*?switchId: 'delay'/.test(src));
ok('Review remains a grid button', /name: 'Review'[\s\S]*?button: 'R'[\s\S]*?run: startReview/.test(src));
ok('switch rows get the review-switch class and a status dot', src.includes("row.classList.add('chartcheck-review-switch')") && src.includes("button.classList.add('chartcheck-review-switch-btn')") && src.includes("dot.className = 'chartcheck-switch-dot'") && src.includes("label.className = 'chartcheck-switch-label'"));
ok('switch pills use a round radius and a 35% text-color outline', /#chartcheck-panel \.chartcheck-help-btn\.chartcheck-review-switch-btn \{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*1px solid rgba\(0,\s*255,\s*102,\s*0\.35\);[\s\S]*?border-radius:\s*999px;/.test(src));
ok('status dot is green when the switch is on and grey when off', src.includes("row.classList.toggle('chartcheck-switch-on', on)") && src.includes("button.classList.toggle('chartcheck-switch-on', on)") && /#chartcheck-panel \.chartcheck-switch-dot \{[\s\S]*?background:\s*#7a7a7a;/.test(src) && /#chartcheck-panel \.chartcheck-help-btn\.chartcheck-switch-on \.chartcheck-switch-dot \{[\s\S]*?background:\s*#00ff66;/.test(src));
ok('Delay 3s and Nonstop ON count as the active dot state', /function isReviewSwitchOn\(id\) \{[\s\S]*currentNonstop\(\)[\s\S]*currentReviewDelayMs\(\) !== REVIEW_DELAY_OFF_MS/.test(src));
ok('switch hover matches regular buttons', /#chartcheck-panel \.chartcheck-help-btn\.chartcheck-review-switch-btn:hover,[\s\S]*?background:\s*#00ff66;[\s\S]*?color:\s*#04140c;/.test(src));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

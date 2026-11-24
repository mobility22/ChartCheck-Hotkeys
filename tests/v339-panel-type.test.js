const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.46', /@version\s+3\.46\b/.test(src));
ok('no leftover 3.45', !/\b3\.45\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));

ok('grid button font is 15px', /#chartcheck-panel \.chartcheck-help-btn\s*\{[\s\S]*?font-size:\s*15px;/.test(src));
ok('grid button padding was increased slightly', /#chartcheck-panel \.chartcheck-help-btn\s*\{[\s\S]*?padding:\s*2px 6px;/.test(src));
ok('switch pills inherit the 15px button font', !/#chartcheck-panel \.chartcheck-help-btn\.chartcheck-review-switch-btn\s*\{[^}]*font-size:/.test(src));
ok('status and count lines are 21px', /#chartcheck-panel \.chartcheck-status\s*\{[\s\S]*?font-size:\s*21px;/.test(src));
ok('reset button font is 15px', /#chartcheck-panel \.chartcheck-count-reset\s*\{[\s\S]*?font-size:\s*15px;/.test(src));
ok('help-list base font remains 13px', /#chartcheck-panel \.chartcheck-help-list\s*\{[\s\S]*?font-size:\s*13px;/.test(src));
ok('title font is unchanged at 21px', /#chartcheck-panel \.chartcheck-title\s*\{[\s\S]*?font-size:\s*21px;/.test(src));
ok('labels were not abbreviated', !src.includes('shortName') && src.includes("name: 'Auto-approve'") && src.includes("name: 'ROS Standard'") && src.includes("name: 'RCO Standard'") && src.includes("name: 'Fail link'") && src.includes("name: 'Fix'") && !src.includes("name: 'Auto'") && !src.includes("name: 'ROS Std'") && !src.includes("name: 'Fail lnk'"));
ok('display still uses the full action name', src.includes('name.textContent = action.name'));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

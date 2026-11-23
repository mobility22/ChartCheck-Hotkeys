const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.43', /@version\s+3\.43\b/.test(src));
ok('no leftover 3.42', !/\b3\.42\b/.test(src));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('row descriptions are 15px, matching the buttons', /#chartcheck-panel \.chartcheck-help-name\s*\{[\s\S]*?font-size:\s*15px;/.test(src));
ok('grid button font stays 15px', /#chartcheck-panel \.chartcheck-help-btn\s*\{[\s\S]*?font-size:\s*15px;/.test(src));
ok('status lines stay 21px', /#chartcheck-panel \.chartcheck-status\s*\{[\s\S]*?font-size:\s*21px;/.test(src));
ok('descriptions stay on one line', /#chartcheck-panel \.chartcheck-help-name\s*\{[\s\S]*?white-space:\s*nowrap;/.test(src));
ok('labels were not abbreviated', !src.includes('shortName') && src.includes("name: 'Auto-approve'") && src.includes("name: 'ROS Standard'") && src.includes("name: 'RCO Standard'") && src.includes("name: 'Fail link'") && src.includes("name: 'Fix'") && src.includes('name.textContent = action.name'));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

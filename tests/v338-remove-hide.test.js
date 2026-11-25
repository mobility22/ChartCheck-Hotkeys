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

const buttonOrder = src.slice(
    src.indexOf('        const buttonOrder = ['),
    src.indexOf('        ];', src.indexOf('        const buttonOrder = ['))
);
ok('Hide is not in the button grid', !buttonOrder.includes("'L'") && !src.includes("name: 'Hide'") && !src.includes("button: 'L'"));
ok('Stop is the last grid button, alone on the last row', /'D',\s*'F',\s*'X'/.test(buttonOrder) && !/'X',\s*'L'/.test(buttonOrder) && !/'L',\s*'X'/.test(buttonOrder));
ok('final grid is Next, Approve, Auto-approve, Review, Nonstop, Delay, templates, Fail, Stop',
    /'S',\s*'A',\s*'⌃⇧R',\s*'R',\s*'NONSTOP',\s*'DELAY',\s*'Q',\s*'W',\s*'⇧Q',\s*'⇧W',\s*'D',\s*'F',\s*'X'/.test(buttonOrder));
ok('LDH still minimizes the panel', src.includes("ldh.className = 'chartcheck-ldh'") && /ldh\.addEventListener\('click'[\s\S]*?togglePanelVisibility\(\);/.test(src));
ok('togglePanelVisibility is unchanged', src.includes('function togglePanelVisibility(') && /if \(panelHidden\) showPanel\(\);\s*else hidePanel\(\);/.test(src));
ok('clicking the minimized title bar still restores the panel', /title\.addEventListener\('click'[\s\S]*?if \(!panelHidden\) return;[\s\S]*?showPanel\(\);/.test(src));
ok('help text does not mention a Hide button', !/Hide and LDH/.test(src) && !/L and LDH/.test(src) && !/LDH and the Hide button/.test(src) && !/Hide fills the slot/.test(src) && !/Hide \| Stop/.test(src));
ok('LDH tooltip still describes minimize', /ldh\.title = 'Minimize to the title bar'/.test(src));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

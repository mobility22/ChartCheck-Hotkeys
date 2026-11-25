const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

ok('handleHotkeys is gone', !src.includes('function handleHotkeys') && !src.includes('handleHotkeys'));
ok('no keydown listener for handleHotkeys', !src.includes("addEventListener('keydown', handleHotkeys)"));
ok('recordUserActivity keydown listener remains', src.includes("document.addEventListener('keydown', recordUserActivity, true)") && src.includes('function recordUserActivity('));
ok('isEditableTarget remains for auto-reload editing checks', src.includes('function isEditableTarget(') && /function isEditingFocus\([\s\S]*isEditableTarget\(deepActiveElement\(\)\)/.test(src));
ok('shortcut fields are gone', !/\bshortcut\s*:/.test(src));
ok('tooltips do not use shortcut text', src.includes('button.title = action.hint || action.name;') && !src.includes('action.shortcut'));
ok('no altKey or Alt+ in the userscript', !/altKey/.test(src) && !/Alt\+/.test(src));
ok('no remaining hotkey branches', !/e\.ctrlKey/.test(src) && !/e\.shiftKey/.test(src) && !/e\.altKey/.test(src) && !/key === '/.test(src));
ok('auto-approve confirm does not mention a keyboard shortcut', /confirm\('Start auto-approve\?[\s\S]*?Click Stop to end the run\.'\)/.test(src) && !/Ctrl\+Shift\+R/.test(src));
ok('panel Review button remains', /name: 'Review'[\s\S]*?button: 'R'[\s\S]*?run: startReview/.test(src));
ok('panel buttons and switches still run on click', /button\.addEventListener\('click'[\s\S]*?action\.run\(\)/.test(src));

let grepOut = '';
let grepCode = 0;
try {
    grepOut = execSync('grep -n "altKey\\|Alt+" ' + JSON.stringify(srcPath), {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
} catch (err) {
    grepCode = err.status;
    grepOut = (err.stdout || '') + (err.stderr || '');
}
ok('grep -n "altKey\\|Alt+" returns nothing', grepCode !== 0 && !grepOut.trim());

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

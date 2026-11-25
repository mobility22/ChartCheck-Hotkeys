const fs = require('fs');
const path = require('path');

const srcPath = process.argv[2] || path.join(__dirname, '..', 'ChartCheck-Hotkeys.user.js');
const src = fs.readFileSync(srcPath, 'utf8');
let failed = 0;

function ok(name, cond) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name);
    if (!cond) failed++;
}

ok('@version 3.56', /@version\s+3\.56\b/.test(src));
ok('no leftover 3.55', !/\b3\.55\b/.test(src));
ok('debug status line element is gone', !src.includes('chartcheck-template-status') && !src.includes('templateStatus'));
ok('debug status helpers are gone', !src.includes('updateTemplateStatusLine') && !src.includes('formatTemplateStatus') && !src.includes('siteStatusCode'));
ok('debug status CSS is gone', !src.includes('chartcheck-template-status'));
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));
ok('Auto Review status remains', src.includes("reviewState.className = 'chartcheck-review-state'"));
ok('Roseville and Rancho counts remain', src.includes('chartcheck-roseville-count') && src.includes('chartcheck-rancho-count'));
ok('yellow site frame border unchanged', /#chartcheck-panel \.chartcheck-site-frame\s*\{[\s\S]*?border:\s*2px solid rgba\(255,\s*214,\s*0,\s*0\.7\);/.test(src));
ok('SBRT mute still uses site-muted class', src.includes("row.classList.toggle('chartcheck-site-muted', mute)"));
ok('applyPatientSiteGray still reads totals', /function applyPatientSiteGray\([\s\S]*?readTemplateGrayFractions\(\)/.test(src));
ok('fraction row reader remains', src.includes('function readTotalFractionsFromCells(') && src.includes('function rowCellTextsFromLabel('));
ok('refresh still starts after load and on DOM changes', src.includes('startSiteGrayRefresh') && src.includes('new MutationObserver') && src.includes('setInterval(refreshPatientSiteGray, SITE_GRAY_REFRESH_MS)') && src.includes('SITE_GRAY_REFRESH_MS = 800'));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

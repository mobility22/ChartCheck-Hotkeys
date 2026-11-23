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
ok('reload uses location.reload', /function tryAutoReload\([\s\S]*?location\.reload\(\)/.test(src));
ok('initial delay is 5 minutes', src.includes('const AUTO_RELOAD_MS = 5 * 60 * 1000'));
ok('retry delay is 1 minute', src.includes('const AUTO_RELOAD_RETRY_MS = 60 * 1000'));
ok('activity window is 60 seconds', src.includes('const AUTO_RELOAD_ACTIVITY_MS = 60 * 1000'));
ok('records click and key activity', src.includes("document.addEventListener('keydown', recordUserActivity, true)") && src.includes("document.addEventListener('mousedown', recordUserActivity, true)") && src.includes("document.addEventListener('click', recordUserActivity, true)"));
ok('starts auto-reload at init', /loadSiteCounts\(\);\s*startAutoReload\(\);/.test(src));
ok('no auto-refresh menu toggle', !/GM_registerMenuCommand/.test(src) && !/Auto-refresh \(5 min\)/.test(src));
ok('does not add a panel auto-refresh label', !/statusEl[\s\S]{0,400}Auto-refresh/.test(src) && !/buildStatusContent[\s\S]*Auto-refresh/.test(src));

const start = src.indexOf('    function hadActivityWithin(');
const end = src.indexOf('    function hasUnsavedChangesIndicator(');
ok('hadActivityWithin extract', start >= 0 && end > start);
const hadActivityWithin = new Function(src.slice(start, end) + '\nreturn hadActivityWithin;')();

ok('recent activity is within 60s', hadActivityWithin(1000, 1000 + 59 * 1000, 60 * 1000) === true);
ok('stale activity is not within 60s', hadActivityWithin(1000, 1000 + 60 * 1000, 60 * 1000) === false);
ok('no activity does not count', hadActivityWithin(0, 5000, 60 * 1000) === false);

const postponeStart = src.indexOf('    function shouldPostponeAutoReload(');
const postponeEnd = src.indexOf('    function scheduleAutoReload(');
ok('shouldPostponeAutoReload extract', postponeStart >= 0 && postponeEnd > postponeStart);
const shouldPostponeAutoReload = new Function(
    src.slice(src.indexOf('    function hadActivityWithin('), postponeEnd) +
    '\nreturn shouldPostponeAutoReload;'
)();

function base(overrides) {
    return Object.assign({
        autoReviewActive: false,
        isEditing: false,
        lastActivityAt: 0,
        now: 10 * 60 * 1000,
        activityWindowMs: 60 * 1000,
        hasUnsavedChanges: false
    }, overrides);
}

ok('idle page does not postpone', shouldPostponeAutoReload(base()) === false);
ok('auto review postpones reload', shouldPostponeAutoReload(base({ autoReviewActive: true })) === true);
ok('nonstop/auto review flag postpones while running', shouldPostponeAutoReload(base({ autoReviewActive: true, lastActivityAt: 1, now: 10 * 60 * 1000 })) === true);
ok('editing focus postpones reload', shouldPostponeAutoReload(base({ isEditing: true })) === true);
ok('recent click or keypress postpones reload', shouldPostponeAutoReload(base({ lastActivityAt: 9.5 * 60 * 1000 })) === true);
ok('activity older than 60s does not postpone', shouldPostponeAutoReload(base({ lastActivityAt: 8 * 60 * 1000 })) === false);
ok('unsaved-changes handler postpones reload', shouldPostponeAutoReload(base({ hasUnsavedChanges: true })) === true);
ok('idle after auto review stops does not postpone', shouldPostponeAutoReload(base({ autoReviewActive: false })) === false);

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

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
ok('panel title uses SCRIPT_VERSION', src.includes("titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION"));

ok('Quick Review / NS Review / Slow review actions are gone', !src.includes("name: 'Quick Review'") && !src.includes("name: 'NS Review'") && !src.includes("name: 'Slow review'"));
ok('single Review action on the R button', /name: 'Review'[\s\S]*?button: 'R'[\s\S]*?run: startReview/.test(src) && !/shortcut:/.test(src));
ok('startAutoReview, startSlowAutoReview, and startSlowNonstopReview are gone', !src.includes('function startAutoReview') && !src.includes('function startSlowAutoReview') && !src.includes('function startSlowNonstopReview'));
ok('Review sits right of Auto-approve, then Nonstop and Delay', /const buttonOrder = \[[\s\S]*?'⌃⇧R',\s*'R',\s*'NONSTOP',\s*'DELAY',/.test(src));
ok('keyboard hotkeys are gone', !/handleHotkeys/.test(src) && !/altKey/.test(src) && !/Alt\+/.test(src));

ok('Nonstop defaults off and Delay defaults to 3s', src.includes('let nonstopReview = false;') && src.includes('let reviewDelayMs = REVIEW_DELAY_ON_MS;') && src.includes('const REVIEW_DELAY_ON_MS = 3000;') && src.includes('const REVIEW_DELAY_OFF_MS = 0;'));
ok('review settings persist with GM keys', src.includes("'chartcheck.nonstopReview'") && src.includes("'chartcheck.reviewDelayMs'") && src.includes('function persistReviewSettings(') && src.includes('function loadReviewSettings('));
ok('review loop reads Nonstop and Delay each iteration', /while \(autoReviewActive\) \{[\s\S]*currentReviewDelayMs\(\)[\s\S]*currentNonstop\(\)/.test(src));
ok('Delay 0 still waits for patient change', /while \(autoReviewActive\) \{[\s\S]*waitForPatientIdentityChange\(/.test(src));
ok('Auto-approve keeps a dedicated 3000 ms delay', src.includes('const AUTO_APPROVE_DELAY_MS = 3000') && src.includes('reviewApproveUntilFail(AUTO_APPROVE_DELAY_MS)'));
ok('CONFIG.slowReviewDelay is not used for Review or Auto-approve', !/reviewUntilFail\(CONFIG\.slowReviewDelay/.test(src) && !/reviewApproveUntilFail\(CONFIG\.slowReviewDelay/.test(src));

ok('Hide minimizes instead of display:none', src.includes('chartcheck-minimized') && !src.includes('chartcheck-hidden') && !/#chartcheck-panel\.chartcheck-hidden\s*\{[\s\S]*display:\s*none/.test(src));
ok('minimized panel docks bottom-right', /#chartcheck-panel\.chartcheck-minimized \{[\s\S]*?right:\s*10px;[\s\S]*?bottom:\s*10px;/.test(src));
ok('minimized panel hides help, status, and LDH', src.includes('#chartcheck-panel.chartcheck-minimized .chartcheck-help-wrap') && src.includes('.chartcheck-status') && src.includes('.chartcheck-ldh'));
ok('title click restores the panel', /title\.addEventListener\('click'[\s\S]*?if \(!panelHidden\) return;[\s\S]*?showPanel\(\);/.test(src));
ok('drag is disabled while minimized', /handle\.addEventListener\('mousedown'[\s\S]*?if \(panelHidden\) return;/.test(src));
ok('Alt+L is removed', !/Alt\+L/.test(src) && !/key === 'l'/.test(src));
ok('LDH tooltip no longer mentions Alt+L', /ldh\.title = 'Minimize to the title bar'/.test(src) && !/hint: 'Minimize to the title bar'/.test(src));
ok('minimized state is not persisted', !/GM_setValue\([^)]*panelHidden/.test(src) && !/GM_setValue\([^)]*minimiz/.test(src) && !src.includes('chartcheck.panelHidden') && !src.includes('chartcheck.minimized'));

// Persistence fallbacks
const persistStart = src.indexOf('    function readStoredNonstop(');
const persistEnd = src.indexOf('    function loadReviewSettings(');
ok('readStored helpers extract', persistStart >= 0 && persistEnd > persistStart);
const readFns = new Function(
    'GM_getValue',
    'REVIEW_DELAY_ON_MS',
    'REVIEW_DELAY_OFF_MS',
    src.slice(persistStart, persistEnd) +
    '\nreturn { readStoredNonstop, readStoredReviewDelay };'
)((key, fallback) => readFns.store && Object.prototype.hasOwnProperty.call(readFns.store, key) ? readFns.store[key] : fallback, 3000, 0);

function stored(value) {
    readFns.store = { k: value };
}

stored(true); ok('stored true is Nonstop ON', readFns.readStoredNonstop('k') === true);
stored('true'); ok('stored string true is Nonstop ON', readFns.readStoredNonstop('k') === true);
stored(false); ok('stored false is Nonstop OFF', readFns.readStoredNonstop('k') === false);
stored('maybe'); ok('invalid Nonstop falls back to OFF', readFns.readStoredNonstop('k') === false);
stored(undefined); ok('missing Nonstop falls back to OFF', readFns.readStoredNonstop('missing') === false);
stored(0); ok('stored 0 ms Delay is Off', readFns.readStoredReviewDelay('k') === 0);
stored(3000); ok('stored 3000 ms Delay is 3s', readFns.readStoredReviewDelay('k') === 3000);
stored(1500); ok('invalid Delay falls back to 3s', readFns.readStoredReviewDelay('k') === 3000);
stored('nope'); ok('non-numeric Delay falls back to 3s', readFns.readStoredReviewDelay('k') === 3000);

// Review loop: merged action, mid-run flip, delay 0 skips sleep
const fnSrc = src.slice(src.indexOf('    async function reviewUntilFail'), src.indexOf('    async function reviewApproveUntilFail'));
const prelude = `let autoReviewActive=false,autoReviewMode='',autoReviewCount=0;const APPROVE_CHECK_INTERVAL=5;
const currentNonstop=()=>S.nonstop===true;
const currentReviewDelayMs=()=>Number(S.delayMs)||0;
const updateOverlay=()=>{S.modes.push(autoReviewMode)};
const waitForInitialPatientData=async()=>({id:S.idx});
const sleep=async(ms)=>{S.sleeps.push(ms)};
const findFailLinks=()=>S.charts[S.idx]?[{click:()=>S.cf.push(S.idx)}]:[];
const getCurrentPatientIdentity=()=>({id:S.idx});const detectPatientSite=()=>'roseville';
const loadNextPatient=()=>{if(S.idx+1>=S.charts.length)return false;S.idx++;if(S.flipAt===S.idx){if(Object.prototype.hasOwnProperty.call(S,'flipTo'))S.nonstop=S.flipTo;if(Object.prototype.hasOwnProperty.call(S,'flipDelay'))S.delayMs=S.flipDelay;}return true};
const waitForPatientIdentityChange=async()=>{S.waits.push(S.idx);return {id:S.idx};};
const patientChanged=(a,b)=>a&&b&&a.id!==b.id;
const recordReviewedChart=()=>{autoReviewCount++};const canApproveAndLoadNext=()=>true;
const setReviewNote=()=>{};const ensureReviewTemplates=async()=>'ok';
const console={log:()=>{}};`;
const make = new Function('S', prelude + fnSrc + 'return reviewUntilFail;');
const charts = [false, false, true, false, false, true, false];

async function runReview(startIdx, opts, extra) {
    const S = Object.assign({
        charts, idx: startIdx, cf: [], sleeps: [], waits: [], modes: [],
        nonstop: false, delayMs: 0
    }, extra || {});
    const f = make(S);
    await f(0, opts);
    return S;
}

(async () => {
    let S = await runReview(0, { skipInitialFail: true });
    ok('merged Review stops at first FAIL and clicks it when Nonstop is off', S.idx === 2 && JSON.stringify(S.cf) === JSON.stringify([2]));

    S = await runReview(2, {}, { nonstop: false });
    ok('first-chart FAIL is skipped only when Nonstop is off', S.idx === 5 && JSON.stringify(S.cf) === JSON.stringify([5]));

    S = await runReview(2, { skipInitialFail: true }, { nonstop: true });
    ok('Nonstop ON continues past FAILs and does not click them', S.idx === 6 && JSON.stringify(S.cf) === JSON.stringify([]));

    S = await runReview(0, {}, { nonstop: false, flipAt: 2, flipTo: true });
    ok('mid-run Nonstop ON flip applies from the next chart', S.idx === 6 && JSON.stringify(S.cf) === JSON.stringify([]));

    S = await runReview(0, {}, { delayMs: 3000 });
    ok('Delay 3s sleeps 3000 before each chart', S.sleeps.length > 0 && S.sleeps.every((ms) => ms === 3000));
    ok('Delay 3s still waits for patient change', S.waits.length > 0);

    S = await runReview(0, {}, { delayMs: 0 });
    ok('Delay 0 skips sleep and still waits for patient change', S.sleeps.length === 0 && S.waits.length > 0 && S.idx === 2);

    S = await runReview(0, {}, { delayMs: 3000, flipAt: 1, flipDelay: 0 });
    ok('mid-run Delay flip applies from the next chart', S.sleeps[0] === 3000 && S.sleeps.slice(1).every((ms) => ms === 0));

    // Minimize dock / restore / no L keydown
    const hideStart = src.indexOf('    let savedPanelPosition = null;');
    const hideEnd = src.indexOf('\n    function isEditableTarget(');
    ok('hide/show extract', hideStart >= 0 && hideEnd > hideStart);

    const hideBody = src.slice(hideStart, hideEnd);
    function buildHide(rect, initialStyle) {
        const style = Object.assign({ left: '', top: '', right: '10px', bottom: '10px' }, initialStyle || {});
        const classes = new Set();
        const attrs = {};
        const panel = {
            style,
            classList: {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                contains: (c) => classes.has(c)
            },
            setAttribute: (k, v) => { attrs[k] = v; },
            getBoundingClientRect: () => rect
        };
        const clampState = { n: 0 };
        const wrapped = new Function(
            'panel',
            'requestAnimationFrame',
            'refreshPatientSiteGray',
            'updateSiteFrame',
            'clampPanel',
            'ensureOverlay',
            'let panelHidden = false;\n' + hideBody +
            '\nreturn { hidePanel, showPanel, togglePanelVisibility, dockMinimizedPanel, isHidden: () => panelHidden, getSaved: () => savedPanelPosition };'
        )(
            panel,
            (fn) => fn(),
            () => {},
            () => {},
            () => { clampState.n += 1; },
            () => {}
        );
        // getClamped inside the extract cannot see clampState; wrap it here.
        wrapped.getClamped = () => clampState.n;
        return { wrapped, panel, classes, attrs, style };
    }

    const docked = { left: 800, top: 700, right: 1000, bottom: 740, width: 200, height: 40 };
    const h = buildHide(docked);
    h.wrapped.hidePanel();
    ok('minimize docks bottom-right', h.style.right === '10px' && h.style.bottom === '10px' && h.style.left === 'auto' && h.style.top === 'auto');
    ok('minimize uses chartcheck-minimized', h.classes.has('chartcheck-minimized') && h.wrapped.isHidden() === true);

    const dragged = buildHide(docked, { left: '120px', top: '80px', right: 'auto', bottom: 'auto' });
    dragged.wrapped.hidePanel();
    ok('dragged position is saved while minimized', dragged.wrapped.getSaved() && dragged.wrapped.getSaved().left === '120px' && dragged.wrapped.getSaved().top === '80px');
    ok('minimized bar is docked even after a drag', dragged.style.right === '10px' && dragged.style.bottom === '10px');
    dragged.wrapped.showPanel();
    ok('a click/show restores the previous position', dragged.style.left === '120px' && dragged.style.top === '80px' && dragged.wrapped.isHidden() === false && !dragged.classes.has('chartcheck-minimized'));
    ok('restored dragged panel is clamped on-screen', dragged.wrapped.getClamped() === 1);

    const tight = buildHide({ left: -40, top: -20, right: 160, bottom: 20, width: 200, height: 40 });
    tight.wrapped.hidePanel();
    ok('minimized bar cannot be lost off-screen', tight.style.left === '10px' && tight.style.top === '10px');

    const defaultPos = buildHide(docked);
    defaultPos.wrapped.hidePanel();
    defaultPos.wrapped.showPanel();
    ok('undragged restore returns to the default corner', defaultPos.style.right === '10px' && defaultPos.style.bottom === '10px' && !defaultPos.style.left);

    ok('no handleHotkeys listener', !src.includes('function handleHotkeys') && !src.includes("addEventListener('keydown', handleHotkeys)"));
    ok('activity keydown listener remains', src.includes("document.addEventListener('keydown', recordUserActivity, true)"));

    if (failed) {
        process.exitCode = 1;
        console.log(failed + ' failed');
    } else {
        console.log('all passed');
    }
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});

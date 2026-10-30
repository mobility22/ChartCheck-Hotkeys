// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      3.8
// @match        https://10.231.132.118/*
// @grant        GM_info
// @downloadURL  https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/refs/heads/main/ChartCheck-Hotkeys.user.js
// @updateURL    https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/refs/heads/main/ChartCheck-Hotkeys.user.js
// ==/UserScript==

(function () {
    'use strict';
    const SCRIPT_VERSION = GM_info.script.version;
    // ============================================================
    // Configuration
    // ============================================================

    const CONFIG = {
        patientLoadDelay: 1000,
        patientChangeTimeout: 5000,
        slowReviewDelay: 3000,
        dialogPollMs: 250,
        dialogTimeoutMs: 8000
    };

    // ============================================================
    // State
    // ============================================================

let autoReviewActive = false;
let autoReviewCount = 0;
let autoReviewMode = 'Review';
let busy = false;
const APPROVE_CHECK_INTERVAL = 5;
    
    // ============================================================
    // Utilities
    // ============================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function runLocked(fn) {
        if (busy) return;

        busy = true;

        try {
            await fn();
        } finally {
            busy = false;
        }
    }

    function walkDom(root, callback) {
        for (const el of root.querySelectorAll('*')) {
            callback(el);

            if (el.shadowRoot) {
                walkDom(el.shadowRoot, callback);
            }
        }
    }

    // ============================================================
    // Status Overlay
    // ============================================================

    let overlay;

    function createOverlay() {
        overlay = document.createElement('div');

        overlay.style.cssText = `
            position:fixed;
            bottom:10px;
            right:10px;
            z-index:999999;
            background:rgba(0,0,0,0.85);
            color:#00ff66;
            font-family:monospace;
            font-size:12px;
            padding:8px;
            border-radius:6px;
            pointer-events:none;
            min-width:160px;
        `;

        document.body.appendChild(overlay);
        updateOverlay();
    }

function updateOverlay() {
    if (!overlay) return;

    const statusText =
        !autoReviewActive
            ? 'OFF'
            : autoReviewMode === 'Approve'
                ? 'APPROVE'
                : 'ON';

    const statusColor =
        !autoReviewActive
            ? '#ff6666'
            : autoReviewMode === 'Approve'
                ? '#ff4444'
                : '#00ff66';

    overlay.innerHTML = `
        <b>ChartCheck v${SCRIPT_VERSION}</b><br>
        Auto Review:
        <span style="color:${statusColor}">
            ${statusText}
        </span><br>
        Count: ${autoReviewCount}
    `;
}

    // ============================================================
    // Generic Finders
    // ============================================================

    function findButtons(root = document) {
        const results = [];

        results.push(...root.querySelectorAll('button'));

        walkDom(root, el => {
            if (el.shadowRoot) {
                results.push(...findButtons(el.shadowRoot));
            }
        });

        return results;
    }

    function findSelects(root = document) {
        const results = [];

        results.push(...root.querySelectorAll('select'));

        walkDom(root, el => {
            if (el.shadowRoot) {
                results.push(...findSelects(el.shadowRoot));
            }
        });

        return results;
    }

    function findPatientsSidebar(root = document) {
        let found = null;

        walkDom(root, el => {
            if (
                !found &&
                el.tagName &&
                el.tagName.toLowerCase() === 'patients-sidebar'
            ) {
                found = el;
            }
        });

        return found;
    }

    function findElementByText(text, root = document) {
        let found = null;

        walkDom(root, el => {
            if (
                !found &&
                el.textContent &&
                el.textContent.trim() === text
            ) {
                found = el;
            }
        });

        return found;
    }

    function findAllTextMatches(text, root = document) {
        const results = [];

        walkDom(root, el => {
            if (el.textContent?.includes(text)) {
                results.push(el);
            }
        });

        return results;
    }

    // ============================================================
    // ChartCheck-Specific Finders
    // ============================================================

    function findFailLinks(root = document) {
        const results = [];

        walkDom(root, el => {
            if (el.tagName?.toLowerCase() === 'a') {
                if (el.querySelector('span[pass-state="FAIL"]')) {
                    results.push(el);
                }
            }
        });

        return results;
    }

    function findUncheckedBoxes(root = document) {
        const results = [];

        walkDom(root, el => {
            if (
                el.classList &&
                el.classList.contains('unchecked') &&
                el.classList.contains('fa-square')
            ) {
                results.push(el);
            }
        });

        return results;
    }

    function findFailedUncheckedBoxes() {
        return findUncheckedBoxes().filter(box => {
            try {
                const host = box.parentElement.getRootNode().host;
                const container = host.parentElement;

                return (
                    container &&
                    container.innerHTML.includes('pass-state="FAIL"')
                );
            } catch {
                return false;
            }
        });
    }

    // ============================================================
    // Template Handling
    // ============================================================

    function getTemplateSelects() {
        const validTemplates = [
            'ROS_Standard',
            'ROS_SBRT/SRS',
            'RCO_Standard',
            'RCO_SBRT'
        ];

        return findSelects().filter(select =>
            Array.from(select.options).some(option =>
                validTemplates.includes(option.text)
            )
        );
    }

    function clickButtonByText(text) {
        const btn = findButtons().find(
            button => button.textContent.trim() === text
        );

        if (!btn || btn.disabled) {
            return false;
        }

        btn.click();
        return true;
    }
    
    function canApproveAndLoadNext() {
    const btn = findButtons().find(
        b => b.textContent.trim() === 'Approve and Load Next'
    );

    return btn && !btn.disabled;
    }

    function clickYesUpdate() {
        const timer = setInterval(() => {
            const yes = findElementByText('Yes, update');

            if (yes) {
                yes.click();
                clearInterval(timer);
            }
        }, CONFIG.dialogPollMs);

        setTimeout(() => {
            clearInterval(timer);
        }, CONFIG.dialogTimeoutMs);
    }

    function setTemplate(templateName) {
        const selects = getTemplateSelects();

        selects.forEach(select => {
            const option = Array.from(select.options).find(
                o => o.text === templateName
            );

            if (!option) return;

            select.value = option.value;

            select.dispatchEvent(
                new Event('change', { bubbles: true })
            );
        });

        setTimeout(() => {
            if (clickButtonByText('Apply Check Templates Update')) {
                clickYesUpdate();
            }
        }, 500);
    }

    // ============================================================
    // Patient Navigation
    // ============================================================

    function scrollCurrentPatientIntoView() {
        const sidebar = findPatientsSidebar();

        if (!sidebar) return;

        const patientId = sidebar.getAttribute('currentpatientid');

        if (!patientId) return;

        const matches = findAllTextMatches(patientId);

        const currentRow = matches.find(
            el =>
                el.tagName &&
                el.tagName.toLowerCase() === 'li' &&
                el.hasAttribute('current')
        );

        currentRow?.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    function loadNextPatient() {
        const button = findButtons().find(
            b => b.textContent.trim() === 'Load Next Patient'
        );

        if (!button || button.disabled) {
            return false;
        }

        button.click();

        setTimeout(
            scrollCurrentPatientIntoView,
            CONFIG.patientLoadDelay
        );

        return true;
    }

    async function waitForPatientChange(
        oldUrl,
        timeout = CONFIG.patientChangeTimeout
    ) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            if (location.href !== oldUrl) {
                await sleep(300);
                return true;
            }

            await sleep(50);
        }

        return false;
    }

    // ============================================================
    // Auto Review
    // ============================================================

    async function reviewUntilFail(delay = 0) {
        if (autoReviewActive) {
            return;
        }

autoReviewCount = 0;
autoReviewMode = 'Review';
autoReviewActive = true;
updateOverlay();

        try {
while (autoReviewActive) {



    const fail = findFailLinks()[0];

    if (fail) {
        console.log(
            `Auto Review stopped: FAIL found after ${autoReviewCount} charts`
        );

        fail.click();
        break;
    }

                if (delay > 0) {
                    await sleep(delay);
                }

                const oldUrl = location.href;

                if (!loadNextPatient()) {
                    break;
                }

const changed = await waitForPatientChange(oldUrl);

if (!changed) {
    break;
}
autoReviewCount++;
updateOverlay();

if (
    autoReviewCount > 0 &&
    autoReviewCount % APPROVE_CHECK_INTERVAL === 0
) {
    if (!canApproveAndLoadNext()) {
        console.log(
            `Auto Review stopped: queue exhausted after ${autoReviewCount} charts`
        );
        break;
    }
}

            }
        } finally {
            autoReviewActive = false;
            autoReviewMode = 'Review';
            updateOverlay();
        }
    }
async function reviewApproveUntilFail(delay = 0) {
    if (autoReviewActive) {
        return;
    }

    autoReviewCount = 0;
    autoReviewMode = 'Approve';
    autoReviewActive = true;
    updateOverlay();

    try {
        while (autoReviewActive) {

            const fail = findFailLinks()[0];

            if (fail) {
                console.log(
                    `Auto Approve stopped: FAIL found after ${autoReviewCount} charts`
                );

                fail.click();
                break;
            }

            if (delay > 0) {
                await sleep(delay);
            }

            const approveBtn = findButtons().find(
                b => b.textContent.trim() === 'Approve and Load Next'
            );

            if (!approveBtn || approveBtn.disabled) {
                console.log(
                    `Auto Approve stopped: queue exhausted after ${autoReviewCount} charts`
                );
                break;
            }

            approveBtn.click();

            autoReviewCount++;
            updateOverlay();

            await sleep(1500);
        }
    } finally {
        autoReviewActive = false;
        autoReviewMode = 'Review';
        updateOverlay();
    }
}

    // ============================================================
    // Hotkeys
    // ============================================================

    function handleHotkeys(e) {
        const key = e.key.toLowerCase();

        if (e.altKey && key === 's') {
            e.preventDefault();
            loadNextPatient();
        }

        if (e.altKey && key === 'z') {
            history.back();
        }

        if (e.altKey && key === 'a') {
            const button = findButtons().find(
                b => b.textContent.trim() === 'Approve and Load Next'
            );

            if (button && !button.disabled) {
                button.click();
            }
        }

        if (e.altKey && key === 'd') {
            findFailLinks()[0]?.click();
        }

        if (e.altKey && key === 'f') {
            findFailedUncheckedBoxes()[0]?.click();
        }

        if (e.altKey && key === 'q') {
            setTemplate('ROS_Standard');
        }

        if (e.altKey && key === 'w') {
            setTemplate('ROS_SBRT/SRS');
        }

        if (e.shiftKey && key === 'q') {
            setTemplate('RCO_Standard');
        }

        if (e.shiftKey && key === 'w') {
            setTemplate('RCO_SBRT');
        }

        if (e.altKey && key === 'c') {
            runLocked(() => reviewUntilFail());
        }
if (e.ctrlKey && e.shiftKey && key === 'r') {
    e.preventDefault();

    runLocked(() =>
        reviewApproveUntilFail(CONFIG.slowReviewDelay)
    );
}
        if (e.altKey && key === 'r') {
            runLocked(() =>
                reviewUntilFail(CONFIG.slowReviewDelay)
            );
        }

        if (e.altKey && key === 'x') {
            autoReviewActive = false;
            updateOverlay();
        }
    }

    // ============================================================
    // Init
    // ============================================================

    window.addEventListener('load', () => {
        createOverlay();
    });

    document.addEventListener('keydown', handleHotkeys);

console.log(`ChartCheck Hotkeys v${SCRIPT_VERSION} Loaded`);
})();

// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      3.11
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

    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function getCurrentPatientIdentity() {
        const sidebar = findPatientsSidebar();
        const id = normalizeText(sidebar?.getAttribute('currentpatientid') || '');
        let name = '';

        if (id) {
            const currentRow = findAllTextMatches(id).find(
                el =>
                    el.tagName &&
                    el.tagName.toLowerCase() === 'li' &&
                    el.hasAttribute('current')
            );

            name = normalizeText(currentRow?.textContent || '');
        } else if (sidebar) {
            let currentRow = null;

            walkDom(sidebar, el => {
                if (
                    !currentRow &&
                    el.tagName &&
                    el.tagName.toLowerCase() === 'li' &&
                    el.hasAttribute('current')
                ) {
                    currentRow = el;
                }
            });

            name = normalizeText(currentRow?.textContent || '');
        }

        return { id, name };
    }

    function hasPatientIdentity(identity) {
        return !!(identity && (identity.id || identity.name));
    }

    function patientChanged(before, after) {
        if (!hasPatientIdentity(after)) return false;

        if (before?.id && after.id) {
            return before.id !== after.id;
        }

        if (before?.name && after.name) {
            return before.name !== after.name;
        }

        return !hasPatientIdentity(before);
    }

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

    function loadNextPatient(requireActive = false) {
        const button = findButtons().find(
            b => b.textContent.trim() === 'Load Next Patient'
        );

        if (!button || button.disabled) {
            return false;
        }

        if (requireActive && !autoReviewActive) {
            return false;
        }

        button.click();

        setTimeout(
            scrollCurrentPatientIntoView,
            CONFIG.patientLoadDelay
        );

        return true;
    }

    async function waitForInitialPatientData(
        timeout = CONFIG.patientChangeTimeout
    ) {
        const start = Date.now();
        const initial = getCurrentPatientIdentity();

        if (!autoReviewActive) return null;
        if (hasPatientIdentity(initial)) return initial;

        while (Date.now() - start < timeout) {
            await sleep(50);
            if (!autoReviewActive) return null;

            const current = getCurrentPatientIdentity();

            if (hasPatientIdentity(current)) {
                await sleep(CONFIG.patientLoadDelay);
                if (!autoReviewActive) return null;
                return getCurrentPatientIdentity();
            }
        }

        return null;
    }

    async function waitForPatientIdentityChange(
        before,
        timeout = CONFIG.patientChangeTimeout
    ) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            if (!autoReviewActive) return null;

            const current = getCurrentPatientIdentity();

            if (patientChanged(before, current)) {
                const seen = current;

                await sleep(CONFIG.patientLoadDelay);
                if (!autoReviewActive) return null;

                const settled = getCurrentPatientIdentity();

                if (patientChanged(before, settled)) return settled;
                if (!hasPatientIdentity(settled)) return seen;
                return null;
            }

            await sleep(50);
        }

        return null;
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
            const initialPatient = await waitForInitialPatientData();

            if (!autoReviewActive || !initialPatient) {
                return;
            }

            while (autoReviewActive) {
                if (delay > 0) {
                    await sleep(delay);
                    if (!autoReviewActive) break;
                }

                const fail = findFailLinks()[0];

                if (fail) {
                    if (!autoReviewActive) break;

                    console.log(
                        `Auto Review stopped: FAIL found after ${autoReviewCount} charts`
                    );

                    fail.click();
                    break;
                }

                const beforePatient = getCurrentPatientIdentity();

                if (!autoReviewActive) break;
                if (!loadNextPatient(true)) {
                    break;
                }

                const nextPatient = await waitForPatientIdentityChange(beforePatient);

                if (!autoReviewActive) break;
                if (!nextPatient || !patientChanged(beforePatient, nextPatient)) {
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
            const initialPatient = await waitForInitialPatientData();

            if (!autoReviewActive || !initialPatient) {
                return;
            }

            while (autoReviewActive) {
                if (delay > 0) {
                    await sleep(delay);
                    if (!autoReviewActive) break;
                }

                const fail = findFailLinks()[0];

                if (fail) {
                    if (!autoReviewActive) break;

                    console.log(
                        `Auto Approve stopped: FAIL found after ${autoReviewCount} charts`
                    );

                    fail.click();
                    break;
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

                const beforePatient = getCurrentPatientIdentity();

                if (!autoReviewActive) break;
                approveBtn.click();

                autoReviewCount++;
                updateOverlay();

                const nextPatient = await waitForPatientIdentityChange(beforePatient);

                if (!autoReviewActive) break;
                if (!nextPatient || !patientChanged(beforePatient, nextPatient)) {
                    console.log(
                        `Auto Approve stopped: patient unchanged after ${autoReviewCount} charts`
                    );
                    break;
                }
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

    function isEditableTarget(node) {
        if (!node || node.nodeType !== 1) return false;

        const tag = node.tagName.toLowerCase();

        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return true;
        }

        return !!node.isContentEditable;
    }

    function handleHotkeys(e) {
        if (e.repeat) return;

        const path = typeof e.composedPath === 'function'
            ? e.composedPath()
            : [e.target];

        if (path.some(isEditableTarget)) return;

        const key = e.key.toLowerCase();

        if (e.altKey && key === 's') {
            e.preventDefault();
            loadNextPatient();
        }

        if (e.altKey && key === 'z') {
            e.preventDefault();
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

            if (autoReviewActive) {
                if (autoReviewMode === 'Approve') {
                    autoReviewActive = false;
                    updateOverlay();
                }
                return;
            }

            if (!confirm('Start auto-approve? This will repeatedly click Approve and Load Next. Press Ctrl+Shift+R again to stop.')) {
                return;
            }

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

        if (e.altKey && key === 'h') {
            e.preventDefault();
            alert(
                'ChartCheck Hotkeys\n' +
                '\n' +
                'Alt+S — Load the next patient\n' +
                'Alt+Z — Go back\n' +
                'Alt+A — Click Approve and Load Next once\n' +
                'Alt+D — Open the first FAIL link\n' +
                'Alt+F — Click the first failed unchecked box\n' +
                'Alt+Q — Apply the ROS_Standard template\n' +
                'Alt+W — Apply the ROS_SBRT/SRS template\n' +
                'Alt+C — Start auto-review: load the next patient until a FAIL is found\n' +
                'Alt+R — Start slow auto-review: pause on each chart, then continue until a FAIL is found\n' +
                'Alt+X — Stop auto-review or auto-approve immediately\n' +
                'Shift+Q — Apply the RCO_Standard template\n' +
                'Shift+W — Apply the RCO_SBRT template\n' +
                'Ctrl+Shift+R — Start auto-approve after a confirm. Clicks Approve and Load Next until a FAIL, the queue ends, or the patient does not change. Press again to stop\n' +
                'Alt+H — Show this help'
            );
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

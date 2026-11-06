// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      3.14
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
            font-size:20px;
            padding:14px 28px;
            border-radius:8px;
            pointer-events:none;
            min-width:160px;
        `;

        document.body.appendChild(overlay);
        updateOverlay();
    }

    function updateOverlay() {
        if (!overlay) return;

        let statusText = 'ON';
        let statusColor = '#00ff66';

        if (!autoReviewActive) {
            statusText = 'OFF';
            statusColor = '#ff6666';
        } else if (autoReviewMode === 'Approve') {
            statusText = 'APPROVE';
            statusColor = '#ff4444';
        } else if (autoReviewMode === 'Nonstop') {
            statusText = 'NONSTOP';
            statusColor = '#66ccff';
        }

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

    async function reviewUntilFail(delay = 0, options = {}) {
        if (autoReviewActive) {
            return;
        }

        const continueOnFail = options.continueOnFail === true;

        autoReviewCount = 0;
        autoReviewMode = continueOnFail ? 'Nonstop' : 'Review';
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

                    if (!continueOnFail) {
                        console.log(
                            `Auto Review stopped: FAIL found after ${autoReviewCount} charts`
                        );

                        fail.click();
                        break;
                    }

                    console.log(
                        `Nonstop review continuing past FAIL after ${autoReviewCount} charts`
                    );
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
                        const label = continueOnFail
                            ? 'Nonstop review'
                            : 'Auto Review';

                        console.log(
                            `${label} stopped: queue exhausted after ${autoReviewCount} charts`
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
    // Actions
    // Hotkeys and help-panel buttons call these same functions.
    // ============================================================

    function goBack() {
        history.back();
    }

    function approveOnce() {
        const button = findButtons().find(
            b => b.textContent.trim() === 'Approve and Load Next'
        );

        if (button && !button.disabled) {
            button.click();
        }
    }

    function openFirstFail() {
        findFailLinks()[0]?.click();
    }

    function clickFirstFailedUnchecked() {
        findFailedUncheckedBoxes()[0]?.click();
    }

    function applyRosStandard() {
        setTemplate('ROS_Standard');
    }

    function applyRosSbrt() {
        setTemplate('ROS_SBRT/SRS');
    }

    function applyRcoStandard() {
        setTemplate('RCO_Standard');
    }

    function applyRcoSbrt() {
        setTemplate('RCO_SBRT');
    }

    function startAutoReview() {
        runLocked(() => reviewUntilFail());
    }

    function startSlowAutoReview() {
        runLocked(() =>
            reviewUntilFail(CONFIG.slowReviewDelay)
        );
    }

    function startSlowNonstopReview() {
        runLocked(() =>
            reviewUntilFail(CONFIG.slowReviewDelay, {
                continueOnFail: true
            })
        );
    }

    function startAutoApprove() {
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

    function stopAuto() {
        autoReviewActive = false;
        updateOverlay();
    }

    // ============================================================
    // Help Panel
    // ============================================================

    let helpPanel;

    // Keyword labels only. Full behavior:
    // S load the next patient, Z go back, A approve once,
    // D open the first FAIL link, F click the first failed unchecked box,
    // Q ROS_Standard, W ROS_SBRT/SRS, Shift+Q RCO_Standard, Shift+W RCO_SBRT,
    // C fast review until FAIL (clicks the FAIL link and stops),
    // R slow review until FAIL (same stop, CONFIG.slowReviewDelay pause),
    // E nonstop slow review: keep loading the next patient past FAIL
    //   and do not click the FAIL link,
    // Ctrl+Shift+R auto-approve until FAIL, X stop, H toggle this panel.
    const HELP_ACTIONS = [
        {
            name: 'Next',
            button: 'S',
            shortcut: 'Alt+S',
            run: loadNextPatient
        },
        {
            name: 'Back',
            button: 'Z',
            shortcut: 'Alt+Z',
            run: goBack
        },
        {
            name: 'Approve',
            button: 'A',
            shortcut: 'Alt+A',
            run: approveOnce
        },
        {
            name: 'Fail link',
            button: 'D',
            shortcut: 'Alt+D',
            run: openFirstFail
        },
        {
            name: 'Fail box',
            button: 'F',
            shortcut: 'Alt+F',
            run: clickFirstFailedUnchecked
        },
        {
            name: 'ROS Standard',
            button: 'Q',
            shortcut: 'Alt+Q',
            run: applyRosStandard
        },
        {
            name: 'ROS SBRT',
            button: 'W',
            shortcut: 'Alt+W',
            run: applyRosSbrt
        },
        {
            name: 'RCO Standard',
            button: '⇧Q',
            shortcut: 'Shift+Q',
            run: applyRcoStandard
        },
        {
            name: 'RCO SBRT',
            button: '⇧W',
            shortcut: 'Shift+W',
            run: applyRcoSbrt
        },
        {
            name: 'Review',
            button: 'C',
            shortcut: 'Alt+C',
            run: startAutoReview
        },
        {
            name: 'Slow review',
            button: 'R',
            shortcut: 'Alt+R',
            run: startSlowAutoReview
        },
        {
            name: 'Nonstop review',
            button: 'E',
            shortcut: 'Alt+E',
            run: startSlowNonstopReview
        },
        {
            name: 'Auto-approve',
            button: '⌃⇧R',
            shortcut: 'Ctrl+Shift+R',
            run: startAutoApprove
        },
        {
            name: 'Stop',
            button: 'X',
            shortcut: 'Alt+X',
            run: stopAuto
        },
        {
            name: 'Help',
            button: 'H',
            shortcut: 'Alt+H',
            run: toggleHelpPanel
        }
    ];

    function orderedHelpActions() {
        const actions = HELP_ACTIONS.filter(action => action.button !== 'H');

        actions.sort((a, b) => a.name.localeCompare(b.name, 'en'));

        const toggle = HELP_ACTIONS.find(action => action.button === 'H');

        if (toggle) {
            actions.push(toggle);
        }

        return actions;
    }

    function installHelpStyles() {
        if (document.getElementById('chartcheck-help-style')) return;

        const style = document.createElement('style');
        style.id = 'chartcheck-help-style';
        style.textContent = `
            #chartcheck-help-panel {
                position: fixed;
                top: 8px;
                left: 8px;
                z-index: 1000000;
                display: none;
                flex-direction: column;
                width: max-content;
                max-width: calc(100vw - 16px);
                max-height: calc(100vh - 16px);
                background: rgba(0, 0, 0, 0.92);
                color: #e6e6e6;
                font-family: monospace;
                font-size: 11px;
                line-height: 1.15;
                border: 1px solid #00ff66;
                border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                pointer-events: auto;
                overflow: hidden;
            }

            #chartcheck-help-panel .chartcheck-help-title {
                flex: 0 0 auto;
                padding: 2px 7px;
                background: #00ff66;
                color: #04140c;
                font-weight: bold;
                font-size: 11px;
                line-height: 1.2;
                cursor: move;
                user-select: none;
                -webkit-user-select: none;
            }

            #chartcheck-help-panel .chartcheck-help-list {
                display: grid;
                grid-template-columns: max-content max-content;
                overflow: auto;
                pointer-events: auto;
            }

            #chartcheck-help-panel .chartcheck-help-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                padding: 1px 6px;
                border-top: 1px solid rgba(0, 255, 102, 0.18);
                pointer-events: auto;
            }

            #chartcheck-help-panel .chartcheck-help-row:nth-child(odd):not(.chartcheck-help-span) {
                border-right: 1px solid rgba(0, 255, 102, 0.18);
            }

            #chartcheck-help-panel .chartcheck-help-span {
                grid-column: 1 / -1;
                justify-content: flex-start;
                gap: 8px;
            }

            #chartcheck-help-panel .chartcheck-help-span .chartcheck-help-name {
                flex: 0 0 auto;
            }

            #chartcheck-help-panel .chartcheck-help-name {
                flex: 1 1 auto;
                min-width: 0;
                white-space: nowrap;
            }

            #chartcheck-help-panel .chartcheck-help-btn {
                flex: 0 0 auto;
                min-width: 3.4em;
                margin: 0;
                padding: 0 4px;
                font-family: monospace;
                font-size: 11px;
                font-weight: bold;
                line-height: 1.35;
                text-align: center;
                white-space: nowrap;
                color: #00ff66;
                background: #101010;
                border: 1px solid #00ff66;
                border-radius: 3px;
                cursor: pointer;
                pointer-events: auto;
            }

            #chartcheck-help-panel .chartcheck-help-btn:hover,
            #chartcheck-help-panel .chartcheck-help-btn:focus {
                background: #00ff66;
                color: #04140c;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function helpIsOpen() {
        if (!helpPanel) return false;

        return window.getComputedStyle(helpPanel).display !== 'none';
    }

    function makeHelpDraggable(panel, handle) {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        function onMove(e) {
            if (!dragging) return;

            const maxLeft = Math.max(0, window.innerWidth - 48);
            const maxTop = Math.max(0, window.innerHeight - 32);
            const left = Math.min(Math.max(0, e.clientX - offsetX), maxLeft);
            const top = Math.min(Math.max(0, e.clientY - offsetY), maxTop);

            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            e.preventDefault();
        }

        function onUp() {
            if (!dragging) return;

            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('blur', onUp);

        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            const rect = panel.getBoundingClientRect();

            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            dragging = true;

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
    }

    function createHelpPanel() {
        if (helpPanel || !document.body) return;

        installHelpStyles();

        const panel = document.createElement('div');
        panel.id = 'chartcheck-help-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'ChartCheck Hotkeys');
        panel.style.display = 'none';

        const title = document.createElement('div');
        title.className = 'chartcheck-help-title';
        title.textContent = 'Hotkeys';

        const list = document.createElement('div');
        list.className = 'chartcheck-help-list';

        orderedHelpActions().forEach(action => {
            const row = document.createElement('div');
            row.className = 'chartcheck-help-row';

            if (action.button === 'H') {
                row.classList.add('chartcheck-help-span');
            }

            const name = document.createElement('div');
            name.className = 'chartcheck-help-name';
            name.textContent = action.name;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chartcheck-help-btn';
            button.textContent = action.button;
            button.title = action.shortcut;
            button.setAttribute('aria-label', action.name);

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                action.run();
            });

            row.appendChild(name);
            row.appendChild(button);
            list.appendChild(row);
        });

        panel.appendChild(title);
        panel.appendChild(list);
        panel.addEventListener('mousedown', (event) => event.stopPropagation());
        panel.addEventListener('click', (event) => event.stopPropagation());
        makeHelpDraggable(panel, title);

        helpPanel = panel;
        document.body.appendChild(panel);
    }

    function ensureHelpPanel() {
        if (!helpPanel) {
            createHelpPanel();
        }
    }

    function toggleHelpPanel() {
        ensureHelpPanel();

        if (!helpPanel) return;

        helpPanel.style.display = helpIsOpen() ? 'none' : 'flex';
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

        // Hotkeys always run, whether or not the help panel is open.

        if (e.altKey && key === 's') {
            e.preventDefault();
            loadNextPatient();
        }

        if (e.altKey && key === 'z') {
            e.preventDefault();
            goBack();
        }

        if (e.altKey && key === 'a') {
            approveOnce();
        }

        if (e.altKey && key === 'd') {
            openFirstFail();
        }

        if (e.altKey && key === 'f') {
            clickFirstFailedUnchecked();
        }

        if (e.altKey && key === 'q') {
            applyRosStandard();
        }

        if (e.altKey && key === 'w') {
            applyRosSbrt();
        }

        if (e.shiftKey && key === 'q') {
            applyRcoStandard();
        }

        if (e.shiftKey && key === 'w') {
            applyRcoSbrt();
        }

        if (e.altKey && key === 'c') {
            startAutoReview();
        }

        if (e.ctrlKey && e.shiftKey && key === 'r') {
            e.preventDefault();
            startAutoApprove();
        }

        if (e.altKey && key === 'r') {
            startSlowAutoReview();
        }

        if (e.altKey && key === 'e') {
            e.preventDefault();
            startSlowNonstopReview();
        }

        if (e.altKey && key === 'x') {
            stopAuto();
        }

        if (e.altKey && key === 'h') {
            e.preventDefault();
            toggleHelpPanel();
        }
    }

    // ============================================================
    // Init
    // ============================================================

    window.addEventListener('load', () => {
        createOverlay();
        ensureHelpPanel();
    });

    document.addEventListener('keydown', handleHotkeys);

    console.log(`ChartCheck Hotkeys v${SCRIPT_VERSION} Loaded`);
})();

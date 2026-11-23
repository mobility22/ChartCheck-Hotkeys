// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      3.43
// @match        https://10.231.132.118/*
// @grant        GM_info
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
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

    // Auto-approve keeps this fixed delay. Review uses the Delay switch.
    const AUTO_APPROVE_DELAY_MS = 3000;
    const REVIEW_DELAY_ON_MS = 3000;
    const REVIEW_DELAY_OFF_MS = 0;

    // ============================================================
    // State
    // ============================================================

    let autoReviewActive = false;
    let autoReviewCount = 0;
    let rosevilleReviewCount = 0;
    let ranchoReviewCount = 0;
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
    // Floating window
    // One panel: version title, button list, then status.
    // LDH minimizes the panel to its title bar in the
    // bottom-right corner. Clicking that bar restores the panel
    // at its previous position.
    // ============================================================

    let panel;
    let statusEl;
    let helpList;
    let siteFrame;
    let panelHidden = false;
    let trackedIdentity = '';
    let settledObservation = null;
    let baselineObservation = null;
    let awaitingFreshBanner = false;
    let copiedIdentity = '';
    let autoCopyBusy = false;
    let retryTimer = null;
    let retryAttempt = 0;
    let failureLoggedFor = '';
    let exhaustedKey = '';

    function updateOverlay() {
        if (!statusEl) return;

        const reviewState = statusEl.querySelector('.chartcheck-review-state');
        const rosevilleEl = statusEl.querySelector('.chartcheck-roseville-count');
        const ranchoEl = statusEl.querySelector('.chartcheck-rancho-count');

        if (!reviewState || !rosevilleEl || !ranchoEl) return;

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

        reviewState.textContent = statusText;
        reviewState.style.color = statusColor;
        rosevilleEl.textContent = String(rosevilleReviewCount);
        ranchoEl.textContent = String(ranchoReviewCount);
    }

    function setReviewNote(text) {
        if (!statusEl) return;

        const note = statusEl.querySelector('.chartcheck-review-note');

        if (!note) return;

        const value = (text || '').trim();

        note.textContent = value;
        note.classList.toggle('chartcheck-review-note-on', !!value);
    }

    function buildStatusContent(status) {
        status.appendChild(document.createTextNode('Auto Review: '));

        const reviewState = document.createElement('span');
        reviewState.className = 'chartcheck-review-state';
        status.appendChild(reviewState);
        status.appendChild(document.createElement('br'));

        status.appendChild(document.createTextNode('Roseville Count: '));

        const rosevilleEl = document.createElement('span');
        rosevilleEl.className = 'chartcheck-roseville-count';
        status.appendChild(rosevilleEl);
        status.appendChild(document.createElement('br'));

        const ranchoLine = document.createElement('span');
        ranchoLine.className = 'chartcheck-rancho-line';
        ranchoLine.appendChild(document.createTextNode('Rancho Count: '));

        const ranchoEl = document.createElement('span');
        ranchoEl.className = 'chartcheck-rancho-count';
        ranchoLine.appendChild(ranchoEl);

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'chartcheck-count-reset';
        resetBtn.textContent = '↺';
        resetBtn.title = 'Reset Roseville and Rancho counts';
        resetBtn.setAttribute('aria-label', 'Reset counts');

        resetBtn.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        resetBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetPersistedSiteCounts();
        });

        ranchoLine.appendChild(resetBtn);
        status.appendChild(ranchoLine);

        const reviewNote = document.createElement('div');
        reviewNote.className = 'chartcheck-review-note';
        status.appendChild(reviewNote);
    }

    const SITE_COUNT_KEYS = {
        roseville: 'chartcheck.rosevilleReviewCount',
        rancho: 'chartcheck.ranchoReviewCount'
    };

    function readStoredCount(key) {
        if (typeof GM_getValue !== 'function') return 0;

        const value = Number(GM_getValue(key, 0));

        if (!Number.isFinite(value) || value <= 0) return 0;

        return Math.floor(value);
    }

    function loadSiteCounts() {
        rosevilleReviewCount = readStoredCount(SITE_COUNT_KEYS.roseville);
        ranchoReviewCount = readStoredCount(SITE_COUNT_KEYS.rancho);
    }

    function persistSiteCounts() {
        if (typeof GM_setValue !== 'function') return;

        GM_setValue(SITE_COUNT_KEYS.roseville, rosevilleReviewCount);
        GM_setValue(SITE_COUNT_KEYS.rancho, ranchoReviewCount);
    }

    // Only the panel reset control clears the site counts. Starting a
    // review, reloading, or a new day must not.
    function resetPersistedSiteCounts() {
        rosevilleReviewCount = 0;
        ranchoReviewCount = 0;
        persistSiteCounts();
        updateOverlay();
        console.log('counters reset');
    }

    // autoReviewCount stays the per-run total, including charts whose
    // center line is neither Roseville nor Rancho. Those unknown charts
    // are not added to either site count. The run total is what the
    // every-fifth queue check and the stop logs already use. Site
    // counts accumulate until the panel reset control is clicked.
    function recordReviewedChart(site) {
        autoReviewCount++;

        if (site === 'roseville') {
            rosevilleReviewCount++;
        } else if (site === 'rancho') {
            ranchoReviewCount++;
        }

        persistSiteCounts();
    }

    // ============================================================
    // Generic Finders
    // ============================================================

    const REVIEW_SETTING_KEYS = {
        nonstop: 'chartcheck.nonstopReview',
        delayMs: 'chartcheck.reviewDelayMs'
    };

    let nonstopReview = false;
    let reviewDelayMs = REVIEW_DELAY_ON_MS;

    function currentNonstop() {
        return nonstopReview === true;
    }

    function currentReviewDelayMs() {
        return reviewDelayMs === REVIEW_DELAY_OFF_MS
            ? REVIEW_DELAY_OFF_MS
            : REVIEW_DELAY_ON_MS;
    }

    function readStoredNonstop(key) {
        if (typeof GM_getValue !== 'function') return false;

        const value = GM_getValue(key, false);

        if (value === true || value === 'true' || value === 1 || value === '1') {
            return true;
        }

        return false;
    }

    function readStoredReviewDelay(key) {
        if (typeof GM_getValue !== 'function') return REVIEW_DELAY_ON_MS;

        const value = Number(GM_getValue(key, REVIEW_DELAY_ON_MS));

        if (value === REVIEW_DELAY_OFF_MS || value === REVIEW_DELAY_ON_MS) {
            return value;
        }

        return REVIEW_DELAY_ON_MS;
    }

    function loadReviewSettings() {
        nonstopReview = readStoredNonstop(REVIEW_SETTING_KEYS.nonstop);
        reviewDelayMs = readStoredReviewDelay(REVIEW_SETTING_KEYS.delayMs);
    }

    function persistReviewSettings() {
        if (typeof GM_setValue !== 'function') return;

        GM_setValue(REVIEW_SETTING_KEYS.nonstop, currentNonstop());
        GM_setValue(REVIEW_SETTING_KEYS.delayMs, currentReviewDelayMs());
    }

    function nonstopSwitchLabel() {
        return currentNonstop() ? 'ON' : 'OFF';
    }

    function delaySwitchLabel() {
        return currentReviewDelayMs() === REVIEW_DELAY_OFF_MS ? 'Off' : '3s';
    }

    function isReviewSwitchOn(id) {
        if (id === 'nonstop') return currentNonstop();
        if (id === 'delay') return currentReviewDelayMs() !== REVIEW_DELAY_OFF_MS;

        return false;
    }

    function refreshReviewSwitchLabels() {
        if (!helpList) return;

        helpList.querySelectorAll('[data-review-switch]').forEach(row => {
            const button = row.querySelector('.chartcheck-help-btn');
            const label = row.querySelector('.chartcheck-switch-label');
            const id = row.dataset.reviewSwitch;

            if (!button) return;

            const on = isReviewSwitchOn(id);

            row.classList.toggle('chartcheck-switch-on', on);
            button.classList.toggle('chartcheck-switch-on', on);

            if (label) {
                if (id === 'nonstop') label.textContent = nonstopSwitchLabel();
                if (id === 'delay') label.textContent = delaySwitchLabel();
            }
        });
    }

    function toggleNonstop() {
        nonstopReview = !currentNonstop();
        persistReviewSettings();
        refreshReviewSwitchLabels();

        if (autoReviewActive) {
            autoReviewMode = currentNonstop() ? 'Nonstop' : 'Review';
            updateOverlay();
        }
    }

    function toggleReviewDelay() {
        reviewDelayMs = currentReviewDelayMs() === REVIEW_DELAY_ON_MS
            ? REVIEW_DELAY_OFF_MS
            : REVIEW_DELAY_ON_MS;
        persistReviewSettings();
        refreshReviewSwitchLabels();
    }

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

    const VALID_CHECK_TEMPLATES = [
        'ROS_Standard',
        'ROS_SBRT/SRS',
        'RCO_Standard',
        'RCO_SBRT'
    ];

    function getTemplateSelects() {
        return findSelects().filter(select =>
            Array.from(select.options).some(option =>
                VALID_CHECK_TEMPLATES.includes(option.text)
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

    function selectedTemplateText(select) {
        if (!select || select.selectedIndex == null || select.selectedIndex < 0) {
            return '';
        }

        const option = select.options[select.selectedIndex];

        return (option && option.text ? String(option.text) : '').trim();
    }

    function isTemplateSelectFilled(select) {
        return VALID_CHECK_TEMPLATES.includes(selectedTemplateText(select));
    }

    function isValidSiteTemplate(text) {
        return VALID_CHECK_TEMPLATES.includes((text || '').trim());
    }

    function isOakTemplateDefault(text) {
        return /^OAK_/i.test((text || '').trim());
    }

    function isRedTemplateColor(color) {
        if (color == null) return false;

        const value = String(color).trim().toLowerCase();

        if (!value || value === 'transparent' || value === 'inherit' || value === 'none') {
            return false;
        }

        if (
            value === 'rgba(0, 0, 0, 0)'
            || value === 'rgb(0, 0, 0, 0)'
            || value === 'rgba(0,0,0,0)'
        ) {
            return false;
        }

        let r;
        let g;
        let b;
        const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(value);

        if (rgb) {
            r = Number(rgb[1]);
            g = Number(rgb[2]);
            b = Number(rgb[3]);
        } else {
            const hex = /^#([0-9a-f]{3,8})$/.exec(value);

            if (hex) {
                const h = hex[1];

                if (h.length === 3 || h.length === 4) {
                    r = parseInt(h[0] + h[0], 16);
                    g = parseInt(h[1] + h[1], 16);
                    b = parseInt(h[2] + h[2], 16);
                } else {
                    r = parseInt(h.slice(0, 2), 16);
                    g = parseInt(h.slice(2, 4), 16);
                    b = parseInt(h.slice(4, 6), 16);
                }
            } else if (
                value === 'red'
                || value === 'darkred'
                || value === 'crimson'
                || value === 'firebrick'
                || value === 'tomato'
                || value === 'orangered'
            ) {
                return true;
            } else {
                return false;
            }
        }

        if (![r, g, b].every(Number.isFinite)) return false;

        return r >= 140 && r > g + 40 && r > b + 40 && g <= 160 && b <= 160;
    }

    function elementBackgroundColor(el) {
        if (!el || el.nodeType !== 1) return '';

        if (el.style && el.style.backgroundColor) {
            return el.style.backgroundColor;
        }

        if (typeof getComputedStyle === 'function') {
            try {
                const style = getComputedStyle(el);

                if (style) {
                    return style.backgroundColor || style.background || '';
                }
            } catch (err) {}
        }

        return '';
    }

    function hasRedTemplateBackground(select) {
        let node = select;

        for (let i = 0; i < 8 && node && node !== document; i++) {
            if (isRedTemplateColor(elementBackgroundColor(node))) {
                return true;
            }

            const parent = node.parentElement;
            let next = parent;

            if (!next && typeof node.getRootNode === 'function') {
                const root = node.getRootNode();

                next = root && root.host ? root.host : null;
            }

            node = next;
        }

        return false;
    }

    function isTemplateSelectUnselected(select) {
        const text = selectedTemplateText(select);

        if (isValidSiteTemplate(text)) return false;

        return isOakTemplateDefault(text) || hasRedTemplateBackground(select);
    }

    function parsePlanTreeLabel(text) {
        const value = normalizeText(text);

        if (!value || value.length > 120) return '';

        const match = /^plan:\s*(.+)$/i.exec(value);

        return match ? normalizeText(match[1]) : '';
    }

    function normalizePlanName(name) {
        const value = normalizeText(name);

        if (!value) return '';

        return value.replace(/^plan:\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function planNamesMatch(left, right) {
        const a = normalizePlanName(left);
        const b = normalizePlanName(right);

        return !!a && !!b && a === b;
    }

    function isPlanNameLabel(text) {
        const value = normalizeText(text).toLowerCase().replace(/:$/, '');

        return value === 'plan name';
    }

    function readPlanNameFromCells(cells) {
        if (!cells || !cells.length) return '';

        for (let i = 0; i < cells.length; i++) {
            if (!isPlanNameLabel(cells[i])) continue;

            for (let j = i + 1; j < cells.length && j <= i + 3; j++) {
                const next = normalizeText(cells[j]);

                if (!next) continue;
                if (isPlanNameLabel(next)) break;
                if (isDeliveredTotalFractionsLabel(next)) break;
                if (isOverviewFieldLabel(next)) break;

                return next;
            }
        }

        return '';
    }

    // Match each template dropdown to its own Plan Overview table
    // by plan name (tree "Plan: X" vs the table "Plan name" cell),
    // or by document order when a name is missing. Filled plans are
    // left untouched and are not used for the fraction decision.
    function resolvePlanTemplateContexts(plans, overviews) {
        const list = Array.isArray(plans) ? plans : [];
        const tables = Array.isArray(overviews) ? overviews : [];

        return list.map((plan, index) => {
            if (plan && plan.filled) {
                return {
                    filled: true,
                    unselected: false,
                    tableFound: false,
                    totalFractions: null
                };
            }

            const unselected = !plan || plan.unselected !== false;
            const planName = plan && plan.planName ? plan.planName : '';
            let table = null;

            if (planName) {
                table = tables.find(item => planNamesMatch(item && item.planName, planName)) || null;
            }

            if (!table) {
                const byOrder = tables[index] || null;
                const orderName = byOrder && byOrder.planName;

                if (!planName || !normalizePlanName(orderName)) {
                    table = byOrder;
                }
            }

            if (!unselected) {
                return {
                    filled: false,
                    unselected: false,
                    tableFound: false,
                    totalFractions: null
                };
            }

            if (!table) {
                return {
                    filled: false,
                    unselected: true,
                    tableFound: false,
                    totalFractions: null
                };
            }

            return {
                filled: false,
                unselected: true,
                tableFound: true,
                totalFractions: table.totalFractions
            };
        });
    }

    // Decide what Review should do for unselected plans only.
    // Unselected means a red template dropdown and/or an OAK_*
    // default. Already-selected ROS_/RCO_ templates are ignored.
    // Each unselected plan uses its own overview table's total
    // fractions. Standard is always possible for the current site.
    // SBRT is also possible when that plan's total fractions are
    // 5 or fewer, so that case is left for a manual pick.
    function templateReviewDecision(site, planStates) {
        const states = Array.isArray(planStates) ? planStates : [];
        const autoIndexes = [];
        let pending = false;
        let shouldStop = false;

        states.forEach((state, index) => {
            if (!state || state.filled) return;

            pending = true;

            if (state.unselected === false) {
                shouldStop = true;
                return;
            }

            const totalFractions = state.totalFractions;
            const knownFx = state.tableFound
                && totalFractions != null
                && Number.isFinite(totalFractions)
                && totalFractions > 0;

            if (!knownFx || totalFractions <= 5) {
                shouldStop = true;
                return;
            }

            autoIndexes.push(index);
        });

        if (!pending) {
            return { action: 'ok' };
        }

        const knownSite = site === 'roseville' || site === 'rancho';

        if (!knownSite || shouldStop) {
            return {
                action: 'stop',
                message: 'Template needed'
            };
        }

        return {
            action: 'auto',
            templateName: site === 'roseville' ? 'ROS_Standard' : 'RCO_Standard',
            unfilledIndexes: autoIndexes
        };
    }

    function checksNeedTemplatePrompt() {
        return !!findElementByText(
            'Select check templates on the right to calculate checks.'
        );
    }

    function hasCheckResults() {
        let found = false;

        walkDom(document, el => {
            if (!found && el.getAttribute && el.getAttribute('pass-state')) {
                found = true;
            }
        });

        return found;
    }

    function isLoadNextEnabled() {
        const button = findButtons().find(
            b => b.textContent.trim() === 'Load Next Patient'
        );

        return !!(button && !button.disabled);
    }

    function areChecksReady() {
        if (checksNeedTemplatePrompt()) return false;

        return hasCheckResults() || isLoadNextEnabled();
    }

    function assignTemplateToSelects(templateName, selects) {
        let assigned = 0;
        let missed = 0;

        selects.forEach(select => {
            const option = Array.from(select.options).find(
                o => o.text === templateName
            );

            if (!option) {
                missed++;
                return;
            }

            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            assigned++;
        });

        return { assigned, missed };
    }

    async function waitForChecksReady(timeoutMs = 20000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            if (!autoReviewActive) return false;
            if (areChecksReady()) return true;
            await sleep(CONFIG.dialogPollMs);
        }

        return areChecksReady();
    }

    async function applyTemplateAndWait(templateName, selects) {
        const result = assignTemplateToSelects(templateName, selects);

        if (!result.assigned || result.missed) return false;

        await sleep(500);
        if (!autoReviewActive) return false;

        if (clickButtonByText('Apply Check Templates Update')) {
            clickYesUpdate();
        }

        return waitForChecksReady();
    }

    function countInnermostFractionsLabels(root) {
        let count = 0;

        if (!root) return 0;

        walkDom(root, el => {
            if (!el.tagName) return;

            const text = collectDeepText(el);

            if (!isDeliveredTotalFractionsLabel(text)) return;
            if (!isInnermostDeepText(el, text) && text !== 'Delivered / Total Fractions') {
                return;
            }

            for (const child of el.children || []) {
                if (isDeliveredTotalFractionsLabel(collectDeepText(child))) {
                    return;
                }
            }

            count++;
        });

        return count;
    }

    function collectPlanTreeNames(root) {
        const names = [];

        if (!root) return names;

        const directText = collectDeepText(root);
        const direct = parsePlanTreeLabel(directText);

        if (direct && isInnermostDeepText(root, directText)) {
            names.push(direct);
            return names;
        }

        walkDom(root, el => {
            if (!el.tagName) return;

            const text = collectDeepText(el);
            const name = parsePlanTreeLabel(text);

            if (name && isInnermostDeepText(el, text)) {
                names.push(name);
            }
        });

        return names;
    }

    function findPlanNameNearSelect(select) {
        let node = select;

        for (let i = 0; i < 14 && node && node !== document; i++) {
            let sib = node.previousElementSibling;

            while (sib) {
                const names = collectPlanTreeNames(sib);

                if (names.length === 1) return names[0];

                sib = sib.previousElementSibling;
            }

            const own = collectPlanTreeNames(node);

            if (own.length === 1) return own[0];

            const parent = node.parentElement;
            let next = parent;

            if (!next && typeof node.getRootNode === 'function') {
                const root = node.getRootNode();

                next = root && root.host ? root.host : null;
            }

            node = next;
        }

        return '';
    }

    function readOverviewRecordFromFractionsLabel(label) {
        const rowTexts = rowCellTextsFromLabel(label);
        let totalFractions = rowTexts ? readTotalFractionsFromCells(rowTexts) : null;
        let planName = '';
        let node = label;

        for (let i = 0; i < 12 && node; i++) {
            if (node !== label && countInnermostFractionsLabels(node) > 1) {
                break;
            }

            const cells = [];

            collectOverviewCells(node, cells);

            if (!planName) planName = readPlanNameFromCells(cells);
            if (totalFractions == null) {
                totalFractions = readTotalFractionsFromCells(cells);
            }

            if (planName && totalFractions != null) {
                return { planName, totalFractions };
            }

            const parent = node.parentElement;
            let next = parent;

            if (!next) {
                const root = typeof node.getRootNode === 'function'
                    ? node.getRootNode()
                    : null;

                next = root && root.host ? root.host : null;
            }

            node = next;
        }

        if (totalFractions == null && !planName) return null;

        return { planName, totalFractions };
    }

    function findOverviewPlanRecords() {
        const records = [];

        overviewDocuments().forEach(doc => {
            walkDom(doc, el => {
                if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                    return;
                }

                const text = collectDeepText(el);

                if (!isDeliveredTotalFractionsLabel(text)) return;
                if (!isInnermostDeepText(el, text) && text !== 'Delivered / Total Fractions') {
                    for (const child of el.children) {
                        if (isDeliveredTotalFractionsLabel(collectDeepText(child))) {
                            return;
                        }
                    }
                }

                const record = readOverviewRecordFromFractionsLabel(el);

                if (record && record.totalFractions != null) {
                    records.push(record);
                }
            });
        });

        return records;
    }

    function describeTemplateSelect(select) {
        const text = selectedTemplateText(select);
        const filled = isValidSiteTemplate(text);
        const unselected = isTemplateSelectUnselected(select);

        return {
            text,
            filled,
            unselected,
            planName: findPlanNameNearSelect(select)
        };
    }

    async function ensureReviewTemplates() {
        const selects = getTemplateSelects();

        if (selects.length === 0 && checksNeedTemplatePrompt()) {
            setReviewNote('Template needed');
            return 'stop';
        }

        const plans = selects.map(describeTemplateSelect);
        const contexts = resolvePlanTemplateContexts(plans, findOverviewPlanRecords());
        const decision = templateReviewDecision(
            detectPatientSite(),
            contexts
        );

        if (decision.action === 'ok') return 'ok';

        if (decision.action === 'stop') {
            setReviewNote(decision.message);
            return 'stop';
        }

        const targets = (decision.unfilledIndexes || [])
            .map(index => selects[index])
            .filter(Boolean);

        const applied = await applyTemplateAndWait(decision.templateName, targets);

        if (!applied) {
            setReviewNote('Template needed: checks not ready, pick manually');
            return 'stop';
        }

        return 'ok';
    }

    // ============================================================
    // Patient Navigation
    // ============================================================

    function normalizeText(text) {
        return (text || '')
            .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\ufeff]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

    // The center line sits under the patient name in the middle of the
    // chart, for example "Roseville Cancer Center, ROS Radiation Oncology, …"
    // or "Rancho Cordova Cancer Center, RCO Radiation Oncology, …".
    // Roseville / Rancho in that line is the site. ROS and RCO are
    // department abbreviations on the same line and are not the site.
    function currentPatientId() {
        const sidebar = findPatientsSidebar();
        const fromSidebar = normalizeText(
            sidebar?.getAttribute('currentpatientid') || ''
        );

        if (fromSidebar) return fromSidebar;

        const match = (location.pathname || '').match(/\/patient\/([^/]+)/i);

        return match ? decodeURIComponent(match[1]) : '';
    }

    function ancestorChain(el) {
        const chain = [];
        let node = el;

        while (node) {
            chain.push(node);

            const root = typeof node.getRootNode === 'function'
                ? node.getRootNode()
                : null;

            if (root && root.host) {
                node = root.host;
            } else {
                node = node.parentElement || null;
            }
        }

        return chain;
    }

    function isInPatientsSidebar(el) {
        return ancestorChain(el).some(node =>
            node.tagName &&
            node.tagName.toLowerCase() === 'patients-sidebar'
        );
    }

    function isInHotkeyPanel(el) {
        return ancestorChain(el).some(node => node.id === 'chartcheck-panel');
    }

    function findCurrentPatientRow() {
        const sidebar = findPatientsSidebar();

        if (!sidebar) return null;

        const id = normalizeText(sidebar.getAttribute('currentpatientid') || '');
        let currentRow = null;

        if (id) {
            currentRow = findAllTextMatches(id).find(el =>
                el.tagName &&
                el.tagName.toLowerCase() === 'li' &&
                el.hasAttribute('current') &&
                isInPatientsSidebar(el)
            ) || null;
        }

        if (currentRow) return currentRow;

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

        return currentRow;
    }

    // Comparison key only. The parenthetical here is not the copied MRN.
    function nameKey(text) {
        return normalizeText(String(text || '').replace(/\([^)]*\)/g, ' '));
    }

    function isMrnToken(value) {
        if (!value) return false;
        if (/cancer|oncology|roseville|rancho/i.test(value)) return false;
        if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(value)) return false;
        if (/[A-Za-z]/.test(value) && /[,\s]/.test(value)) return false;

        return true;
    }

    // Only a single parenthetical on the name heading counts. Any other
    // parenthesis on the page is ignored, and more than one on the
    // heading is ambiguous, so that case copies nothing.
    function singleParentheticalMrn(text) {
        const matches = String(text || '').match(/\(([^)]*)\)/g);

        if (!matches || matches.length !== 1) return '';

        const inner = matches[0].slice(1, -1).trim();

        if (!isMrnToken(inner)) return '';

        const outside = nameKey(text);

        if (!outside || !/[A-Za-z]/.test(outside)) return '';

        return inner;
    }

    function mrnFromLabel(scope) {
        if (!scope) return '';

        let found = '';

        walkDom(scope, el => {
            if (found || !el.tagName || el.children.length) return;

            const text = (el.textContent || '').trim();
            const inline = text.match(/^MRN\s*[:#]\s*(.*)$/i)
                || text.match(/^Medical Record(?: Number)?\s*[:#]\s*(.*)$/i);

            if (inline && isMrnToken(inline[1].trim())) {
                found = inline[1].trim();
                return;
            }

            if (!/^MRN\s*:?\s*$/i.test(text) && !/^Medical Record(?: Number)?\s*:?\s*$/i.test(text)) {
                return;
            }

            const next = el.nextElementSibling;
            const value = (next?.textContent || '').trim();

            if (isMrnToken(value)) found = value;
        });

        return found;
    }

    function tightHeading(node) {
        const raw = node.textContent || '';
        const key = nameKey(raw);

        if (!key || normalizeText(raw).length > 200) return null;

        for (const child of node.children) {
            const childRaw = child.textContent || '';

            if (
                nameKey(childRaw) === key &&
                normalizeText(childRaw).length <= 200
            ) {
                const tighter = tightHeading(child);

                if (tighter) return tighter;
            }
        }

        return node;
    }

    // The name heading directly above the center line. A matching name
    // anywhere else, including another patient with the same name, is
    // not this banner.
    function findStructuralBannerHeading() {
        const row = findCurrentPatientRow();
        const rowName = nameKey(row ? row.textContent : '');

        if (!rowName) return null;

        const lines = findCenterLineElements();

        for (const line of lines) {
            let node = line.previousElementSibling;
            let steps = 0;

            while (node && steps < 5) {
                if (!isInPatientsSidebar(node) && !isInHotkeyPanel(node)) {
                    const text = node.textContent || '';

                    if (
                        nameKey(text) === rowName &&
                        normalizeText(text).length < 400 &&
                        !isCenterLine(text)
                    ) {
                        const heading = tightHeading(node);

                        if (heading && nameKey(heading.textContent || '') === rowName) {
                            return heading;
                        }
                    }
                }

                node = node.previousElementSibling;
                steps += 1;
            }
        }

        return null;
    }

    function bannerScope(heading) {
        const parent = heading.parentElement;

        if (
            parent &&
            !isInPatientsSidebar(parent) &&
            !isInHotkeyPanel(parent) &&
            normalizeText(parent.textContent).length <= 600
        ) {
            return parent;
        }

        return heading;
    }

    function bannerObservation() {
        const heading = findStructuralBannerHeading();

        if (!heading) {
            return { headingText: '', label: '', paren: '' };
        }

        const label = mrnFromLabel(bannerScope(heading));

        return {
            headingText: normalizeText(heading.textContent || ''),
            label: label,
            paren: label ? '' : singleParentheticalMrn(heading.textContent || '')
        };
    }

    function sameObservation(left, right) {
        if (!left || !right) return false;

        return left.headingText === right.headingText &&
            left.label === right.label &&
            left.paren === right.paren;
    }

    // baseline is the previous patient's banner. Until this banner
    // actually changes, there is no verified MRN. A label that is still
    // the previous value is not replaced by a parenthetical guess.
    function selectFreshMrn(obs, baseline) {
        if (!obs.headingText && !obs.label && !obs.paren) return '';

        if (!baseline) {
            if (obs.label) return obs.label;

            return obs.paren || '';
        }

        const headingMoved = obs.headingText !== baseline.headingText;
        const labelMoved = obs.label !== baseline.label;

        if (!headingMoved && !labelMoved) return '';

        if (baseline.label) {
            if (!labelMoved) return '';
            if (obs.label) return obs.label;

            return headingMoved ? (obs.paren || '') : '';
        }

        if (obs.label) return obs.label;
        if (headingMoved) return obs.paren || '';

        return '';
    }

    async function writeClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
            try {
                const result = GM_setClipboard(text, 'text');

                if (result && typeof result.then === 'function') {
                    await result;
                }

                return true;
            } catch (err) {
                return false;
            }
        }

        const clipboard = navigator.clipboard;

        if (!clipboard || typeof clipboard.writeText !== 'function') {
            return false;
        }

        try {
            await clipboard.writeText(text);
            return true;
        } catch (err) {
            return false;
        }
    }

    const MRN_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

    function clearMrnRetry() {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        retryAttempt = 0;
    }

    function maybeAutoCopyPatientMrn() {
        if (autoCopyBusy || retryTimer) return;

        const identity = currentPatientId();

        if (!identity) return;

        if (identity !== trackedIdentity) {
            const previousIdentity = trackedIdentity;

            trackedIdentity = identity;
            clearMrnRetry();
            failureLoggedFor = '';
            exhaustedKey = '';
            baselineObservation = previousIdentity ? settledObservation : null;
            awaitingFreshBanner = !!previousIdentity;
        }

        const obs = bannerObservation();

        if (copiedIdentity === identity && !awaitingFreshBanner) {
            settledObservation = obs;
            return;
        }

        if (awaitingFreshBanner && sameObservation(obs, baselineObservation)) {
            return;
        }

        const mrn = selectFreshMrn(
            obs,
            awaitingFreshBanner ? baselineObservation : null
        );

        if (!mrn) return;

        const key = identity + '\n' + mrn;

        if (exhaustedKey === key) return;

        awaitingFreshBanner = false;
        startMrnCopy(identity, mrn, key, obs);
    }

    async function startMrnCopy(identity, mrn, key, obs) {
        if (autoCopyBusy) return;

        autoCopyBusy = true;
        let copied = false;

        try {
            copied = await writeClipboard(mrn);
        } finally {
            autoCopyBusy = false;
        }

        if (currentPatientId() !== identity) return;

        if (copied) {
            copiedIdentity = identity;
            settledObservation = obs;
            baselineObservation = null;
            awaitingFreshBanner = false;
            exhaustedKey = '';
            retryAttempt = 0;
            failureLoggedFor = '';
            return;
        }

        if (failureLoggedFor !== key) {
            console.log('ChartCheck Hotkeys: MRN copy failed');
            failureLoggedFor = key;
        }

        if (retryAttempt >= MRN_RETRY_DELAYS_MS.length) {
            exhaustedKey = key;
            return;
        }

        const delay = MRN_RETRY_DELAYS_MS[retryAttempt];

        retryAttempt += 1;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            maybeAutoCopyPatientMrn();
        }, delay);
    }

    function isCenterLine(text) {
        return /cancer center[, ]+(?:ros|rco)\s+radiation oncology/i.test(
            normalizeText(text)
        );
    }

    // Higher scores are the subtitle directly under this patient's name.
    // A center line elsewhere on the chart scores 0 and is ignored.
    function centerLineScore(el, id) {
        if (!id) return 0;

        let node = el;
        let best = 0;

        for (let depth = 0; depth < 6 && node; depth += 1) {
            const prev = node.previousElementSibling;
            const prevIsSidebar = prev && (
                (prev.tagName && prev.tagName.toLowerCase() === 'patients-sidebar') ||
                isInPatientsSidebar(prev)
            );

            if (prev && !prevIsSidebar && normalizeText(prev.textContent).includes(id)) {
                const prevLen = normalizeText(prev.textContent).length;

                if (prevLen < 200) {
                    best = Math.max(best, 100 - depth);
                }
            }

            const parent = node.parentElement;

            if (!parent) {
                const root = typeof node.getRootNode === 'function'
                    ? node.getRootNode()
                    : null;

                node = root && root.host ? root.host : null;
                continue;
            }

            const parentText = normalizeText(parent.textContent);

            if (parentText.includes(id) && parentText.length < 500) {
                best = Math.max(best, 80 - depth);
            }

            node = parent;
        }

        return best;
    }

    function findCenterLineElements() {
        const matches = [];

        walkDom(document, el => {
            if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                return;
            }

            const text = normalizeText(el.textContent);

            if (text.length > 240 || !isCenterLine(text)) return;

            for (const child of el.children) {
                if (isCenterLine(child.textContent)) return;
            }

            matches.push(el);
        });

        return matches;
    }

    function findCenterLineText() {
        const matches = findCenterLineElements();

        if (!matches.length) return '';

        const id = currentPatientId();
        let bestEl = null;
        let bestScore = 0;

        matches.forEach(el => {
            const score = centerLineScore(el, id);

            if (score > bestScore) {
                bestScore = score;
                bestEl = el;
            }
        });

        if (!bestEl) return '';

        return normalizeText(bestEl.textContent);
    }

    function classifyCenterLine(text) {
        const value = normalizeText(text).toLowerCase();
        const roseville = value.includes('roseville');
        const rancho = value.includes('rancho');

        if (roseville && !rancho) return 'roseville';
        if (rancho && !roseville) return 'rancho';

        return 'unknown';
    }

    function detectPatientSite() {
        return classifyCenterLine(findCenterLineText());
    }

    // Total fractions come from the Delivered / Total Fractions row
    // on the Prescription / Plan Overview. The Rx cell is often a
    // lone total (for example 3). The Plan cell is N / M (for
    // example 2 / 3), and M may sit in a child span, so the Plan
    // cell must be read as a whole. The plan M is used when present;
    // otherwise the Rx total is used.
    function isDeliveredTotalFractionsLabel(text) {
        const value = normalizeText(text)
            .toLowerCase()
            .replace(/[／⁄|]/g, '/');

        return /delivered\s*\/\s*total\s+fractions?/.test(value)
            || /delivered\s*\/?\s*total\s*\/?\s*fractions?/.test(value);
    }

    function isOverviewFieldLabel(text) {
        const value = normalizeText(text).toLowerCase();

        if (!value || isDeliveredTotalFractionsLabel(value)) return false;

        return /^(dose\s*\/\s*fraction|dose per fraction|total dose|energy|frequency|scheduling|gating|technique|modality|beam energy|approval)\b/.test(value);
    }

    function isDoseUnitContext(text, start, end) {
        const value = text || '';
        const after = value.slice(end);
        const around = value.slice(Math.max(0, start - 16), Math.min(value.length, end + 16));

        if (/^\s*(cgy|centigray|gy|fx)\b/i.test(after)) return true;
        if (/\dcgy\s*\//i.test(around) || /\/\s*fx\b/i.test(around)) return true;
        if (/(cgy|centigray|\bgy\b)/i.test(around) && !/\b(fractions?|fx)\b/i.test(around)) {
            return true;
        }

        return false;
    }

    function parseFractionPairTotal(text) {
        const value = normalizeText(text).replace(/[／⁄|]/g, '/');

        if (!value) return null;

        const explicit = [];
        const implicit = [];
        let match;

        const ofRe = /(\d+)\s+of\s+(\d+)(?:\s*(fx|fractions?))?/gi;

        while ((match = ofRe.exec(value))) {
            const total = Number(match[2]);

            if (!Number.isFinite(total) || total <= 0) continue;
            if (isDoseUnitContext(value, match.index, match.index + match[0].length)) {
                continue;
            }

            if (match[3]) explicit.push(total);
            else implicit.push(total);
        }

        const slashRe = /(\d+)\s*\/\s*(\d+)(?:\s*(fx|fractions?))?/g;

        while ((match = slashRe.exec(value))) {
            const total = Number(match[2]);

            if (!Number.isFinite(total) || total <= 0) continue;
            if (isDoseUnitContext(value, match.index, match.index + match[0].length)) {
                continue;
            }

            if (match[3]) explicit.push(total);
            else implicit.push(total);
        }

        if (explicit.length) return explicit[explicit.length - 1];
        if (implicit.length) return implicit[implicit.length - 1];

        return null;
    }

    function loneFractionInteger(text) {
        const value = normalizeText(text);

        if (!/^\d+$/.test(value)) return null;

        const total = Number(value);

        return Number.isFinite(total) && total > 0 && total <= 200
            ? total
            : null;
    }

    function loneTotalAfterLabel(text) {
        const value = normalizeText(text);

        if (!value) return null;

        const labelRe = /delivered\s*\/?\s*total\s*\/?\s*fractions?|total\s+fractions?/i;
        const label = labelRe.exec(value);

        if (!label) return null;

        const after = value.slice(label.index + label[0].length).trim();
        const nums = [];
        const numRe = /\d+/g;
        let match;

        while ((match = numRe.exec(after))) {
            const total = Number(match[0]);

            if (Number.isFinite(total) && total > 0 && total <= 200) {
                nums.push(total);
            }
        }

        if (!nums.length || nums.length > 2) return null;

        return nums[nums.length - 1];
    }

    function parseTotalFractionsFromRowText(text) {
        const pair = parseFractionPairTotal(text);

        if (pair != null) return pair;

        return loneTotalAfterLabel(text);
    }

    function readTotalFractionsFromCells(cells) {
        if (!cells || !cells.length) return null;

        for (let i = 0; i < cells.length; i++) {
            if (!isDeliveredTotalFractionsLabel(cells[i])) continue;

            const row = [];

            for (let j = i + 1; j < cells.length && j <= i + 6; j++) {
                const next = cells[j];

                if (!next) break;
                if (isDeliveredTotalFractionsLabel(next)) break;
                if (isOverviewFieldLabel(next)) break;

                row.push(next);
            }

            const fromPlan = parseFractionPairTotal(row.join(' '));

            if (fromPlan != null) return fromPlan;

            if (row.length) {
                const fromRx = loneFractionInteger(row[0]);

                if (fromRx != null) return fromRx;
            }

            const fromLabel = parseTotalFractionsFromRowText(
                [cells[i]].concat(row).join(' ')
            );

            if (fromLabel != null) return fromLabel;
        }

        // If the exact row label was not found, still accept an
        // explicit "N of M fractions" (or N / M fractions) cell,
        // but never a dose field.
        for (let i = 0; i < cells.length; i++) {
            const value = normalizeText(cells[i]);

            if (isOverviewFieldLabel(value)) continue;

            const ofMatch = /(\d+)\s+of\s+(\d+)\s*(fx|fractions?)\b/i.exec(value);

            if (ofMatch && !isDoseUnitContext(value, ofMatch.index, ofMatch.index + ofMatch[0].length)) {
                const total = Number(ofMatch[2]);

                if (Number.isFinite(total) && total > 0) return total;
            }
        }

        return null;
    }

    function collectDeepText(root) {
        const parts = [];

        function visit(node) {
            if (!node) return;

            if (node.nodeType === 3) {
                parts.push(node.nodeValue || '');
                return;
            }

            if (node.nodeType !== 1) return;
            if (node.id === 'chartcheck-panel') return;

            const tag = (node.tagName || '').toLowerCase();

            if (tag === 'script' || tag === 'style' || tag === 'noscript') {
                return;
            }

            if (node.shadowRoot) visit(node.shadowRoot);

            for (const child of node.childNodes) visit(child);
        }

        visit(root);
        return normalizeText(parts.join(' '));
    }

    function isInnermostDeepText(el, text) {
        if (el.shadowRoot) {
            for (const child of el.shadowRoot.children) {
                if (collectDeepText(child) === text) return false;
            }
        }

        for (const child of el.children) {
            if (collectDeepText(child) === text) return false;
        }

        return true;
    }

    function collectOverviewCells(root, cells) {
        walkDom(root, el => {
            if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                return;
            }

            const text = collectDeepText(el);

            if (!text || text.length > 240) return;
            if (!isInnermostDeepText(el, text)) return;

            cells.push(text);
        });
    }

    function overviewDocuments() {
        const docs = [];
        const seen = new Set();

        function add(doc) {
            if (!doc || seen.has(doc)) return;

            seen.add(doc);
            docs.push(doc);

            walkDom(doc, el => {
                if (!el.tagName || el.tagName.toLowerCase() !== 'iframe') {
                    return;
                }

                try {
                    if (el.contentDocument) add(el.contentDocument);
                } catch (err) {}
            });
        }

        add(document);
        return docs;
    }

    function readTotalFractionsFromLabel(label) {
        let node = label;

        for (let i = 0; i < 8 && node; i++) {
            const parent = node.parentElement;
            let next = parent;

            if (!next) {
                const root = typeof node.getRootNode === 'function'
                    ? node.getRootNode()
                    : null;

                next = root && root.host ? root.host : null;
            }

            if (!next) break;

            const children = Array.from(next.children || []);
            const index = children.indexOf(node);
            const slice = (index >= 0 ? children.slice(index, index + 3) : children)
                .map(child => collectDeepText(child))
                .filter(Boolean);
            const sliced = parseTotalFractionsFromRowText(slice.join(' '));

            if (sliced != null) return sliced;

            const joined = collectDeepText(next);

            if (joined.length <= 400) {
                const total = parseTotalFractionsFromRowText(joined);

                if (total != null) return total;
            }

            node = next;
        }

        return null;
    }

    function rowCellTextsFromLabel(label) {
        let node = label;

        for (let i = 0; i < 8 && node; i++) {
            const parent = node.parentElement;
            let next = parent;

            if (!next) {
                const root = typeof node.getRootNode === 'function'
                    ? node.getRootNode()
                    : null;

                next = root && root.host ? root.host : null;
            }

            if (!next) break;

            const children = Array.from(next.children || []);

            if (children.length >= 2) {
                const texts = children
                    .map(child => collectDeepText(child))
                    .filter(Boolean);
                const index = texts.findIndex(isDeliveredTotalFractionsLabel);

                if (index >= 0) return texts.slice(index);
            }

            node = next;
        }

        return null;
    }

    function readTotalFractions() {
        let fromRow = null;

        overviewDocuments().forEach(doc => {
            if (fromRow != null) return;

            walkDom(doc, el => {
                if (fromRow != null) return;
                if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                    return;
                }

                const text = collectDeepText(el);

                if (!isDeliveredTotalFractionsLabel(text)) return;
                if (!isInnermostDeepText(el, text) && text !== 'Delivered / Total Fractions') {
                    for (const child of el.children) {
                        if (isDeliveredTotalFractionsLabel(collectDeepText(child))) {
                            return;
                        }
                    }
                }

                const rowTexts = rowCellTextsFromLabel(el);

                if (rowTexts) {
                    const total = readTotalFractionsFromCells(rowTexts);

                    if (total != null) fromRow = total;
                }
            });
        });

        if (fromRow != null) return fromRow;

        const cells = [];

        overviewDocuments().forEach(doc => {
            collectOverviewCells(doc, cells);
        });

        const fromCells = readTotalFractionsFromCells(cells);

        if (fromCells != null) return fromCells;

        let fallback = null;

        overviewDocuments().forEach(doc => {
            if (fallback != null) return;

            walkDom(doc, el => {
                if (fallback != null) return;
                if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                    return;
                }

                const text = collectDeepText(el);

                if (!isDeliveredTotalFractionsLabel(text)) return;

                for (const child of el.children) {
                    if (isDeliveredTotalFractionsLabel(collectDeepText(child))) {
                        return;
                    }
                }

                fallback = readTotalFractionsFromLabel(el);
            });
        });

        return fallback;
    }

    function shouldMuteSiteSbrt(totalFractions) {
        return totalFractions != null && totalFractions > 5;
    }

    function isSiteTemplateMuted(site, totalFractions, sitePair, isSbrt) {
        if (!sitePair) return false;

        if (
            (site === 'roseville' && sitePair === 'rco')
            || (site === 'rancho' && sitePair === 'ros')
        ) {
            return true;
        }

        if (
            isSbrt
            && shouldMuteSiteSbrt(totalFractions)
            && (
                (site === 'roseville' && sitePair === 'ros')
                || (site === 'rancho' && sitePair === 'rco')
            )
        ) {
            return true;
        }

        return false;
    }

    function isTemplateHotkeyMuted(sitePair, isSbrt) {
        return isSiteTemplateMuted(
            detectPatientSite(),
            readTotalFractions(),
            sitePair,
            isSbrt
        );
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

        // A FAIL on the starting chart is skipped when Nonstop is off,
        // so Review can be pressed again on the chart the last run stopped
        // on. Later FAILs still stop when Nonstop is off. The Nonstop and
        // Delay switches are read each iteration so a mid-run flip applies
        // from the next chart.
        let skipFailOnThisChart = Object.prototype.hasOwnProperty.call(
            options,
            'skipInitialFail'
        )
            ? options.skipInitialFail === true
            : !currentNonstop();

        autoReviewCount = 0;
        autoReviewMode = currentNonstop() ? 'Nonstop' : 'Review';
        autoReviewActive = true;
        setReviewNote('');
        updateOverlay();

        try {
            const initialPatient = await waitForInitialPatientData();

            if (!autoReviewActive || !initialPatient) {
                return;
            }

            while (autoReviewActive) {
                const delayNow = currentReviewDelayMs();

                if (delayNow > 0) {
                    await sleep(delayNow);
                    if (!autoReviewActive) break;
                }

                const templateReady = await ensureReviewTemplates();

                if (!autoReviewActive) break;
                if (templateReady !== 'ok') break;

                const continueOnFail = currentNonstop();
                autoReviewMode = continueOnFail ? 'Nonstop' : 'Review';
                updateOverlay();

                const fail = findFailLinks()[0];
                const skipThisFail = skipFailOnThisChart;
                skipFailOnThisChart = false;

                if (fail && skipThisFail && !continueOnFail) {
                    console.log('Review resuming past the FAIL on the starting chart');
                } else if (fail) {
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
                const reviewedSite = detectPatientSite();

                if (!autoReviewActive) break;
                if (!loadNextPatient(true)) {
                    break;
                }

                const nextPatient = await waitForPatientIdentityChange(beforePatient);

                if (!autoReviewActive) break;
                if (!nextPatient || !patientChanged(beforePatient, nextPatient)) {
                    break;
                }

                recordReviewedChart(reviewedSite);
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
                const reviewedSite = detectPatientSite();

                if (!autoReviewActive) break;
                approveBtn.click();

                recordReviewedChart(reviewedSite);
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
    // The panel buttons call these same functions.
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

    function startReview() {
        runLocked(() =>
            reviewUntilFail(currentReviewDelayMs(), {
                continueOnFail: currentNonstop(),
                skipInitialFail: !currentNonstop()
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

        if (!confirm('Start auto-approve? This will repeatedly click Approve and Load Next. Click Stop to end the run.')) {
            return;
        }

        runLocked(() =>
            reviewApproveUntilFail(AUTO_APPROVE_DELAY_MS)
        );
    }

    function stopAuto() {
        autoReviewActive = false;
        updateOverlay();
    }

    // ============================================================
    // Button list inside the floating window
    // ============================================================

    // Keyword labels only. Full behavior:
    // S load the next patient, A approve once,
    // D open the first FAIL link, F click the first failed unchecked box,
    // Q ROS_Standard, W ROS_SBRT/SRS, ⇧Q RCO_Standard, ⇧W RCO_SBRT,
    // R starts Review. Nonstop ON continues past FAIL; OFF stops and
    //   clicks the FAIL link, skipping a FAIL already on the starting
    //   chart. Delay chooses 0 ms or 3000 ms for that wait only.
    // Auto-approve runs until FAIL, X stop,
    // LDH minimizes the panel to the title bar; clicking the bar
    // restores it. Back is not shown in this panel.
    const HELP_ACTIONS = [
        {
            name: 'Next',
            button: 'S',
            run: loadNextPatient
        },
        {
            name: 'Approve',
            button: 'A',
            run: approveOnce
        },
        {
            name: 'Fail link',
            button: 'D',
            run: openFirstFail
        },
        {
            name: 'Fix',
            button: 'F',
            run: clickFirstFailedUnchecked
        },
        {
            name: 'ROS Standard',
            button: 'Q',
            sitePair: 'ros',
            run: applyRosStandard
        },
        {
            name: 'ROS SBRT',
            button: 'W',
            sitePair: 'ros',
            sbrt: true,
            run: applyRosSbrt
        },
        {
            name: 'RCO Standard',
            button: '⇧Q',
            sitePair: 'rco',
            run: applyRcoStandard
        },
        {
            name: 'RCO SBRT',
            button: '⇧W',
            sitePair: 'rco',
            sbrt: true,
            run: applyRcoSbrt
        },
        {
            name: 'Review',
            button: 'R',
            run: startReview
        },
        {
            name: 'Nonstop',
            button: 'NONSTOP',
            kind: 'switch',
            switchId: 'nonstop',
            hint: 'Continue past FAIL when ON',
            run: toggleNonstop
        },
        {
            name: 'Delay',
            button: 'DELAY',
            kind: 'switch',
            switchId: 'delay',
            hint: 'Wait 3s or Off between charts',
            run: toggleReviewDelay
        },
        {
            name: 'Auto-approve',
            button: '⌃⇧R',
            run: startAutoApprove
        },
        {
            name: 'Stop',
            button: 'X',
            run: stopAuto
        }
    ];

    // Fixed 2-column reading order.
    // Next | Approve
    // Auto-approve | Review
    // Nonstop | Delay
    // ROS Standard | ROS SBRT
    // RCO Standard | RCO SBRT
    // Fail link | Fail box
    // Stop
    function orderedHelpActions() {
        const buttonOrder = [
            'S',
            'A',
            '⌃⇧R',
            'R',
            'NONSTOP',
            'DELAY',
            'Q',
            'W',
            '⇧Q',
            '⇧W',
            'D',
            'F',
            'X'
        ];
        const byButton = new Map(HELP_ACTIONS.map(action => [action.button, action]));

        return buttonOrder.map(button => {
            const action = byButton.get(button);

            if (!action) {
                throw new Error('Missing help action for button ' + button);
            }

            return action;
        });
    }

    function installPanelStyles() {
        if (document.getElementById('chartcheck-panel-style')) return;

        const style = document.createElement('style');
        style.id = 'chartcheck-panel-style';
        style.textContent = `
            #chartcheck-panel {
                position: fixed;
                right: 10px;
                bottom: 10px;
                z-index: 1000000;
                display: flex;
                flex-direction: column;
                width: max-content;
                max-width: calc(100vw - 20px);
                background: rgba(0, 0, 0, 0.92);
                color: #00ff66;
                font-family: monospace;
                border: 1px solid #00ff66;
                border-radius: 8px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
                overflow: hidden;
                pointer-events: none;
            }

            #chartcheck-panel.chartcheck-minimized {
                right: 10px;
                bottom: 10px;
                left: auto;
                top: auto;
            }

            #chartcheck-panel.chartcheck-minimized .chartcheck-help-wrap,
            #chartcheck-panel.chartcheck-minimized .chartcheck-status,
            #chartcheck-panel.chartcheck-minimized .chartcheck-ldh {
                display: none !important;
            }

            #chartcheck-panel.chartcheck-minimized .chartcheck-title {
                cursor: pointer;
            }

            #chartcheck-panel .chartcheck-title {
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                padding: 9px 16px;
                background: #00ff66;
                color: #04140c;
                font-weight: bold;
                font-size: 21px;
                line-height: 1.2;
                white-space: nowrap;
                cursor: move;
                user-select: none;
                -webkit-user-select: none;
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-ldh {
                flex: 0 0 auto;
                margin: 0;
                padding: 0 7px;
                font-family: monospace;
                font-size: 14px;
                font-weight: bold;
                line-height: 1.4;
                color: #04140c;
                background: transparent;
                border: 1px solid #04140c;
                border-radius: 3px;
                cursor: pointer;
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-ldh:hover,
            #chartcheck-panel .chartcheck-ldh:focus {
                background: #04140c;
                color: #00ff66;
            }

            #chartcheck-panel .chartcheck-help-wrap {
                position: relative;
                flex: 0 1 auto;
                max-height: calc(100vh - 210px);
                overflow: hidden;
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-help-list {
                display: grid;
                grid-template-columns: max-content max-content;
                max-height: calc(100vh - 210px);
                overflow: auto;
                color: #e6e6e6;
                font-size: 13px;
                line-height: 1.2;
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-status {
                flex: 0 0 auto;
                padding: 14px 18px;
                font-size: 21px;
                line-height: 1.3;
                white-space: nowrap;
                border-top: 1px solid rgba(0, 255, 102, 0.45);
                pointer-events: none;
            }

            #chartcheck-panel .chartcheck-review-note {
                display: none;
                width: 0;
                min-width: 100%;
                box-sizing: border-box;
                margin-top: 8px;
                font-size: 16px;
                line-height: 1.3;
                white-space: normal;
                overflow-wrap: break-word;
                color: #ffd24d;
            }

            #chartcheck-panel .chartcheck-review-note.chartcheck-review-note-on {
                display: block;
            }

            #chartcheck-panel .chartcheck-rancho-line {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }

            #chartcheck-panel .chartcheck-count-reset {
                flex: 0 0 auto;
                margin: 0;
                padding: 0 7px;
                font-family: monospace;
                font-size: 15px;
                font-weight: bold;
                line-height: 1.3;
                color: #04140c;
                background: #00ff66;
                border: 1px solid #00ff66;
                border-radius: 3px;
                cursor: pointer;
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-count-reset:hover,
            #chartcheck-panel .chartcheck-count-reset:focus {
                background: #04140c;
                color: #00ff66;
            }

            #chartcheck-panel .chartcheck-help-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 7px;
                padding: 2px 7px;
                border-top: 1px solid rgba(0, 255, 102, 0.18);
                pointer-events: auto;
            }

            #chartcheck-panel .chartcheck-help-row:nth-child(odd) {
                border-right: 1px solid rgba(0, 255, 102, 0.18);
            }

            #chartcheck-panel .chartcheck-help-name {
                flex: 1 1 auto;
                min-width: 0;
                font-size: 15px;
                white-space: nowrap;
            }

            #chartcheck-panel .chartcheck-help-btn {
                flex: 0 0 auto;
                min-width: 3.4em;
                margin: 0;
                padding: 2px 6px;
                font-family: monospace;
                font-size: 15px;
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

            #chartcheck-panel .chartcheck-help-btn:hover,
            #chartcheck-panel .chartcheck-help-btn:focus {
                background: #00ff66;
                color: #04140c;
            }

            #chartcheck-panel .chartcheck-help-btn.chartcheck-review-switch-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                background: transparent;
                border: 1px solid rgba(0, 255, 102, 0.35);
                border-radius: 999px;
            }

            #chartcheck-panel .chartcheck-help-btn.chartcheck-review-switch-btn:hover,
            #chartcheck-panel .chartcheck-help-btn.chartcheck-review-switch-btn:focus {
                background: #00ff66;
                color: #04140c;
            }

            #chartcheck-panel .chartcheck-switch-dot {
                flex: 0 0 auto;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #7a7a7a;
            }

            #chartcheck-panel .chartcheck-help-btn.chartcheck-switch-on .chartcheck-switch-dot {
                background: #00ff66;
            }

            #chartcheck-panel .chartcheck-help-btn.chartcheck-review-switch-btn:hover .chartcheck-switch-dot,
            #chartcheck-panel .chartcheck-help-btn.chartcheck-review-switch-btn:focus .chartcheck-switch-dot {
                background: #04140c;
            }

            #chartcheck-panel .chartcheck-help-row.chartcheck-site-muted .chartcheck-help-name {
                color: #8d8d8d;
            }

            #chartcheck-panel .chartcheck-help-row.chartcheck-site-muted .chartcheck-help-btn {
                color: #9a9a9a;
                background: #2a2a2a;
                border-color: #6a6a6a;
                opacity: 0.85;
            }

            #chartcheck-panel .chartcheck-help-row.chartcheck-site-muted .chartcheck-help-btn:hover,
            #chartcheck-panel .chartcheck-help-row.chartcheck-site-muted .chartcheck-help-btn:focus {
                color: #9a9a9a;
                background: #2a2a2a;
            }

            /* 2px yellow box around the ROS/RCO 2x2, sized from the cells. */
            #chartcheck-panel .chartcheck-site-frame {
                position: absolute;
                box-sizing: border-box;
                pointer-events: none;
                border: 2px solid rgba(255, 214, 0, 0.7);
                border-radius: 3px;
                z-index: 10;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function clampPanel() {
        if (!panel || panel.style.left === '') return;

        const rect = panel.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);
        const left = Math.min(Math.max(0, rect.left), maxLeft);
        const top = Math.min(Math.max(0, rect.top), maxTop);

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    }

    function makePanelDraggable(root, handle) {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        function onMove(e) {
            if (!dragging) return;

            const width = root.offsetWidth;
            const height = root.offsetHeight;
            const maxLeft = Math.max(0, window.innerWidth - width);
            const maxTop = Math.max(0, window.innerHeight - height);
            const left = Math.min(Math.max(0, e.clientX - offsetX), maxLeft);
            const top = Math.min(Math.max(0, e.clientY - offsetY), maxTop);

            root.style.left = left + 'px';
            root.style.top = top + 'px';
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
            if (panelHidden) return;

            const rect = root.getBoundingClientRect();

            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            root.style.left = rect.left + 'px';
            root.style.top = rect.top + 'px';
            dragging = true;

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
    }

    // Union of the four ROS/RCO cell rects, in the wrap's coordinate space.
    // Left and right are inset so the 2px vertical borders sit inside the
    // panel content box and are not clipped by the panel edge.
    function siteFrameBox(wrapRect, cellRects, panelContentRect, inset = 4) {
        if (!cellRects || cellRects.length === 0) return null;

        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;

        for (const rect of cellRects) {
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.right);
            bottom = Math.max(bottom, rect.bottom);
        }

        if (panelContentRect) {
            left = Math.max(left, panelContentRect.left);
            right = Math.min(right, panelContentRect.right);
        }

        left += inset;
        right -= inset;

        const width = right - left;
        const height = bottom - top;

        if (!(width > 0) || !(height > 0)) return null;

        return {
            left: left - wrapRect.left,
            top: top - wrapRect.top,
            width: width,
            height: height
        };
    }

    function updateSiteFrame() {
        if (!siteFrame || !helpList || !panel || panelHidden) return;

        const wrap = siteFrame.parentElement;

        if (!wrap) return;

        const panelRect = panel.getBoundingClientRect();
        const panelContentRect = {
            left: panelRect.left + panel.clientLeft,
            right: panelRect.left + panel.clientLeft + panel.clientWidth,
            top: panelRect.top + panel.clientTop,
            bottom: panelRect.top + panel.clientTop + panel.clientHeight
        };

        const cells = helpList.querySelectorAll('.chartcheck-site-template');
        const box = siteFrameBox(
            wrap.getBoundingClientRect(),
            Array.from(cells, cell => cell.getBoundingClientRect()),
            panelContentRect
        );

        if (!box) return;

        siteFrame.style.left = box.left + 'px';
        siteFrame.style.top = box.top + 'px';
        siteFrame.style.width = box.width + 'px';
        siteFrame.style.height = box.height + 'px';
    }

    function createOverlay() {
        if (panel || !document.body) return;

        installPanelStyles();

        const root = document.createElement('div');
        root.id = 'chartcheck-panel';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'ChartCheck Hotkeys');
        root.setAttribute('aria-hidden', 'false');

        const title = document.createElement('div');
        title.className = 'chartcheck-title';
        title.title = 'Drag to move';

        const titleText = document.createElement('span');
        titleText.className = 'chartcheck-title-text';
        titleText.textContent = 'ChartCheck v' + SCRIPT_VERSION;

        const ldh = document.createElement('button');
        ldh.type = 'button';
        ldh.className = 'chartcheck-ldh';
        ldh.textContent = 'LDH';
        ldh.title = 'Minimize to the title bar';
        ldh.setAttribute('aria-label', 'LDH');

        ldh.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        ldh.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePanelVisibility();
        });

        title.appendChild(titleText);
        title.appendChild(ldh);

        const wrap = document.createElement('div');
        wrap.className = 'chartcheck-help-wrap';

        const list = document.createElement('div');
        list.className = 'chartcheck-help-list';
        list.setAttribute('aria-hidden', 'false');

        orderedHelpActions().forEach(action => {
            const row = document.createElement('div');
            row.className = 'chartcheck-help-row';

            if (action.sitePair) {
                row.dataset.sitePair = action.sitePair;
                row.classList.add('chartcheck-site-template');
            }

            if (action.sbrt) {
                row.dataset.sbrt = '1';
            }

            const name = document.createElement('div');
            name.className = 'chartcheck-help-name';
            name.textContent = action.name;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chartcheck-help-btn';
            if (action.kind === 'switch') {
                row.classList.add('chartcheck-review-switch');
                row.dataset.reviewSwitch = action.switchId;
                button.classList.add('chartcheck-review-switch-btn');

                const dot = document.createElement('span');
                dot.className = 'chartcheck-switch-dot';
                dot.setAttribute('aria-hidden', 'true');

                const label = document.createElement('span');
                label.className = 'chartcheck-switch-label';
                label.textContent = action.switchId === 'nonstop'
                    ? nonstopSwitchLabel()
                    : delaySwitchLabel();

                button.appendChild(dot);
                button.appendChild(label);
                button.title = action.hint || action.name;
                button.classList.toggle(
                    'chartcheck-switch-on',
                    isReviewSwitchOn(action.switchId)
                );
                row.classList.toggle(
                    'chartcheck-switch-on',
                    isReviewSwitchOn(action.switchId)
                );
            } else {
                button.textContent = action.button;
                button.title = action.hint || action.name;
            }

            button.setAttribute('aria-label', action.name);

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (
                    action.sitePair
                    && isTemplateHotkeyMuted(action.sitePair, !!action.sbrt)
                ) {
                    return;
                }

                action.run();
            });

            row.appendChild(name);
            row.appendChild(button);
            list.appendChild(row);
        });

        siteFrame = document.createElement('div');
        siteFrame.className = 'chartcheck-site-frame';
        siteFrame.setAttribute('aria-hidden', 'true');
        wrap.appendChild(list);
        wrap.appendChild(siteFrame);

        const status = document.createElement('div');
        status.className = 'chartcheck-status';
        buildStatusContent(status);

        root.appendChild(title);
        root.appendChild(wrap);
        root.appendChild(status);
        root.addEventListener('mousedown', (event) => event.stopPropagation());
        root.addEventListener('click', (event) => event.stopPropagation());
        makePanelDraggable(root, title);

        title.addEventListener('click', (event) => {
            if (!panelHidden) return;

            event.preventDefault();
            event.stopPropagation();
            showPanel();
        });

        panel = root;
        helpList = list;
        statusEl = status;
        document.body.appendChild(root);
        window.addEventListener('resize', () => {
            if (panelHidden) dockMinimizedPanel();
        });
        window.addEventListener('resize', updateSiteFrame);
        list.addEventListener('scroll', updateSiteFrame);
        updateOverlay();
        refreshReviewSwitchLabels();
        refreshPatientSiteGray();
        requestAnimationFrame(updateSiteFrame);
    }

    function ensureOverlay() {
        if (!panel) {
            createOverlay();
        }
    }

    function applyPatientSiteGray(site) {
        if (panel) panel.dataset.patientSite = site;
        if (!helpList) return;

        const totalFractions = readTotalFractions();

        helpList.querySelectorAll('.chartcheck-help-row').forEach(row => {
            const pair = row.dataset.sitePair || '';
            const isSbrt = row.dataset.sbrt === '1';
            const mute = isSiteTemplateMuted(site, totalFractions, pair, isSbrt);

            row.classList.toggle('chartcheck-site-muted', mute);
        });
    }

    let applyingSiteGray = false;

    function refreshPatientSiteGray() {
        if (applyingSiteGray) return;

        applyingSiteGray = true;

        try {
            applyPatientSiteGray(detectPatientSite());
            maybeAutoCopyPatientMrn();
            updateSiteFrame();
        } finally {
            applyingSiteGray = false;
        }
    }

    let savedPanelPosition = null;

    function dockMinimizedPanel() {
        if (!panel) return;

        panel.style.left = 'auto';
        panel.style.top = 'auto';
        panel.style.right = '10px';
        panel.style.bottom = '10px';

        requestAnimationFrame(() => {
            if (!panel || !panelHidden) return;

            const rect = panel.getBoundingClientRect();

            if (rect.left < 10) {
                panel.style.right = 'auto';
                panel.style.left = '10px';
            }

            if (rect.top < 10) {
                panel.style.bottom = 'auto';
                panel.style.top = '10px';
            }
        });
    }

    function savePanelPositionForRestore() {
        if (!panel) return;

        if (panel.style.left) {
            savedPanelPosition = {
                left: panel.style.left,
                top: panel.style.top
            };
        } else {
            savedPanelPosition = null;
        }
    }

    // Opening restores the full panel at its previous position.
    function showPanel() {
        if (!panel) return;

        panelHidden = false;
        panel.classList.remove('chartcheck-minimized');
        panel.setAttribute('aria-hidden', 'false');

        if (savedPanelPosition) {
            panel.style.left = savedPanelPosition.left;
            panel.style.top = savedPanelPosition.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            clampPanel();
        } else {
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '10px';
            panel.style.bottom = '10px';
        }

        refreshPatientSiteGray();
        requestAnimationFrame(updateSiteFrame);
    }

    function hidePanel() {
        if (!panel) return;

        savePanelPositionForRestore();
        panelHidden = true;
        panel.classList.add('chartcheck-minimized');
        panel.setAttribute('aria-hidden', 'false');
        dockMinimizedPanel();
    }

    // LDH minimizes the panel to its title bar.
    // Clicking that bar restores the full panel.
    function togglePanelVisibility() {
        ensureOverlay();

        if (!panel) return;

        if (panelHidden) showPanel();
        else hidePanel();
    }

    function isEditableTarget(node) {
        if (!node || node.nodeType !== 1) return false;

        const tag = node.tagName.toLowerCase();

        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return true;
        }

        return !!node.isContentEditable;
    }

    // ============================================================
    // Auto-reload
    // Every 5 minutes the page reloads. If the user is editing, recently
    // clicked or typed, auto review is running, or an unsaved-changes
    // handler is present, wait 1 minute and try again.
    // ============================================================

    const AUTO_RELOAD_MS = 5 * 60 * 1000;
    const AUTO_RELOAD_RETRY_MS = 60 * 1000;
    const AUTO_RELOAD_ACTIVITY_MS = 60 * 1000;

    let lastUserActivityAt = 0;
    let autoReloadTimer = null;

    function recordUserActivity() {
        lastUserActivityAt = Date.now();
    }

    function deepActiveElement() {
        let el = document.activeElement;

        while (el && el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        }

        return el;
    }

    function isEditingFocus() {
        return isEditableTarget(deepActiveElement());
    }

    function hadActivityWithin(lastActivityAt, now, windowMs) {
        return lastActivityAt > 0 && (now - lastActivityAt) < windowMs;
    }

    function hasUnsavedChangesIndicator() {
        return typeof window.onbeforeunload === 'function';
    }

    function shouldPostponeAutoReload(state) {
        const current = state || {
            autoReviewActive: autoReviewActive,
            isEditing: isEditingFocus(),
            lastActivityAt: lastUserActivityAt,
            now: Date.now(),
            activityWindowMs: AUTO_RELOAD_ACTIVITY_MS,
            hasUnsavedChanges: hasUnsavedChangesIndicator()
        };

        if (current.autoReviewActive) return true;
        if (current.isEditing) return true;
        if (hadActivityWithin(
            current.lastActivityAt,
            current.now,
            current.activityWindowMs
        )) return true;
        if (current.hasUnsavedChanges) return true;

        return false;
    }

    function scheduleAutoReload(delay) {
        if (autoReloadTimer !== null) {
            clearTimeout(autoReloadTimer);
        }

        autoReloadTimer = setTimeout(tryAutoReload, delay);
    }

    function tryAutoReload() {
        autoReloadTimer = null;

        if (shouldPostponeAutoReload()) {
            scheduleAutoReload(AUTO_RELOAD_RETRY_MS);
            return;
        }

        location.reload();
    }

    function startAutoReload() {
        document.addEventListener('keydown', recordUserActivity, true);
        document.addEventListener('keyup', recordUserActivity, true);
        document.addEventListener('mousedown', recordUserActivity, true);
        document.addEventListener('click', recordUserActivity, true);
        scheduleAutoReload(AUTO_RELOAD_MS);
    }

    // ============================================================
    // Init
    // ============================================================

    let siteGrayRefreshStarted = false;

    function mutationIsOutsidePanel(mutation) {
        const node = mutation.target;
        const el = node && node.nodeType === 1
            ? node
            : node && node.parentElement;

        if (!el || typeof el.closest !== 'function') return true;

        return !el.closest('#chartcheck-panel');
    }

    function startSiteGrayRefresh() {
        if (siteGrayRefreshStarted) return;
        if (!document.body) return;

        siteGrayRefreshStarted = true;
        createOverlay();
        refreshPatientSiteGray();
        setInterval(refreshPatientSiteGray, 800);

        if (typeof MutationObserver !== 'function') return;

        let queued = false;
        const observer = new MutationObserver(mutations => {
            if (applyingSiteGray || queued) return;
            if (!mutations.some(mutationIsOutsidePanel)) return;

            queued = true;
            setTimeout(() => {
                queued = false;
                refreshPatientSiteGray();
            }, 150);
        });

        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true
        });
    }

    loadReviewSettings();
    loadSiteCounts();
    startAutoReload();

    if (document.readyState === 'complete') {
        startSiteGrayRefresh();
    } else {
        document.addEventListener('DOMContentLoaded', startSiteGrayRefresh);
        window.addEventListener('load', startSiteGrayRefresh);
    }

    console.log(`ChartCheck Hotkeys v${SCRIPT_VERSION} Loaded`);
})();

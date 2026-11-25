// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      3.56
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
        if (!root || !root.querySelectorAll) return;

        for (const el of root.querySelectorAll('*')) {
            callback(el);

            if (el.shadowRoot) {
                walkDom(el.shadowRoot, callback);
            }
        }
    }

    // Short-lived caches and targeted composed queries so the 800ms
    // refresh and MutationObserver do not walk the whole document
    // when nothing relevant has changed.
    let pageScanDirty = true;
    let cachedPatientsSidebar = null;
    let cachedOverviewDocs = null;
    let cachedTemplateSelects = null;
    let cachedCenterLineEl = null;
    let cachedIdleSignature = '';
    let lastAppliedSite = null;
    let lastSiteFrameKey = '';

    function markPageScanDirty() {
        pageScanDirty = true;
        cachedOverviewDocs = null;
        cachedTemplateSelects = null;

        if (cachedPatientsSidebar && cachedPatientsSidebar.isConnected === false) {
            cachedPatientsSidebar = null;
        }

        if (cachedCenterLineEl && cachedCenterLineEl.isConnected === false) {
            cachedCenterLineEl = null;
        }
    }

    function isConnectedNode(node) {
        return !!node && node.isConnected !== false;
    }

    function isOwnPanelNode(el) {
        if (!el) return false;
        if (el.id === 'chartcheck-panel' || el.id === 'chartcheck-dom-copy') return true;

        try {
            if (typeof el.closest === 'function') {
                return !!(el.closest('#chartcheck-panel') || el.closest('#chartcheck-dom-copy'));
            }
        } catch (err) {}

        return false;
    }

    function forEachShadowRoot(root, visit) {
        if (!root || !root.querySelectorAll) return;

        const all = root.querySelectorAll('*');

        for (let i = 0; i < all.length; i++) {
            const el = all[i];

            if (isOwnPanelNode(el)) continue;

            if (el.shadowRoot) {
                visit(el.shadowRoot);
                forEachShadowRoot(el.shadowRoot, visit);
            }
        }
    }

    function collectDeepByQuery(root, selector, results) {
        const list = results || [];

        if (!root || !selector || !root.querySelectorAll) return list;

        list.push.apply(list, root.querySelectorAll(selector));
        forEachShadowRoot(root, shadow => {
            if (shadow.querySelectorAll) {
                list.push.apply(list, shadow.querySelectorAll(selector));
            }
        });

        return list;
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
    let domCopyBtn;
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

    function setReviewNote(text, reason) {
        if (!statusEl) return;

        const note = statusEl.querySelector('.chartcheck-review-note');

        if (!note) return;

        const value = (text || '').trim();

        note.textContent = value;
        note.classList.toggle('chartcheck-review-note-on', !!value);

        const detail = reason == null ? '' : String(reason).trim();

        if (value && detail) {
            note.title = value + ' (' + detail + ')';
            note.setAttribute('title', note.title);
        } else {
            note.title = '';
            note.removeAttribute('title');
        }
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
        return collectDeepByQuery(root, 'button', []);
    }

    function findSelects(root = document) {
        return collectDeepByQuery(root, 'select', []);
    }

    function findPatientsSidebar(root = document) {
        const scope = root || document;

        if (scope === document && isConnectedNode(cachedPatientsSidebar)) {
            return cachedPatientsSidebar;
        }

        let found = null;

        if (scope.querySelector) {
            found = scope.querySelector('patients-sidebar');
        }

        if (!found) {
            const matches = collectDeepByQuery(scope, 'patients-sidebar', []);
            found = matches.length ? matches[0] : null;
        }

        if (scope === document) cachedPatientsSidebar = found;

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

    function optionLooksLikeCheckTemplate(text) {
        return /^(ROS_|RCO_|OAK_)/i.test(normalizeText(text));
    }

    function selectLooksLikeDateFilter(select) {
        const texts = Array.from((select && select.options) || []).map(option => (
            normalizeText(option && option.text).toLowerCase()
        ));

        return texts.some(text => (
            /\blast\s+\d+\s+days?\b/.test(text)
            || /\b(today|yesterday|this\s+week|last\s+week)\b/.test(text)
            || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)
        ));
    }

    function isCheckTemplateLabelText(text) {
        const value = normalizeText(text).replace(/[:.\-]+$/g, '').toLowerCase();

        return value === 'check template' || value === 'check templates';
    }

    function isLikelyVisibleSelect(select) {
        if (!select || !select.tagName) return true;

        try {
            if (select.hidden) return false;

            const wide = select.offsetWidth || 0;
            const tall = select.offsetHeight || 0;

            // Already on screen: skip getComputedStyle to avoid layout work
            // on every refresh.
            if (wide > 0 || tall > 0) return true;

            if (typeof select.getBoundingClientRect === 'function') {
                const rect = select.getBoundingClientRect();

                if (rect && (rect.width > 0 || rect.height > 0)) return true;
                if (rect && rect.width === 0 && rect.height === 0) return false;
            }

            if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
                const style = window.getComputedStyle(select);

                if (style && (style.display === 'none' || style.visibility === 'hidden')) {
                    return false;
                }
            }
        } catch (err) {}

        return true;
    }

    function hasPrecedingCheckTemplateLabel(select) {
        if (!select) return false;

        let node = select;

        for (let i = 0; i < 10 && node; i++) {
            let sib = node.previousElementSibling;
            let steps = 0;

            while (sib && steps < 8) {
                if (isCheckTemplateLabelText(collectDeepText(sib))) {
                    return true;
                }

                sib = sib.previousElementSibling;
                steps++;
            }

            const parent = node.parentElement
                || (typeof node.getRootNode === 'function' && node.getRootNode() && node.getRootNode().host)
                || null;

            if (
                parent
                && isCheckTemplateLabelText(collectDeepText(parent))
                && (parent.children || []).length < 6
            ) {
                return true;
            }

            node = parent;
        }

        return false;
    }

    function filterCheckTemplateSelects(selects) {
        const unique = [];
        const seen = new Set();

        (selects || []).forEach(select => {
            if (!select || seen.has(select) || isInHotkeyPanel(select)) return;
            if (selectLooksLikeDateFilter(select)) return;

            const options = Array.from(select.options || []);

            if (!options.some(option => optionLooksLikeCheckTemplate(option && option.text))) {
                return;
            }

            seen.add(select);
            unique.push(select);
        });

        const labeled = unique.filter(hasPrecedingCheckTemplateLabel);
        const visibleLabeled = labeled.filter(isLikelyVisibleSelect);

        if (visibleLabeled.length) return visibleLabeled;
        if (labeled.length) return labeled;

        const visible = unique.filter(isLikelyVisibleSelect);

        return visible.length ? visible : unique;
    }

    function getTemplateSelects() {
        if (
            !pageScanDirty
            && cachedTemplateSelects
            && cachedTemplateSelects.every(isConnectedNode)
        ) {
            return filterCheckTemplateSelects(cachedTemplateSelects);
        }

        const found = [];

        overviewDocuments().forEach(doc => {
            found.push.apply(found, findSelects(doc));
        });

        cachedTemplateSelects = found;
        return filterCheckTemplateSelects(found);
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

    function parseCourseLabel(text) {
        const value = normalizeText(text).replace(/[：∶﹕]/g, ':');

        if (!value || value.length > 200) return '';

        let match = /^(course\s*id|course)\s*[:.\-]\s*(.+)$/i.exec(value);

        if (match) return normalizeText(match[2]);

        match = /^(course\s*id|course)\s+(c\s*\d+[\s\S]*)$/i.exec(value);

        if (match) return normalizeText(match[2]);

        match = /^(course\s*id|course)\s+(.+)$/i.exec(value);

        if (match) {
            const rest = normalizeText(match[2]);

            if (rest && !/^(id|name|title|of|for)$/i.test(rest)) {
                return rest;
            }
        }

        if (/^c\s*\d+\s*-/i.test(value) && value.length <= 100) {
            return value;
        }

        return '';
    }

    function normalizePlanName(name) {
        let value = normalizeText(name);

        if (!value) return '';

        value = value.replace(/^plan\s*name\s*[:.\-]?\s*/i, '');
        value = value.replace(/^plan:\s*/i, '');

        return value.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function planNamesMatch(left, right) {
        return labelsMatchLoose(left, right);
    }

    function normalizeCourseKey(name) {
        const value = normalizeText(name).replace(/^course:\s*/i, '');

        if (!value) return '';

        return value.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function courseIdToken(name) {
        const value = looseLabelKey(name);

        if (!value) return '';

        const match = /^c\s*(\d+)\b/i.exec(value);

        return match ? 'c' + match[1] : '';
    }

    function courseKeysMatch(left, right) {
        if (labelsMatchLoose(left, right)) return true;

        const a = courseIdToken(left);
        const b = courseIdToken(right);

        return !!(a && b && a === b);
    }

    function looseLabelKey(name) {
        let value = normalizeText(name);

        if (!value) return '';

        value = value.replace(/^course\s*id\s*[:.\-]?\s*/i, '');
        value = value.replace(/^course:\s*/i, '');
        value = value.replace(/^course\s+/i, '');
        value = value.replace(/^plan\s*name\s*[:.\-]?\s*/i, '');
        value = value.replace(/^plan:\s*/i, '');

        return value.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function labelsMatchLoose(left, right) {
        const a = looseLabelKey(left);
        const b = looseLabelKey(right);

        if (!a || !b) return false;
        if (a === b) return true;

        const compact = value => value.replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        const ca = compact(a);
        const cb = compact(b);

        if (ca && cb && ca === cb) return true;

        if (a.length >= 2 && b.length >= 2) {
            if (a.startsWith(b) || b.startsWith(a)) return true;
        }

        if (a.length >= 3 && b.length >= 3) {
            if (a.includes(b) || b.includes(a)) return true;
        }

        if (ca.length >= 3 && cb.length >= 3) {
            if (ca.startsWith(cb) || cb.startsWith(ca) || ca.includes(cb) || cb.includes(ca)) {
                return true;
            }
        }

        return false;
    }

    function joinSplitPrefixedLabel(prefixText, followingTexts) {
        const prefix = normalizeText(prefixText);
        const rest = normalizeText((followingTexts || []).join(' '));

        if (!rest) return '';

        if (/^(course(\s*id)?|plan)\s*[:.\-]?\s*$/i.test(prefix)) {
            const kind = /^plan/i.test(prefix) ? 'Plan: ' : 'Course: ';

            return kind + rest;
        }

        return '';
    }

    function nearestPrecedingLabel(itemOrder, labels) {
        let found = '';

        (labels || []).forEach(label => {
            if (!label || label.order == null) return;
            if (label.order < itemOrder && label.text) {
                found = label.text;
            }
        });

        return found;
    }

    function formatReviewReason(reason, counts) {
        const detail = reason == null ? '' : String(reason).trim();

        if (!detail) return '';

        const data = counts || {};

        function countValue(key) {
            const value = Number(data[key]);

            return Number.isFinite(value) ? value : 0;
        }

        let text = detail
            + ' sel=' + countValue('sel')
            + ' unsel=' + countValue('unsel')
            + ' blocks=' + countValue('blocks')
            + ' rows=' + countValue('rows')
            + ' courses=' + countValue('courses')
            + ' planLabels=' + countValue('planLabels')
            + ' matched=' + countValue('matched')
            + ' near=' + countValue('near');

        if (data.fail) {
            text += ' fail=' + String(data.fail).trim();
        }

        return text;
    }

    function isPlanNameLabel(text) {
        const value = normalizeText(text).toLowerCase().replace(/:$/, '');

        return value === 'plan name';
    }

    function planNameFromLabeledText(text) {
        const value = normalizeText(text);
        const match = /^plan\s*name\s*[:.\-]?\s+(.+)$/i.exec(value);

        if (!match) return '';

        const name = normalizeText(match[1]);

        if (!name || isPlanNameLabel(name)) return '';
        if (isDeliveredTotalFractionsLabel(name)) return '';
        if (isOverviewFieldLabel(name)) return '';

        return name;
    }

    function readPlanNameFromCells(cells) {
        if (!cells || !cells.length) return '';

        for (let i = 0; i < cells.length; i++) {
            const fromSame = planNameFromLabeledText(cells[i]);

            if (fromSame) return fromSame;
        }

        for (let i = 0; i < cells.length; i++) {
            if (!isPlanNameLabel(cells[i])) continue;

            for (let j = i + 1; j < cells.length && j <= i + 3; j++) {
                const next = normalizeText(cells[j]);

                if (!next) continue;
                if (isPlanNameLabel(next)) break;
                if (planNameFromLabeledText(cells[j])) continue;
                if (isDeliveredTotalFractionsLabel(next)) break;
                if (isOverviewFieldLabel(next)) break;

                return next;
            }
        }

        return '';
    }

    function readAllPlanNamesFromCells(cells) {
        const names = [];

        if (!cells || !cells.length) return names;

        const seen = new Set();

        function addName(name) {
            const value = normalizeText(name);

            if (!value) return;

            const key = looseLabelKey(value);

            if (!key || seen.has(key)) return;

            seen.add(key);
            names.push(value);
        }

        for (let i = 0; i < cells.length; i++) {
            const fromSame = planNameFromLabeledText(cells[i]);

            if (fromSame) addName(fromSame);
        }

        for (let i = 0; i < cells.length; i++) {
            if (!isPlanNameLabel(cells[i])) continue;

            for (let j = i + 1; j < cells.length && j <= i + 3; j++) {
                const next = normalizeText(cells[j]);

                if (!next) continue;
                if (isPlanNameLabel(next)) break;
                if (planNameFromLabeledText(cells[j])) continue;
                if (isDeliveredTotalFractionsLabel(next)) break;
                if (isOverviewFieldLabel(next)) break;

                addName(next);
                break;
            }
        }

        return names;
    }

    function readAllFractionTotalsFromCells(cells) {
        const totals = [];

        if (!cells || !cells.length) return totals;

        for (let i = 0; i < cells.length; i++) {
            if (!isDeliveredTotalFractionsLabel(cells[i])) continue;

            const row = [];

            for (let j = i + 1; j < cells.length && j <= i + 8; j++) {
                const next = cells[j];

                if (!next) break;
                if (isDeliveredTotalFractionsLabel(next)) break;
                if (isOverviewFieldLabel(next)) break;

                row.push(next);
            }

            const pairs = [];
            const lones = [];

            row.forEach(cell => {
                const pair = parseFractionPairTotal(cell);
                const lone = loneFractionInteger(cell);

                if (pair != null) pairs.push(pair);
                else if (lone != null) lones.push(lone);
            });

            if (pairs.length) {
                pairs.forEach(value => totals.push(value));
                continue;
            }

            const joined = parseAllFractionPairTotals(row.join(' '));

            if (joined.length) {
                joined.forEach(value => totals.push(value));
                continue;
            }

            lones.forEach(value => totals.push(value));
        }

        if (totals.length) return totals;

        const fallback = readTotalFractionsFromCells(cells);

        return fallback != null ? [fallback] : [];
    }

    function extractPlanRowsFromCells(cells, courseName) {
        const names = readAllPlanNamesFromCells(cells);
        const totals = readAllFractionTotalsFromCells(cells);
        const course = courseName || '';

        if (!names.length && !totals.length) return [];

        if (names.length && totals.length === names.length) {
            return names.map((planName, index) => ({
                courseName: course,
                planName,
                totalFractions: totals[index]
            }));
        }

        if (names.length === 1 && totals.length) {
            return [{
                courseName: course,
                planName: names[0],
                totalFractions: totals[totals.length - 1]
            }];
        }

        if (!names.length && totals.length === 1) {
            return [{
                courseName: course,
                planName: '',
                totalFractions: totals[0]
            }];
        }

        if (names.length && totals.length === 1) {
            return names.map(planName => ({
                courseName: course,
                planName,
                totalFractions: totals[0]
            }));
        }

        return [];
    }

    function isNestedOverviewBlock(outer, inner) {
        if (!outer || !inner || outer === inner) return false;

        if (
            outer.container
            && inner.container
            && outer.container !== inner.container
            && typeof outer.container.contains === 'function'
        ) {
            return outer.container.contains(inner.container);
        }

        const ancestors = inner.ancestorIds || [];

        return !!outer.id && ancestors.indexOf(outer.id) >= 0;
    }

    function dedupeOverviewBlocks(blocks) {
        const list = (blocks || []).filter(block => (
            block
            && (block.planName || block.totalFractions != null)
        ));
        const seen = [];

        return list.filter((block, index) => {
            if (list.some((other, otherIndex) => (
                otherIndex !== index && isNestedOverviewBlock(block, other)
            ))) {
                return false;
            }

            const key = block.container || block.id;

            if (key != null && seen.indexOf(key) >= 0) {
                return false;
            }

            if (key != null) seen.push(key);

            return true;
        });
    }

    function inferPatientSiteFromTemplates(selectedTexts, optionLists) {
        const selected = Array.isArray(selectedTexts) ? selectedTexts : [];

        for (let i = 0; i < selected.length; i++) {
            const text = selected[i] || '';

            if (/^ROS_/i.test(text)) return 'roseville';
            if (/^RCO_/i.test(text)) return 'rancho';
        }

        const lists = Array.isArray(optionLists) ? optionLists : [];

        for (let i = 0; i < lists.length; i++) {
            const options = Array.isArray(lists[i]) ? lists[i] : [];
            const hasRos = options.some(text => /^ROS_/i.test(text || ''));
            const hasRco = options.some(text => /^RCO_/i.test(text || ''));

            if (hasRos && !hasRco) return 'roseville';
            if (hasRco && !hasRos) return 'rancho';
        }

        return 'unknown';
    }

    function resolveReviewSite(detected, plans) {
        if (detected === 'roseville' || detected === 'rancho') {
            return detected;
        }

        const list = Array.isArray(plans) ? plans : [];

        return inferPatientSiteFromTemplates(
            list.map(plan => plan && plan.text),
            list.map(plan => plan && plan.optionTexts)
        );
    }

    // Match a template dropdown to a plan row: plan name first,
    // then course title, then document-order index when dropdowns
    // and rows line up, then remaining unselected dropdowns
    // against leftover rows. Filled dropdowns also receive the
    // matched row's fractions so SBRT gray-out can use them.
    // A single plan uses the only overview row when names miss.
    function resolvePlanTemplateMatch(plans, overviews, options) {
        const list = Array.isArray(plans) ? plans : [];
        const rows = Array.isArray(overviews) ? overviews : [];
        const used = new Set();
        const failed = [];
        const settings = options || {};

        function claim(row) {
            if (!row) return null;

            const index = rows.indexOf(row);

            if (index >= 0) used.add(index);

            return row;
        }

        function uniqueUnused(hits) {
            const free = hits.filter((row, index) => {
                const at = rows.indexOf(row);

                return at >= 0 && !used.has(at) && hits.indexOf(row) === index;
            });

            return free.length === 1 ? claim(free[0]) : null;
        }

        function matchByPlanName(plan) {
            const planName = plan && plan.planName ? plan.planName : '';

            if (!planName) return null;

            return uniqueUnused(rows.filter(item => planNamesMatch(item && item.planName, planName)));
        }

        function matchByCourse(plan) {
            const courseName = plan && plan.courseName ? plan.courseName : '';

            if (!courseName) return null;

            return uniqueUnused(rows.filter(item => courseKeysMatch(item && item.courseName, courseName)));
        }

        const filledClaimed = list.map(() => false);
        const assigned = list.map(() => null);

        list.forEach((plan, index) => {
            if (plan && plan.filled) {
                const row = matchByPlanName(plan) || matchByCourse(plan);

                if (row) {
                    filledClaimed[index] = true;
                    assigned[index] = row;
                }
            }
        });

        let nameHits = 0;

        list.forEach((plan, index) => {
            if (!plan || plan.filled || plan.unselected === false) return;

            const row = matchByPlanName(plan);

            if (row) {
                assigned[index] = row;
                nameHits++;
            }
        });

        if (list.some((plan, index) => plan && !plan.filled && plan.unselected !== false && !assigned[index])) {
            failed.push('name');
        }

        let courseHits = 0;

        list.forEach((plan, index) => {
            if (!plan || plan.filled || plan.unselected === false || assigned[index]) return;

            const row = matchByCourse(plan);

            if (row) {
                assigned[index] = row;
                courseHits++;
            }
        });

        if (list.some((plan, index) => plan && !plan.filled && plan.unselected !== false && !assigned[index])) {
            failed.push('course');
        }

        let indexHits = 0;

        if (list.length === rows.length) {
            list.forEach((plan, index) => {
                if (!plan || assigned[index]) return;

                if (plan.filled) {
                    if (rows[index] && !used.has(index)) {
                        used.add(index);
                        assigned[index] = rows[index];
                    }
                    return;
                }

                if (plan.unselected === false) return;

                if (rows[index] && !used.has(index)) {
                    used.add(index);
                    assigned[index] = rows[index];
                    indexHits++;
                }
            });
        }

        const leftoverPlans = [];

        list.forEach((plan, index) => {
            if (plan && !plan.filled && plan.unselected !== false && !assigned[index]) {
                leftoverPlans.push(index);
            }
        });

        const leftoverRows = [];

        rows.forEach((row, index) => {
            if (!used.has(index)) leftoverRows.push(row);
        });

        const unmatchedFilled = list.filter((plan, index) => plan && plan.filled && !filledClaimed[index]).length;

        if (
            leftoverPlans.length
            && leftoverPlans.length === leftoverRows.length
            && unmatchedFilled === 0
        ) {
            leftoverPlans.forEach((planIndex, offset) => {
                assigned[planIndex] = claim(leftoverRows[offset]);
                indexHits++;
            });
            leftoverPlans.length = 0;
        }

        if (leftoverPlans.length) {
            failed.push('index');
        }

        let nearHits = 0;
        const allowNear = Number(settings.blocks) === 0 && rows.length > 0;

        function sourceOrder(item, index) {
            const value = Number(item && item.order);

            return Number.isFinite(value) ? value : index;
        }

        if (allowNear && leftoverPlans.length) {
            const unusedIdx = [];

            rows.forEach((row, index) => {
                if (!used.has(index)) unusedIdx.push(index);
            });

            const pairs = [];

            leftoverPlans.forEach(planIndex => {
                unusedIdx.forEach(rowIndex => {
                    pairs.push({
                        planIndex,
                        rowIndex,
                        dist: Math.abs(
                            sourceOrder(list[planIndex], planIndex)
                            - sourceOrder(rows[rowIndex], rowIndex)
                        )
                    });
                });
            });

            pairs.sort((left, right) => (
                left.dist - right.dist
                || left.planIndex - right.planIndex
                || left.rowIndex - right.rowIndex
            ));

            const takenPlan = {};
            const takenRow = {};

            pairs.forEach(pair => {
                if (takenPlan[pair.planIndex] || takenRow[pair.rowIndex]) return;

                takenPlan[pair.planIndex] = true;
                takenRow[pair.rowIndex] = true;
                assigned[pair.planIndex] = claim(rows[pair.rowIndex]);
                nearHits++;
            });

            for (let i = leftoverPlans.length - 1; i >= 0; i--) {
                if (assigned[leftoverPlans[i]]) leftoverPlans.splice(i, 1);
            }
        }

        if (allowNear && leftoverPlans.length) {
            failed.push('near');
        }

        // A single plan can use the only overview row, or the only
        // unused row that already has a known total, even when the
        // Check Template is already selected or names miss.
        if (list.length === 1 && !assigned[0] && rows.length) {
            const unused = [];

            rows.forEach((row, index) => {
                if (!used.has(index)) unused.push(row);
            });

            const known = unused.filter(row => (
                row
                && row.totalFractions != null
                && Number.isFinite(row.totalFractions)
                && row.totalFractions > 0
            ));

            if (known.length === 1) {
                assigned[0] = claim(known[0]);
            } else if (unused.length === 1) {
                assigned[0] = claim(unused[0]);
            } else if (rows.length === 1) {
                assigned[0] = claim(rows[0]);
            }
        }

        const contexts = list.map((plan, index) => {
            const row = assigned[index];

            if (plan && plan.filled) {
                return {
                    filled: true,
                    unselected: false,
                    tableFound: !!row,
                    totalFractions: row && row.totalFractions != null
                        ? row.totalFractions
                        : null
                };
            }

            const unselected = !plan || plan.unselected !== false;

            if (!unselected) {
                return {
                    filled: false,
                    unselected: false,
                    tableFound: !!row,
                    totalFractions: row && row.totalFractions != null
                        ? row.totalFractions
                        : null
                };
            }

            if (!row) {
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
                totalFractions: row.totalFractions
            };
        });

        const unsel = list.filter(plan => plan && !plan.filled && plan.unselected !== false).length;
        const matched = contexts.filter(state => state && state.unselected && state.tableFound).length;
        const courseNames = {};
        const planLabels = list.filter(plan => plan && plan.planName).length;

        list.concat(rows).forEach(item => {
            const key = looseLabelKey(item && item.courseName);

            if (key) courseNames[key] = true;
        });

        return {
            contexts,
            stats: {
                sel: list.length,
                unsel,
                blocks: rows.length,
                rows: rows.length,
                courses: Object.keys(courseNames).length,
                planLabels,
                matched,
                near: nearHits,
                fail: leftoverPlans.length ? failed.join(',') : ''
            }
        };
    }

    function resolvePlanTemplateContexts(plans, overviews) {
        return resolvePlanTemplateMatch(plans, overviews).contexts;
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
        let reason = '';

        states.forEach((state, index) => {
            if (!state || state.filled) return;

            pending = true;

            if (state.unselected === false) {
                shouldStop = true;
                if (!reason) reason = 'match?';
                return;
            }

            if (!state.tableFound) {
                shouldStop = true;
                if (!reason) reason = 'match?';
                return;
            }

            const totalFractions = state.totalFractions;
            const knownFx = totalFractions != null
                && Number.isFinite(totalFractions)
                && totalFractions > 0;

            if (!knownFx) {
                shouldStop = true;
                if (!reason) reason = 'fx?';
                return;
            }

            if (totalFractions <= 5) {
                shouldStop = true;
                if (!reason) reason = 'fx<=5';
                return;
            }

            autoIndexes.push(index);
        });

        if (!pending) {
            return { action: 'ok' };
        }

        const knownSite = site === 'roseville' || site === 'rancho';

        if (!knownSite) {
            return {
                action: 'stop',
                message: 'Template needed',
                reason: 'site?'
            };
        }

        if (shouldStop) {
            return {
                action: 'stop',
                message: 'Template needed',
                reason
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

    function followingSiblingTexts(el, limit) {
        const texts = [];
        let sib = el ? el.nextSibling : null;
        const max = limit == null ? 4 : limit;

        while (sib && texts.length < max) {
            if (sib.nodeType === 3) {
                const text = normalizeText(sib.nodeValue);

                if (text) texts.push(text);
            } else if (sib.nodeType === 1) {
                const text = collectDeepText(sib);

                if (text && !isDeliveredTotalFractionsLabel(text)) {
                    const trimmed = normalizeText(text).replace(/[：∶﹕]/g, ':');

                    // A bare course/plan title (C1- Alpha, PlanA) should
                    // be joined to a preceding Course:/Plan: prefix.
                    // Only stop when the sibling starts a new prefix.
                    if (/^(course(\s*id)?|plan)\s*[:.\-]/i.test(trimmed)) {
                        break;
                    }

                    texts.push(text);
                    break;
                }
            }

            sib = sib.nextSibling;
        }

        return texts;
    }

    function readPrefixedLabelAt(el) {
        if (!el || !el.tagName) return { course: '', plan: '' };

        const text = collectDeepText(el);
        const value = normalizeText(text).replace(/[：∶﹕]/g, ':');
        const tag = (el.tagName || '').toLowerCase();
        const attrs = [
            el.getAttribute ? el.getAttribute('aria-label') : '',
            el.getAttribute ? el.getAttribute('title') : ''
        ];

        for (let i = 0; i < attrs.length; i++) {
            const fromCourse = parseCourseLabel(attrs[i]);
            const fromPlan = parsePlanTreeLabel(attrs[i]);

            if (fromCourse) {
                return { course: fromCourse, plan: '' };
            }

            if (fromPlan) {
                return { course: '', plan: fromPlan };
            }
        }

        if (!value || value.length > 240) return { course: '', plan: '' };

        if (/^(course(\s*id)?|plan)\s*[:.\-]?\s*$/i.test(value)) {
            const joined = joinSplitPrefixedLabel(value, followingSiblingTexts(el));

            return {
                course: /^plan/i.test(value) ? '' : (parseCourseLabel(joined) || looseLabelKey(joined)),
                plan: /^plan/i.test(value) ? (parsePlanTreeLabel(joined) || looseLabelKey(joined)) : ''
            };
        }

        const heading = /^h[1-6]$/.test(tag)
            || tag === 'strong'
            || tag === 'b'
            || tag === 'label'
            || tag === 'legend';

        if (!heading && !isInnermostDeepText(el, text) && text !== value) {
            return { course: '', plan: '' };
        }

        const course = parseCourseLabel(text);
        const plan = parsePlanTreeLabel(text);

        if (course && (heading || value.length <= 120 || isInnermostDeepText(el, text))) {
            return { course, plan };
        }

        return { course: heading ? course : '', plan };
    }

    function walkElementsInOrder(root, visit, seen) {
        const visited = seen || new Set();

        if (!root || visited.has(root)) return;

        visited.add(root);

        function walk(node) {
            if (!node || node.nodeType !== 1) return;
            if (node.id === 'chartcheck-panel') return;
            if (isInHotkeyPanel(node)) return;

            visit(node);

            if (node.shadowRoot) walkElementsInOrder(node.shadowRoot, visit, visited);

            const tag = (node.tagName || '').toLowerCase();

            if (tag === 'iframe') {
                try {
                    if (node.contentDocument) {
                        walkElementsInOrder(node.contentDocument, visit, visited);
                    }
                } catch (err) {}
                return;
            }

            const children = node.children || [];

            for (let i = 0; i < children.length; i++) {
                walk(children[i]);
            }
        }

        if (root.nodeType === 9) walk(root.documentElement);
        else walk(root);
    }

    function isFractionsLabelElement(el) {
        if (!el || !el.tagName) return false;
        if (isInHotkeyPanel(el) || isInNavSidebar(el)) return false;

        const text = collectDeepText(el);

        if (!isDeliveredTotalFractionsLabel(text)) return false;

        const kids = [];

        if (el.shadowRoot) {
            Array.from(el.shadowRoot.children || []).forEach(child => kids.push(child));
        }

        Array.from(el.children || []).forEach(child => kids.push(child));

        for (let i = 0; i < kids.length; i++) {
            if (isDeliveredTotalFractionsLabel(collectDeepText(kids[i]))) {
                return false;
            }
        }

        return true;
    }

    function walkComposedTree(root, visit, seen) {
        const visited = seen || new Set();

        function walk(node) {
            if (!node || visited.has(node)) return;

            if (node.nodeType === 9) {
                walk(node.documentElement);
                return;
            }

            if (node.nodeType === 11) {
                const fragKids = node.children || [];

                for (let i = 0; i < fragKids.length; i++) walk(fragKids[i]);
                return;
            }

            if (node.nodeType !== 1) return;
            if (node.id === 'chartcheck-panel') return;
            if (isInHotkeyPanel(node)) return;

            visited.add(node);
            visit(node);

            if (node.shadowRoot) walk(node.shadowRoot);

            const tag = (node.tagName || '').toLowerCase();

            if (tag === 'slot' && typeof node.assignedElements === 'function') {
                const assigned = node.assignedElements();

                for (let i = 0; i < assigned.length; i++) walk(assigned[i]);
                return;
            }

            const children = node.children || [];

            for (let i = 0; i < children.length; i++) walk(children[i]);
        }

        walk(root);
        return visited;
    }

    function composedElementOrderMap(root) {
        const ranks = new Map();
        let order = 0;

        walkComposedTree(root, el => {
            ranks.set(el, order++);
        });

        return ranks;
    }

    function firstElementByTag(root, tagName) {
        const want = String(tagName || '').toLowerCase();
        const kids = root && root.children ? Array.from(root.children) : [];

        for (let i = 0; i < kids.length; i++) {
            if ((kids[i].tagName || '').toLowerCase() === want) return kids[i];
        }

        return null;
    }

    function tableHeadRow(table) {
        if (!table) return null;

        const thead = firstElementByTag(table, 'thead');

        if (thead) return firstElementByTag(thead, 'tr');

        return firstElementByTag(table, 'tr');
    }

    function tableHeadRows(table) {
        const rows = [];

        if (!table) return rows;

        const thead = firstElementByTag(table, 'thead');

        if (thead) {
            const kids = Array.from(thead.children || []);

            for (let i = 0; i < kids.length; i++) {
                if ((kids[i].tagName || '').toLowerCase() === 'tr') rows.push(kids[i]);
            }

            return rows;
        }

        const kids = Array.from(table.children || []);

        for (let i = 0; i < kids.length; i++) {
            const child = kids[i];
            const tag = (child.tagName || '').toLowerCase();

            if (tag === 'tbody' || tag === 'tfoot') break;
            if (tag !== 'tr') continue;

            const cells = tableRowCells(child);
            const hasTh = cells.some(cell => (cell.tagName || '').toLowerCase() === 'th');

            if (!hasTh && rows.length) break;
            if (hasTh) rows.push(child);
        }

        return rows;
    }

    function combinedHeaderCellText(headRows, index) {
        const parts = [];

        (headRows || []).forEach(row => {
            const cells = tableRowCellSlots(row);

            if (!cells[index]) return;

            const text = collectDeepText(cells[index]);

            if (text) parts.push(text);
        });

        return normalizeText(parts.join(' '));
    }

    // Read every thead row, not just the first. A title row or a
    // "Plan name" label row often sits above the row that holds
    // the plan names, and skipping those later rows used to miss
    // a second plan in a side-by-side Rx/Plan table.
    function readPlanColumnsFromTable(table) {
        const headRows = tableHeadRows(table);
        const cols = [];

        if (!headRows.length) return cols;

        let max = 0;

        headRows.forEach(row => {
            const count = tableRowCellSlots(row).length;

            if (count > max) max = count;
        });

        for (let i = 0; i < max; i++) {
            const combined = combinedHeaderCellText(headRows, i);
            const name = planNameFromHeaderCell(combined);
            const prev = cols[cols.length - 1];

            if (name) {
                if (prev && prev.planName === name && headerSlotSameCell(headRows, prev.index, i)) {
                    continue;
                }

                cols.push({ index: i, planName: name });
                continue;
            }

            if (isPlanNameLabel(combined) || /^plan\s*name\b/i.test(combined)) {
                if (prev && !prev.planName && headerSlotSameCell(headRows, prev.index, i)) {
                    continue;
                }

                cols.push({ index: i, planName: '' });
            }
        }

        return cols;
    }

    function tableBodyRows(table) {
        const rows = [];

        if (!table) return rows;

        const tbody = firstElementByTag(table, 'tbody');
        const source = tbody || table;
        const kids = Array.from(source.children || []);

        for (let i = 0; i < kids.length; i++) {
            if ((kids[i].tagName || '').toLowerCase() === 'tr') rows.push(kids[i]);
        }

        return rows;
    }

    function isTableCellElement(el) {
        const tag = (el && el.tagName || '').toLowerCase();

        return tag === 'th' || tag === 'td';
    }

    function tableRowCells(tr) {
        const direct = Array.from((tr && tr.children) || []).filter(isTableCellElement);

        if (direct.length) return direct;

        // Some overview grids wrap each cell, so td/th are not
        // direct children of the row.
        const nested = [];

        function visit(node) {
            if (!node) return;

            const tag = (node.tagName || '').toLowerCase();

            if (node !== tr && tag === 'table') return;

            if (node !== tr && isTableCellElement(node)) {
                nested.push(node);
                return;
            }

            Array.from((node.children || [])).forEach(visit);
        }

        visit(tr);
        return nested;
    }

    function cellColSpan(cell) {
        if (!cell) return 1;

        let raw = 1;

        try {
            if (cell.colSpan != null && cell.colSpan !== '') {
                raw = cell.colSpan;
            } else if (typeof cell.getAttribute === 'function') {
                const attr = cell.getAttribute('colspan');

                if (attr != null && attr !== '') raw = attr;
            }
        } catch (err) {}

        const span = Number(raw);

        return Number.isFinite(span) && span > 0 ? Math.floor(span) : 1;
    }

    // Visual column slots, repeating a cell for its colspan so a
    // fractions value that spans an Rx/Plan pair lines up with
    // the header columns.
    function tableRowCellSlots(tr) {
        const slots = [];

        tableRowCells(tr).forEach(cell => {
            const span = cellColSpan(cell);

            for (let i = 0; i < span; i++) slots.push(cell);
        });

        return slots;
    }

    function uniqueRowCellTexts(cells) {
        const texts = [];
        const seen = [];

        (cells || []).forEach(cell => {
            if (!cell || seen.indexOf(cell) >= 0) return;

            seen.push(cell);
            texts.push(collectDeepText(cell));
        });

        return texts;
    }

    function headerSlotSameCell(headRows, left, right) {
        const rows = headRows || [];
        let saw = false;

        for (let i = 0; i < rows.length; i++) {
            const slots = tableRowCellSlots(rows[i]);

            if (!slots[left] && !slots[right]) continue;
            if (slots[left] !== slots[right]) return false;

            saw = true;
        }

        return saw;
    }

    function planNameFromHeaderCell(text) {
        const value = normalizeText(text);

        if (!value) return '';

        return planNameFromLabeledText(value);
    }

    function parsePlanCellFractionTotal(text) {
        const value = normalizeText(text).replace(/[／⁄|]/g, '/');

        if (!value) return null;

        const pair = parseFractionPairTotal(value);

        if (pair != null) return pair;

        return loneFractionInteger(value);
    }

    function readPlanColumnsFromHeadRow(headRow) {
        const cols = [];
        const cells = tableRowCells(headRow);

        for (let i = 0; i < cells.length; i++) {
            const name = planNameFromHeaderCell(collectDeepText(cells[i]));

            if (name) cols.push({ index: i, planName: name });
        }

        return cols;
    }

    function findFractionsBodyRow(table) {
        const rows = tableBodyRows(table);

        for (let i = 0; i < rows.length; i++) {
            const cells = tableRowCells(rows[i]);
            const first = cells[0] ? collectDeepText(cells[0]) : '';

            if (isDeliveredTotalFractionsLabel(first) || isDeliveredTotalFractionsLabel(collectDeepText(rows[i]))) {
                return rows[i];
            }
        }

        return null;
    }

    function nearestOverviewTable(el) {
        let node = el;

        for (let i = 0; i < 24 && node; i++) {
            if ((node.tagName || '').toLowerCase() === 'table') return node;

            if (node.shadowRoot) {
                const kids = node.shadowRoot.querySelectorAll
                    ? node.shadowRoot.querySelectorAll('table')
                    : [];
                const tables = kids && kids.length ? Array.from(kids) : [];

                if (tables.length === 1) return tables[0];

                if (!tables.length) {
                    const nested = [];

                    walkComposedTree(node.shadowRoot, child => {
                        if ((child.tagName || '').toLowerCase() === 'table') nested.push(child);
                    });

                    if (nested.length === 1) return nested[0];
                } else if (tables.length === 1) {
                    return tables[0];
                }
            }

            node = composedParent(node);
        }

        return null;
    }

    function findSmallestFractionsLabelElements(root) {
        const hits = [];

        walkComposedTree(root, el => {
            if (isInNavSidebar(el) || isInHotkeyPanel(el)) return;
            if (isFractionsLabelElement(el)) hits.push(el);
        });

        return hits;
    }

    function parseCourseHeadingText(text) {
        const value = normalizeText(text).replace(/[：∶﹕]/g, ':');

        if (!value || !/^course:/i.test(value)) return '';

        return parseCourseLabel(value);
    }

    function nearestMainCourseHeading(el, ranks) {
        if (!el) return '';

        const rankMap = ranks || new Map();
        const elRank = rankMap.has(el) ? rankMap.get(el) : null;
        let best = '';
        let bestRank = -1;
        let node = composedParent(el);
        let steps = 0;

        while (node && steps < 30) {
            const text = collectDeepText(node);
            const course = parseCourseHeadingText(text);

            if (course && !isInNavSidebar(node) && !isInHotkeyPanel(node) && text.length <= 200) {
                const kids = Array.from(node.children || []);
                const childHas = kids.some(child => parseCourseHeadingText(collectDeepText(child)));

                if (!childHas || kids.length <= 2) return course;
            }

            node = composedParent(node);
            steps++;
        }

        const root = (el.ownerDocument || (typeof el.getRootNode === 'function' ? el.getRootNode() : null));
        const searchRoot = root && root.host ? (root.host.ownerDocument || root) : (el.ownerDocument || root);

        if (searchRoot) {
            walkComposedTree(searchRoot.nodeType ? searchRoot : searchRoot, item => {
                if (isInNavSidebar(item) || isInHotkeyPanel(item)) return;

                const course = parseCourseHeadingText(collectDeepText(item));

                if (!course) return;

                const itemRank = rankMap.has(item) ? rankMap.get(item) : null;

                if (elRank != null && itemRank != null && itemRank < elRank && itemRank >= bestRank) {
                    best = course;
                    bestRank = itemRank;
                }
            });
        }

        if (best) return best;

        // Walk preceding composed siblings via ancestors if ranks were missing.
        node = el;
        steps = 0;

        while (node && steps < 40) {
            let sib = node.previousElementSibling;

            while (sib) {
                if (!isInNavSidebar(sib) && !isInHotkeyPanel(sib)) {
                    let found = '';

                    walkComposedTree(sib, item => {
                        if (found || isInNavSidebar(item)) return;

                        const course = parseCourseHeadingText(collectDeepText(item));

                        if (course) found = course;
                    });

                    const own = parseCourseHeadingText(collectDeepText(sib));

                    if (own) return own;
                    if (found) return found;
                }

                sib = sib.previousElementSibling;
            }

            node = composedParent(node);
            steps++;
        }

        return best;
    }

    function readPlanRowsFromOverviewTable(table, courseName, order) {
        const cols = readPlanColumnsFromTable(table);
        const fracRow = findFractionsBodyRow(table);
        const rows = [];
        const start = order == null ? 0 : order;

        if (!fracRow) return rows;

        const cells = tableRowCellSlots(fracRow);

        if (cols.length) {
            cols.forEach((col, offset) => {
                const cell = cells[col.index];
                const total = cell ? parsePlanCellFractionTotal(collectDeepText(cell)) : null;

                rows.push({
                    courseName: courseName || '',
                    planName: col.planName,
                    totalFractions: total,
                    table,
                    order: start + offset
                });
            });

            return rows;
        }

        // No header names: still emit one row per N / M total in the
        // fractions row so two side-by-side plans are not collapsed
        // into a single unknown match.
        const texts = uniqueRowCellTexts(cells);
        const totals = readAllFractionTotalsFromCells(texts);

        totals.forEach((total, offset) => {
            rows.push({
                courseName: courseName || '',
                planName: '',
                totalFractions: total,
                table,
                order: start + offset
            });
        });

        return rows;
    }

    function findMainCourseHeadingRecords(root, ranks, startOrder) {
        const records = [];
        const seen = {};
        let order = startOrder || 0;

        walkComposedTree(root, el => {
            if (isInNavSidebar(el) || isInHotkeyPanel(el)) return;

            const text = collectDeepText(el);

            if (!text || text.length > 160) return;

            const course = parseCourseHeadingText(text);

            if (!course) return;

            const kids = Array.from(el.children || []);

            if (kids.some(child => parseCourseHeadingText(collectDeepText(child)) && collectDeepText(child).length < text.length)) {
                return;
            }

            const key = courseIdToken(course) || looseLabelKey(course);

            if (!key || seen[key]) return;

            seen[key] = true;
            records.push({
                courseName: course,
                planName: '',
                totalFractions: null,
                headingOnly: true,
                order: order++
            });
        });

        return records;
    }

    function mergeOverviewPlanRows() {
        const merged = [];
        const lists = Array.from(arguments);
        const seen = new Set();
        const tableIds = typeof WeakMap === 'function' ? new WeakMap() : null;
        let tableSeq = 0;

        function tableKey(table) {
            if (!table) return '';

            if (tableIds) {
                if (!tableIds.has(table)) tableIds.set(table, ++tableSeq);

                return String(tableIds.get(table));
            }

            return String(++tableSeq);
        }

        function keyFor(row) {
            if (row && row.table && row.planName) {
                return 't:' + tableKey(row.table) + ':' + looseLabelKey(row.planName);
            }

            const course = courseIdToken(row && row.courseName) || looseLabelKey(row && row.courseName);
            const plan = looseLabelKey(row && row.planName);

            return 'c:' + course + ':' + plan + ':' + String(row && row.totalFractions);
        }

        function score(row) {
            let n = 0;

            if (row && row.totalFractions != null) n += 4;
            if (row && row.planName) n += 2;
            if (row && row.courseName && !row.headingOnly) n += 1;
            if (row && row.table) n += 1;

            return n;
        }

        lists.forEach(list => {
            (list || []).forEach(row => {
                if (!row) return;

                const key = keyFor(row);
                const existing = seen.has(key) ? merged.find(item => keyFor(item) === key) : null;

                if (existing) {
                    if (score(row) > score(existing)) {
                        merged[merged.indexOf(existing)] = row;
                    }
                    return;
                }

                // Prefer a full table row over a heading-only row for the same course
                // when the table row has no plan name collision.
                if (row.headingOnly) {
                    const id = courseIdToken(row.courseName) || looseLabelKey(row.courseName);
                    const hasBetter = merged.some(item => (
                        !item.headingOnly
                        && (courseIdToken(item.courseName) || looseLabelKey(item.courseName)) === id
                    ));

                    if (hasBetter) return;
                } else {
                    const id = courseIdToken(row.courseName) || looseLabelKey(row.courseName);

                    for (let i = merged.length - 1; i >= 0; i--) {
                        const item = merged[i];
                        const other = courseIdToken(item.courseName) || looseLabelKey(item.courseName);

                        if (item.headingOnly && id && other === id) {
                            merged.splice(i, 1);
                            seen.delete(keyFor(item));
                        }
                    }
                }

                seen.add(key);
                merged.push(row);
            });
        });

        return merged;
    }

    function scanTemplateMatchPage(selects) {
        const events = [];
        let order = 0;
        const selectSet = new Set(selects || []);

        overviewDocuments().forEach(doc => {
            walkElementsInOrder(doc, el => {
                const label = readPrefixedLabelAt(el);

                if (label.course) {
                    events.push({ order: order++, kind: 'course', text: label.course, el });
                }

                if (label.plan) {
                    events.push({ order: order++, kind: 'plan', text: label.plan, el });
                }

                if (selectSet.has(el)) {
                    events.push({ order: order++, kind: 'select', el });
                }

                if (isFractionsLabelElement(el)) {
                    events.push({ order: order++, kind: 'fractions', el });
                }
            });
        });

        const courseEvents = events.filter(item => item.kind === 'course');
        const planEvents = events.filter(item => item.kind === 'plan');
        const courseBySelect = new Map();
        const planBySelect = new Map();

        events.forEach(item => {
            if (item.kind !== 'select') return;

            const course = nearestPrecedingLabel(item.order, courseEvents);
            const plan = nearestPrecedingLabel(item.order, planEvents);

            if (course) courseBySelect.set(item.el, course);
            if (plan) planBySelect.set(item.el, plan);
        });

        const rawBlocks = [];

        events.forEach(item => {
            if (item.kind !== 'fractions') return;

            const record = readOverviewRecordFromFractionsLabel(item.el);
            let container = item.el;
            const ancestorIds = [];

            for (let i = 0; i < 12 && container && container.parentElement; i++) {
                const parent = container.parentElement;

                if (!parent || countInnermostFractionsLabels(parent) > 1) break;

                ancestorIds.push(parent);
                container = parent;

                const cells = [];

                collectOverviewCells(container, cells);

                if (readAllPlanNamesFromCells(cells).length || readTotalFractionsFromCells(cells) != null) {
                    break;
                }
            }

            const cells = [];

            collectOverviewCells(container || item.el, cells);

            const courseName = nearestPrecedingLabel(item.order, courseEvents)
                || (record && record.courseName)
                || '';

            rawBlocks.push({
                id: container || item.el,
                container: container || item.el,
                ancestorIds,
                courseName,
                planName: record && record.planName ? record.planName : readPlanNameFromCells(cells),
                totalFractions: record && record.totalFractions != null
                    ? record.totalFractions
                    : readTotalFractionsFromCells(cells),
                cells,
                order: item.order
            });
        });

        const uniqueBlocks = dedupeOverviewBlocks(rawBlocks);
        const overviews = [];

        uniqueBlocks.forEach(block => {
            const rows = extractPlanRowsFromCells(block.cells || [], block.courseName);

            if (rows.length) {
                rows.forEach((row, rowIndex) => {
                    if (!row.courseName) row.courseName = block.courseName || '';
                    if (row.order == null) row.order = (block.order != null ? block.order : overviews.length) + rowIndex;
                    overviews.push(row);
                });
                return;
            }

            if (block.totalFractions != null && block.planName) {
                overviews.push({
                    courseName: block.courseName || '',
                    planName: block.planName,
                    totalFractions: block.totalFractions,
                    order: block.order != null ? block.order : overviews.length
                });
            }
        });

        const selectOrder = new Map();

        events.forEach(item => {
            if (item.kind === 'select') selectOrder.set(item.el, item.order);
        });

        return {
            events,
            courseBySelect,
            planBySelect,
            selectOrder,
            overviews,
            uniqueBlocks,
            counts: {
                sel: (selects || []).length,
                blocks: uniqueBlocks.length,
                rows: overviews.length,
                courses: courseEvents.length,
                planLabels: planEvents.length
            }
        };
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

    function collectCourseLabels(root) {
        const names = [];

        if (!root) return names;

        const directText = collectDeepText(root);
        const direct = parseCourseLabel(directText);

        if (direct && isInnermostDeepText(root, directText)) {
            names.push(direct);
            return names;
        }

        walkDom(root, el => {
            if (!el.tagName) return;

            const text = collectDeepText(el);
            const name = parseCourseLabel(text);

            if (name && isInnermostDeepText(el, text)) {
                names.push(name);
            }
        });

        return names;
    }

    function findCourseLabelNearSelect(select) {
        let node = select;

        for (let i = 0; i < 14 && node && node !== document; i++) {
            let sib = node.previousElementSibling;

            while (sib) {
                const names = collectCourseLabels(sib);

                if (names.length === 1) return names[0];

                sib = sib.previousElementSibling;
            }

            const own = collectCourseLabels(node);

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
        let courseName = '';
        let node = label;

        for (let i = 0; i < 16 && node; i++) {
            if (node !== label && countInnermostFractionsLabels(node) > 1) {
                break;
            }

            const courseNames = collectCourseLabels(node);

            if (node !== label && courseNames.length > 1) {
                break;
            }

            const cells = [];

            collectOverviewCells(node, cells);

            if (!planName) planName = readPlanNameFromCells(cells);
            if (!courseName && courseNames.length === 1) {
                courseName = courseNames[0];
            }
            if (totalFractions == null) {
                totalFractions = readTotalFractionsFromCells(cells);
            }

            if ((planName || courseName) && totalFractions != null) {
                return { courseName, planName, totalFractions };
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

        if (totalFractions == null && !planName && !courseName) return null;

        return { courseName, planName, totalFractions };
    }

    function collectOverviewRowsFromRoot(root) {
        const ranks = composedElementOrderMap(root);
        const fromTables = [];
        const seenTables = new Set();
        let order = 0;

        findSmallestFractionsLabelElements(root).forEach(label => {
            const table = nearestOverviewTable(label);
            const courseName = nearestMainCourseHeading(label, ranks)
                || nearestMainCourseHeading(table, ranks)
                || '';

            if (table) {
                if (seenTables.has(table)) return;

                seenTables.add(table);

                const extracted = readPlanRowsFromOverviewTable(table, courseName, order);

                if (extracted.length) {
                    extracted.forEach(row => fromTables.push(row));
                    order += extracted.length;
                    return;
                }
            }

            const record = readOverviewRecordFromFractionsLabel(label);

            if (record && (record.totalFractions != null || record.planName)) {
                fromTables.push({
                    courseName: record.courseName || courseName,
                    planName: record.planName || '',
                    totalFractions: record.totalFractions,
                    table: table || null,
                    order: order++
                });
            }
        });

        const headings = findMainCourseHeadingRecords(root, ranks, order);

        return mergeOverviewPlanRows(fromTables, headings);
    }

    // 3.46-style fallback: every smallest fractions label that yields
    // a parseable total, including nested wrappers. Later merged and
    // deduped against table-based rows.
    function findOverviewPlanRecordsLegacy() {
        const records = [];
        let order = 0;

        overviewDocuments().forEach(doc => {
            walkDom(doc, el => {
                if (!el.tagName || isInPatientsSidebar(el) || isInHotkeyPanel(el)) {
                    return;
                }

                const text = collectDeepText(el);

                if (!isDeliveredTotalFractionsLabel(text)) return;

                const kids = Array.from(el.children || []);

                if (kids.some(child => isDeliveredTotalFractionsLabel(collectDeepText(child)))) {
                    return;
                }

                const record = readOverviewRecordFromFractionsLabel(el);

                if (record && record.totalFractions != null) {
                    records.push({
                        courseName: record.courseName || '',
                        planName: record.planName || '',
                        totalFractions: record.totalFractions,
                        order: order++
                    });
                }
            });
        });

        return records;
    }

    function findOverviewPlanRecords() {
        const collected = [];

        overviewDocuments().forEach(doc => {
            collectOverviewRowsFromRoot(doc).forEach(row => collected.push(row));
        });

        return mergeOverviewPlanRows(collected, findOverviewPlanRecordsLegacy());
    }

    function describeTemplateSelect(select, scan) {
        const text = selectedTemplateText(select);
        const filled = isValidSiteTemplate(text);
        const unselected = isTemplateSelectUnselected(select);
        const fromScan = scan || {};

        return {
            text,
            filled,
            unselected,
            planName: (fromScan.planBySelect && fromScan.planBySelect.get(select))
                || findPlanNameNearSelect(select),
            courseName: (fromScan.courseBySelect && fromScan.courseBySelect.get(select))
                || findCourseLabelNearSelect(select),
            optionTexts: Array.from(select.options || []).map(option => (
                option && option.text ? String(option.text).trim() : ''
            )),
            order: (fromScan.selectOrder && fromScan.selectOrder.get(select))
                || 0
        };
    }

    async function ensureReviewTemplates() {
        const selects = getTemplateSelects();
        const scan = scanTemplateMatchPage(selects);

        if (selects.length === 0 && checksNeedTemplatePrompt()) {
            setReviewNote('Template needed', formatReviewReason('prompt?', scan.counts));
            return 'stop';
        }

        const plans = selects.map(select => describeTemplateSelect(select, scan));
        const overviews = mergeOverviewPlanRows(scan.overviews, findOverviewPlanRecords());
        const tableCount = new Set(overviews.map(row => row && row.table).filter(Boolean)).size;
        const match = resolvePlanTemplateMatch(plans, overviews, {
            blocks: tableCount || (scan.counts.blocks != null ? scan.counts.blocks : 0)
        });
        const unsel = plans.filter(plan => plan && !plan.filled && plan.unselected).length;
        const namedPlans = plans.filter(plan => plan && plan.planName).length;
        const namedCourses = plans.filter(plan => plan && plan.courseName).length;
        const counts = Object.assign({}, match.stats, {
            sel: selects.length,
            unsel,
            blocks: tableCount || (scan.counts.blocks != null ? scan.counts.blocks : 0),
            rows: overviews.length,
            courses: Math.max(Number(scan.counts.courses) || 0, namedCourses, Number(match.stats.courses) || 0),
            planLabels: Math.max(Number(scan.counts.planLabels) || 0, namedPlans),
            near: match.stats.near || 0
        });
        const decision = templateReviewDecision(
            resolveReviewSite(detectPatientSite(), plans),
            match.contexts
        );

        if (decision.action === 'ok') return 'ok';

        if (decision.action === 'stop') {
            setReviewNote(decision.message, formatReviewReason(decision.reason, counts));
            return 'stop';
        }

        const targets = (decision.unfilledIndexes || [])
            .map(index => selects[index])
            .filter(Boolean);

        const applied = await applyTemplateAndWait(decision.templateName, targets);

        if (!applied) {
            setReviewNote('Template needed', formatReviewReason('checks?', counts));
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

    function isInNavSidebar(el) {
        return ancestorChain(el).some(node => {
            const tag = node.tagName ? node.tagName.toLowerCase() : '';

            return tag === 'patients-sidebar' || tag === 'sections-sidebar';
        });
    }

    function composedRootHost(node) {
        if (!node || typeof node.getRootNode !== 'function') return null;

        const root = node.getRootNode();

        return root && root.host ? root.host : null;
    }

    function composedParent(node) {
        if (!node) return null;

        return node.parentElement || composedRootHost(node) || null;
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

        // Already copied this patient and the banner does not need
        // to change: skip the heading / center-line document walk.
        if (copiedIdentity === identity && !awaitingFreshBanner) {
            return;
        }

        const obs = bannerObservation();

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

    function isSmallTextCandidate(el) {
        if (!el || !el.tagName) return false;

        try {
            if (el.childElementCount > 12) return false;
            if (el.getElementsByTagName && el.getElementsByTagName('*').length > 32) {
                return false;
            }
        } catch (err) {}

        return true;
    }

    function considerCenterLineElement(el, matches) {
        if (!el || !el.tagName) return;

        const tag = el.tagName.toLowerCase();

        if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
        if (tag === 'patients-sidebar' || isOwnPanelNode(el)) return;

        try {
            if (typeof el.closest === 'function' && el.closest('patients-sidebar')) {
                return;
            }
        } catch (err) {}

        if (isInPatientsSidebar(el) || isInHotkeyPanel(el)) return;
        if (!isSmallTextCandidate(el)) return;

        const text = normalizeText(el.textContent);

        if (text.length > 240 || !isCenterLine(text)) return;

        for (const child of el.children) {
            if (isCenterLine(child.textContent)) return;
        }

        matches.push(el);
    }

    function findCenterLineElements() {
        const matches = [];

        function walk(root) {
            if (!root || !root.querySelectorAll) return;

            const all = root.querySelectorAll('*');

            for (let i = 0; i < all.length; i++) {
                const el = all[i];
                const tag = (el.tagName || '').toLowerCase();

                if (tag === 'patients-sidebar' || isOwnPanelNode(el)) continue;

                try {
                    if (typeof el.closest === 'function' && el.closest('patients-sidebar')) {
                        continue;
                    }
                } catch (err) {}

                considerCenterLineElement(el, matches);

                if (el.shadowRoot) walk(el.shadowRoot);
            }
        }

        walk(document);
        return matches;
    }

    function findCenterLineText() {
        if (isConnectedNode(cachedCenterLineEl)) {
            const cachedText = normalizeText(cachedCenterLineEl.textContent);

            if (isCenterLine(cachedText) && cachedText.length <= 240) {
                return cachedText;
            }

            cachedCenterLineEl = null;
        }

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

        cachedCenterLineEl = bestEl;
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
    function fractionsLabelNorm(text) {
        return normalizeText(text)
            .toLowerCase()
            .replace(/[／⁄|]/g, '/')
            .replace(/\s*\/\s*/g, '/');
    }

    function isDeliveredTotalFractionsLabel(text) {
        const value = normalizeText(text)
            .toLowerCase()
            .replace(/[／⁄|]/g, '/')
            .replace(/\s*\/\s*/g, '/');

        if (!value) return false;

        return value === 'delivered/total fractions'
            || value === 'delivered/total fraction'
            || value.startsWith('delivered/total fractions')
            || value.startsWith('delivered/total fraction/')
            || value.startsWith('delivered/total fraction ');
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

    function parseAllFractionPairTotals(text) {
        const value = normalizeText(text).replace(/[／⁄|]/g, '/');

        if (!value) return [];

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

        if (explicit.length) return explicit;
        return implicit;
    }

    function parseFractionPairTotal(text) {
        const all = parseAllFractionPairTotals(text);

        return all.length ? all[all.length - 1] : null;
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

            // ShadowRoot and document fragments are nodeType 11.
            if (node.nodeType === 11) {
                for (const child of node.childNodes || []) visit(child);
                return;
            }

            if (node.nodeType !== 1) return;
            if (node.id === 'chartcheck-panel') return;

            const tag = (node.tagName || '').toLowerCase();

            if (tag === 'script' || tag === 'style' || tag === 'noscript') {
                return;
            }

            if (tag === 'br') {
                parts.push(' ');
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
        if (!pageScanDirty && cachedOverviewDocs && cachedOverviewDocs.length) {
            return cachedOverviewDocs;
        }

        const docs = [];
        const seen = new Set();

        function add(doc) {
            if (!doc || seen.has(doc)) return;

            seen.add(doc);
            docs.push(doc);

            collectDeepByQuery(doc, 'iframe', []).forEach(el => {
                try {
                    if (el.contentDocument) add(el.contentDocument);
                } catch (err) {}
            });
        }

        add(document);
        cachedOverviewDocs = docs;
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

    // Use each plan's fx for SBRT/Standard gray-out, whether or
    // not a Check Template is already selected.
    // Enable SBRT if any plan has known fx<=5, or if any plan's
    // fx is unknown. Mute SBRT only when every plan has a known
    // total greater than 5. Standard is never muted by fx.
    function isKnownFractionTotal(value) {
        return value != null && Number.isFinite(value) && value > 0;
    }

    function sbrtGrayFractionsFromPlans(planStates) {
        const totals = [];

        (planStates || []).forEach(state => {
            if (!state) return;

            const fx = state.totalFractions;

            if (
                state.tableFound
                && fx != null
                && Number.isFinite(fx)
                && fx > 0
            ) {
                totals.push(fx);
            } else {
                totals.push(null);
            }
        });

        if (!totals.length) return null;

        const known = totals.filter(value => value != null);
        const shortCourse = known.filter(value => value <= 5);

        if (shortCourse.length) return Math.min.apply(null, shortCourse);
        if (known.length < totals.length) return null;
        if (!known.length) return null;

        return known[0];
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

    // If the per-plan match has no known total, use a page-wide
    // Delivered / Total Fractions reading only when at most one
    // plan is in play, so a longer first course cannot mask a
    // different plan.
    function sbrtGrayFractionsWithFallback(planStates, fallbackTotal) {
        const fromPlans = sbrtGrayFractionsFromPlans(planStates);

        if (isKnownFractionTotal(fromPlans)) return fromPlans;

        const states = planStates || [];

        if (states.length <= 1 && isKnownFractionTotal(fallbackTotal)) {
            return fallbackTotal;
        }

        return fromPlans;
    }

    function grayFractionSelectSignature(selects) {
        return (selects || []).map(select => {
            if (!select) return '';

            const value = select.value != null ? String(select.value) : '';
            let text = '';

            try {
                text = selectedTemplateText(select) || '';
            } catch (err) {}

            if (!text && select.options && select.selectedIndex >= 0) {
                const option = select.options[select.selectedIndex];
                text = option && option.text ? String(option.text) : '';
            }

            return value + '=' + text;
        }).join(';');
    }

    // Cheap invalidation only: href, table counts, and text length.
    // This does not parse fraction totals.
    function cheapTextHash(text) {
        const value = String(text || '');
        let hash = 0;

        for (let i = 0; i < value.length; i++) {
            hash = (hash * 33 + value.charCodeAt(i)) | 0;
        }

        return hash + ':' + value.length;
    }

    function cheapOverviewTextSignature() {
        let href = '';
        let tables = 0;
        let length = 0;
        let hash = 0;

        try {
            href = typeof location !== 'undefined' && location.href
                ? String(location.href)
                : '';
        } catch (err) {}

        try {
            overviewDocuments().forEach(doc => {
                const root = doc.body || doc.documentElement;

                if (!root) return;

                if (root.getElementsByTagName) {
                    const list = root.getElementsByTagName('table');
                    tables += list.length;

                    for (let i = 0; i < list.length; i++) {
                        const text = list[i].textContent || '';
                        length += text.length;
                        hash ^= cheapTextHash(text);
                    }
                }

                if (root.querySelectorAll) {
                    const hosts = root.querySelectorAll(
                        'rx-pass-state-table, weekly-plan-check-view'
                    );

                    for (let i = 0; i < hosts.length; i++) {
                        const shadow = hosts[i].shadowRoot;

                        if (shadow) {
                            const text = shadow.textContent || '';
                            length += text.length;
                            hash ^= cheapTextHash(text);
                        }
                    }
                }
            });
        } catch (err) {}

        return href + ':' + tables + ':' + length + ':' + hash;
    }

    function grayFractionPageSignature(selects) {
        const list = selects || [];

        return grayFractionSelectSignature(list)
            + '\n'
            + String(list.length)
            + '\n'
            + cheapOverviewTextSignature();
    }

    let grayFractionCache = {
        key: null,
        value: null,
        ready: false
    };

    function cachedGrayFractions(key, compute) {
        if (grayFractionCache.ready && grayFractionCache.key === key) {
            return grayFractionCache.value;
        }

        const value = typeof compute === 'function' ? compute() : compute;

        grayFractionCache = {
            key,
            value,
            ready: true
        };

        return value;
    }

    const GRAY_DEBUG_FLAG = 'cc_debug_gray';

    function isGrayDebugEnabled() {
        try {
            if (typeof localStorage === 'undefined' || !localStorage) return false;

            const value = localStorage.getItem(GRAY_DEBUG_FLAG);

            return value === '1' || value === 'true';
        } catch (err) {
            return false;
        }
    }

    // Counts only: totals and flags. Never log names, IDs, or page text.
    function logGrayDebug(info) {
        if (!isGrayDebugEnabled()) return;

        const data = info || {};

        try {
            console.info('[ChartCheck] gray', {
                selects: data.selects,
                planCount: data.planCount,
                planTotals: Array.isArray(data.planTotals) ? data.planTotals.slice() : [],
                overviewTotals: Array.isArray(data.overviewTotals) ? data.overviewTotals.slice() : [],
                usedOverviewFallback: !!data.usedOverviewFallback,
                result: data.result
            });
        } catch (err) {}
    }

    function nearestFractionsRowElement(label) {
        let node = label;

        for (let i = 0; i < 12 && node; i++) {
            const tag = (node.tagName || '').toLowerCase();

            if (tag === 'tr') return node;

            if (tag === 'table') {
                return findFractionsBodyRow(node) || node;
            }

            try {
                if (typeof node.getAttribute === 'function' && node.getAttribute('role') === 'row') {
                    return node;
                }
            } catch (err) {}

            node = typeof composedParent === 'function' ? composedParent(node) : (node.parentElement || node.parentNode);
        }

        return label && (label.parentElement || label.parentNode) ? (label.parentElement || label.parentNode) : label;
    }

    function readFractionTotalsFromRowElement(row) {
        if (!row) return [];

        const cells = tableRowCellSlots(row);
        const fromCells = cells.length
            ? readAllFractionTotalsFromCells(uniqueRowCellTexts(cells))
            : [];

        if (fromCells.length) return fromCells;

        const inner = [];

        try {
            collectOverviewCells(row, inner);
        } catch (err) {}

        if (inner.length) {
            const fromInner = readAllFractionTotalsFromCells(inner);

            if (fromInner.length) return fromInner;
        }

        return parseAllFractionPairTotals(collectDeepText(row));
    }

    // Every N / M (or bare Rx integer) total in Delivered / Total
    // Fractions rows, including shadow roots. Used when a per-plan
    // match leaves any total unknown.
    function readAllOverviewFractionTotals() {
        const totals = [];
        const seen = new Set();

        function addFromRow(row) {
            if (!row || seen.has(row)) return;

            const found = readFractionTotalsFromRowElement(row);

            if (!found.length) return;

            seen.add(row);
            found.forEach(value => {
                if (isKnownFractionTotal(value)) totals.push(value);
            });
        }

        overviewDocuments().forEach(doc => {
            const root = doc.body || doc.documentElement || doc;

            walkComposedTree(root, el => {
                if (isInNavSidebar(el) || isInHotkeyPanel(el) || isInPatientsSidebar(el)) {
                    return;
                }

                if ((el.tagName || '').toLowerCase() === 'table') {
                    addFromRow(findFractionsBodyRow(el));
                }
            });

            findSmallestFractionsLabelElements(root).forEach(label => {
                const table = nearestOverviewTable(label);

                if (table) {
                    addFromRow(findFractionsBodyRow(table));
                    return;
                }

                addFromRow(nearestFractionsRowElement(label));
            });
        });

        return totals;
    }

    // Mute only when every found overview total is known and >5,
    // and there are at least as many totals as plan selects.
    function sbrtGrayFractionsFromOverviewTotals(totals, selectCount) {
        const list = (totals || []).filter(isKnownFractionTotal);
        const needed = Number(selectCount) || 0;

        if (!list.length || list.length !== (totals || []).length) return null;
        if (needed > 0 && list.length < needed) return null;
        if (list.some(value => value <= 5)) return null;

        return list[0];
    }

    function sbrtGrayFractionsWithOverviewFallback(planStates, fallbackTotal, overviewTotals, selectCount) {
        const fromPlans = sbrtGrayFractionsWithFallback(planStates, fallbackTotal);

        if (isKnownFractionTotal(fromPlans)) return fromPlans;

        const fromOverview = sbrtGrayFractionsFromOverviewTotals(overviewTotals, selectCount);

        return isKnownFractionTotal(fromOverview) ? fromOverview : fromPlans;
    }

    function computeTemplateGrayFractions(selects) {
        const list = selects || [];

        if (!list.length) {
            const none = readTotalFractions();

            logGrayDebug({
                selects: 0,
                planCount: 0,
                planTotals: [],
                overviewTotals: [],
                usedOverviewFallback: false,
                result: none
            });

            return none;
        }

        const scan = scanTemplateMatchPage(list);
        const plans = list.map(select => describeTemplateSelect(select, scan));
        const overviews = mergeOverviewPlanRows(scan.overviews, findOverviewPlanRecords());
        const tableCount = new Set(overviews.map(row => row && row.table).filter(Boolean)).size;
        const match = resolvePlanTemplateMatch(plans, overviews, {
            blocks: tableCount || (scan.counts.blocks != null ? scan.counts.blocks : 0)
        });
        const fromPlans = sbrtGrayFractionsFromPlans(match.contexts);

        // Skip the page-wide document scan unless the per-plan match
        // has no known total and a single-plan fallback is allowed.
        let result;

        if (isKnownFractionTotal(fromPlans) || (match.contexts || []).length > 1) {
            result = sbrtGrayFractionsWithFallback(match.contexts, null);
        } else {
            result = sbrtGrayFractionsWithFallback(match.contexts, readTotalFractions());
        }

        let overviewTotals = [];
        let usedOverviewFallback = false;

        if (!isKnownFractionTotal(result)) {
            overviewTotals = readAllOverviewFractionTotals();
            result = sbrtGrayFractionsWithOverviewFallback(
                match.contexts,
                null,
                overviewTotals,
                list.length
            );
            usedOverviewFallback = isKnownFractionTotal(result);
        }

        logGrayDebug({
            selects: list.length,
            planCount: (match.contexts || []).length,
            planTotals: (match.contexts || []).map(ctx => (
                ctx && isKnownFractionTotal(ctx.totalFractions) ? ctx.totalFractions : null
            )),
            overviewTotals,
            usedOverviewFallback,
            result
        });

        return result;
    }

    function readTemplateGrayFractions() {
        const selects = getTemplateSelects();

        return cachedGrayFractions(grayFractionPageSignature(selects), function () {
            return computeTemplateGrayFractions(selects);
        });
    }

    function isTemplateHotkeyMuted(sitePair, isSbrt) {
        return isSiteTemplateMuted(
            detectPatientSite(),
            readTemplateGrayFractions(),
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


    const SKELETON_WHITELIST_PHRASES = [
        'check template',
        'course id',
        'plan name',
        'rx name',
        'plan overview',
        'prescription / plan overview',
        'rx/plan overview',
        'delivered / total fractions',
        'delivered / total dose',
        'dose per fraction',
        'method of delivery',
        'approval status',
        'initial treatment checks',
        'ref points'
    ];

    const SKELETON_WHITELIST_TOKENS = {
        course: 1, plan: 1, delivered: 1, total: 1, fractions: 1, fraction: 1,
        template: 1, templates: 1, standard: 1, rx: 1, site: 1, status: 1, fx: 1,
        check: 1, name: 1, id: 1, dose: 1, energy: 1, approval: 1, method: 1,
        delivery: 1, overview: 1, prescription: 1, documentation: 1, imaging: 1,
        field: 1, fields: 1, points: 1, ref: 1, initial: 1, treatment: 1,
        checks: 1, per: 1, of: 1, and: 1, or: 1, the: 1, a: 1, an: 1, to: 1,
        from: 1, with: 1, for: 1, in: 1, on: 1, at: 1, by: 1, yes: 1, no: 1,
        not: 1, new: 1, next: 1, previous: 1, open: 1, close: 1, save: 1,
        cancel: 1, help: 1, view: 1, details: 1, date: 1, time: 1, days: 1,
        last: 1, filter: 1, search: 1, sort: 1, type: 1, unit: 1, table: 1,
        row: 1, column: 1, header: 1, item: 1, list: 1, tree: 1, menu: 1,
        button: 1, select: 1, label: 1, note: 1, notes: 1, comment: 1,
        comments: 1, warning: 1, error: 1, info: 1, ready: 1, pending: 1,
        complete: 1, completed: 1, approved: 1, active: 1, inactive: 1,
        image: 1, images: 1, structure: 1, structures: 1, beam: 1, beams: 1,
        patient: 1, patients: 1, history: 1, report: 1, print: 1, export: 1,
        settings: 1, loading: 1, unknown: 1, current: 1, none: 1, na: 1,
        days: 1, today: 1, yesterday: 1, week: 1, this: 1, update: 1, apply: 1,
        review: 1, approve: 1, selected: 1, unselected: 1
    };

    function isSkeletonWhitelistToken(token) {
        const value = normalizeText(token).toLowerCase();

        return !!SKELETON_WHITELIST_TOKENS[value];
    }

    function maskSkeletonText(text) {
        let value = normalizeText(text);

        if (!value) return '';

        const phrases = SKELETON_WHITELIST_PHRASES.slice().sort((a, b) => b.length - a.length);
        const held = [];

        phrases.forEach((phrase, index) => {
            const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

            value = value.replace(re, () => {
                const key = '\u0001' + '#'.repeat(held.length + 1) + '\u0001';

                held.push(phrase);
                return key;
            });
        });

        value = value.replace(/[A-Za-z][A-Za-z0-9_]*|[0-9]+/g, token => {
            if (isSkeletonWhitelistToken(token)) return token;

            return token.replace(/[A-Za-z0-9]/g, 'x');
        });

        held.forEach((phrase, index) => {
            value = value.replace('\u0001' + '#'.repeat(index + 1) + '\u0001', phrase);
        });

        return value;
    }

    function isSafeSkeletonClassName(name) {
        const value = normalizeText(name);

        if (!value || value.length > 24) return false;
        if (/^ng-/.test(value) && value.length > 16) return false;

        const digits = (value.match(/\d/g) || []).length;

        if (digits >= 3) return false;
        if (digits / value.length >= 0.3 && digits >= 2) return false;
        if (/[a-f0-9]{8,}/i.test(value)) return false;

        return true;
    }

    function safeSkeletonClassList(el) {
        const raw = el && el.className != null ? String(el.className) : '';
        const names = raw.split(/\s+/).filter(Boolean).filter(isSafeSkeletonClassName);

        return names.slice(0, 8);
    }

    function skeletonAttrNames(el) {
        const names = [];

        if (!el || !el.attributes) return names;

        const attrs = el.attributes;

        for (let i = 0; i < attrs.length; i++) {
            const name = attrs[i] && attrs[i].name ? String(attrs[i].name) : '';

            if (!name) continue;
            if (name === 'class' || name === 'style') continue;
            if (name === 'role' || name.indexOf('aria-') === 0 || name.indexOf('data-') === 0) {
                names.push(name);
            } else if (name === 'id' || name === 'name' || name === 'title' || name === 'hidden') {
                names.push(name);
            }
        }

        return names;
    }

    function isSkeletonTextSafe(text) {
        const value = String(text || '');
        const phrases = SKELETON_WHITELIST_PHRASES.slice().sort((a, b) => b.length - a.length);
        let rest = value;

        phrases.forEach(phrase => {
            rest = rest.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
        });

        rest = rest.replace(/[A-Za-z][A-Za-z0-9_]*/g, token => {
            return isSkeletonWhitelistToken(token) ? ' ' : token;
        });

        if (/[0-9]/.test(rest)) return false;
        if (/[A-Za-z]/.test(rest.replace(/x+/g, ' '))) return false;

        return true;
    }

    function elementHasShadow(el) {
        return !!(el && el.shadowRoot);
    }

    function elementIsIframe(el) {
        return !!(el && (el.tagName || '').toLowerCase() === 'iframe');
    }

    function describeSkeletonNode(el, depth) {
        if (!el || !el.tagName) return '';

        const tag = (el.tagName || '').toLowerCase();
        const classes = safeSkeletonClassList(el);
        const attrs = skeletonAttrNames(el);
        const kids = (el.children && el.children.length) || 0;
        const bits = ['d' + (depth || 0), tag];

        if (classes.length) bits.push('.' + classes.join('.'));
        if (attrs.length) bits.push('attrs=' + attrs.join(','));
        bits.push('children=' + kids);

        if (elementHasShadow(el)) bits.push('shadow');
        if (elementIsIframe(el)) bits.push('iframe');

        const text = maskSkeletonText(collectDeepText(el));

        if (text && text.length <= 80 && (kids === 0 || text.length <= 40)) {
            bits.push('text=' + text);
        }

        return bits.join(' ');
    }

    function collectAncestorPath(el, limit) {
        const parts = [];
        let node = el;
        const max = limit == null ? 12 : limit;

        while (node && node.tagName && parts.length < max) {
            if (node.id === 'chartcheck-panel' || node.id === 'chartcheck-dom-copy') break;

            parts.push(describeSkeletonNode(node, parts.length));
            node = node.parentElement
                || (typeof node.getRootNode === 'function' && node.getRootNode() && node.getRootNode().host)
                || null;
        }

        return parts.reverse();
    }

    function siblingElements(el) {
        const parent = el && el.parentElement;

        if (!parent) return [];

        return Array.from(parent.children || []).filter(node => node && node.tagName);
    }

    function collectSiblingSkeletons(el, count) {
        const kids = siblingElements(el);
        const index = kids.indexOf(el);
        const prev = [];
        const next = [];
        const take = count == null ? 3 : count;

        if (index < 0) return { prev, next };

        for (let i = Math.max(0, index - take); i < index; i++) {
            prev.push(describeSkeletonNode(kids[i], 0));
        }

        for (let i = index + 1; i < kids.length && next.length < take; i++) {
            next.push(describeSkeletonNode(kids[i], 0));
        }

        return { prev, next };
    }

    function walkSkeletonSubtree(root, lines, depth, maxDepth, maxLines) {
        if (!root || !root.tagName || lines.length >= maxLines) return;
        if (root.id === 'chartcheck-panel' || root.id === 'chartcheck-dom-copy') return;
        if (depth > maxDepth) return;

        lines.push((new Array(depth + 1).join('  ')) + describeSkeletonNode(root, depth));

        if (elementHasShadow(root) && lines.length < maxLines) {
            lines.push((new Array(depth + 2).join('  ')) + '#shadow');
            const kids = root.shadowRoot.children || [];

            for (let i = 0; i < kids.length && lines.length < maxLines; i++) {
                walkSkeletonSubtree(kids[i], lines, depth + 2, maxDepth, maxLines);
            }
        }

        if (elementIsIframe(root) && lines.length < maxLines) {
            let inner = null;

            try { inner = root.contentDocument && root.contentDocument.documentElement; } catch (err) {}

            if (inner) {
                lines.push((new Array(depth + 2).join('  ')) + 'iframe-doc');
                walkSkeletonSubtree(inner, lines, depth + 2, maxDepth, maxLines);
            } else {
                lines.push((new Array(depth + 2).join('  ')) + 'iframe-closed');
            }
        }

        const kids = root.children || [];

        for (let i = 0; i < kids.length && lines.length < maxLines; i++) {
            walkSkeletonSubtree(kids[i], lines, depth + 1, maxDepth, maxLines);
        }
    }

    function overviewRegionRoots() {
        const roots = [];
        const seen = new Set();

        overviewDocuments().forEach(doc => {
            walkDom(doc, el => {
                if (!el || !el.tagName || isInHotkeyPanel(el)) return;

                const text = collectDeepText(el);

                if (!text || text.length > 200) return;

                const value = text.toLowerCase();
                const hit = isDeliveredTotalFractionsLabel(text)
                    || /prescription\s*\/\s*plan\s*overview/.test(value)
                    || /^(rx\/)?plan\s*overview$/.test(value);

                if (!hit) return;

                let root = el;

                for (let i = 0; i < 6 && root && root.parentElement; i++) {
                    const parent = root.parentElement;

                    if (!parent || parent === doc.body || parent === doc.documentElement) break;
                    if (isInHotkeyPanel(parent)) break;

                    root = parent;
                }

                if (seen.has(root)) return;

                seen.add(root);
                roots.push(root);
            });
        });

        return roots.slice(0, 8);
    }

    function buildMaskedDomSkeleton() {
        const lines = [];
        const selects = getTemplateSelects();
        let shadows = 0;
        let iframes = 0;

        overviewDocuments().forEach(doc => {
            walkDom(doc, el => {
                if (elementHasShadow(el)) shadows++;
                if (elementIsIframe(el)) iframes++;
            });
        });

        lines.push('# ChartCheck DOM skeleton v' + SCRIPT_VERSION + ' (PHI-masked)');
        lines.push('# selects=' + selects.length + ' shadows=' + shadows + ' iframes=' + iframes);
        lines.push('# text is masked; attribute values omitted except safe class names');

        selects.forEach((select, index) => {
            if (lines.length >= 400) return;

            lines.push('');
            lines.push('## select ' + (index + 1));
            lines.push('path:');
            collectAncestorPath(select, 12).forEach(line => lines.push('  ' + line));

            const sibs = collectSiblingSkeletons(select, 3);

            sibs.prev.forEach((line, i) => lines.push('prev' + (i + 1) + ': ' + line));
            sibs.next.forEach((line, i) => lines.push('next' + (i + 1) + ': ' + line));
        });

        const regions = overviewRegionRoots();

        regions.forEach((root, index) => {
            if (lines.length >= 400) return;

            lines.push('');
            lines.push('## overview ' + (index + 1));
            walkSkeletonSubtree(root, lines, 0, 8, 400);
        });

        if (lines.length >= 400) {
            lines.length = 400;
            lines[399] = '# truncated';
        }

        return lines.join('\n');
    }

    async function copyMaskedDomSkeleton() {
        const text = buildMaskedDomSkeleton();
        const ok = await writeClipboard(text);

        if (domCopyBtn) {
            const previous = domCopyBtn.getAttribute('data-label') || 'Copy masked DOM';

            domCopyBtn.title = ok ? 'Copied masked DOM' : 'Copy failed';
            setTimeout(() => {
                if (domCopyBtn) domCopyBtn.title = previous;
            }, 1600);
        }

        return ok;
    }

    function syncDomCopyButtonPosition() {
        if (!domCopyBtn || !panel) return;

        const rect = panel.getBoundingClientRect();
        const width = domCopyBtn.offsetWidth || 28;
        const left = Math.max(4, rect.left - width - 4);
        const top = Math.max(4, rect.top + 8);

        domCopyBtn.style.left = left + 'px';
        domCopyBtn.style.top = top + 'px';
        domCopyBtn.style.right = 'auto';
        domCopyBtn.style.bottom = 'auto';
    }

    function ensureDomCopyButton() {
        if (domCopyBtn || !document.body) return;

        const btn = document.createElement('button');

        btn.type = 'button';
        btn.id = 'chartcheck-dom-copy';
        btn.className = 'chartcheck-dom-copy';
        btn.textContent = '⧉';
        btn.title = 'Copy masked DOM structure (no names or IDs)';
        btn.setAttribute('data-label', 'Copy masked DOM structure (no names or IDs)');
        btn.setAttribute('aria-label', 'Copy masked DOM structure');

        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            copyMaskedDomSkeleton();
        });

        document.body.appendChild(btn);
        domCopyBtn = btn;
        if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
        window.addEventListener('resize', () => {
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
        });
    }

    function installPanelStyles() {
        if (document.getElementById('chartcheck-panel-style')) return;

        const style = document.createElement('style');
        style.id = 'chartcheck-panel-style';
        style.textContent = `
            #chartcheck-dom-copy {
                position: fixed;
                z-index: 1000001;
                margin: 0;
                padding: 0 6px;
                font-family: monospace;
                font-size: 16px;
                line-height: 1.4;
                color: #04140c;
                background: #00ff66;
                border: 1px solid #00ff66;
                border-radius: 3px;
                cursor: pointer;
                pointer-events: auto;
                width: auto;
                height: auto;
            }

            #chartcheck-dom-copy:hover,
            #chartcheck-dom-copy:focus {
                background: #04140c;
                color: #00ff66;
            }

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
                pointer-events: auto;
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
        if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
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
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
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

        const key = box.left + ',' + box.top + ',' + box.width + ',' + box.height;

        if (key === lastSiteFrameKey) return;

        lastSiteFrameKey = key;
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
        ensureDomCopyButton();
        requestAnimationFrame(() => {
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
        });
        window.addEventListener('resize', () => {
            if (panelHidden) dockMinimizedPanel();
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
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
        lastAppliedSite = site;
        if (panel) panel.dataset.patientSite = site;
        if (!helpList) return;

        const totalFractions = readTemplateGrayFractions();

        helpList.querySelectorAll('.chartcheck-help-row').forEach(row => {
            const pair = row.dataset.sitePair || '';
            const isSbrt = row.dataset.sbrt === '1';
            const mute = isSiteTemplateMuted(site, totalFractions, pair, isSbrt);

            row.classList.toggle('chartcheck-site-muted', mute);
        });
    }

    let applyingSiteGray = false;

    function cheapIdleSignature() {
        let patientId = '';

        try {
            const sidebar = findPatientsSidebar();
            patientId = sidebar ? String(sidebar.getAttribute('currentpatientid') || '') : '';
        } catch (err) {}

        let href = '';

        try {
            href = typeof location !== 'undefined' && location.href
                ? String(location.href)
                : '';
        } catch (err) {}

        const selects = getTemplateSelects();
        let center = '';

        if (isConnectedNode(cachedCenterLineEl)) {
            try {
                center = normalizeText(cachedCenterLineEl.textContent || '');
            } catch (err) {}
        }

        return [
            href,
            patientId,
            grayFractionSelectSignature(selects),
            String(selects.length),
            cheapOverviewTextSignature(),
            center
        ].join('\n');
    }

    function refreshPatientSiteGray() {
        if (applyingSiteGray) return;

        applyingSiteGray = true;

        try {
            const signature = cheapIdleSignature();
            const changed = signature !== cachedIdleSignature;
            cachedIdleSignature = signature;

            // Skip the heavy site / fraction / banner scans when the
            // visible page state we care about has not changed, unless
            // the site is still unknown and might appear shortly.
            if (changed || lastAppliedSite == null || lastAppliedSite === 'unknown') {
                applyPatientSiteGray(detectPatientSite());
            }

            maybeAutoCopyPatientMrn();
            updateSiteFrame();
            pageScanDirty = false;
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

            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
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
        requestAnimationFrame(() => {
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
        });
    }

    function hidePanel() {
        if (!panel) return;

        savePanelPositionForRestore();
        panelHidden = true;
        panel.classList.add('chartcheck-minimized');
        panel.setAttribute('aria-hidden', 'false');
        dockMinimizedPanel();
        requestAnimationFrame(() => {
            if (typeof syncDomCopyButtonPosition === 'function') syncDomCopyButtonPosition();
        });
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

    const SITE_GRAY_REFRESH_MS = 800;
    const SITE_GRAY_MUTATION_DEBOUNCE_MS = 300;

    function mutationIsOutsidePanel(mutation) {
        const node = mutation.target;
        const el = node && node.nodeType === 1
            ? node
            : node && node.parentElement;

        if (!el || typeof el.closest !== 'function') return true;

        return !el.closest('#chartcheck-panel')
            && !el.closest('#chartcheck-dom-copy');
    }

    // One shared debounced observer path. The 800ms interval still
    // calls refreshPatientSiteGray, which no-ops when nothing changed.
    let siteGrayQueued = false;

    function queueSiteGrayRefresh() {
        if (applyingSiteGray || siteGrayQueued) return;

        siteGrayQueued = true;
        setTimeout(() => {
            siteGrayQueued = false;
            refreshPatientSiteGray();
        }, SITE_GRAY_MUTATION_DEBOUNCE_MS);
    }

    function startSiteGrayRefresh() {
        if (siteGrayRefreshStarted) return;
        if (!document.body) return;

        siteGrayRefreshStarted = true;
        createOverlay();
        refreshPatientSiteGray();
        setInterval(refreshPatientSiteGray, SITE_GRAY_REFRESH_MS);

        if (typeof MutationObserver !== 'function') return;

        const observer = new MutationObserver(mutations => {
            if (applyingSiteGray || siteGrayQueued) return;
            if (!mutations.some(mutationIsOutsidePanel)) return;

            markPageScanDirty();
            queueSiteGrayRefresh();
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

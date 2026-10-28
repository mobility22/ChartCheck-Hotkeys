// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      2.3
// @match        https://10.231.132.118/*
// @grant        none
// @downloadURL https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/refs/heads/main/ChartCheck-Hotkeys.user.js
// @updateURL   https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/refs/heads/main/ChartCheck-Hotkeys.user.js
// ==/UserScript==

(function () {
    'use strict';

    function findButtons(root = document) {
        let buttons = Array.from(root.querySelectorAll('button'));
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) buttons.push(...findButtons(el.shadowRoot));
        });
        return buttons;
    }

    function findPatientsSidebar(root = document) {
        for (const el of root.querySelectorAll('*')) {
            if (el.tagName && el.tagName.toLowerCase() === 'patients-sidebar') {
                return el;
            }
            if (el.shadowRoot) {
                const found = findPatientsSidebar(el.shadowRoot);
                if (found) return found;
            }
        }
        return null;
    }

    function findSelects(root = document) {
        let selects = Array.from(root.querySelectorAll('select'));
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) selects.push(...findSelects(el.shadowRoot));
        });
        return selects;
    }

    function findFailLinks(root = document) {
        const links = [];
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) links.push(...findFailLinks(el.shadowRoot));
        });
        root.querySelectorAll('a').forEach(a => {
            if (a.querySelector('span[pass-state="FAIL"]')) links.push(a);
        });
        return links;
    }

    function findUncheckedBoxes(root = document) {
        let boxes = [];
        root.querySelectorAll('*').forEach(el => {
            if (el.classList && el.classList.contains('unchecked') && el.classList.contains('fa-square')) boxes.push(el);
            if (el.shadowRoot) boxes.push(...findUncheckedBoxes(el.shadowRoot));
        });
        return boxes;
    }

    function findFailedUncheckedBoxes() {
        return findUncheckedBoxes().filter(box => {
            try {
                const host = box.parentElement.getRootNode().host;
                const container = host.parentElement;
                return container && container.innerHTML.includes('pass-state="FAIL"');
            } catch {
                return false;
            }
        });
    }

    function findElementByText(text, root = document) {
        for (const el of root.querySelectorAll('*')) {
            if (el.textContent.trim() === text) return el;
            if (el.shadowRoot) {
                const result = findElementByText(text, el.shadowRoot);
                if (result) return result;
            }
        }
        return null;
    }

    function getTemplateSelects() {
        return findSelects().filter(s => Array.from(s.options).some(o => o.text === 'ROS_Standard' || o.text === 'ROS_SBRT/SRS' || o.text === 'RCO_SBRT' || o.text === 'RCO_Standard'));
    }

    function clickButtonByText(text) {
        const btn = findButtons().find(b => b.textContent.trim() === text);
        if (btn && !btn.disabled) {
            btn.click();
            return true;
        }
        return false;
    }

    function clickYesUpdate() {
        const timer = setInterval(() => {
            const yesElement = findElementByText('Yes, update');
            if (yesElement) {
                yesElement.click();
                clearInterval(timer);
            }
        }, 250);
        setTimeout(() => clearInterval(timer), 8000);
    }

    function setTemplate(templateName) {
        const selects = getTemplateSelects();
        selects.forEach(select => {
            const option = Array.from(select.options).find(o => o.text === templateName);
            if (option) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        setTimeout(() => {
            if (clickButtonByText('Apply Check Templates Update')) clickYesUpdate();
        }, 500);
    }

    let autoReviewActive = false;
    function findAllTextMatches(text, root = document, results = []) {

        for (const el of root.querySelectorAll('*')) {

            if (el.textContent.includes(text)) {
                results.push(el);
            }

            if (el.shadowRoot) {
                findAllTextMatches(text, el.shadowRoot, results);
            }
        }

        return results;
    }

    function loadNextPatient() {
        const btn = findButtons().find(b => b.textContent.trim() === 'Load Next Patient');
        if (btn && !btn.disabled) {
            btn.click();
            setTimeout(() => {
                const sidebar = findPatientsSidebar();
                if (sidebar) {

                    const patientId = sidebar.getAttribute('currentpatientid');

                    const matches = findAllTextMatches(patientId);

                    const row = matches.find(el =>
                                             el.tagName &&
                                             el.tagName.toLowerCase() === 'li' &&
                                             el.hasAttribute('current')
                                            );

                    if (row) {

                        row.scrollIntoView({
                            block: 'center',
                            behavior: 'smooth'
                        });
                    }
                }
            }, 1000);
            return true;
        }
        return false;
    }

    async function waitForPatientChange(oldUrl, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (location.href !== oldUrl) {
                await new Promise(resolve => setTimeout(resolve, 300));
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    }

    async function reviewUntilFail() {
        if (autoReviewActive) return;
        autoReviewActive = true;
        while (autoReviewActive) {
            const fails = findFailLinks();
            if (fails.length > 0) {
                fails[0].click();
                autoReviewActive = false;
                return;
            }
            const oldUrl = location.href;
            if (!loadNextPatient()) return;
            const changed = await waitForPatientChange(oldUrl);
            if (!changed) {
                autoReviewActive = false;
                return;
            }
        }
    }

    async function reviewUntilFailSlow(delay = 3000) {
        if (autoReviewActive) return;
        autoReviewActive = true;
        while (autoReviewActive) {
            const fails = findFailLinks();
            if (fails.length > 0) {
                fails[0].click();
                autoReviewActive = false;
                return;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            const oldUrl = location.href;
            if (!loadNextPatient()) return;
            const changed = await waitForPatientChange(oldUrl);
            if (!changed) {
                autoReviewActive = false;
                return;
            }
        }
    }

    document.addEventListener('keydown', e => {
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            loadNextPatient();
        }
        if (e.altKey && e.key.toLowerCase() === 'z') history.back();
        if (e.altKey && e.key.toLowerCase() === 'a') {
            const btn = findButtons().find(b => b.textContent.trim() === 'Approve and Load Next');
            if (btn && !btn.disabled) btn.click();
        }
        if (e.altKey && e.key.toLowerCase() === 'd') findFailLinks()[0]?.click();
        if (e.altKey && e.key.toLowerCase() === 'f') findFailedUncheckedBoxes()[0]?.click();
        if (e.altKey && e.key.toLowerCase() === 'q') setTemplate('ROS_Standard');
        if (e.altKey && e.key.toLowerCase() === 'w') setTemplate('ROS_SBRT/SRS');
        if (e.shiftlKey && e.key.toLowerCase() === 'q') setTemplate('RCO_Standard');
        if (e.shiftKey && e.key.toLowerCase() === 'w') setTemplate('RCO_SBRT');
        if (e.altKey && e.key.toLowerCase() === 'c') reviewUntilFail();
        if (e.altKey && e.key.toLowerCase() === 'r') reviewUntilFailSlow(3000);
        if (e.altKey && e.key.toLowerCase() === 'x') autoReviewActive = false;
    });

    console.log('ChartCheck Hotkeys Loaded');
})();

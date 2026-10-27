// ==UserScript==
// @name         ChartCheck Hotkeys
// @version      1.6
// @match        https://10.231.132.118/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/main/ChartCheck-Hotkeys.user.js
// @updateURL    https://raw.githubusercontent.com/mobility22/ChartCheck-Hotkeys/main/ChartCheck-Hotkeys.user.js
// ==/UserScript==

(function () {
    'use strict';

    function findButtons(root = document) {
        let buttons = Array.from(root.querySelectorAll('button'));

        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                buttons.push(...findButtons(el.shadowRoot));
            }
        });

        return buttons;
    }

    function findSelects(root = document) {
        let selects = Array.from(root.querySelectorAll('select'));

        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                selects.push(...findSelects(el.shadowRoot));
            }
        });

        return selects;
    }

    function findFailLinks(root = document) {
        const links = [];

        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                links.push(...findFailLinks(el.shadowRoot));
            }
        });

        root.querySelectorAll('a').forEach(a => {
            if (a.querySelector('span[pass-state="FAIL"]')) {
                links.push(a);
            }
        });

        return links;
    }

    function findUncheckedBoxes(root = document) {
        let boxes = [];

        root.querySelectorAll('*').forEach(el => {
            if (
                el.classList &&
                el.classList.contains('unchecked') &&
                el.classList.contains('fa-square')
            ) {
                boxes.push(el);
            }

            if (el.shadowRoot) {
                boxes.push(...findUncheckedBoxes(el.shadowRoot));
            }
        });

        return boxes;
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

    function findElementByText(text, root = document) {
        for (const el of root.querySelectorAll('*')) {

            if (el.textContent.trim() === text) {
                return el;
            }

            if (el.shadowRoot) {
                const result = findElementByText(text, el.shadowRoot);
                if (result) {
                    return result;
                }
            }
        }

        return null;
    }

    function getTemplateSelects() {
        return findSelects().filter(s =>
            Array.from(s.options).some(o =>
                o.text === 'ROS_Standard' ||
                o.text === 'ROS_SBRT/SRS'
            )
        );
    }

    function clickButtonByText(text) {
        const btn = findButtons().find(
            b => b.textContent.trim() === text
        );

        if (btn && !btn.disabled) {
            btn.click();
            console.log(`Clicked: ${text}`);
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
                console.log('Clicked: Yes, update');
            }

        }, 250);

        setTimeout(() => clearInterval(timer), 8000);
    }

    function setTemplate(templateName) {

        const selects = getTemplateSelects();

        let count = 0;

        selects.forEach(select => {

            const option = Array.from(select.options).find(
                o => o.text === templateName
            );

            if (option) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                count++;
            }
        });

        console.log(`Changed ${count} template(s) to ${templateName}`);

        setTimeout(() => {

            const applied = clickButtonByText('Apply Check Templates Update');

            if (applied) {
                clickYesUpdate();
            }

        }, 500);
    }

    document.addEventListener('keydown', e => {

        // Alt+S = Load Next Patient
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();

            findButtons()
                .find(b => b.textContent.trim() === 'Load Next Patient')
                ?.click();
        }

        // Alt+A = Approve and Load Next
        if (e.altKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();

            const btn = findButtons()
                .find(b => b.textContent.trim() === 'Approve and Load Next');

            if (btn && !btn.disabled) {
                btn.click();
            }
        }

        // Alt+D = Jump to first failed item
        if (e.altKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();

            const failLink = findFailLinks()[0];

            if (failLink) {
                failLink.click();
            }
        }

        // Alt+F = Check next FAILED item only
        if (e.altKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();

            const box = findFailedUncheckedBoxes()[0];

            if (box) {
                box.click();
                console.log('Checked next failed item');
            } else {
                console.log('No failed items remaining');
            }
        }

        // Alt+Q = ROS_Standard
        if (e.altKey && e.key.toLowerCase() === 'q') {
            e.preventDefault();
            setTemplate('ROS_Standard');
        }

        // Alt+W = ROS_SBRT/SRS
        if (e.altKey && e.key.toLowerCase() === 'w') {
            e.preventDefault();
            setTemplate('ROS_SBRT/SRS');
        }
    });

    console.log('ChartCheck Hotkeys Loaded');
})();
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
ok('startup still creates the overlay before the first gray refresh', /function startSiteGrayRefresh\([\s\S]*?createOverlay\(\);\s*refreshPatientSiteGray\(\);/.test(src));
ok('createOverlay still appends #chartcheck-panel to document.body', /function createOverlay\([\s\S]*?root\.id = 'chartcheck-panel'[\s\S]*?document\.body\.appendChild\(root\)/.test(src));
ok('idle signature joins fields with an escaped newline, not a raw line break in a string', /function cheapIdleSignature\([\s\S]*?\.join\('\\n'\)/.test(src));

let parseError = null;
try {
    // Compile the whole userscript. A raw newline inside a quoted
    // string, a TDZ error at compile time, or any other syntax
    // error would stop Tampermonkey from running and hide the panel.
    new vm.Script(src, { filename: 'ChartCheck-Hotkeys.user.js' });
} catch (err) {
    parseError = err;
}
ok('the full userscript parses', parseError == null);
if (parseError) console.log('  parse error: ' + parseError.message);

function createStartupWindow() {
    function node(nodeType, tagName) {
        const classSet = new Set();
        const attrs = {};
        const el = {
            nodeType,
            tagName: tagName ? String(tagName).toUpperCase() : undefined,
            childNodes: [],
            children: [],
            parentNode: null,
            parentElement: null,
            ownerDocument: null,
            shadowRoot: null,
            id: '',
            className: '',
            textContent: '',
            title: '',
            type: '',
            hidden: false,
            disabled: false,
            tabIndex: 0,
            style: {},
            dataset: {},
            attributes: attrs,
            offsetWidth: 1,
            offsetHeight: 1,
            isConnected: true,
            classList: {
                add(...names) { names.forEach(name => classSet.add(name)); el.className = Array.from(classSet).join(' '); },
                remove(...names) { names.forEach(name => classSet.delete(name)); el.className = Array.from(classSet).join(' '); },
                toggle(name, force) {
                    const on = force == null ? !classSet.has(name) : !!force;
                    if (on) classSet.add(name); else classSet.delete(name);
                    el.className = Array.from(classSet).join(' ');
                    return on;
                },
                contains(name) { return classSet.has(name); }
            },
            appendChild(child) {
                child.parentNode = el;
                child.parentElement = el.nodeType === 1 ? el : null;
                child.ownerDocument = el.ownerDocument || el;
                el.childNodes.push(child);
                if (child.nodeType === 1) el.children.push(child);
                return child;
            },
            setAttribute(name, value) {
                attrs[name] = String(value);
                if (name === 'id') el.id = String(value);
                if (name === 'class') {
                    classSet.clear();
                    String(value).split(/\s+/).filter(Boolean).forEach(item => classSet.add(item));
                    el.className = Array.from(classSet).join(' ');
                }
            },
            getAttribute(name) { return attrs[name] != null ? attrs[name] : null; },
            hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return true; },
            click() {},
            focus() {},
            getBoundingClientRect() {
                return { left: 20, top: 20, right: 220, bottom: 220, width: 200, height: 200 };
            },
            getRootNode() {
                let cur = el;
                while (cur.parentNode) cur = cur.parentNode;
                return cur;
            },
            closest(selector) {
                let cur = el;
                while (cur) {
                    if (cur.nodeType === 1 && matches(cur, selector)) return cur;
                    cur = cur.parentElement;
                }
                return null;
            },
            contains(other) {
                let cur = other;
                while (cur) {
                    if (cur === el) return true;
                    cur = cur.parentNode;
                }
                return false;
            },
            querySelector(selector) {
                return el.querySelectorAll(selector)[0] || null;
            },
            querySelectorAll(selector) {
                const found = [];
                function walk(node) {
                    (node.children || []).forEach(child => {
                        if (matches(child, selector)) found.push(child);
                        walk(child);
                    });
                }
                walk(el);
                return found;
            },
            getElementsByTagName(tag) {
                return el.querySelectorAll(String(tag).toLowerCase());
            }
        };

        Object.defineProperty(el, 'textContent', {
            get() {
                if (Object.prototype.hasOwnProperty.call(el, '_text')) return el._text;
                return el.childNodes.map(child => (
                    child.nodeType === 3 ? (child.nodeValue || '') : (child.textContent || '')
                )).join('');
            },
            set(value) {
                el._text = String(value == null ? '' : value);
                el.childNodes = [];
                el.children = [];
            },
            configurable: true
        });

        return el;
    }

    function matches(el, selector) {
        if (!el || el.nodeType !== 1) return false;
        const parts = String(selector).trim().split(/\s*,\s*/);
        return parts.some(part => {
            if (part.startsWith('#')) return el.id === part.slice(1);
            if (part.startsWith('.')) {
                return (el.className || '').split(/\s+/).includes(part.slice(1));
            }
            const attr = /^([a-z][\w-]*)?(?:\[(.+?)\])?$/i.exec(part);
            if (!attr) return false;
            if (attr[1] && (el.tagName || '').toLowerCase() !== attr[1].toLowerCase()) return false;
            if (!attr[2]) return true;
            return el.getAttribute(attr[2]) != null;
        });
    }

    const doc = node(9, '#document');
    const html = node(1, 'html');
    const head = node(1, 'head');
    const body = node(1, 'body');
    html.ownerDocument = doc;
    head.ownerDocument = doc;
    body.ownerDocument = doc;
    doc.ownerDocument = doc;
    doc.documentElement = html;
    doc.head = head;
    doc.body = body;
    doc.readyState = 'complete';
    doc.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);

    doc.createElement = tag => {
        const el = node(1, tag);
        el.ownerDocument = doc;
        return el;
    };
    doc.createTextNode = value => {
        return {
            nodeType: 3,
            nodeValue: String(value == null ? '' : value),
            textContent: String(value == null ? '' : value),
            childNodes: [],
            children: [],
            parentNode: null,
            parentElement: null,
            ownerDocument: doc
        };
    };
    doc.getElementById = id => {
        const hits = doc.querySelectorAll('#' + id);
        return hits[0] || null;
    };
    doc.querySelector = selector => doc.documentElement.querySelector(selector);
    doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
    doc.getElementsByTagName = tag => doc.documentElement.getElementsByTagName(tag);
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    const store = Object.create(null);
    const windowObj = {
        addEventListener() {},
        removeEventListener() {},
        requestAnimationFrame(fn) { return setTimeout(fn, 0); },
        getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
        innerWidth: 1280,
        innerHeight: 800,
        onbeforeunload: null
    };

    const location = {
        href: 'https://10.231.132.118/patient/abc',
        pathname: '/patient/abc',
        reload() {}
    };

    windowObj.document = doc;
    windowObj.location = location;
    windowObj.window = windowObj;
    windowObj.MutationObserver = function MutationObserver() {};
    windowObj.MutationObserver.prototype.observe = function () {};
    windowObj.localStorage = {
        getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
        setItem(key, value) { store[key] = String(value); },
        removeItem(key) { delete store[key]; }
    };
    windowObj.navigator = { clipboard: null };
    windowObj.GM_info = { script: { version: '3.56' } };
    windowObj.GM_getValue = function () { return undefined; };
    windowObj.GM_setValue = function () {};
    windowObj.GM_setClipboard = function () {};
    const timers = { next: 1, map: new Map() };
    function fakeTimeout(fn) {
        const id = timers.next++;
        timers.map.set(id, fn);
        return id;
    }
    function fakeClear(id) { timers.map.delete(id); }
    windowObj.console = console;
    windowObj.setTimeout = fakeTimeout;
    windowObj.clearTimeout = fakeClear;
    windowObj.setInterval = fakeTimeout;
    windowObj.clearInterval = fakeClear;
    windowObj._runPendingTimers = function () {
        Array.from(timers.map.values()).forEach(fn => {
            try { if (typeof fn === 'function') fn(); } catch (err) {}
        });
    };
    doc.defaultView = windowObj;

    return { window: windowObj, document: doc, location };
}

const startup = createStartupWindow();
let runError = null;
try {
    vm.runInNewContext(src, {
        window: startup.window,
        document: startup.document,
        location: startup.location,
        navigator: startup.window.navigator,
        MutationObserver: startup.window.MutationObserver,
        localStorage: startup.window.localStorage,
        console,
        setTimeout: startup.window.setTimeout,
        clearTimeout: startup.window.clearTimeout,
        setInterval: startup.window.setInterval,
        clearInterval: startup.window.clearInterval,
        requestAnimationFrame: startup.window.requestAnimationFrame,
        getComputedStyle: startup.window.getComputedStyle,
        GM_info: startup.window.GM_info,
        GM_getValue: startup.window.GM_getValue,
        GM_setValue: startup.window.GM_setValue,
        GM_setClipboard: startup.window.GM_setClipboard
    }, { filename: 'ChartCheck-Hotkeys.user.js' });
} catch (err) {
    runError = err;
}

const panel = startup.document.getElementById('chartcheck-panel');
const title = panel && panel.querySelector('.chartcheck-title-text');
ok('startup does not throw before the panel is created', !runError || !!panel);
if (runError && !panel) console.log('  startup error: ' + runError.stack);
ok('the panel is attached to document.body on startup', !!(panel && panel.parentElement === startup.document.body));
ok('the panel is visible and labeled on startup', !!(panel && panel.getAttribute('aria-hidden') === 'false' && panel.id === 'chartcheck-panel'));
ok('the panel title shows the script version on startup', !!(title && title.textContent === 'ChartCheck v3.56'));

if (failed) {
    process.exitCode = 1;
    console.log(failed + ' failed');
} else {
    console.log('all passed');
}

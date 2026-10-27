

Tampermonkey® by Jan Biniok
v5.5.1
	
ChartCheck Hotkeys

1
// ==UserScript==
2
// @name         ChartCheck Hotkeys
3
// @version      1.6
4
// @match        https://10.231.132.118/*
5
// @grant        none
6
// ==/UserScript==
7
​
8
(function () {
9
    'use strict';
10
​
11
    function findButtons(root = document) {
12
        let buttons = Array.from(root.querySelectorAll('button'));
13
​
14
        root.querySelectorAll('*').forEach(el => {
15
            if (el.shadowRoot) {
16
                buttons.push(...findButtons(el.shadowRoot));
17
            }
18
        });
19
​
20
        return buttons;
21
    }
22
​
23
    function findSelects(root = document) {
24
        let selects = Array.from(root.querySelectorAll('select'));
25
​
26
        root.querySelectorAll('*').forEach(el => {
27
            if (el.shadowRoot) {
28
                selects.push(...findSelects(el.shadowRoot));
29
            }
30
        });
31
​
32
        return selects;
33
    }
34
​
35
    function findFailLinks(root = document) {
36
        const links = [];
37
​
38
        root.querySelectorAll('*').forEach(el => {
39
            if (el.shadowRoot) {
40
                links.push(...findFailLinks(el.shadowRoot));
41
            }
42
        });
43
​
44
        root.querySelectorAll('a').forEach(a => {
45
            if (a.querySelector('span[pass-state="FAIL"]')) {
46
                links.push(a);
47
            }
48
        });
49
​
50
        return links;
51
    }
52
​
53
    function findUncheckedBoxes(root = document) {
54
        let boxes = [];
55
​
56
        root.querySelectorAll('*').forEach(el => {
57
            if (
58
                el.classList &&
59
                el.classList.contains('unchecked') &&
60
                el.classList.contains('fa-square')
61
            ) {
62
                boxes.push(el);
63
            }
64
​
65
            if (el.shadowRoot) {
66
                boxes.push(...findUncheckedBoxes(el.shadowRoot));
67
            }
68
        });
69
​
70
        return boxes;
71
    }
72
​
Tam - Your service bot

Do you want to use an external editor to edit your scripts?
Would you like to know how to set this up?
Disable
Tampermonkey Bot

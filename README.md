# ChartCheck Hotkeys

Tampermonkey userscript (version 3.25) that adds keyboard shortcuts to ChartCheck. It loads the next patient, applies check templates, jumps to failed checks, and can walk the queue automatically. One floating window shows the version as its title, the hotkey list, and auto-review status. The list is always shown with the window. There is no collapsed title and status strip. Alt+L, the Hide button beside Stop, or LDH on the title hides that full window and shows it again the same way. While it is hidden, nothing from this script is visible.

Auto-review and auto-approve stop on a FAIL result and open that FAIL link. Alt+E is slow nonstop review: it pauses on each chart for the same interval as Alt+R, then loads the next patient when the chart has a FAIL, and leaves the FAIL link unopened. It stops when the queue ends, the patient does not change, or you press Alt+X. These loops wait until the new chart's patient id (or patient name, when no id is available) has updated before they look for FAIL. Alt+X stops any of them immediately, before another Approve or Load Next click. Auto-approve stops instead of approving again when that id or name never changes. Shortcuts do nothing while you are typing in an input, textarea, select, or contenteditable field, and they ignore key auto-repeat. The hotkey list is a compact two-column grid in that same window. Each action has a keyword label and a letter button. Drag the version title to move the window.

The line under the patient name is the center, such as "Roseville Cancer Center, ROS Radiation Oncology, …" or "Rancho Cordova Cancer Center, RCO Radiation Oncology, …". The script reads that line and matches the words Roseville and Rancho. It does not treat the ROS or RCO department abbreviation as the site. On a Roseville center, the RCO Standard and RCO SBRT letter buttons are grayed. On a Rancho center, the ROS Standard and ROS SBRT letter buttons are grayed. Any other center leaves all four buttons at full strength. Gray is visual only: those letter buttons still click, and Alt+Q, Alt+W, Shift+Q, and Shift+W still run.

Auto-review and auto-approve show Roseville Count and Rancho Count instead of one combined count. Each chart is counted for the center line on screen before the next patient loads. A center line that is neither Roseville nor Rancho is not added to either count. Both counts reset to zero when a new auto-review or auto-approve run starts.

When the current patient's MRN is shown on the chart banner, the script copies that MRN once for pasting into ARIA. It prefers an MRN label in that banner, above the center line. If there is no label, it uses the single parenthetical on that name heading only. Leading zeros stay. The sidebar id and the URL id are not copied. After a patient switch, the previous banner is not copied, even when the new patient has the same name, until the heading or the MRN label actually changes. A label that is still the previous value is not replaced by guessing from a parenthetical. The same patient does not trigger another copy. Nothing about the copy is added to the panel. A failed clipboard write is retried a few times and is not treated as success.

## Hotkeys

| Shortcut | Action |
| --- | --- |
| Alt+S | Load the next patient |
| Alt+Z | Go back |
| Alt+A | Click **Approve and Load Next** once |
| Alt+D | Open the first FAIL link |
| Alt+F | Click the first failed unchecked box |
| Alt+Q | Apply template 1 |
| Alt+W | Apply template 2 |
| Shift+Q | Apply template 3 |
| Shift+W | Apply template 4 |
| Alt+C | Start auto-review: load the next patient until a FAIL is found. Pressing Alt+C again after it stops resumes: it moves past the FAIL on the current chart and keeps going until the next FAIL |
| Alt+R | Start slow auto-review: same as Alt+C, but pause on each chart for it to finish loading before the FAIL check |
| Alt+E | Start slow nonstop review: same pause as Alt+R, then keep loading the next patient through FAIL charts. Leaves the FAIL link unopened. Stops when the queue ends, the patient does not change, or you press Alt+X |
| Ctrl+Shift+R | Start auto-approve after a confirm dialog. Repeatedly clicks **Approve and Load Next** until a FAIL is found, the queue is exhausted, the patient does not change, or you stop it. Press Ctrl+Shift+R again to stop without a second dialog |
| Alt+X | Stop auto-review, nonstop review, or auto-approve immediately |
| Alt+L | Hide or show the ChartCheck window. The window starts open with the full hotkey list. The Hide letter button beside Stop, and LDH on the title, do the same. Showing it again opens the full list. While it is hidden, nothing from this script is visible |

## Install

1. Install the Tampermonkey extension in your browser.
2. Open the raw script, which is also the script's update URL.
3. Confirm **Install** in the Tampermonkey dialog.

Tampermonkey then installs version 3.25 and picks up later updates from that raw script. The script runs only on the ChartCheck host it is matched to.

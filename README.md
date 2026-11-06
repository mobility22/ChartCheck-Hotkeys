# ChartCheck Hotkeys

Tampermonkey userscript (version 3.16) that adds keyboard shortcuts to ChartCheck. It loads the next patient, applies check templates, jumps to failed checks, and can walk the queue automatically. One floating window shows the version as its title. Alt+H expands or collapses the hotkey list in the middle of that window. Auto-review status and the chart count stay visible under the list.

Auto-review and auto-approve stop on a FAIL result and open that FAIL link. Alt+E is slow nonstop review: it pauses on each chart for the same interval as Alt+R, then loads the next patient when the chart has a FAIL, and leaves the FAIL link unopened. It stops when the queue ends, the patient does not change, or you press Alt+X. These loops wait until the new chart's patient id (or patient name, when no id is available) has updated before they look for FAIL. Alt+X stops any of them immediately, before another Approve or Load Next click. Auto-approve stops instead of approving again when that id or name never changes. Shortcuts do nothing while you are typing in an input, textarea, select, or contenteditable field, and they ignore key auto-repeat. Alt+H expands or collapses a compact two-column keyword list in that same window. Each action has a keyword label and a letter button. Shortcuts keep working while that list is expanded or collapsed. Drag the version title to move the window.

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
| Alt+C | Start auto-review: load the next patient until a FAIL is found |
| Alt+R | Start slow auto-review: same as Alt+C, but pause on each chart for it to finish loading before the FAIL check |
| Alt+E | Start slow nonstop review: same pause as Alt+R, then keep loading the next patient through FAIL charts. Leaves the FAIL link unopened. Stops when the queue ends, the patient does not change, or you press Alt+X |
| Ctrl+Shift+R | Start auto-approve after a confirm dialog. Repeatedly clicks **Approve and Load Next** until a FAIL is found, the queue is exhausted, the patient does not change, or you stop it. Press Ctrl+Shift+R again to stop without a second dialog |
| Alt+X | Stop auto-review, nonstop review, or auto-approve immediately |
| Alt+H | Expand or collapse the hotkey list in the floating window. Each action has a keyword label and a letter button that runs that action. Help stays on the last row. The version stays on top, and auto-review status and the count stay below the list |

## Install

1. Install the Tampermonkey extension in your browser.
2. Open the raw script, which is also the script's update URL.
3. Confirm **Install** in the Tampermonkey dialog.

Tampermonkey then installs version 3.16 and picks up later updates from that raw script. The script runs only on the ChartCheck host it is matched to.

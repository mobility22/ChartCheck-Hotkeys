# ChartCheck Hotkeys

Tampermonkey userscript (version 3.10) that adds keyboard shortcuts to ChartCheck. It loads the next patient, applies check templates, jumps to failed checks, and can walk the queue automatically. A small status overlay shows whether auto-review is off, on, or approving, plus how many charts the current run has advanced.

Auto-review and auto-approve stop on a FAIL result. Both wait until the new chart's patient id (or patient name, when no id is available) has updated before they look for FAIL. Alt+X stops either loop immediately, before another Approve or Load Next click. Auto-approve stops instead of approving again when that id or name never changes. Shortcuts do nothing while you are typing in an input, textarea, select, or contenteditable field, and they ignore key auto-repeat.

## Hotkeys

| Shortcut | Action |
| --- | --- |
| Alt+S | Load the next patient |
| Alt+Z | Go back |
| Alt+A | Click **Approve and Load Next** once |
| Alt+D | Open the first FAIL link |
| Alt+F | Click the first failed unchecked box |
| Alt+Q | Apply the `ROS_Standard` template |
| Alt+W | Apply the `ROS_SBRT/SRS` template |
| Shift+Q | Apply the `RCO_Standard` template |
| Shift+W | Apply the `RCO_SBRT` template |
| Alt+C | Start auto-review: load the next patient until a FAIL is found |
| Alt+R | Start slow auto-review: same as Alt+C, but pause on each chart for it to finish loading before the FAIL check |
| Ctrl+Shift+R | Start auto-approve after a confirm dialog. Repeatedly clicks **Approve and Load Next** until a FAIL is found, the queue is exhausted, the patient does not change, or you stop it. Press Ctrl+Shift+R again to stop without a second dialog |
| Alt+X | Stop auto-review or auto-approve immediately |

## Install

1. Install the Tampermonkey extension in your browser.
2. Open the raw script, which is also the script's update URL.
3. Confirm **Install** in the Tampermonkey dialog.

Tampermonkey then installs version 3.10 and picks up later updates from that raw script. The script runs only on the ChartCheck host it is matched to.

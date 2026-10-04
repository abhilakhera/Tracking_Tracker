# Troubleshooting

Always check the **Tracking Log** tab first. It lists every problem from the last run with
its row number.

## The "📦 Courier Tracking" menu doesn't appear
* Reload the sheet (F5) and wait ~10 seconds.
* In the Apps Script editor, make sure all files are saved and `Main.gs` contains `function onOpen()`.
* In the editor, select `onOpen` in the function dropdown at the top and click **▶ Run** once.

## "No TrackingMore API key saved" / "No Delhivery API token saved"
Use **📦 Courier Tracking → Set / change API keys**. Keys are saved per script, so if you
copied the sheet, save them again in the copy.

## "rejected the API key" / "rejected the API token"
The key was mistyped, revoked or expired. Copy it again from the provider's website (no
spaces before or after) and save it again.

## "Courier name not recognised"
Column H contains a spelling the script doesn't know. Either fix the cell, or add the spelling
to `aliases` for that courier in `Config.gs`. Spaces, dashes, dots and capital letters are ignored.

## Rows stay blank with "Registered with TrackingMore…"
That's normal for new tracking numbers on the first run. TrackingMore fetches data from
the courier in the background. Run the update again after 10–15 minutes.

If it stays like this for more than a day:
* Check the tracking number is correct on the courier's own website.
* The number may be very new: some couriers show data only after pickup.
* Check the courier code (see below). A wrong code means TrackingMore asks the wrong courier.

## Status shows "Not Found"
The courier has no record of the number yet, or the number or courier in column H is wrong.
Check it on the courier's website.

## DP World not found on TrackingMore

**Test API connections** shows ❌ for DP World, or the log says *"TrackingMore has no
Indian courier matching DP World"*.

The script searches TrackingMore's courier list for *dp world / dpworld / delex*, preferring
Indian entries. If nothing fits:
1. The error message lists **similar entries** with their codes in `[brackets]`. If one is
   DP World's Indian express service, copy its code into `Config.gs`:
   ```js
   DPWORLD: { ..., trackingMoreCode: 'the-code-here', ... }
   ```
2. Ask TrackingMore support whether they cover *DP World Express India (formerly Delex)*,
   and the courier code to use.
3. If TrackingMore doesn't cover it, ask your DP World relationship manager for their
   tracking API (see [GETTING_API_KEYS.md](GETTING_API_KEYS.md#3-direct-safexpress--dp-world-apis-later-optional)).
   A direct connector can then be added like `Delhivery.gs`.

Other aggregators with large Indian courier lists (Ship24, AfterShip, ClickPost) are
alternatives if needed.

## Wrong courier code for Safexpress / Delhivery on TrackingMore
Codes are set in `Config.gs` (`trackingMoreCode`). To make the script search for the code
itself, set it to `''`. Then run **Set / change API keys** and press OK twice without typing
anything; this clears the saved codes. Then run **Test API connections**.

## "already registered but returned no result"
TrackingMore knows the number, but its "get" request didn't return it. This can happen for
numbers registered a long time ago. Check the number in the TrackingMore dashboard; if it's
listed there, contact TrackingMore support.

## "no credits left on your plan"
Your TrackingMore quota for the month is used up. Upgrade the plan or wait for the next
billing cycle. To use fewer credits, keep `SKIP_FINISHED: true` (the default) and, for
Delhivery, add a Delhivery token so those numbers don't use TrackingMore at all.

## "Paused at row … (Google time limit)"
Google stops scripts after 6 minutes. With a very large sheet, the script pauses on purpose
and continues on its own about a minute later. Nothing to do.

## Status Date column shows numbers like 46298
The column's format was changed. The value is still a date: select column J →
**Format → Number → Date**, or just run an update (the script re-applies `DATE_FORMAT`).

## Dates are one day off
The spreadsheet's timezone differs from India. Fix it in **File → Settings → Time zone →
(GMT+05:30) India Standard Time**.

## I want the time as well as the date
In `Config.gs` set `KEEP_TIME: true` and `DATE_FORMAT: 'dd-mmm-yyyy hh:mm'`.

## The status text is too long
In `Config.gs` set `SHOW_LOCATION: false` and/or `SHOW_DETAIL: false`.

## Where can I see the script's own error messages?
Apps Script editor → **Executions** (the ☰▶ icon on the left) shows every run with any error.

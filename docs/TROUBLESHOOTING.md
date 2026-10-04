# Something isn't working?

👉 **First look at the "Tracking Log" tab** in your sheet. It lists every row that wasn't
updated, with the reason.

| What you see | What it means | What to do |
|---|---|---|
| No **📦 Courier Tracking** menu | The sheet hasn't loaded the robot yet | Refresh the page (F5) and wait 10 seconds. Check that all files were saved in Apps Script (Ctrl + S). |
| "No TrackCourier.io API key saved" | The key isn't saved yet | **📦 Courier Tracking → Set / change API keys** and paste it. |
| "rejected the API key" | The key is wrong or expired | Copy it again from your TrackCourier.io account (no spaces) and save it again. |
| "plan limit reached" | Your TrackCourier.io credits for the month are used up | Top up your plan, or wait for next month. |
| "too many requests" | Too many questions at once | Nothing; the next run continues. |
| "Courier name not recognised" | Column H has a spelling the robot doesn't know, e.g. "Delhivry" | Fix the spelling in the cell. |
| "found no shipment with this number" | The courier doesn't know this number | Check the number on the courier's website. Very new parcels may show up only after pickup. |
| "DP World tracking is not connected yet" | Expected for now | See Part 5 of [SETUP_GUIDE.md](SETUP_GUIDE.md). |
| "Paused at row … (Google time limit)" | Very big sheet; Google allows 6 minutes per run | Nothing; it continues by itself a minute later. |
| Column J shows numbers like 46298 | The column's format was changed | Select column J → **Format → Number → Date**. |
| Dates are one day off | Your sheet isn't set to Indian time | **File → Settings → Time zone → (GMT+05:30) India Standard Time**. |
| Safexpress rows all say "found no shipment" | TrackCourier.io may use a different name for Safexpress | Send me the message from the Tracking Log. The name is set in `Config.gs` (`trackCourierSlug`). |

## Small changes you can make in `Config.gs`

| Want… | Change this line |
|---|---|
| A different tab than the first one | `SHEET_NAME: 'Orders',` (your tab name) |
| Date shown as 04/10/2026 | `DATE_FORMAT: 'dd/mm/yyyy',` |
| Shorter status text (no place name) | `SHOW_LOCATION: false,` |
| Update every hour | `AUTO_UPDATE_EVERY_HOURS: 1,`, then turn automatic updates OFF and ON again |

After any change, press **Ctrl + S** in Apps Script.

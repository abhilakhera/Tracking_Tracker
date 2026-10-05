# Something isn't working?

👉 **First look at the "Tracking Log" tab** in your sheet. It lists every row that wasn't
updated, with the reason.

| What you see | What it means | What to do |
|---|---|---|
| No **📦 Courier Tracking** menu | The sheet hasn't loaded the robot yet | Refresh the page (F5) and wait 10 seconds. Check that all files were saved in Apps Script (Ctrl + S). |
| "No TrackCourier.io API key saved" | The key isn't saved yet | **📦 Courier Tracking → Set / change API keys** and paste it. |
| "rejected the API key" | The key is wrong or expired | Copy it again from your TrackCourier.io account (no spaces) and save it again. |
| "monthly limit of your plan reached" | Your TrackCourier.io requests for the month are used up | Upgrade the plan, or wait for next month. See Part 5 of [SETUP_GUIDE.md](SETUP_GUIDE.md) to use fewer. |
| "Paused at row … (time or TrackCourier.io per-minute limit)" | Your plan allows only a few checks per minute | Nothing; it continues by itself a minute later. |
| "Stopped at row … after 50 automatic continuations" | Something kept blocking it, usually the monthly limit | Check your TrackCourier.io plan. The next scheduled update tries again. |
| "Courier name not recognised" | Column H has a spelling the robot doesn't know, e.g. "Delhivry" | Fix the spelling in the cell. |
| "found no shipment with this number" | The courier doesn't know this number | Check the number on the courier's website. Very new parcels may show up only after pickup. |
| "DP World has no shipment with this docket number" | DP World doesn't know this docket | Check the number on DP World's tracking page. |
| "DP World website replied HTTP …" on **every** DP World row, for more than a day | DP World changed their website | The DP World reader (`DPWorld.gs`) needs updating. Send the message from the Tracking Log. |
| "Paused at row … (Google time limit)" | Very big sheet; Google allows 6 minutes per run | Nothing; it continues by itself a minute later. |
| Column J shows numbers like 46298 | The column's format was changed | Select column J → **Format → Number → Date**. |
| Dates are one day off | Your sheet isn't set to Indian time | **File → Settings → Time zone → (GMT+05:30) India Standard Time**. |
| "TrackCourier.io does not know the courier name …" | A courier name in `Config.gs` is misspelt | Fix `trackCourierSlug` in `Config.gs`: it must be `delhivery` or `safexpress`. |

## Small changes you can make in `Config.gs`

| Want… | Change this line |
|---|---|
| A different tab than the first one | `SHEET_NAME: 'Orders',` (your tab name) |
| Date shown as 04/10/2026 | `DATE_FORMAT: 'dd/mm/yyyy',` |
| Shorter status text (no place name) | `SHOW_LOCATION: false,` |
| Update once a day (uses fewer requests) | `AUTO_UPDATE_EVERY_HOURS: 24,`, then turn automatic updates OFF and ON again |
| You upgraded TrackCourier.io (faster checks) | `TRACKCOURIER_REQUESTS_PER_MINUTE: 60,` (Starter) or `300` (Pro) |

After any change, press **Ctrl + S** in Apps Script.

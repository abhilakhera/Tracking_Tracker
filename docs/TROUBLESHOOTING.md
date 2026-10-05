# Something isn't working?

👉 **First look at the "Courier Tracking Log" tab** in your sheet. It lists every row that wasn't
updated, with the reason.

| What you see | What it means | What to do |
|---|---|---|
| No **📦 Courier Tracking** menu | Setup hasn't been run, or the page needs a refresh | Run `CT_setup` once in Apps Script (Part 2 of [SETUP_GUIDE.md](SETUP_GUIDE.md)), then refresh the sheet (F5). |
| *Could not find the tab "Order Tracking"* | The tab is named differently | Rename the tab, or change `SHEET_NAME` in `CT_Config`. Capitals and spaces must match. |
| Parcels weren't updated this morning | The daily update is off | **📦 Courier Tracking → Test API connections** shows "Daily update: ON/OFF". If OFF: **Turn ON daily update**. |
| An error about "scopes" or permissions when running `CT_setup` | Your other scripts list their permissions by hand | See the box in Part 1 of [SETUP_GUIDE.md](SETUP_GUIDE.md). |
| "No TrackCourier.io API key saved" | The key isn't saved yet | **📦 Courier Tracking → Set / change API keys** and paste it. |
| "rejected the API key" | The key is wrong or expired | Copy it again from your TrackCourier.io account (no spaces) and save it again. |
| "monthly limit of your plan reached" | Your TrackCourier.io requests for the month are used up | Upgrade the plan, or wait for next month. Get the free Delhivery token (see [SETUP_GUIDE.md](SETUP_GUIDE.md)) to use fewer. |
| "Paused at row … (time or TrackCourier.io per-minute limit)" | Your plan allows only a few checks per minute | Nothing; it continues by itself a minute later. |
| "Stopped at row … after 50 automatic continuations" | Something kept blocking it, usually the monthly limit | Check your TrackCourier.io plan. The next daily update tries again. |
| "Courier name not recognised" | Column H has a spelling the robot doesn't know, e.g. "Delhivry" | Fix the spelling in the cell. |
| "found no shipment with this number" | The courier doesn't know this number | Check the number on the courier's website. Very new parcels may show up only after pickup. |
| "DP World has no shipment with this docket number" | DP World doesn't know this docket | Check the number on DP World's tracking page. |
| "DP World website replied HTTP …" on **every** DP World row, for more than a day | DP World changed their website | The DP World reader (`DPWorld.gs`) needs updating. Send the message from the log tab. |
| "Paused at row … (Google time limit)" | Very big sheet; Google allows 6 minutes per run | Nothing; it continues by itself a minute later. |
| Column K shows numbers like 46298 | The column's format was changed | Select column K → **Format → Number → Date**. |
| Dates are one day off | Your sheet isn't set to Indian time | **File → Settings → Time zone → (GMT+05:30) India Standard Time**. |
| "TrackCourier.io does not know the courier name …" | A courier name in `CT_Config` is misspelt | Fix `trackCourierSlug` in `CT_Config`: it must be `delhivery` or `safexpress`. |

## Small changes you can make in `CT_Config`

| Want… | Change this line |
|---|---|
| A different tab | `SHEET_NAME: 'Order Tracking',` (your tab name) |
| Different columns | the letters under `COLUMNS:` |
| No Brief Status column | `BRIEF_STATUS: '',` |
| Date shown as 04/10/2026 | `DATE_FORMAT: 'dd/mm/yyyy',` |
| Shorter status text (no place name) | `SHOW_LOCATION: false,` |
| A different time than 8 AM | `DAILY_UPDATE_HOUR: 8,` (24-hour clock, e.g. 18 = 6 PM), then **Turn ON daily update** again from the menu |
| You upgraded TrackCourier.io (faster checks) | `TRACKCOURIER_REQUESTS_PER_MINUTE: 60,` (Starter) or `300` (Pro) |

After any change, press **Ctrl + S** in Apps Script.

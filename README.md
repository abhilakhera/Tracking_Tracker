# Tracking Tracker 📦

A **robot inside your Google Sheet** that checks your parcels and fills in their status
by itself.

## What it does, in one picture

```
  Your Google Sheet, tab "Order Tracking"
  ┌─────────────┬────────────┬──────────────┬────────────────────────────────┬─────────────┐
  │ G           │ H          │ I            │ J                              │ K           │
  │ Tracking ID │ Courier    │ Brief Status │ Tracking Status                │ Status Date │
  ├─────────────┼────────────┼──────────────┼────────────────────────────────┼─────────────┤
  │ 4238701017… │ Delhivery  │ In Transit   │ In Transit - Shipment left …   │ 03-Oct-2026 │
  │ 100041695709│ Safexpress │ Delivered    │ Delivered (Chennai)            │ 02-Oct-2026 │
  │ 1846272584  │ DP World   │ Delivered    │ Delivered (Anantapur)          │ 30-Sep-2026 │
  └─────────────┴────────────┴──────────────┴────────────────────────────────┴─────────────┘
        ▲ you type these          ▲ the robot fills these in
```

Every morning at 8 AM the robot:

1. reads the **Tracking ID** (G) and **Courier** (H) of every parcel that isn't delivered yet,
2. asks that courier "where is this parcel now?",
3. writes **Brief Status** (I), the full **Tracking Status** (J) and the **date** of that update (K).

It only ever changes the **Order Tracking** tab, and it is built to sit safely next to the other
scripts in your spreadsheet (everything in it starts with `CT_`).

## Words you'll see

| Word | Meaning in plain English |
|---|---|
| **Script** | The robot. A small program saved inside your Google Sheet. Google runs it for free. |
| **API** | A "back door" a company gives to robots. The robot asks a question and gets a short, clean answer, without opening a web page. |
| **API key** | The password for that back door. Keep it secret, like a bank PIN. |

## Where each courier's status comes from

| Courier | Where the robot asks | Status |
|---|---|---|
| Delhivery | TrackCourier.io (your key), or Delhivery directly if you get a free Delhivery token | ✅ Ready |
| Safexpress | TrackCourier.io (your key) | ✅ Ready |
| DP World | DP World's own tracking page (free, no key needed) | ✅ Ready |

## How to install it

Follow **[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)**. It's copy and paste only, and
takes about 15 minutes.

Something not working? See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

---

<details>
<summary>For technical people: files in this repository</summary>

```
apps-script/          code to paste into Extensions → Apps Script
  Config.gs           settings (tab name, columns, date format, couriers, 8 AM schedule)
  Main.gs             menu, reading/writing the sheet, scheduling
  TrackCourier.gs     TrackCourier.io connector (Safexpress, Delhivery)
  Delhivery.gs        Delhivery's own API (optional, needs a Delhivery token)
  DPWorld.gs          DP World reader (the data behind DP World's tracking page)
  Utils.gs            date reading, courier-name matching
  appsscript.json     permissions (for a fresh project only; keep your own in a sheet with other scripts)
tests/                offline tests: npm test
```
</details>

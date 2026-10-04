# Tracking Tracker 📦

A **robot inside your Google Sheet** that checks your parcels and fills in their status
by itself.

## What it does, in one picture

```
  Your Google Sheet
  ┌──────────────┬────────────┬──────────────────────────┬─────────────┐
  │ G            │ H          │ I                        │ J           │
  │ Tracking ID  │ Courier    │ Tracking Status          │ Status Date │
  ├──────────────┼────────────┼──────────────────────────┼─────────────┤
  │ 1234567890   │ Delhivery  │ In Transit (Mumbai)      │ 03-Oct-2026 │
  │ 55123456     │ Safexpress │ Delivered (Chennai)      │ 02-Oct-2026 │
  │ DPW00987     │ DP World   │ Out for Delivery         │ 04-Oct-2026 │
  └──────────────┴────────────┴──────────────────────────┴─────────────┘
        ▲ you type these        ▲ the robot fills these in
```

Every 2 hours the robot:

1. reads the **Tracking ID** (column G) and **Courier** (column H) of each row,
2. asks that courier "where is this parcel now?",
3. writes the answer in **Tracking Status** (column I) and the **date** of that update (column J).

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
| DP World | DP World's own tracking website (free) | ⏳ Needs one more piece of info, see below |

## How to install it

Follow **[docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)**. It's copy and paste only, and
takes about 15 minutes.

Something not working? See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

---

<details>
<summary>For technical people: files in this repository</summary>

```
apps-script/          code to paste into Extensions → Apps Script
  Config.gs           settings (columns, date format, couriers, schedule)
  Main.gs             menu, reading/writing the sheet, scheduling
  TrackCourier.gs     TrackCourier.io connector (Safexpress, Delhivery)
  Delhivery.gs        Delhivery's own API (optional, needs a Delhivery token)
  DPWorld.gs          DP World website reader (waiting for page details)
  Utils.gs            date reading, courier-name matching
  appsscript.json     timezone (India) and permissions
tests/                offline tests: npm test
```
</details>

# Tracking Tracker 📦

Automatically updates the courier tracking status of every shipment in a Google Sheet.
Supports **Delhivery**, **Safexpress** and **DP World**.

```
 Google Sheet                                              Courier APIs
┌────────────┬──────────────┬───────────────────────┬─────────────┐
│ G          │ H            │ I                     │ J           │
│ Tracking ID│ Courier      │ Tracking Status       │ Status Date │
├────────────┼──────────────┼───────────────────────┼─────────────┤      ┌──────────────┐
│ 1234567890 │ Delhivery    │ In Transit - Received │ 03-Oct-2026 │ ◄──► │ Delhivery API│
│            │              │ at hub (Mumbai_HB)    │             │      └──────────────┘
│ 55123456   │ Safexpress   │ Delivered (Chennai)   │ 02-Oct-2026 │ ◄──┐ ┌──────────────┐
│ DPW00987   │ DP World     │ Out for Delivery      │ 04-Oct-2026 │ ◄──┴►│ TrackingMore │
└────────────┴──────────────┴───────────────────────┴─────────────┘      │ (multi-courier)
        reads G + H  ──►  asks the API  ──►  writes I + J                 └──────────────┘
```

## How it works

1. A small program (**Google Apps Script**) lives inside your Google Sheet. It runs for
   free on Google's computers. You don't need a server or software on your laptop.
2. It reads each row's **Tracking ID (G)** and **Courier Partner (H)**.
3. It asks the courier's **API** for the latest status. An API is a "waiter" that fetches
   data from the courier's system for a program; see [docs/API_BASICS.md](docs/API_BASICS.md).
   * **Delhivery** → Delhivery's own tracking API (or TrackingMore if you have no Delhivery token)
   * **Safexpress, DP World** → [TrackingMore](https://www.trackingmore.com), one API covering many couriers
4. It writes the **latest status (I)** and the **date of that status (J)**. Column J holds
   real date values, so you can sort, filter and use date formulas on it.
5. It runs **automatically every 2 hours**, and you can also run it from the
   **📦 Courier Tracking** menu. Shipments already marked *Delivered* are skipped.
   Any problems are listed by row in a **Tracking Log** tab.

## Get started

| # | What | Guide |
|---|---|---|
| 1 | Understand APIs and keys (5-minute read) | [docs/API_BASICS.md](docs/API_BASICS.md) |
| 2 | Get a TrackingMore API key, plus a Delhivery token (optional) | [docs/GETTING_API_KEYS.md](docs/GETTING_API_KEYS.md) |
| 3 | Install the script in your sheet (copy-paste, about 15 minutes) | [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) |
| 4 | If something goes wrong | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |

## Repository layout

```
apps-script/            ← the code you copy into Extensions → Apps Script
  Config.gs             ← settings (columns, date format, couriers, schedule)
  Main.gs               ← menu, reading/writing the sheet, scheduling
  Delhivery.gs          ← Delhivery API connector
  TrackingMore.gs       ← TrackingMore API connector (Safexpress, DP World, Delhivery)
  Utils.gs              ← date parsing, courier-name matching, helpers
  appsscript.json       ← timezone (India) and permissions
docs/                   ← beginner guides
tests/                  ← offline tests (npm test), no keys needed
```

## Sheet menu

| Menu item | What it does |
|---|---|
| Update all tracking statuses now | Checks every unfinished shipment |
| Update selected rows only | Checks just the rows you've selected (including delivered ones) |
| Set / change API keys | Stores your keys privately, never in the sheet |
| Test API connections | Checks your keys and shows which courier code is used |
| Turn ON / OFF automatic updates | Schedules a run every few hours |

## Costs

* Google Apps Script: **free**.
* Delhivery tracking API: free for Delhivery business customers.
* TrackingMore: paid per *new* shipment registered, with a free trial quota for new accounts.
  Re-checking a shipment until it's delivered costs nothing extra. See their pricing page.

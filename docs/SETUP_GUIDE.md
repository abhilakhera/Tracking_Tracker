# Step-by-step setup (about 15 minutes, no coding)

## Before you start

* Your Google Sheet has **Tracking ID in column G** and **Courier Partner in column H**.
  The script fills **Tracking Status in column I** and **Status Date in column J**.
* Row 1 holds headings and shipments start from row 2. If yours is different, change
  `HEADER_ROWS` in step 3.
* You have a **TrackingMore API key** ([how to get it](GETTING_API_KEYS.md)). You can also
  do steps 1–5 first and get the key afterwards.

> 💡 **Make a copy of your sheet first** (File → Make a copy) and set everything up on the
> copy. Once it works, repeat on the real sheet, or keep using the copy.

---

## Step 1: Open the script editor

1. Open your Google Sheet.
2. In the top menu click **Extensions → Apps Script**. A new tab opens with a code editor
   and a file called `Code.gs`.
3. Click **Untitled project** (top left) and name it `Courier Tracking`.

## Step 2: Add the code files

You'll copy 5 files from the `apps-script/` folder of this repository into the editor.

For each file in this list:

| File in this repo | Name to give it in the editor |
|---|---|
| `apps-script/Config.gs` | `Config` |
| `apps-script/Utils.gs` | `Utils` |
| `apps-script/Delhivery.gs` | `Delhivery` |
| `apps-script/TrackingMore.gs` | `TrackingMore` |
| `apps-script/Main.gs` | `Main` |

1. In the editor, click the **+** next to **Files** → **Script**, then type the name (e.g. `Config`).
   The editor adds `.gs` itself.
2. On GitHub, open the file, click the **Copy raw file** button (two overlapping squares),
   and paste it into the new editor file, replacing anything already there.
3. Repeat for all 5 files.
4. Delete the empty `Code.gs`: click ⋮ next to it → **Delete**.
5. Click **💾 Save** (or Ctrl+S).

### Step 2b: the manifest file (`appsscript.json`)

This sets the timezone to India and lists the permissions the script needs.

1. Click the **⚙ Project Settings** (gear icon on the left).
2. Tick **Show "appsscript.json" manifest file in editor**.
3. Go back to the **< > Editor**, open `appsscript.json`, and replace its contents with
   `apps-script/appsscript.json` from this repository. Save.

## Step 3: Check the settings

Open `Config.gs` in the editor. The important lines:

```js
SHEET_NAME: '',          // tab name, e.g. 'Orders'. '' = first tab
HEADER_ROWS: 1,          // rows of headings at the top
COLUMNS: { TRACKING_ID: 'G', COURIER: 'H', STATUS: 'I', STATUS_DATE: 'J' },
DATE_FORMAT: 'dd-mmm-yyyy',
```

If your shipment data is **not on the first tab**, type the tab name between the quotes,
e.g. `SHEET_NAME: 'Orders',`. Save.

## Step 4: Give permission (first run only)

1. Go back to your Google Sheet tab and **reload the page** (F5).
2. After a few seconds a new menu **📦 Courier Tracking** appears next to *Help*.
3. Click **📦 Courier Tracking → Set / change API keys**.
4. Google asks for authorisation:
   * **Continue** → pick your Google account.
   * If you see *"Google hasn't verified this app"*: click **Advanced** →
     **Go to Courier Tracking (unsafe)**. This is normal for scripts you write yourself;
     the script belongs to you and only runs in your account.
   * Click **Allow**.

   The permissions requested are: edit **this** spreadsheet, connect to external services
   (the courier APIs), and run on a schedule.
5. Run **Set / change API keys** again if the authorisation interrupted it.

## Step 5: Save your API key(s)

**📦 Courier Tracking → Set / change API keys**

* Box 1: paste your **TrackingMore API key** → OK
* Box 2: paste your **Delhivery token** if you have one, otherwise leave empty → OK

## Step 6: Test

1. **📦 Courier Tracking → Test API connections.** You should see ✅ next to each key, and
   a TrackingMore courier code for Safexpress and DP World (and Delhivery, if no Delhivery token).
2. **📦 Courier Tracking → Update all tracking statuses now.**
3. Watch the small pop-up at the bottom right. When it's done:
   * Columns **I** and **J** are filled for shipments that have data.
   * A new tab **Tracking Log** lists anything that needs attention, by row number.

> **First run with TrackingMore:** new tracking numbers are *registered* first, and the
> status usually appears a few minutes later. The Log says
> *"Registered with TrackingMore…"*. Run the update again after ~10 minutes, or wait for
> the automatic update.

## Step 7: Switch on automatic updates

**📦 Courier Tracking → Turn ON automatic updates**

The sheet now refreshes every 2 hours (change `AUTO_UPDATE_EVERY_HOURS` in `Config.gs`),
even when nobody has it open. Rows already marked **Delivered** are skipped.

To stop: **📦 Courier Tracking → Turn OFF automatic updates**.

---

## Everyday use

* **Add new shipments** by typing the Tracking ID (G) and Courier Partner (H) in a new row.
  The next update picks them up.
* **Check a few rows right now:** select them, then **📦 Courier Tracking → Update selected rows only**.
  This also re-checks rows already marked Delivered.
* **Courier names** are matched loosely. *Delhivery*, *DELHIVERY B2C*, *Safe Express*,
  *SafExpress*, *DP World*, *DPWorld* all work. Other spellings: add them to
  `aliases` in `Config.gs`.
* **Status Date** holds real dates, so you can sort, filter, and use formulas such as
  `=TODAY()-J2` (days since last update) to spot stuck shipments.

## Optional: deploy with `clasp` (for technical users)

If you're comfortable with a terminal, you can push the files instead of copy-pasting:

```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID> --rootDir apps-script   # Script ID: Apps Script → Project Settings
clasp push
```

## Running the offline tests (for technical users)

```bash
npm test
```

These check the date parsing, courier-name matching and API-response handling against
sample data. They need Node.js, and no API keys.

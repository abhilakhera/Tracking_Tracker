# Setup guide (simple steps)

⏱ About 15 minutes. You don't need to understand the code; you only copy and paste.

This guide is for your **main spreadsheet**, which already has other scripts. The robot is
built so it **cannot interfere with them**: everything in it starts with `CT_`, it only
changes the **Order Tracking** tab, and it only ever touches its own automatic triggers.

---

## Before you start: check the "Order Tracking" tab

| Column | Heading | Who fills it |
|---|---|---|
| G | Tracking ID | You |
| H | Courier Partner | You |
| I | Brief Status | Robot: just "Delivered", "In Transit", "Out for Delivery", … |
| J | Tracking Status | Robot: the full latest status |
| K | Status Date | Robot: the date of that status (a real date) |

- The tab name must be exactly **Order Tracking** (same capitals and spaces).
- Row 1 holds the headings; parcels start in row 2.
- If you already have statuses in column J, the robot fills in Brief Status (column I)
  for those rows by itself.

---

## Part 1: Add the robot's files (don't touch the existing ones)

**Step 1.** Open the main spreadsheet → **Extensions → Apps Script**.
You'll see your existing script files on the left. **Leave them exactly as they are.**

**Step 2.** Add 6 new files. For **each** row in this table:
1. Click the **+** next to "Files" → **Script**.
2. Type the name from the right-hand column, then press Enter.
3. Open the matching file on GitHub, click the **copy** button (two small squares, top
   right of the file), and paste it into the new, empty file.

| Open on GitHub | Name it |
|---|---|
| `apps-script/Config.gs` | `CT_Config` |
| `apps-script/Utils.gs` | `CT_Utils` |
| `apps-script/Main.gs` | `CT_Main` |
| `apps-script/TrackCourier.gs` | `CT_TrackCourier` |
| `apps-script/Delhivery.gs` | `CT_Delhivery` |
| `apps-script/DPWorld.gs` | `CT_DPWorld` |

> ℹ️ **Leave `appsscript.json` alone.** Your spreadsheet already has this settings file, and
> it is shared with your other scripts. You don't need to copy ours or change yours.

**Step 3.** Press **Ctrl + S** to save.

> **Rare case (most people can skip this):** only if Step 5 shows an error mentioning
> **"scopes"**, send a screenshot of the error to whoever set this up for you. This only happens
> when a spreadsheet's `appsscript.json` contains a line starting with `"oauthScopes"`.

---

## Part 2: Switch it on (one time)

**Step 4.** At the top of the Apps Script editor there's a drop-down list of functions
(next to **▶ Run** and **Debug**). Choose **`CT_setup`**.

**Step 5.** Click **▶ Run**. Google asks for permission:
- Click **Review permissions** and choose your Google account.
- If it says *"Google hasn't verified this app"*, click **Advanced** →
  **Go to … (unsafe)**. This is normal for your own scripts.
- Click **Allow**.

At the bottom, the *Execution log* should say
**"✅ Courier Tracking is set up."** This step:
- adds the **📦 Courier Tracking** menu to the spreadsheet, and
- switches on the **daily update at 8 AM**.

If it says *Could not find the tab "Order Tracking"*, check the tab's name and run it again.

**Step 6.** Go back to the spreadsheet and **refresh the page** (F5). After a few seconds the
**📦 Courier Tracking** menu appears at the top.

---

## Part 3: Your TrackCourier.io key

**Step 7.** **📦 Courier Tracking → Set / change API keys.**
- **First box:** paste your **TrackCourier.io key** (it starts with `tc_live_`). Click OK.
- **Second box:** leave empty (that's for an optional Delhivery token). Click OK.

> 🔒 The key is saved privately inside the robot. **Never type it into a cell.**
> Keys saved in your test sheet don't carry over, so save it again here.

**Step 8.** Set your plan's speed. In Apps Script open **`CT_Config`** and find:
```
TRACKCOURIER_REQUESTS_PER_MINUTE: 60,
```
**60** is right for the **Starter** plan. On the **Pro** plan, change it to **300**. Press Ctrl + S.

---

## Part 4: Try it

**Step 9.** **📦 Courier Tracking → Test API connections.** You should see:
- TrackCourier.io: ✅ connected
- DP World website: ✅ reachable
- Daily update: ON, around 8:00
- Tab being updated: "Order Tracking"

This test doesn't use any of your monthly TrackCourier.io requests.

**Step 10.** **📦 Courier Tracking → Update all tracking statuses now.**
Wait for the message at the bottom-right. Columns **I, J and K** are now filled.
A new tab, **Courier Tracking Log**, lists any row that couldn't be updated and why, and shows
how many TrackCourier.io requests you've used this month.

That's it. 🎉 From now on, the robot runs **every morning between 8:00 and 8:30**, even when
nobody has the spreadsheet open, and checks **only parcels that aren't delivered yet**.
(Google starts daily jobs within a half-hour window; an exact minute isn't possible.)

---

## Everyday use

- **New parcel?** Type its Tracking ID (G) and Courier (H) in a new row. The next morning's run picks it up.
- **Need an update right now?** Select the rows on the Order Tracking tab, then
  **📦 Courier Tracking → Update selected rows only**.
- **Delivered parcels** (Brief Status "Delivered" or "RTO Delivered") are never checked again.
- **Courier names:** "Delhivery", "DELHIVERY", "Safe Express", "SafExpress", "DP World" and "DPWorld" all work.
- **Turning it off:** **📦 Courier Tracking → Turn OFF daily update.** Your other scripts' schedules are not affected.

---

## How many TrackCourier.io requests will I use?

Checking one Delhivery or Safexpress parcel uses **1 request**. DP World is free.

> **Requests per month ≈ undelivered Delhivery + Safexpress parcels × 30**  (one check a day)

Example: 150 parcels on the way at any time → 150 × 30 = **4,500 requests a month**, which
fits the Starter plan (5,000). The Courier Tracking Log tab shows your usage after every run.

| TrackCourier.io plan | Requests per month | Requests per minute |
|---|---|---|
| Free | 100 | 10 |
| Starter | 5,000 | 60 |
| Pro | 50,000 | 300 |

---

## DP World

DP World needs **nothing from you**: no key, no account, no cost. The robot reads the same
information that DP World's tracking page (<https://www.logistics.dpworld.com/tracking/in/express>)
shows when you type a docket number.

This is the data behind DP World's website, not an official service for programs. If DP World
redesigns their website, DP World rows may stop updating, and the log tab will say so.

---

## Optional: free Delhivery tracking

If your company has a **Delhivery business login** (Delhivery One), Delhivery can be tracked
**for free** directly, which saves TrackCourier.io requests:
1. Log in at <https://one.delhivery.com> → **Settings → API Setup** → copy the **API token**.
   If you can't find it, ask your Delhivery account manager for "the API token for package tracking".
2. **📦 Courier Tracking → Set / change API keys**: leave the first box empty and paste the token in the second box.

---

## Updating your test sheet too

The test sheet used the older version. To keep it working, replace its files with the new
ones the same way, then run `CT_setup` once. Change `SHEET_NAME` and `COLUMNS` in `CT_Config`
if its layout differs from the Order Tracking tab. Also remove the old version's schedule: in
Apps Script click the ⏰ **Triggers** icon on the left and delete any trigger whose function is
`scheduledTrackingUpdate` or `continueTrackingUpdate`.

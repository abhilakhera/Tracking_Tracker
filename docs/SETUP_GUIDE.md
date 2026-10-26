# Setup guide (simple steps)

⏱ About 15 minutes. You don't need to understand the code; you only copy and paste.

This guide is for your **main spreadsheet**, which already has other scripts. The robot is
built so it **cannot interfere with them**: everything in it starts with `CT_`, it only
changes the **Order Tracking** tab, and it only ever touches its own automatic triggers.

---

## What fills what

**Order Tracking** (one row per product):

| Column | Heading | Filled by |
|---|---|---|
| A–F | Order Id, Order Date, SKU, FSN, Customer Name, Contact Number | Robot, from **Pre CRM** |
| G | Tracking ID | Robot, from the seller team's sheet ("Raw Order Tracking"); you type it only if it isn't there |
| H | Courier Partner | Robot, from the seller team's sheet; otherwise you |
| I | Brief Status | Robot: just "Delivered", "In Transit", … |
| J | Tracking Status | Robot: the full latest status from the courier |
| K | Status Date | Robot: the date of that status |
| L | Delivery By Date | Robot, from **Pre CRM** |
| M | Remarks | **You** |
| N–O | Return Request Type, Refund Status | Robot, from **Self Ship Cases** |
| P | Order Item Id | Robot: tells the robot which product each row is. **Don't edit it.** |

- Orders come in from **Pre CRM** when they were **ordered on or after 20-Sep-2026** and
  their **Remarks** contain **"Dispatch"**, but not "Do Not Dispatch" (or "Don't Dispatch",
  "Not to Dispatch", ...). New products are added at the bottom.

- Couriers you track by hand (**BNG**, set in `MANUAL_COURIERS` in `CT_Config`) are skipped by the
  tracking robot: fill in Brief Status, Tracking Status and Status Date yourself.
- Order Tracking **mirrors Pre CRM**: an order is there only while Pre CRM lists it as a
  "Dispatch" order (as many times as Pre CRM lists it). Rows of orders that no longer qualify
  (remark changed, deleted from Pre CRM) and extra duplicate copies are removed automatically.
  When you **change a Remark** in Pre CRM (e.g. "Dispatch" → "Hold"), its Order Tracking row is
  removed **straight away**; changing it back to "Dispatch" brings the row back straight away.
  Every removed row is first copied, complete, to the **Removed Orders** tab, so nothing you
  typed is lost.
- Columns G, H and M are **never** changed by the robot.

**Review & Rating Data**: a product is added **2 days after its Status Date** once its Brief Status
is **Delivered**. Orders in **Self Ship Cases** are added only if **"Eligible for Review"** (column W)
says **Yes** (then by the same 2-day rule); with **No** or empty they are kept out, and if they are
already there they are **removed** straight away. Changing No → Yes brings them in at once (when
delivered 2+ days ago). The robot fills A–G (and M, Order Item Id); your team's columns **H–L are
never touched**.

**Self Ship Cases**: type or paste an **Order ID in column C** and press Enter. The robot fills
**SKU (A), FSN (B), Order Item ID (D), Customer Name (E), Phone Number (F), City (G) and Pin code (H)**
from Pre CRM. If Pre CRM has **more than one row** for that order (several products, or the same
product listed twice), a **pop-up** asks which row to use. Your other columns are never touched.
- Order ID not in Pre CRM: a note on the cell says so, and nothing is filled.
- If the pop-up doesn't appear (for example for a teammate, or after Cancel), select the row and use
  **📦 Courier Tracking → Fill Self Ship row(s) from Pre CRM**. The same menu item refills rows any time.

**When it runs:**
- Courier tracking: every morning between 8:00 and 8:30.
- Order sync: every hour, about a minute after you edit **Pre CRM**, and straight away when
  you edit **Self Ship Cases**. Also from the menu: **📦 Courier Tracking → Sync orders now**.

---

## Tracking import (seller team's spreadsheet → "Raw Order Tracking")

The robot reads **every tab** of **GANPATI ARTS FLIPKART TRACKING - 2026** and copies
the **ORDER ID**, **Tracking ID** and **TRANSPORT** columns into the hidden **Raw Order Tracking** tab
(**Order ID**, **Tracking ID**, **Courier Name**):
- the columns are found by their headings in the first 10 rows of each tab, wherever they are,
  with capitals, spaces and small spelling mistakes ignored ("Oder ID", "Tracking No", "Transporter");
- misspelled **Delhivery**, **Safexpress** and **DP World** are written correctly; other couriers as typed;
- no two identical rows; rows without both an Order ID and a Tracking ID are left out;
- the tab is only rewritten when something changed. Other columns in it are never touched.

**Filling Order Tracking:** after each import that changed something (and on every sync), the robot fills
**Tracking ID (G)** and **Courier Partner (H)** in Order Tracking from "Raw Order Tracking", matched by Order ID:
- the seller team's sheet wins: if they change a Tracking ID, the row gets the new one, and its old status
  (Brief Status, Tracking Status, Status Date) is cleared so the next tracking run fills it again;
- one Tracking ID for an order with several products → every product row gets it; one per product → given
  out in row order; any other mismatch → those rows are left alone and the Order Sync Log says so;
- orders the seller team's sheet doesn't have keep whatever you typed.
Turn this off with `FILL_TRACKING_FROM_RAW: false` in `CT_Config`.

**When it runs:** about **1 minute after anyone edits** the seller team's spreadsheet (typing, pasting,
or adding a new tab; many quick edits lead to one import), plus a safety-net check **every 30 minutes**,
plus **📦 Courier Tracking → Import tracking data now**. **Test API connections** shows the last result.

The Google account that runs `CT_setup` needs **edit** access to the seller team's spreadsheet for the
"1 minute after an edit" part (with view access only, the 30-minute check still works). Their
spreadsheet is only ever **read**, never changed.

---

## FSN links (all tabs)

In **every tab**, any column whose heading in row 1 is **FSN** (in any column position) turns
its values into clickable Flipkart links: straight away when you type or paste, and every hour
for values written by other scripts. Cells that already hold a formula are left alone.
To convert everything at once: **📦 Courier Tracking → Make all FSNs clickable (all tabs)**.

---

## Already set up the tracker before? Do only this

1. In Apps Script, open **`CT_Config`**, select everything (**Ctrl + A**), and paste the new
   `apps-script/Config.gs` over it. If you had changed a number in it (for example
   `TRACKCOURIER_REQUESTS_PER_MINUTE`), change it again.
2. Do the same for **`CT_Main`** with the new `apps-script/Main.gs`.
3. Add one new file named **`CT_Sync`** with `apps-script/Sync.gs`.
4. Press **Ctrl + S**, choose **`CT_setup`** at the top and click **▶ Run** (allow the new
   permission if asked).
5. Refresh the spreadsheet and click **📦 Courier Tracking → Sync orders now**.

The other files (`CT_Utils`, `CT_TrackCourier`, `CT_Delhivery`, `CT_DPWorld`) stay as they are.

---

## Part 1: Add the robot's files (don't touch the existing ones)

**Step 1.** Open the main spreadsheet → **Extensions → Apps Script**.
You'll see your existing script files on the left. **Leave them exactly as they are.**

**Step 2.** Add 10 new files. For **each** row in this table:
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
| `apps-script/RajSolutions.gs` | `CT_RajSolutions` |
| `apps-script/Sync.gs` | `CT_Sync` |
| `apps-script/Fsn.gs` | `CT_Fsn` |
| `apps-script/Import.gs` | `CT_Import` |

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
- adds the **📦 Courier Tracking** menu to the spreadsheet,
- switches on the **daily tracking update at 8 AM**, and
- switches on the **order sync** (every hour and after edits).

If it says *Could not find the tab "…"*, check that tab's name (capitals and spaces must match)
and run it again.

**Step 6.** Go back to the spreadsheet and **refresh the page** (F5). After a few seconds the
**📦 Courier Tracking** menu appears at the top.

---

## Part 3: Your API keys

**Step 7.** **📦 Courier Tracking → Set / change API keys.** Three boxes appear, one after another:
- **First box:** paste your **TrackCourier.io key** (it starts with `tc_live_`). Click OK.
- **Second box:** leave empty (that's for an optional Delhivery token). Click OK.
- **Third box:** paste your **Raj Solutions key** (it starts with `pk_`; used for DP World). Click OK.

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
- Raj Solutions (DP World): ✅ connected
- Delhivery → …, Safexpress → TrackCourier.io, DP World → Raj Solutions
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

Checking one Delhivery or Safexpress parcel uses **1 request**. DP World goes through Raj
Solutions instead and uses none of your TrackCourier.io requests (see below).

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

DP World is tracked through **Raj Solutions** (rajsolutions.co.in), the shipping partner your
DP World parcels are booked with, using your **Raj Solutions API key** (Step 7, third box).
Raj Solutions gets the scans from DP World: booked, picked up, in transit, out for delivery,
delivered, RTO.

- **Speed:** Raj Solutions allows **20 requests a minute**, so the robot asks about 18 dockets a
  minute. 400 undelivered DP World parcels take about 22 minutes; the robot pauses and continues
  on its own (Google stops a script after 6 minutes). Delhivery and Safexpress are asked in the
  same run, in row order.
- **Where to find the key:** your Raj Solutions account → **API Access Control** → **Current API Key**.
  If you press **Rotate Key** there, the old key stops working: save the new one with
  **📦 Courier Tracking → Set / change API keys** (third box).
- DP World's own tracking page can't be used by a robot: since October 2026 it asks for a Google
  reCAPTCHA. TrackCourier.io's API doesn't offer DP World either.

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

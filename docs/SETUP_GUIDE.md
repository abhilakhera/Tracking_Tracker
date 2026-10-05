# Setup guide (simple steps)

⏱ About 15 minutes. You don't need to understand the code; you only copy and paste.

> 💡 Tip: first try it on a **copy** of your sheet (**File → Make a copy**).

---

## Part 1: Put the robot inside your sheet

**Step 1.** Open your Google Sheet.

**Step 2.** In the top menu, click **Extensions → Apps Script**.
A new tab opens. This is where the robot lives.

**Step 3.** On the left you'll see a file called **Code.gs**. We'll add 6 files.
For **each** file in the table below:

1. Click the **+** next to "Files" → choose **Script**.
2. Type the name from the right-hand column, then press Enter.
3. Open the matching file on GitHub (left-hand column), click the **copy** button
   (two small squares, top right of the file), and paste into the empty file.

| Open on GitHub | Name it |
|---|---|
| `apps-script/Config.gs` | `Config` |
| `apps-script/Utils.gs` | `Utils` |
| `apps-script/Main.gs` | `Main` |
| `apps-script/TrackCourier.gs` | `TrackCourier` |
| `apps-script/Delhivery.gs` | `Delhivery` |
| `apps-script/DPWorld.gs` | `DPWorld` |

**Step 4.** Delete the empty **Code.gs**: click the **⋮** next to it, then **Delete**.

**Step 5.** One settings file:
1. Click the **⚙ gear icon** (Project Settings) on the far left.
2. Tick ☑ **Show "appsscript.json" manifest file in editor**.
3. Click the **< >** icon (Editor) on the far left. A file **appsscript.json** is now visible.
4. Open it, delete everything inside, and paste in `apps-script/appsscript.json` from GitHub.

**Step 6.** Press **Ctrl + S** to save.

---

## Part 2: Give the robot your key

**Step 7.** Go back to your Google Sheet tab and **refresh the page** (press F5).
Wait a few seconds. A new menu **📦 Courier Tracking** appears at the top.

**Step 8.** Click **📦 Courier Tracking → Set / change API keys**.

**Step 9.** Google asks for permission (first time only):
- Click **Continue** and choose your Google account.
- If it says *"Google hasn't verified this app"*, click **Advanced**, then
  **Go to … (unsafe)**. This is normal: the robot is yours and only works inside your account.
- Click **Allow**.

**Step 10.** Click **📦 Courier Tracking → Set / change API keys** again.
- **First box:** paste your **TrackCourier.io key** (it starts with `tc_live_`). Click OK.
- **Second box:** leave empty (that's for an optional Delhivery token). Click OK.

> 🔒 Your key is saved privately inside the robot. **Never type it into the sheet's cells.**

---

## Part 3: Try it

**Step 11.** **📦 Courier Tracking → Test API connections.**
You should see **TrackCourier.io: ✅ connected**.

**Step 12.** **📦 Courier Tracking → Update all tracking statuses now.**
Wait until the small message at the bottom-right says it's finished.

Columns **I** and **J** are now filled for Delhivery and Safexpress rows.
A new tab, **Tracking Log**, lists any row that couldn't be updated and why.
For now this includes the DP World rows (see Part 5).

**Step 13.** **📦 Courier Tracking → Turn ON automatic updates.**
The robot now runs every 12 hours by itself, even when the sheet is closed. 🎉

---

## Part 4: Everyday use

- **New parcel?** Just type its Tracking ID (G) and Courier (H) in a new row. The robot picks it up on the next run.
- **Want an update right now?** Select the rows, then **📦 Courier Tracking → Update selected rows only**.
- **Delivered parcels** are skipped automatically, to save your TrackCourier.io credits.
- **Courier names:** "Delhivery", "DELHIVERY", "Safe Express", "SafExpress", "DP World" and "DPWorld" all work.

---

## Part 5: How many TrackCourier.io requests will I use?

Every time the robot checks one parcel, it uses **1 request** from your TrackCourier.io plan.
Delivered parcels are not checked again.

> **Requests per month ≈ parcels not yet delivered × checks per day × 30**

Example: 40 parcels on the way at any time, checked twice a day (every 12 hours):
40 × 2 × 30 = **2,400 requests a month**.

| TrackCourier.io plan | Requests per month | Requests per minute |
|---|---|---|
| Free | 100 | 10 |
| Starter | 5,000 | 60 |
| Pro | 50,000 | 300 |

The **Free** plan is only enough for testing. To save requests:
- Check less often: in `Config.gs`, `AUTO_UPDATE_EVERY_HOURS: 12` → `24` (once a day).
- Get the free **Delhivery token** (below). Then Delhivery parcels use no TrackCourier.io requests at all.

**After you upgrade**, open `Config.gs` and set `TRACKCOURIER_REQUESTS_PER_MINUTE` to your plan's
number (60 for Starter), so the robot works faster. On the Free plan it checks 10 parcels a minute
and simply continues by itself if it needs more time.

---

## Part 6: DP World (being set up)

TrackCourier.io doesn't track DP World, so the robot will read **DP World's own tracking page**
(<https://www.logistics.dpworld.com/tracking/in/express>), the same page you use yourself.
That part is still being built. Until it's ready, nothing breaks: DP World rows stay as they
are and are listed in the Tracking Log tab.

---

## Optional: free Delhivery tracking

If your company has a **Delhivery business login** (Delhivery One), Delhivery can be tracked
**for free** directly, which saves TrackCourier.io credits:
1. Log in at <https://one.delhivery.com> → **Settings → API Setup** → copy the **API token**.
   If you can't find it, ask your Delhivery account manager for "the API token for package tracking".
2. **📦 Courier Tracking → Set / change API keys**: leave the first box empty and paste the token in the second box.

The robot then switches Delhivery to the free direct route automatically.

# Getting the API keys

| Courier | Recommended API | Key you need | Required? |
|---|---|---|---|
| Safexpress | TrackingMore | TrackingMore API key | **Yes** |
| DP World | TrackingMore | TrackingMore API key (same key) | **Yes** |
| Delhivery | Delhivery's own API (or TrackingMore if you have no Delhivery token) | Delhivery API token | Optional |

**Minimum to start: one TrackingMore key.** It covers all three couriers.
Add a Delhivery token later if you want Delhivery tracked directly, which is free and
doesn't use TrackingMore credits.

> Website menus change from time to time. If a button below has moved, look for words
> like **"API"**, **"Developer"**, **"Integrations"** or **"API key / token"** in the settings.

---

## 1. TrackingMore API key (needed)

TrackingMore is a tracking service that connects to many couriers, including Delhivery and
Safexpress, and gives you one API for all of them.

1. Go to <https://www.trackingmore.com> and **sign up** with your work email.
2. After logging in, open the **Developer / API** section of the dashboard.
3. Click **Generate API Key** (or **Create API key**) and copy the key, a long string of letters and numbers.
4. In your Google Sheet: **📦 Courier Tracking → Set / change API keys** and paste it in the first box.

**Cost:** TrackingMore charges per **new tracking number registered**. Checking the
same number again (hourly, daily, until delivered) doesn't cost extra. New accounts
usually get a free trial quota. Check their **Pricing** page for current plans and pick one
that covers the number of shipments you send per month.

**Check DP World coverage before you pay.** Run **📦 Courier Tracking → Test API connections**
after saving your key. It shows which TrackingMore courier code was found for each courier. If
DP World shows ❌, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#dp-world-not-found-on-trackingmore).
You can also ask TrackingMore support: *"Do you support DP World Express India
(formerly Delex) domestic dockets? What is the courier code?"*

---

## 2. Delhivery API token (optional, recommended if you ship a lot with Delhivery)

This works if you ship through a **Delhivery business account** (the *Delhivery One* client panel).

1. Log in to your Delhivery client panel: <https://one.delhivery.com>.
2. Go to **Settings → API Setup** (sometimes shown as **Developer / API Token**).
3. Copy the **Live / Production API token**. If none exists, click **Generate** or **Request token**.
   If you can't find it, email your Delhivery account manager
   and ask for *"the API token for the Package Tracking API (track.delhivery.com)"*.
4. In your Google Sheet: **📦 Courier Tracking → Set / change API keys**, skip the first
   box (leave it empty), and paste the token in the second box.

Once saved, Delhivery numbers automatically switch from TrackingMore to Delhivery's own API.

> **Delhivery B2B / freight (LTL) shipments:** Part-truck-load shipments booked through
> Delhivery's B2B service are tracked with an **LR number** on a different Delhivery system,
> and the standard API token above may not find them. For those, leave Delhivery on
> TrackingMore. Open `apps-script/Config.gs` and set `provider: 'TRACKINGMORE'` for
> `DELHIVERY`, and check with TrackingMore that it covers Delhivery B2B LR numbers.

---

## 3. Direct Safexpress / DP World APIs (later, optional)

Both companies offer APIs to corporate customers, but they are not self-service:

* **Safexpress:** ask your Safexpress key account manager for *"tracking API access
  (waybill tracking API) and documentation"*.
* **DP World Express (ex-Delex):** ask your DP World relationship manager for
  *"tracking API credentials and documentation"*. You'll need your DP World customer code.

Once you have their documentation, a direct connector can be added in the same way as
`apps-script/Delhivery.gs`. This repository is set up for that: add a new file and a new
`provider` value. Until then, TrackingMore covers them.

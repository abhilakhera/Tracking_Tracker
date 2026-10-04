# What is an API?

You don't need to be a programmer to use this project, but this page explains the idea.

## The restaurant analogy

Say you're in a restaurant. You don't go into the kitchen and cook. You tell the **waiter**
what you want, the waiter takes the order to the kitchen, and brings the food back.

An **API** (Application Programming Interface) is that waiter, but between two computer programs:

| Restaurant | Our project |
|---|---|
| You | Your Google Sheet (the script inside it) |
| Waiter | The courier's API |
| Kitchen | The courier's tracking system (Delhivery / Safexpress / DP World) |
| Your order | "What is the status of tracking ID 1234567890?" |
| The food | "In Transit – reached Mumbai hub, 03-Oct-2026" |

When you track a parcel on a courier website, you type the number and read the page.
An API gives the **same information** to a program in a fixed, machine-readable form,
so the script can copy it into your sheet without a person reading web pages.

## What a real API request looks like

The script sends a request like this to Delhivery:

```
GET https://track.delhivery.com/api/v1/packages/json/?waybill=1234567890123
Authorization: Token 9f8e7d6c5b4a...
```

* `GET` means "I want to read something".
* The URL says *what* we want (package details for waybill 1234567890123).
* `Authorization: Token ...` is the **API key**, explained below.

Delhivery replies with **JSON**, a plain-text format that programs can read easily:

```json
{
  "ShipmentData": [{
    "Shipment": {
      "AWB": "1234567890123",
      "Status": {
        "Status": "In Transit",
        "StatusDateTime": "2026-10-03T11:02:44",
        "StatusLocation": "Mumbai_Bhiwandi_HB",
        "Instructions": "Shipment Received at Facility"
      }
    }
  }]
}
```

The script picks out `Status`, `Instructions` and `StatusLocation` for column **I**, and
`StatusDateTime` (converted into a real date) for column **J**.

## What is an API key?

An **API key** (also called a *token*) is like a password for a program. The courier uses it to:

* know **who** is asking, because only their customers may use the API,
* count **how much** you use it, since some plans are paid per shipment,
* block anyone who misuses it.

Treat API keys like passwords:
* ✅ Save them only through the sheet's menu (**📦 Courier Tracking → Set / change API keys**).
  They are then stored in the script's private settings, not in the sheet cells or the code.
* ❌ Don't paste them into the Google Sheet, emails, WhatsApp, or this GitHub repository.
* If a key leaks, generate a new one on the provider's website. The old one then stops working.

## Direct API vs. "aggregator" API

There are two ways to get tracking data:

1. **Direct courier API.** Each courier has its own API, its own key and its own response format.
   Delhivery's is easy to get from their customer portal. Safexpress and DP World usually
   give API access only to corporate customers on request, through your account manager.

2. **Aggregator API**, for example [TrackingMore](https://www.trackingmore.com). One company
   connects to over 1,000 couriers and gives you **one** API and **one** key for all of them.
   You pay them a small fee per shipment tracked.

This project supports **both**:

* **Safexpress and DP World → TrackingMore**, the easiest route available today.
* **Delhivery → Delhivery's own API** if you have a Delhivery token (free for Delhivery
  customers), otherwise TrackingMore.

So to get started you need **only one key: TrackingMore**. See [GETTING_API_KEYS.md](GETTING_API_KEYS.md).

## Where does the code run?

The code is a **Google Apps Script**, a small program attached to your Google Sheet that
runs on Google's computers for free. You don't need a server or software on your
laptop. It adds a **📦 Courier Tracking** menu to your sheet and can run automatically
every few hours, even when the sheet is closed.

/**
 * ============================================================================
 *  COURIER TRACKING: SETTINGS. This is the only file you normally need to edit.
 * ============================================================================
 *
 *  API keys are NOT stored here. Store them from the sheet menu:
 *  "📦 Courier Tracking" → "Set / change API keys". That keeps them out of the code.
 *
 *  Everything in these files starts with CT_ so it can never clash with other
 *  scripts in the same spreadsheet.
 */
var CT_CONFIG = {
  // Name of the tab that holds your shipments. Only this tab is ever changed.
  SHEET_NAME: 'Order Tracking',

  // How many rows at the top are headings (not shipments).
  HEADER_ROWS: 1,

  // Column letters in your sheet.
  //   TRACKING_ID, COURIER - read by the robot
  //   BRIEF_STATUS         - written: just "Delivered", "In Transit", ... (set to '' if not wanted)
  //   STATUS               - written: the full latest status
  //   STATUS_DATE          - written: date of that status
  COLUMNS: {
    TRACKING_ID: 'G',
    COURIER: 'H',
    BRIEF_STATUS: 'I',
    STATUS: 'J',
    STATUS_DATE: 'K',
  },

  // How the Status Date column is displayed. The cell holds a real date value,
  // so sorting, filtering and date formulas work on it.
  // Examples: 'dd-mmm-yyyy' → 04-Oct-2026   'dd/mm/yyyy' → 04/10/2026
  DATE_FORMAT: 'dd-mmm-yyyy',

  // false = store only the date (time removed). true = keep the time as well
  // (change DATE_FORMAT to e.g. 'dd-mmm-yyyy hh:mm' if you turn this on).
  KEEP_TIME: false,

  // Courier portals in India report times in IST. This is used only when a courier
  // returns a time without saying which timezone it is in.
  COURIER_UTC_OFFSET_MINUTES: 330,

  // Skip rows whose Brief Status or Tracking Status starts with one of these words.
  // Finished shipments don't change, so skipping them saves API calls.
  SKIP_FINISHED: true,
  FINISHED_STATUS_PREFIXES: ['delivered', 'rto delivered', 'returned', 'cancelled', 'lost'],

  // What goes into the Tracking Status cell:
  //   main status only          → "In Transit"
  //   + detail (SHOW_DETAIL)    → "In Transit - Shipment arrived at hub"
  //   + location (SHOW_LOCATION)→ "In Transit - Shipment arrived at hub (Mumbai_Hub)"
  SHOW_DETAIL: true,
  SHOW_LOCATION: true,

  // Automatic update: once a day at this hour (24-hour clock, 8 = 8 AM) in this timezone.
  // Google starts daily jobs within a 30-minute window, so it runs between 8:00 and 8:30.
  // Only parcels that are not delivered yet are checked.
  DAILY_UPDATE_HOUR: 8,
  TIMEZONE: 'Asia/Kolkata',

  // Name of the tab where each run writes its problems and notes. The script creates it.
  LOG_SHEET_NAME: 'Courier Tracking Log',

  // Couriers.
  //   aliases  - how the courier may be spelled in column H. Case, spaces and
  //              punctuation are ignored, and "Delhivery B2C" also matches "delhivery".
  //   provider - where the status comes from:
  //                'DELHIVERY'    = Delhivery's own API (needs a Delhivery token, free)
  //                'TRACKCOURIER' = TrackCourier.io (needs your TrackCourier.io key)
  //                'DPWORLD_WEB'  = DP World's own tracking website
  //                'AUTO'         = Delhivery API if a Delhivery token is saved, else TrackCourier.io
  //   trackCourierSlug - TrackCourier.io's name for the courier.
  COURIERS: {
    DELHIVERY: {
      label: 'Delhivery',
      aliases: ['delhivery'],
      provider: 'AUTO',
      trackCourierSlug: 'delhivery',
    },
    SAFEXPRESS: {
      label: 'Safexpress',
      aliases: ['safexpress', 'safeexpress'],
      provider: 'TRACKCOURIER',
      trackCourierSlug: 'safexpress',
    },
    DPWORLD: {
      label: 'DP World',
      aliases: ['dpworld', 'dpw', 'delex'],
      provider: 'DPWORLD_WEB',
    },
  },

  // Couriers you track by hand. Their rows are skipped: Brief Status, Tracking Status and
  // Status Date are left for you to fill in. Capitals and spaces don't matter.
  MANUAL_COURIERS: ['BNG'],

  // API addresses. You don't need to change these.
  DELHIVERY_BASE_URL: 'https://track.delhivery.com',
  TRACKCOURIER_BASE_URL: 'https://api.trackcourier.io/v1',
  DPWORLD_TRACKING_URL: 'https://api-fr.cargoes.com/track/v4', // what DP World's tracking page uses

  // TrackCourier.io allows a set number of requests per minute, depending on your plan
  // (Free: 10, Starter: 60, Pro: 300). Set this to your plan's number.
  TRACKCOURIER_REQUESTS_PER_MINUTE: 60,

  // Technical limits. Google stops a script after 6 minutes, so the script pauses
  // before that and resumes automatically a minute later.
  ROWS_PER_BLOCK: 200,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_AUTO_RESUMES: 50,
};

/**
 * ============================================================================
 *  ORDER SYNC: SETTINGS (Pre CRM → Order Tracking → Review & Rating Data)
 * ============================================================================
 *  Letters are the columns in each tab. Row 1 of every tab holds the headings.
 */
var CT_SYNC = {
  // Where orders come from (filled in by you).
  PRE_CRM: {
    SHEET: 'Pre CRM',
    HEADER_ROWS: 1,
    SKU: 'A', FSN: 'B', CATEGORY: 'D', ORDER_ID: 'E', ORDER_ITEM_ID: 'F', ORDERED_ON: 'G',
    NAME: 'J', PHONE: 'N', REMARKS: 'Q', DELIVERY_BY: 'S',
  },

  // Which Pre CRM rows go to Order Tracking: ordered on or after this date
  // (year-month-day) AND the Remarks column contains this word (capitals don't matter).
  INCLUDE_ORDERS_FROM: '2026-09-20',
  REMARK_WORD: 'dispatch',

  // Order Tracking (tab name is CT_CONFIG.SHEET_NAME). The robot fills these columns.
  // G Tracking ID, H Courier and M Remarks are yours and are never changed.
  // ORDER_ITEM_ID: the robot remembers which product each row is for here.
  ORDER_TRACKING: {
    ORDER_ID: 'A', ORDER_DATE: 'B', SKU: 'C', FSN: 'D', NAME: 'E', PHONE: 'F',
    DELIVERY_BY: 'L', RETURN_TYPE: 'N', REFUND_STATUS: 'O', ORDER_ITEM_ID: 'P',
  },

  // Self Ship Cases (filled in by you).
  SELF_SHIP: {
    SHEET: 'Self Ship Cases',
    HEADER_ROWS: 1,
    ORDER_ID: 'C', ORDER_ITEM_ID: 'D', REQUEST_TYPE: 'K', REFUND_STATUS: 'S',
  },

  // Review & Rating Data. The robot fills A-G and M; H-L are your team's and are never changed.
  REVIEW: {
    SHEET: 'Review & Rating Data',
    HEADER_ROWS: 1,
    ORDER_ID: 'A', ORDER_DATE: 'B', FSN: 'C', CATEGORY: 'D', NAME: 'E', PHONE: 'F',
    DELIVERY_DATE: 'G', ORDER_ITEM_ID: 'M',
  },
  // A delivered product appears in Review & Rating Data this many days after its Status Date.
  REVIEW_AFTER_DAYS: 2,

  // The sync also runs on its own every N hours (1, 2, 4, 6, 8 or 12).
  SYNC_EVERY_HOURS: 1,

  // FSNs as clickable Flipkart links: in every tab, any column headed "FSN" (row 1), as soon
  // as a value is typed or pasted, plus hourly for values written by scripts. false = off.
  FSN_AS_LINK: true,

  DATE_FORMAT: 'dd-mmm-yyyy',
  LOG_SHEET_NAME: 'Order Sync Log',
};

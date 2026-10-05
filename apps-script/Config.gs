/**
 * ============================================================================
 *  SETTINGS: this is the only file you normally need to edit.
 * ============================================================================
 *
 *  API keys are NOT stored here. Store them from the sheet menu:
 *  "📦 Courier Tracking" → "Set / change API keys". That keeps them out of the code.
 */
var CONFIG = {
  // Name of the tab that holds your shipments. Leave '' to use the FIRST tab.
  SHEET_NAME: '',

  // How many rows at the top are headings (not shipments).
  HEADER_ROWS: 1,

  // Column letters in your sheet.
  COLUMNS: {
    TRACKING_ID: 'G',
    COURIER: 'H',
    STATUS: 'I',
    STATUS_DATE: 'J',
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

  // Skip rows whose Status already starts with one of these words.
  // Finished shipments don't change, so skipping them saves API calls.
  SKIP_FINISHED: true,
  FINISHED_STATUS_PREFIXES: ['delivered', 'rto delivered', 'returned', 'cancelled', 'lost'],

  // What goes into the Tracking Status cell:
  //   main status only          → "In Transit"
  //   + detail (SHOW_DETAIL)    → "In Transit - Shipment arrived at hub"
  //   + location (SHOW_LOCATION)→ "In Transit - Shipment arrived at hub (Mumbai_Hub)"
  SHOW_DETAIL: true,
  SHOW_LOCATION: true,

  // Automatic updates run every N hours. Allowed values: 1, 2, 4, 6, 8, 12, or 24 (once a day).
  // Each run uses 1 TrackCourier.io request per undelivered parcel, so running less
  // often saves your monthly requests. See "How many requests will I use?" in the guide.
  AUTO_UPDATE_EVERY_HOURS: 12,

  // Name of the tab where each run writes its problems and notes. The script creates it.
  LOG_SHEET_NAME: 'Tracking Log',

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

  // API addresses. You don't need to change these.
  DELHIVERY_BASE_URL: 'https://track.delhivery.com',
  TRACKCOURIER_BASE_URL: 'https://api.trackcourier.io/v1',

  // TrackCourier.io allows a set number of requests per minute, depending on your plan
  // (Free: 10, Starter: 60, Pro: 300). Set this to your plan's number.
  TRACKCOURIER_REQUESTS_PER_MINUTE: 10,

  // Technical limits. Google stops a script after 6 minutes, so the script pauses
  // before that and resumes automatically a minute later.
  ROWS_PER_BLOCK: 200,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_AUTO_RESUMES: 50,
};

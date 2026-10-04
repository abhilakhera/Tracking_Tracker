/**
 * Small helper functions used by the other files.
 */

/** Lowercase and drop everything except letters/digits: "DP World " → "dpworld". */
function normalizeText_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map whatever is typed in the Courier column to a key of CONFIG.COURIERS
 * ('DELHIVERY', 'SAFEXPRESS', 'DPWORLD'), or null if it isn't recognised.
 */
function courierKeyFor_(courierCell) {
  var name = normalizeText_(courierCell);
  if (!name) return null;
  var keys = Object.keys(CONFIG.COURIERS);
  for (var i = 0; i < keys.length; i++) {
    var aliases = CONFIG.COURIERS[keys[i]].aliases;
    for (var j = 0; j < aliases.length; j++) {
      if (name.indexOf(normalizeText_(aliases[j])) === 0) return keys[i];
    }
  }
  return null;
}

/** Tracking IDs are compared as trimmed text (sheets sometimes store them as numbers). */
function cleanTrackingId_(value) {
  if (typeof value === 'number') return String(Math.round(value));
  return String(value == null ? '' : value).trim();
}

/** Split a list into pieces of at most `size` items. */
function chunk_(list, size) {
  var out = [];
  for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** True when the status text means the shipment journey is over. */
function isFinishedStatus_(statusText) {
  var s = String(statusText || '').trim().toLowerCase();
  if (!s) return false;
  return CONFIG.FINISHED_STATUS_PREFIXES.some(function (p) { return s.indexOf(p) === 0; });
}

/** Build the text written in the Tracking Status column. */
function formatStatus_(main, detail, location) {
  main = String(main || '').trim();
  detail = String(detail || '').trim();
  location = String(location || '').trim();
  var text = main || detail;
  if (CONFIG.SHOW_DETAIL && main && detail && detail.toLowerCase() !== main.toLowerCase()) {
    text += ' - ' + detail;
  }
  if (CONFIG.SHOW_LOCATION && location) text += ' (' + location + ')';
  return text;
}

var MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Turn the many date styles couriers use into a JavaScript Date (or null).
 * Handles e.g.:
 *   "2026-10-03T14:25:11+05:30", "2026-10-03T14:25:11.123", "2026-10-03 14:25"
 *   "03-10-2026 14:25", "03/10/2026", "03-Oct-2026 02:25 PM", epoch numbers.
 * A time with no timezone is treated as CONFIG.COURIER_UTC_OFFSET_MINUTES (IST).
 */
function parseCourierDate_(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    if (value > 1e12) return new Date(value);
    if (value > 1e9) return new Date(value * 1000);
    return null;
  }
  var s = String(value).trim();
  var defaultOffset = CONFIG.COURIER_UTC_OFFSET_MINUTES;
  var m;

  // 2026-10-03, 2026-10-03T14:25:11.123+05:30, 2026-10-03 14:25:11Z
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    return buildDate_(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0),
      m[7] ? offsetMinutes_(m[7]) : defaultOffset);
  }

  // 03-10-2026, 03/10/2026 14:25, 03-Oct-2026 02:25 PM (day first, Indian style)
  m = s.match(/^(\d{1,2})[-\/. ]([a-z]{3,9}|\d{1,2})[-\/. ,]+(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    var month = /^\d+$/.test(m[2]) ? +m[2] : MONTHS_[m[2].slice(0, 3).toLowerCase()];
    var year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    var hour = +(m[4] || 0);
    if (m[7]) {
      var pm = m[7].toLowerCase() === 'pm';
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    if (month) return buildDate_(year, month, +m[1], hour, +(m[5] || 0), +(m[6] || 0), defaultOffset);
  }

  var parsed = Date.parse(s);
  return isNaN(parsed) ? null : new Date(parsed);
}

function offsetMinutes_(tz) {
  if (/^z$/i.test(tz)) return 0;
  var m = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}

function buildDate_(y, mo, d, h, mi, s, offsetMin) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMin * 60000);
}

/**
 * Prepare a Date for writing into the sheet. Unless KEEP_TIME is on, the time
 * is removed: the value becomes midnight of that day in the spreadsheet's
 * timezone, so Sheets treats it as a plain date.
 */
function toSheetDate_(date, timeZone) {
  if (!date) return '';
  if (CONFIG.KEEP_TIME) return date;
  var day = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  return Utilities.parseDate(day, timeZone, 'yyyy-MM-dd');
}

/** Column letter(s) → number. "A" → 1, "J" → 10, "AA" → 27. */
function columnNumber_(letters) {
  var n = 0;
  String(letters).toUpperCase().replace(/[^A-Z]/g, '').split('').forEach(function (ch) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  });
  return n;
}

/** Read a saved secret (API key) from Script Properties. */
function getSecret_(name) {
  return (PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

/** Shorten long API error bodies before they go into the log. */
function shorten_(text, max) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  max = max || 200;
  return text.length > max ? text.slice(0, max) + '…' : text;
}

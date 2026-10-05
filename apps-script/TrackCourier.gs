/**
 * TrackCourier.io: one API for many Indian couriers (used here for Safexpress,
 * and for Delhivery when no Delhivery token is saved).
 *
 * Request:  GET https://api.trackcourier.io/v1/track?courier=<slug>&tracking_number=<number>
 *           Header  X-API-Key: <your TrackCourier.io key>
 * Response (PascalCase keys):
 *   { "ShipmentState": "InTransit", "MostRecentStatus": "In Transit",
 *     "Checkpoints": [ { "Activity": "...", "CheckpointState": "intransit",
 *                        "Date": "28-Aug-2026", "Time": "09:41", "Location": "Delhi" } ] }
 */

/**
 * Track a list of jobs ({ courierKey, id }), one request per number, paced to
 * stay under the plan's per-minute limit (CT_CONFIG.TRACKCOURIER_REQUESTS_PER_MINUTE).
 * Returns { 'COURIERKEY|id': { status, date } | { error } | { deferred } }.
 * "deferred" means "not asked this time": the run pauses and continues a minute later.
 */
function CT_trackWithTrackCourier_(jobs) {
  var key = CT_getSecret_('CT_TRACKCOURIER_API_KEY');
  if (!key) throw new Error('No TrackCourier.io API key saved. Use the menu: Courier Tracking → Set / change API keys.');
  var gapMs = Math.ceil(60000 / Math.max(1, CT_CONFIG.TRACKCOURIER_REQUESTS_PER_MINUTE));

  var results = {};
  var stopped = false;
  var fatal = '';        // a problem that affects every number (bad key, plan used up)
  var lastRequestAt = 0;
  jobs.forEach(function (job) {
    var jobKey = job.courierKey + '|' + job.id;
    if (fatal) { results[jobKey] = { error: fatal }; return; }
    if (stopped || CT_timeIsUp_()) { results[jobKey] = { deferred: true }; return; }

    var wait = lastRequestAt + gapMs - Date.now();
    if (wait > 0) Utilities.sleep(wait);
    lastRequestAt = Date.now();

    var slug = CT_CONFIG.COURIERS[job.courierKey].trackCourierSlug;
    var response = UrlFetchApp.fetch(CT_CONFIG.TRACKCOURIER_BASE_URL + '/track?courier=' + encodeURIComponent(slug) +
      '&tracking_number=' + encodeURIComponent(job.id), {
      method: 'get',
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() === 429) {
      // Per-minute limit hit anyway: stop asking, continue on the next run.
      stopped = true;
      results[jobKey] = { deferred: true };
      return;
    }
    try {
      results[jobKey] = CT_handleTrackCourierResponse_(response.getResponseCode(), response.getContentText(), slug);
    } catch (e) {
      fatal = e.message;
      results[jobKey] = { error: fatal };
    }
  });
  return results;
}

/**
 * Turn one HTTP reply into { status, date } or { error }. Throws for problems that affect
 * every row. Errors look like { "success": false, "error": { "code": "...", "message": "..." } }.
 */
function CT_handleTrackCourierResponse_(code, body, slug) {
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* handled below */ }
  var err = (json && json.error) || {};
  if (typeof err === 'string') err = { message: err };
  var errCode = String(err.code || '');
  var apiMessage = CT_shorten_(err.message || (json && json.message) || body);

  if (code === 401 || code === 403) throw new Error('TrackCourier.io rejected the API key (HTTP ' + code + '): ' + apiMessage);
  if (code === 402) {
    if (errCode === 'ACCOUNT_NEEDS_ATTENTION') throw new Error('TrackCourier.io says your account needs attention: ' + apiMessage);
    throw new Error('TrackCourier.io: monthly limit of your plan reached (' + apiMessage + '). Upgrade the plan or wait for next month.');
  }
  if (code === 404 && errCode === 'COURIER_NOT_FOUND') {
    throw new Error('TrackCourier.io does not know the courier name "' + slug + '". Check trackCourierSlug in CT_Config.');
  }
  if (code === 404) return { error: 'TrackCourier.io found no shipment with this number. Check it on the courier\'s website.' };
  if (code === 502 || code === 504) return { error: 'The courier\'s system did not answer in time (' + apiMessage + '). Will retry on the next run.' };
  if (json && json.usage) CT_TC_USAGE_ = json.usage;
  if (code !== 200 || !json || json.success === false) return { error: 'TrackCourier.io HTTP ' + code + ': ' + apiMessage };
  return CT_parseTrackCourierResult_(json);
}

/** Last "usage" block TrackCourier.io sent back ({ used, quota, plan }), if any. */
var CT_TC_USAGE_ = null;

/** "TrackCourier.io: 1,234 of 5,000 requests used this month." or '' */
function CT_trackCourierUsage_() {
  var u = CT_TC_USAGE_;
  if (!u || u.used == null || !u.quota) return '';
  return 'TrackCourier.io: ' + Number(u.used).toLocaleString('en-IN') + ' of ' +
    Number(u.quota).toLocaleString('en-IN') + ' requests used this month.';
}

/** Read the status and date out of a /v1/track answer. */
function CT_parseTrackCourierResult_(json) {
  var t = json.data || json.Data || json.result || json;
  if (t.CourierHasNoRecordOfShipment === true) {
    return { error: 'The courier has no record of this number yet. Check it on the courier\'s website.' };
  }
  var pick = function (obj, names) {
    for (var i = 0; i < names.length; i++) if (obj && obj[names[i]] != null && obj[names[i]] !== '') return obj[names[i]];
    return '';
  };

  var checkpoints = CT_toArray_(pick(t, ['Checkpoints', 'checkpoints'])).map(function (c, index) {
    var date = pick(c, ['Date', 'date']);
    var time = pick(c, ['Time', 'time']);
    return {
      index: index,
      activity: pick(c, ['Activity', 'activity', 'Status', 'status']),
      location: pick(c, ['Location', 'location']),
      when: CT_parseCourierDate_(time && !/[T:]/.test(String(date)) ? date + ' ' + time : date),
    };
  });
  // Newest first. Checkpoints with the same time keep the order TrackCourier gave.
  checkpoints.sort(function (a, b) {
    var diff = (b.when || 0) - (a.when || 0);
    return diff || a.index - b.index;
  });
  var latest = checkpoints[0];

  var main = String(pick(t, ['MostRecentStatus', 'most_recent_status']) ||
    CT_humanizeState_(pick(t, ['ShipmentState', 'status']))).trim();

  if (!latest && !main) return { error: 'TrackCourier.io returned no tracking events yet.' };
  return {
    status: CT_formatStatus_(main, latest && latest.activity, latest && latest.location),
    date: latest ? latest.when : null,
  };
}

var CT_TC_STATE_LABELS_ = {
  pending: 'Pending', intransit: 'In Transit', outfordelivery: 'Out for Delivery',
  delivered: 'Delivered', exception: 'Exception', returned: 'Returned', cancelled: 'Cancelled',
};

/** "intransit" / "in_transit" / "InTransit" → "In Transit". */
function CT_humanizeState_(state) {
  var known = CT_TC_STATE_LABELS_[CT_normalizeText_(state)];
  if (known) return known;
  return String(state || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .trim();
}

function CT_toArray_(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

/**
 * Used by "Test API connections". Uses the courier list, which TrackCourier.io does not
 * count against your monthly requests, and checks the courier names in CT_Config.
 */
function CT_testTrackCourierConnection_() {
  var key = CT_getSecret_('CT_TRACKCOURIER_API_KEY');
  if (!key) return 'TrackCourier.io: no API key saved.';
  var response = UrlFetchApp.fetch(CT_CONFIG.TRACKCOURIER_BASE_URL + '/couriers', {
    headers: { 'X-API-Key': key, Accept: 'application/json' }, muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code === 401 || code === 403) return 'TrackCourier.io: ❌ key rejected (HTTP ' + code + ').';
  if (code !== 200) return 'TrackCourier.io: ⚠ reply HTTP ' + code + ': ' + CT_shorten_(response.getContentText(), 150);

  var known = {};
  try {
    var data = JSON.parse(response.getContentText()).data || {};
    CT_toArray_(data.couriers || data).forEach(function (c) { if (c && c.slug) known[c.slug] = true; });
  } catch (e) { /* list unreadable: just report the connection */ }
  var missing = Object.keys(CT_CONFIG.COURIERS)
    .map(function (k) { return CT_CONFIG.COURIERS[k].trackCourierSlug; })
    .filter(function (slug) { return slug && Object.keys(known).length && !known[slug]; });
  return missing.length
    ? 'TrackCourier.io: ✅ connected, but ⚠ it does not list: ' + missing.join(', ')
    : 'TrackCourier.io: ✅ connected.';
}

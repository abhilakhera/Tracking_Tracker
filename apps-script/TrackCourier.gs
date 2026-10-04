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

var TC_PARALLEL_REQUESTS = 5; // numbers asked at the same time

/**
 * Track a list of numbers for one courier (key of CONFIG.COURIERS).
 * Returns { trackingId: { status, date } | { error } }.
 */
function trackWithTrackCourier_(courierKey, ids) {
  var key = getSecret_('TRACKCOURIER_API_KEY');
  if (!key) throw new Error('No TrackCourier.io API key saved. Use the menu: Courier Tracking → Set / change API keys.');
  var slug = CONFIG.COURIERS[courierKey].trackCourierSlug;

  var results = {};
  chunk_(ids, TC_PARALLEL_REQUESTS).forEach(function (batch) {
    var requests = batch.map(function (id) {
      return {
        url: CONFIG.TRACKCOURIER_BASE_URL + '/track?courier=' + encodeURIComponent(slug) +
          '&tracking_number=' + encodeURIComponent(id),
        method: 'get',
        headers: { 'X-API-Key': key, Accept: 'application/json' },
        muteHttpExceptions: true,
      };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function (response, i) {
      results[batch[i]] = handleTrackCourierResponse_(response.getResponseCode(), response.getContentText(), slug);
    });
  });
  return results;
}

/** Turn one HTTP reply into { status, date } or { error }. Throws for problems that affect every row. */
function handleTrackCourierResponse_(code, body, slug) {
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* handled below */ }
  var apiMessage = json && (json.message || json.error || json.Message || json.Error);
  apiMessage = apiMessage ? shorten_(typeof apiMessage === 'string' ? apiMessage : JSON.stringify(apiMessage)) : shorten_(body);

  if (code === 401 || code === 403) throw new Error('TrackCourier.io rejected the API key (HTTP ' + code + '): ' + apiMessage);
  if (code === 402) throw new Error('TrackCourier.io: plan limit reached (' + apiMessage + ').');
  if (code === 429) throw new Error('TrackCourier.io: too many requests right now, will retry on the next run (' + apiMessage + ').');
  if (code === 404) return { error: 'TrackCourier.io found no shipment with this number (courier "' + slug + '"). ' + apiMessage };
  if (code !== 200 || !json) return { error: 'TrackCourier.io HTTP ' + code + ': ' + apiMessage };
  return parseTrackCourierResult_(json);
}

/** Read the status and date out of a /v1/track answer. */
function parseTrackCourierResult_(json) {
  var t = json.data || json.Data || json.result || json;
  var pick = function (obj, names) {
    for (var i = 0; i < names.length; i++) if (obj && obj[names[i]] != null && obj[names[i]] !== '') return obj[names[i]];
    return '';
  };

  var checkpoints = toArray_(pick(t, ['Checkpoints', 'checkpoints'])).map(function (c, index) {
    var date = pick(c, ['Date', 'date']);
    var time = pick(c, ['Time', 'time']);
    return {
      index: index,
      activity: pick(c, ['Activity', 'activity', 'Status', 'status']),
      location: pick(c, ['Location', 'location']),
      when: parseCourierDate_(time && !/[T:]/.test(String(date)) ? date + ' ' + time : date),
    };
  });
  // Newest first. Checkpoints with the same time keep the order TrackCourier gave.
  checkpoints.sort(function (a, b) {
    var diff = (b.when || 0) - (a.when || 0);
    return diff || a.index - b.index;
  });
  var latest = checkpoints[0];

  var main = String(pick(t, ['MostRecentStatus', 'most_recent_status']) ||
    humanizeState_(pick(t, ['ShipmentState', 'status']))).trim();

  if (!latest && !main) return { error: 'TrackCourier.io returned no tracking events yet.' };
  return {
    status: formatStatus_(main, latest && latest.activity, latest && latest.location),
    date: latest ? latest.when : null,
  };
}

/** "InTransit" / "in_transit" → "In Transit". */
function humanizeState_(state) {
  return String(state || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .trim();
}

function toArray_(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

/** Used by "Test API connections". */
function testTrackCourierConnection_() {
  if (!getSecret_('TRACKCOURIER_API_KEY')) return 'TrackCourier.io: no API key saved.';
  var response = UrlFetchApp.fetch(CONFIG.TRACKCOURIER_BASE_URL + '/track?courier=' +
    encodeURIComponent(CONFIG.COURIERS.SAFEXPRESS.trackCourierSlug) + '&tracking_number=0000000000', {
    headers: { 'X-API-Key': getSecret_('TRACKCOURIER_API_KEY') }, muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code === 401 || code === 403) return 'TrackCourier.io: ❌ key rejected (HTTP ' + code + ').';
  if (code === 200 || code === 404) return 'TrackCourier.io: ✅ connected.';
  return 'TrackCourier.io: ⚠ reply HTTP ' + code + ': ' + shorten_(response.getContentText(), 150);
}

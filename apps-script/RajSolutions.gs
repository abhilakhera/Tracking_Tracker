/**
 * DP World tracking through Raj Solutions (rajsolutions.co.in), the shipping partner your
 * DP World shipments are booked with. Needs your Raj Solutions API key.
 *
 * Request:  GET https://rajsolutions.co.in/api/v1/tracking?awb=<docket>
 *           Header  X-API-Key: <your Raj Solutions key>
 * Response: { "success": true, "data": {
 *               "shipment": { "awb": "1846272584", "status": "delivered",
 *                             "delivered_at": "2026-09-30 21:03:00", ... },
 *               "tracking_events": [ { "status": "OUT_FOR_DELIVERY", "location": "Ananthpur, ...",
 *                                      "timestamp": "2026-09-30 11:01:30" }, ... ] } }
 * One docket per request; the API allows about 20 requests a minute.
 * The reply also holds the customer's name, phone and address: those are never used or stored.
 */

/**
 * Ask Raj Solutions about one docket. Returns { status, date } | { error } | { deferred }
 * (429: too many requests this minute). Throws if the key is rejected.
 */
function CT_askRajSolutions_(docket, key) {
  var response = UrlFetchApp.fetch(CT_CONFIG.RAJSOLUTIONS_BASE_URL + '/tracking?awb=' + encodeURIComponent(docket), {
    method: 'get',
    headers: { 'X-API-Key': key, Accept: 'application/json' },
    muteHttpExceptions: true,
  });
  return CT_handleRajSolutionsResponse_(response.getResponseCode(), response.getContentText());
}

function CT_handleRajSolutionsResponse_(code, body) {
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* handled below */ }
  var message = CT_shorten_((json && json.message) || body);
  if (code === 401 || code === 403) {
    throw new Error('Raj Solutions rejected the API key (HTTP ' + code + ': ' + message + '). ' +
      'Save the current key with: Courier Tracking → Set / change API keys.');
  }
  if (code === 429) return { deferred: true };
  if (code === 404) {
    return { error: 'Raj Solutions has no shipment with this docket number. Check it on DP World\'s tracking page.' };
  }
  if (code !== 200 || !json || json.success === false) {
    return { error: 'Raj Solutions HTTP ' + code + ': ' + message + ' (will retry on the next run)' };
  }
  return CT_parseRajSolutionsResult_(json);
}

// Steps that are only paperwork after delivery; they never count as the "latest" status.
var CT_RAJ_PAPERWORK_ = /^(E?POD|EPOD_COPY)/i;

/** Read the status and date out of a /tracking answer. */
function CT_parseRajSolutionsResult_(json) {
  var data = json.data || {};
  var shipment = data.shipment || {};
  var events = CT_toArray_(data.tracking_events).map(function (e, index) {
    return { status: String(e.status || ''), location: String(e.location || ''),
      when: CT_parseCourierDate_(e.timestamp), order: index };
  });
  var real = events.filter(function (e) { return e.status && !CT_RAJ_PAPERWORK_.test(e.status); });
  real.sort(function (a, b) { return ((a.when || 0) - (b.when || 0)) || (a.order - b.order); });
  var latest = real[real.length - 1];
  if (!shipment.status && !latest) return { error: 'Raj Solutions knows this docket but shows no tracking events yet.' };

  // The place: the latest event's, or else the most recent one that names a place.
  var place = '';
  for (var i = real.length - 1; i >= 0 && !place; i--) place = real[i].location;
  place = place.split(',')[0].trim(); // "Ananthpur, Ananthapur, Andhra Pradesh" → "Ananthpur"

  var main = CT_rajWords_(shipment.status || (latest && latest.status));
  var detail = latest ? CT_rajWords_(latest.status) : '';
  var delivered = /^delivered$/i.test(shipment.status || '');
  var when = (delivered && CT_parseCourierDate_(shipment.delivered_at)) || (latest && latest.when) ||
    CT_parseCourierDate_(shipment.manifested_at || shipment.pickup_at);
  return { status: CT_formatStatus_(main, detail, place), date: when || null };
}

/** "in_transit" → "In Transit", "REQUEST_RTO" → "Request RTO", "manifested" → "Booked". */
function CT_rajWords_(code) {
  var s = String(code || '').trim();
  if (/^manifested$/i.test(s)) return 'Booked';
  return s.toLowerCase().replace(/[_\s]+/g, ' ').trim()
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .replace(/\b(Rto|Ndr|Pod|Epod|Awb|Lr)\b/g, function (w) { return w.toUpperCase(); });
}

/** For "Test API connections": asks about a docket that doesn't exist (a 404 means the key works). */
function CT_testRajSolutionsConnection_() {
  var key = CT_getSecret_('CT_RAJSOLUTIONS_API_KEY');
  if (!key) return 'Raj Solutions (DP World): no API key saved.';
  var response = UrlFetchApp.fetch(CT_CONFIG.RAJSOLUTIONS_BASE_URL + '/tracking?awb=0', {
    headers: { 'X-API-Key': key, Accept: 'application/json' }, muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code === 401 || code === 403) return 'Raj Solutions (DP World): ❌ key rejected (HTTP ' + code + ').';
  if (code === 200 || code === 404) return 'Raj Solutions (DP World): ✅ connected.';
  return 'Raj Solutions (DP World): ⚠ reply HTTP ' + code + ': ' + CT_shorten_(response.getContentText(), 150);
}

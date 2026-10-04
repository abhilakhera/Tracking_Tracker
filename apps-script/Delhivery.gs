/**
 * Delhivery's own tracking API.
 *
 * Request:  GET https://track.delhivery.com/api/v1/packages/json/?waybill=AWB1,AWB2,...
 *           Header  Authorization: Token <your Delhivery API token>
 * Response: { "ShipmentData": [ { "Shipment": { "AWB": "...",
 *               "Status": { "Status": "In Transit", "StatusDateTime": "...",
 *                           "StatusLocation": "...", "Instructions": "...", "StatusType": "UD" },
 *               "Scans": [ ... ] } } ] }
 *
 * To get a token, see docs/GETTING_API_KEYS.md.
 */

var DELHIVERY_BATCH_SIZE = 50; // Delhivery accepts up to 50 waybills per request

/**
 * Track a list of Delhivery waybills.
 * Returns { trackingId: { status, date } | { error } }.
 */
function trackWithDelhivery_(ids) {
  var token = getSecret_('DELHIVERY_TOKEN');
  if (!token) throw new Error('No Delhivery API token saved. Use the menu: Courier Tracking → Set / change API keys.');

  var results = {};
  chunk_(ids, DELHIVERY_BATCH_SIZE).forEach(function (batch) {
    var url = CONFIG.DELHIVERY_BASE_URL + '/api/v1/packages/json/?waybill=' + encodeURIComponent(batch.join(','));
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Token ' + token, Accept: 'application/json' },
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 401 || code === 403) {
      throw new Error('Delhivery rejected the API token (HTTP ' + code + '). Check the token you saved.');
    }
    var json = null;
    try { json = JSON.parse(body); } catch (e) { /* not JSON, handled below */ }
    if (code !== 200 || !json) {
      batch.forEach(function (id) { results[id] = { error: 'Delhivery HTTP ' + code + ': ' + shorten_(body) }; });
      return;
    }

    var parsed = parseDelhiveryResponse_(json);
    batch.forEach(function (id) {
      results[id] = parsed[id.toUpperCase()] ||
        { error: 'Delhivery has no shipment with this number' + (json.Error ? ' (' + shorten_(json.Error) + ')' : '') };
    });
  });
  return results;
}

/** Turn a Delhivery response into { AWB (upper-case): { status, date } }. */
function parseDelhiveryResponse_(json) {
  var out = {};
  (json.ShipmentData || []).forEach(function (item) {
    var s = item.Shipment || item;
    var awb = cleanTrackingId_(s.AWB || s.Waybill).toUpperCase();
    if (!awb) return;

    var st = s.Status || {};
    var main = st.Status || '';
    var detail = st.Instructions || '';
    var location = st.StatusLocation || '';
    var when = st.StatusDateTime || '';

    // If the summary is empty, use the most recent scan instead.
    var scans = (s.Scans || []).map(function (x) { return x.ScanDetail || x; });
    if ((!main || !when) && scans.length) {
      scans.sort(function (a, b) {
        return (parseCourierDate_(b.ScanDateTime || b.StatusDateTime) || 0) -
               (parseCourierDate_(a.ScanDateTime || a.StatusDateTime) || 0);
      });
      var last = scans[0];
      main = main || last.Scan || '';
      detail = detail || last.Instructions || '';
      location = location || last.ScannedLocation || '';
      when = when || last.ScanDateTime || last.StatusDateTime || '';
    }

    // A return shipment that has reached the sender shows Status "RTO" with type "DL".
    if (/^rto$/i.test(main) && String(st.StatusType).toUpperCase() === 'DL') main = 'RTO Delivered';

    out[awb] = { status: formatStatus_(main, detail, location), date: parseCourierDate_(when) };
  });
  return out;
}

/** Used by "Test API connections". Returns a one-line result. */
function testDelhiveryConnection_() {
  var token = getSecret_('DELHIVERY_TOKEN');
  if (!token) return 'Delhivery: no token saved (optional; Delhivery numbers go through TrackCourier.io).';
  var response = UrlFetchApp.fetch(CONFIG.DELHIVERY_BASE_URL + '/api/v1/packages/json/?waybill=0000000000000', {
    headers: { Authorization: 'Token ' + token }, muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code === 401 || code === 403) return 'Delhivery: ❌ token rejected (HTTP ' + code + ').';
  if (code === 200) return 'Delhivery: ✅ connected.';
  return 'Delhivery: ⚠ unexpected reply HTTP ' + code + ': ' + shorten_(response.getContentText(), 120);
}

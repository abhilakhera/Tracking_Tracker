/**
 * DP World Express (India) tracking.
 *
 * TrackCourier.io does not cover DP World, so this reads the same data that DP World's
 * public tracking page (https://www.logistics.dpworld.com/tracking/in/express) shows.
 * It is free and needs no key.
 *
 * Request:  GET https://api-fr.cargoes.com/track/v4?transportMode=express&trackingId=DOCKET1,DOCKET2
 * Response: { "status": "success",
 *             "data": { "trackings": [ { "identifier": { "identifierValue": "1846272584" },
 *                                        "containersTrackingEvents": { "1846272584": [
 *                                          { "event_desc": "Delivered", "event_status": "actual",
 *                                            "event_time": "2026-09-30T21:03:00",
 *                                            "event_location": { "name": "...", "city": "Anantapur" },
 *                                            "sub_events": [ { "event_desc": "Branch Out", "ata": "...", ... } ] } ] } } ],
 *                       "failedTrackings": [ "DOCKET_NOT_FOUND" ] } }
 *
 * This is the website's own data source, not an official API, so DP World may change it
 * without notice. If DP World rows suddenly all show errors, see docs/TROUBLESHOOTING.md.
 */

var CT_DPWORLD_BATCH_SIZE = 10; // dockets per request

/** Returns { docket: { status, date } | { error } | { deferred } }. */
function CT_trackWithDpWorld_(ids) {
  var results = {};
  CT_chunk_(ids, CT_DPWORLD_BATCH_SIZE).forEach(function (batch) {
    if (CT_timeIsUp_()) {
      batch.forEach(function (id) { results[id] = { deferred: true }; });
      return;
    }
    var url = CT_CONFIG.DPWORLD_TRACKING_URL + '?transportMode=express&trackingId=' +
      encodeURIComponent(batch.join(','));
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Accept: 'application/json' },
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    var json = null;
    try { json = JSON.parse(body); } catch (e) { /* handled below */ }
    if (code !== 200 || !json || !json.data) {
      batch.forEach(function (id) {
        results[id] = { error: 'DP World website replied HTTP ' + code + ': ' + CT_shorten_(body) + ' (will retry on the next run)' };
      });
      return;
    }
    var parsed = CT_parseDpWorldResponse_(json);
    batch.forEach(function (id) {
      results[id] = parsed[id.toUpperCase()] || {
        error: 'DP World has no shipment with this docket number. Check it on the DP World tracking page.',
      };
    });
  });
  return results;
}

/** Turn a DP World reply into { DOCKET (upper-case): { status, date } }. */
function CT_parseDpWorldResponse_(json) {
  var out = {};
  CT_toArray_(json.data && json.data.trackings).forEach(function (t) {
    var groups = t.containersTrackingEvents || {};
    Object.keys(groups).forEach(function (docket) {
      var latest = CT_latestDpWorldEvent_(CT_toArray_(groups[docket]));
      var key = CT_cleanTrackingId_(docket).toUpperCase();
      out[key] = latest
        ? { status: CT_formatStatus_(latest.main, latest.detail, latest.location), date: latest.when }
        : { error: 'DP World knows this docket but shows no tracking events yet.' };
    });
  });
  return out;
}

/**
 * Find the newest event that has actually happened. Main events ("In Transit") can hold
 * finer steps ("Destination Hub In"); if a step is the newest thing, it is shown as
 * the detail, e.g. "In Transit - Destination Hub In (BANGALORE HUB BLRH)".
 */
function CT_latestDpWorldEvent_(events) {
  var candidates = [];
  events.forEach(function (e) {
    if (!e || (e.event_status && String(e.event_status).toLowerCase() !== 'actual')) return;
    candidates.push({
      main: e.event_desc, detail: '', location: CT_dpWorldPlace_(e.event_location),
      when: CT_parseCourierDate_(e.event_time || e.ata), order: candidates.length,
    });
    CT_toArray_(e.sub_events).forEach(function (s) {
      if (!s || (s.event_status && String(s.event_status).toLowerCase() !== 'actual')) return;
      candidates.push({
        main: e.event_desc, detail: s.event_desc, location: CT_dpWorldPlace_(s.event_location),
        when: CT_parseCourierDate_(s.ata || s.event_time), order: candidates.length,
      });
    });
  });
  candidates = candidates.filter(function (c) { return c.when && (c.main || c.detail); });
  // Newest first; for the same time, the one listed later wins.
  candidates.sort(function (a, b) { return (b.when - a.when) || (b.order - a.order); });
  return candidates[0] || null;
}

function CT_dpWorldPlace_(loc) {
  if (!loc) return '';
  return String(loc.name || loc.city || '').trim();
}

/** Used by "Test API connections". */
function CT_testDpWorldConnection_() {
  var response = UrlFetchApp.fetch(CT_CONFIG.DPWORLD_TRACKING_URL + '?transportMode=express&trackingId=0', {
    headers: { Accept: 'application/json' }, muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code === 200) return 'DP World website: ✅ reachable.';
  return 'DP World website: ⚠ reply HTTP ' + code + ': ' + CT_shorten_(response.getContentText(), 150);
}

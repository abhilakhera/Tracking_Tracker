/**
 * DP World tracking.
 *
 * TrackCourier.io does not cover DP World. So the robot will read DP World's own
 * public tracking page, the same page you open in a browser.
 *
 * NOT READY YET: the exact address and reply format of that page are needed first
 * (see "DP World" in docs/SETUP_GUIDE.md). Until then, DP World rows are listed in
 * the "Tracking Log" tab and left unchanged. Nothing breaks.
 */

/** Returns { trackingId: { status, date } | { error } }. */
function trackWithDpWorld_(ids) {
  var out = {};
  ids.forEach(function (id) {
    out[id] = { error: 'DP World tracking is not connected yet. This row will update once it is set up.' };
  });
  return out;
}

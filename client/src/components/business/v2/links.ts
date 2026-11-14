// The Business page's two link builders (moved unchanged from the MVP 1 tracking model, issue #691).

/** Deep link to a carrier's job (DECISIONS pass 4). */
export function carrierHref(employeeId: string, jobId: string): string {
  return `/employee/${encodeURIComponent(employeeId)}?job=${encodeURIComponent(jobId)}`;
}

/**
 * Deep link to the simulator that opens this package's journey and plays it once (DECISIONS pass 63, 64).
 * The one builder of every simulator link on the Business page: the match result's "Watch in simulator",
 * the delivery details' "View journey" and the missing-delivery link.
 */
export function simulatorHref(shipmentId: string): string {
  return `/simulator?package=${encodeURIComponent(shipmentId)}&play=1`;
}

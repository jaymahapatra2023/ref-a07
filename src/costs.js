/**
 * Reference costs by CDT procedure code, in cents, for a metropolitan area.
 *
 * Transcribed from a consumer dental cost estimator. In-network figures are negotiated rates;
 * out-of-network figures are the amount a plan typically allows before the provider's own charge.
 * Every figure here is a reference point, not a quote — `estimate.js` labels it as such.
 */
export const REFERENCE_COSTS = {
  D0120: { description: 'Periodic oral evaluation', category: 'preventive', inNetwork: 5200, outOfNetwork: 7500 },
  D0150: { description: 'Comprehensive oral evaluation', category: 'preventive', inNetwork: 8900, outOfNetwork: 13000 },
  D0274: { description: 'Bitewing X-rays, four films', category: 'preventive', inNetwork: 6800, outOfNetwork: 9900 },
  D1110: { description: 'Adult cleaning (prophylaxis)', category: 'preventive', inNetwork: 9800, outOfNetwork: 14500 },
  D1206: { description: 'Topical fluoride varnish', category: 'preventive', inNetwork: 3900, outOfNetwork: 5600 },
  D2140: { description: 'Amalgam filling, one surface', category: 'basic', inNetwork: 14200, outOfNetwork: 20500 },
  D2391: { description: 'Composite filling, one surface, posterior', category: 'basic', inNetwork: 18700, outOfNetwork: 27000 },
  D2740: { description: 'Crown, porcelain or ceramic', category: 'major', inNetwork: 115000, outOfNetwork: 168000 },
  D2950: { description: 'Core build-up, including pins', category: 'major', inNetwork: 27500, outOfNetwork: 39500 },
  D3310: { description: 'Root canal, anterior tooth', category: 'major', inNetwork: 78000, outOfNetwork: 113000 },
  D4341: { description: 'Scaling and root planing, per quadrant', category: 'basic', inNetwork: 26000, outOfNetwork: 37500 },
  D4910: { description: 'Periodontal maintenance', category: 'preventive', inNetwork: 11500, outOfNetwork: 16800 },
  D6010: { description: 'Endosteal implant placement', category: 'major', inNetwork: 195000, outOfNetwork: 285000 },
  D7140: { description: 'Extraction, erupted tooth', category: 'basic', inNetwork: 19500, outOfNetwork: 28000 },
  D8080: { description: 'Comprehensive orthodontic treatment, adolescent', category: 'orthodontia', inNetwork: 540000, outOfNetwork: 720000 },
}

/** Free text to a procedure code. Deliberately narrow: an unmatched description is reported. */
const KEYWORDS = [
  [/implant/i, 'D6010'], [/root ?canal|endodont/i, 'D3310'], [/crown|cap\b/i, 'D2740'],
  [/build[- ]?up/i, 'D2950'], [/brace|orthodont|aligner/i, 'D8080'],
  [/deep clean|scaling|root plan/i, 'D4341'], [/perio.*maint/i, 'D4910'],
  [/extract|pull.*tooth|tooth.*out|wisdom/i, 'D7140'],
  [/composite|white filling/i, 'D2391'], [/fill/i, 'D2140'],
  [/x-?ray|bitewing|radiograph/i, 'D0274'], [/fluoride/i, 'D1206'],
  [/clean|hygien|prophy/i, 'D1110'], [/comprehensive exam|new patient/i, 'D0150'],
  [/exam|check ?up|visit/i, 'D0120'],
]

export function matchProcedure(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { matched: false, reason: 'No procedure was described.' }
  const direct = trimmed.toUpperCase().match(/\bD\d{4}\b/)
  if (direct && REFERENCE_COSTS[direct[0]]) {
    return { matched: true, code: direct[0], via: 'procedure code' }
  }
  for (const [pattern, code] of KEYWORDS) {
    if (pattern.test(trimmed)) return { matched: true, code, via: 'description' }
  }
  return {
    matched: false,
    reason: `"${trimmed}" did not match a procedure this tool holds a reference cost for. ` +
      'Ask the dentist for the CDT code on the treatment plan and enter that.',
  }
}

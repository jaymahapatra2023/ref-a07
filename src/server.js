/**
 * The HTTP surface. Thin on purpose: every figure it shows is computed in `estimate.js` or
 * `sequence.js`, both pure and both tested, and this file only shapes the request and the reply.
 *
 * No model call sits on any path that produces a number. A language model is used, when one is
 * configured, only to rephrase an explanation that has already been computed — and if it is
 * unavailable the computed explanation is shown as it is. That is the difference between a tool
 * that can be checked and one that cannot.
 */
import { createServer } from 'node:http'
import { matchProcedure, REFERENCE_COSTS } from './costs.js'
import { annualMaximumUsage, compareNetworks, estimateProcedure } from './estimate.js'
import { expiringBenefits, sequenceCare } from './sequence.js'
import { explainEstimate, LIMITS_NOTICE } from './explain.js'

const PORT = Number(process.env.PORT ?? 8080)

/**
 * Held in memory, keyed by a session id the client is given. Deliberately not persisted: the
 * answers include what care somebody is planning, and this tool has no reason to keep them
 * after the conversation. Nothing here is written to the log either — see `log()`.
 */
const sessions = new Map()

/** Structured, and never carrying an answer. Plan terms and procedures are the user's business. */
function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`)
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
    if (chunks.reduce((n, c) => n + c.length, 0) > 64 * 1024) {
      throw Object.assign(new Error('The request was too large.'), { status: 413 })
    }
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('The request body was not valid JSON.'), { status: 400 })
  }
}

const EMPTY_PLAN = {
  annualMaximumCents: null, annualMaximumUsedCents: 0,
  deductibleCents: null, deductibleMetCents: 0,
  coinsurance: null, network: null,
  waitingPeriodsMonths: null, frequencyLimitsPerYear: null,
  frequencyUsedPerYear: {}, monthsEnrolled: 0, fsaBalanceCents: 0,
}

/**
 * The six plan terms the tool asks for, each its own step, in the order an employee can answer
 * them from a benefits summary. Asked one at a time rather than as one form.
 */
const PLAN_STEPS = [
  { key: 'annualMaximumCents', ask: 'What is your annual maximum — the most your plan pays in a plan year?', unit: 'dollars' },
  { key: 'deductibleCents', ask: 'What is your deductible, and how much of it have you already paid this plan year?', unit: 'dollars' },
  { key: 'coinsurance', ask: 'What share does your plan pay for preventive, basic and major care?', unit: 'percentages' },
  { key: 'network', ask: 'Will you see an in-network or an out-of-network dentist?', unit: 'choice' },
  { key: 'waitingPeriodsMonths', ask: 'Does your plan have waiting periods, and how long have you been enrolled?', unit: 'months' },
  { key: 'frequencyLimitsPerYear', ask: 'How many cleanings and exams does your plan cover per plan year, and how many have you had?', unit: 'counts' },
]

function nextStep(plan) {
  return PLAN_STEPS.find((step) => plan[step.key] == null) ?? null
}

function session(id) {
  if (!sessions.has(id)) sessions.set(id, { plan: { ...EMPTY_PLAN }, procedures: [] })
  return sessions.get(id)
}

const ROUTES = {
  'GET /': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  },

  'GET /health': (_req, res) => json(res, 200, { ok: true }),

  /** What the tool still needs, so the client asks one question at a time. */
  'POST /session': async (req, res) => {
    const body = await readBody(req)
    const id = String(body.sessionId ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const state = session(id)
    log('session.opened', { sessionId: id })
    json(res, 200, {
      sessionId: id,
      next: nextStep(state.plan),
      collected: PLAN_STEPS.filter((s) => state.plan[s.key] != null).map((s) => s.key),
      remaining: PLAN_STEPS.filter((s) => state.plan[s.key] == null).map((s) => s.key),
    })
  },

  /** One answer at a time. A revised answer replaces the old one and the estimate recomputes. */
  'POST /plan': async (req, res) => {
    const body = await readBody(req)
    const state = session(String(body.sessionId ?? ''))
    for (const step of PLAN_STEPS) {
      if (body[step.key] !== undefined) state.plan[step.key] = body[step.key]
    }
    for (const extra of ['annualMaximumUsedCents', 'deductibleMetCents', 'monthsEnrolled',
                         'frequencyUsedPerYear', 'fsaBalanceCents']) {
      if (body[extra] !== undefined) state.plan[extra] = body[extra]
    }
    log('plan.updated', { sessionId: body.sessionId, termsGiven: PLAN_STEPS.filter((s) => state.plan[s.key] != null).length })
    json(res, 200, { next: nextStep(state.plan), plan: state.plan })
  },

  'POST /procedure': async (req, res) => {
    const body = await readBody(req)
    const state = session(String(body.sessionId ?? ''))
    const match = matchProcedure(body.description)
    if (!match.matched) {
      json(res, 422, { matched: false, message: match.reason })
      return
    }
    state.procedures.push(match.code)
    json(res, 200, {
      matched: true, code: match.code, via: match.via,
      description: REFERENCE_COSTS[match.code].description,
      procedures: state.procedures,
    })
  },

  'POST /estimate': async (req, res) => {
    const body = await readBody(req)
    const state = session(String(body.sessionId ?? ''))
    const codes = body.procedures ?? state.procedures
    if (codes.length === 0) {
      json(res, 422, { message: 'Describe the care you are planning first.' })
      return
    }

    const estimates = codes.map((code) => estimateProcedure(state.plan, code))
    json(res, 200, {
      estimates: estimates.map((e) => ({ ...e, explanation: explainEstimate(e) })),
      annualMaximum: annualMaximumUsage(state.plan, estimates),
      networkComparison: codes.map((code) => compareNetworks(state.plan, code)),
      limits: LIMITS_NOTICE,
    })
  },

  'POST /sequence': async (req, res) => {
    const body = await readBody(req)
    const state = session(String(body.sessionId ?? ''))
    const codes = body.procedures ?? state.procedures
    if (codes.length < 2) {
      json(res, 422, { message: 'Sequencing needs at least two planned procedures.' })
      return
    }
    json(res, 200, {
      ...sequenceCare(state.plan, codes, { monthsLeftInPlanYear: body.monthsLeftInPlanYear ?? 12 }),
      expiring: expiringBenefits(state.plan, { monthsLeftInPlanYear: body.monthsLeftInPlanYear ?? 12 }),
      limits: LIMITS_NOTICE,
    })
  },

  'GET /reference': (_req, res) => json(res, 200, {
    note: 'Reference costs this tool holds. Every estimate is derived from one of these.',
    procedures: Object.entries(REFERENCE_COSTS).map(([code, c]) => ({ code, ...c })),
  }),
}

export const app = createServer((req, res) => {
  const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`
  const handler = ROUTES[key]
  if (!handler) {
    json(res, 404, { message: `Nothing is served at ${key}.` })
    return
  }
  Promise.resolve(handler(req, res)).catch((err) => {
    // A failure says what happened and keeps the session: an employee who has entered six plan
    // terms should not lose them because one request failed.
    log('request.failed', { route: key, message: err.message })
    if (!res.headersSent) {
      json(res, err.status ?? 500, {
        message: err.status ? err.message : 'Something went wrong working that out.',
        yourAnswersAreKept: true,
      })
    }
  })
})

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Dental cost and coverage planner</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f2;padding:.1rem .3rem}</style></head><body>
<h1>Dental cost and coverage planner</h1>
<p>Describe the care you are planning and your plan's terms. You get an itemised estimate of what
the plan pays and what you owe, each line showing which plan term produced it, and an order to
have the work done in across the plan year.</p>
<p><strong>This is an estimate, not a quote.</strong> It is not a substitute for your plan document
or your dentist's treatment plan.</p>
<h2>How to use it</h2>
<ol>
<li><code>POST /session</code> — start; the reply names the next thing it needs.</li>
<li><code>POST /plan</code> — answer one term at a time. Answer again to change one.</li>
<li><code>POST /procedure</code> — describe a procedure in your own words.</li>
<li><code>POST /estimate</code> — the itemised breakdown and the annual-maximum position.</li>
<li><code>POST /sequence</code> — the order to have two or more procedures done in.</li>
</ol>
</body></html>`

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => log('server.listening', { port: PORT }))
}

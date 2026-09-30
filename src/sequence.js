/**
 * The order to have planned care done in, across the plan year.
 *
 * Three plan terms decide it, and the reason given for each placement names which: the annual
 * maximum (what is left to spend), the deductible (paid once, so the first non-preventive
 * procedure carries it), and frequency limits (how many of a thing the plan covers per year).
 *
 * Pure. Given the same plan and procedures it returns the same plan-year sequence.
 */
import { REFERENCE_COSTS } from './costs.js'
import { estimateProcedure } from './estimate.js'

const URGENCY = { major: 0, basic: 1, preventive: 2, orthodontia: 3 }

export function sequenceCare(plan, procedureCodes, options = {}) {
  const monthsLeftInPlanYear = options.monthsLeftInPlanYear ?? 12
  const ordered = [...procedureCodes].sort((a, b) => {
    const ua = URGENCY[REFERENCE_COSTS[a].category] ?? 9
    const ub = URGENCY[REFERENCE_COSTS[b].category] ?? 9
    if (ua !== ub) return ua - ub
    return REFERENCE_COSTS[b].inNetwork - REFERENCE_COSTS[a].inNetwork
  })

  let usedCents = plan.annualMaximumUsedCents ?? 0
  let deductibleMetCents = plan.deductibleMetCents ?? 0
  const frequencyUsed = { ...(plan.frequencyUsedPerYear ?? {}) }
  const steps = []

  for (const code of ordered) {
    const reference = REFERENCE_COSTS[code]
    const estimate = estimateProcedure(
      { ...plan, annualMaximumUsedCents: usedCents, deductibleMetCents }, code)

    const reasons = []
    const remainingBefore = Math.max(0, (plan.annualMaximumCents ?? 0) - usedCents)

    if (estimate.deductibleAppliedCents > 0) {
      reasons.push(
        `this is where your deductible gets paid — ${(estimate.deductibleAppliedCents / 100).toFixed(2)} ` +
        'of it, once for the plan year, so everything after this is cheaper')
    }

    const limit = plan.frequencyLimitsPerYear?.[code]
    const already = frequencyUsed[code] ?? 0
    let deferred = false
    if (limit != null && already >= limit) {
      deferred = true
      reasons.push(
        `your plan covers ${limit} of these per plan year and you have had ${already}, so this one ` +
        'falls in the next plan year')
    }

    if (!deferred && estimate.cappedByAnnualMaximum) {
      reasons.push(
        `your annual maximum runs out part-way through this one — ${(remainingBefore / 100).toFixed(2)} ` +
        'was left — so splitting it across the plan-year boundary costs you less')
    } else if (!deferred) {
      reasons.push(
        `${(remainingBefore / 100).toFixed(2)} of your annual maximum was still available, ` +
        'which covers the plan\'s share of this')
    }

    const monthOffset = deferred
      ? monthsLeftInPlanYear
      : Math.min(steps.length, Math.max(0, monthsLeftInPlanYear - 1))

    steps.push({
      procedureCode: code,
      description: reference.description,
      category: reference.category,
      position: steps.length + 1,
      whenMonthsFromNow: monthOffset,
      planYear: deferred ? 'next' : 'this',
      planPaysCents: deferred ? 0 : estimate.planPaysCents,
      employeeOwesCents: estimate.employeeOwesCents,
      reasons,
    })

    if (!deferred) {
      usedCents += estimate.planPaysCents
      deductibleMetCents += estimate.deductibleAppliedCents
      frequencyUsed[code] = already + 1
    }
  }

  return {
    steps,
    summary:
      `${steps.filter((s) => s.planYear === 'this').length} of ${steps.length} planned in this ` +
      `plan year, ordered so the deductible is paid once and the annual maximum is spent on the ` +
      `most urgent care first.`,
  }
}

/** Benefits that expire at the plan-year boundary, with what is actually left of each. */
export function expiringBenefits(plan, options = {}) {
  const monthsLeft = options.monthsLeftInPlanYear ?? 12
  const items = []

  const remaining = Math.max(0, (plan.annualMaximumCents ?? 0) - (plan.annualMaximumUsedCents ?? 0))
  if (remaining > 0) {
    items.push({
      kind: 'annual maximum',
      remaining: `${(remaining / 100).toFixed(2)}`,
      expiresInMonths: monthsLeft,
      note: 'Unused annual maximum does not carry over into the next plan year.',
    })
  }

  for (const [code, limit] of Object.entries(plan.frequencyLimitsPerYear ?? {})) {
    const used = plan.frequencyUsedPerYear?.[code] ?? 0
    if (used < limit) {
      items.push({
        kind: REFERENCE_COSTS[code]?.description ?? code,
        remaining: `${limit - used} of ${limit} covered this plan year`,
        expiresInMonths: monthsLeft,
        note: 'Covered visits do not carry over; booking before the plan year ends uses them.',
      })
    }
  }

  const fsa = plan.fsaBalanceCents ?? 0
  if (fsa > 0) {
    items.push({
      kind: 'flexible spending account balance',
      remaining: `${(fsa / 100).toFixed(2)}`,
      expiresInMonths: monthsLeft,
      note: 'FSA balances are commonly forfeited at the plan-year end; check your own plan rules.',
    })
  }

  return items
}

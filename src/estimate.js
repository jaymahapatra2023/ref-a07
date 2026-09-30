/**
 * What the plan pays and what the employee owes, computed from the plan terms they entered.
 *
 * Pure: no I/O, no model call, no clock. Every line of the breakdown names the plan term that
 * produced it, because an employee who cannot see why a figure is what it is cannot check it.
 * Money is in cents throughout; formatting happens at the edge.
 */
import { REFERENCE_COSTS } from './costs.js'

const CATEGORY_LABEL = {
  preventive: 'preventive', basic: 'basic', major: 'major', orthodontia: 'orthodontia',
}

/** A plan term that was not supplied cannot be applied, and the estimate says so. */
function missingTerms(plan) {
  const missing = []
  if (plan.annualMaximumCents == null) missing.push('annual maximum')
  if (plan.deductibleCents == null) missing.push('deductible')
  if (plan.coinsurance == null) missing.push('coinsurance by category')
  if (plan.network == null) missing.push('network status')
  if (plan.waitingPeriodsMonths == null) missing.push('waiting periods')
  if (plan.frequencyLimitsPerYear == null) missing.push('frequency limits')
  return missing
}

export function estimateProcedure(plan, procedureCode, options = {}) {
  const reference = REFERENCE_COSTS[procedureCode]
  if (!reference) throw new Error(`No reference cost for ${procedureCode}.`)

  const missing = missingTerms(plan)
  const network = plan.network === 'OUT_OF_NETWORK' ? 'outOfNetwork' : 'inNetwork'
  const allowedCents = reference[network]
  const category = reference.category
  const lines = []

  lines.push({
    label: `Reference ${plan.network === 'OUT_OF_NETWORK' ? 'out-of-network' : 'in-network'} cost`,
    amountCents: allowedCents,
    basis: 'reference cost data for this procedure code',
    estimated: true,
    dependsOn: 'the procedure code, your network status, and the area the reference data covers',
  })

  const waitMonths = plan.waitingPeriodsMonths?.[category] ?? 0
  const monthsEnrolled = plan.monthsEnrolled ?? 0
  const waitingPeriodBlocks = waitMonths > monthsEnrolled
  if (waitingPeriodBlocks) {
    lines.push({
      label: 'Waiting period not yet served',
      amountCents: 0,
      basis: `your plan's ${waitMonths}-month waiting period for ${CATEGORY_LABEL[category]} care, ` +
        `and ${monthsEnrolled} month(s) enrolled`,
      estimated: false,
      dependsOn: null,
    })
    return {
      procedureCode, description: reference.description, category,
      allowedCents, planPaysCents: 0, employeeOwesCents: allowedCents,
      deductibleAppliedCents: 0, cappedByAnnualMaximum: false, waitingPeriodBlocks: true,
      lines, missingTerms: missing,
    }
  }

  const deductibleApplies = category !== 'preventive'
  const deductibleRemaining = Math.max(0, (plan.deductibleCents ?? 0) - (plan.deductibleMetCents ?? 0))
  const deductibleAppliedCents = deductibleApplies
    ? Math.min(deductibleRemaining, allowedCents)
    : 0

  if (deductibleApplies) {
    lines.push({
      label: 'Deductible you pay first',
      amountCents: deductibleAppliedCents,
      basis: deductibleAppliedCents === 0
        ? 'your deductible is already met for this plan year'
        : `your ${CATEGORY_LABEL[category]} deductible, of which ` +
          `${(deductibleRemaining / 100).toFixed(2)} is unmet`,
      estimated: false,
      dependsOn: null,
    })
  } else {
    lines.push({
      label: 'Deductible does not apply',
      amountCents: 0,
      basis: 'preventive care is not subject to the deductible under your plan',
      estimated: false,
      dependsOn: null,
    })
  }

  const share = plan.coinsurance?.[category] ?? 0
  const afterDeductible = allowedCents - deductibleAppliedCents
  const beforeCap = Math.round(afterDeductible * share)

  lines.push({
    label: `Plan share at ${Math.round(share * 100)}%`,
    amountCents: beforeCap,
    basis: `your plan's ${Math.round(share * 100)}% coinsurance for ${CATEGORY_LABEL[category]} care, ` +
      'applied after the deductible',
    estimated: false,
    dependsOn: null,
  })

  const maximumRemaining = Math.max(
    0, (plan.annualMaximumCents ?? 0) - (plan.annualMaximumUsedCents ?? 0))
  const planPaysCents = Math.min(beforeCap, maximumRemaining)
  const cappedByAnnualMaximum = planPaysCents < beforeCap

  if (cappedByAnnualMaximum) {
    lines.push({
      label: 'Reduced by your remaining annual maximum',
      amountCents: planPaysCents - beforeCap,
      basis: `your annual maximum has ${(maximumRemaining / 100).toFixed(2)} left this plan year`,
      estimated: false,
      dependsOn: null,
    })
  }

  const employeeOwesCents = allowedCents - planPaysCents

  return {
    procedureCode, description: reference.description, category,
    allowedCents, planPaysCents, employeeOwesCents,
    deductibleAppliedCents, cappedByAnnualMaximum, waitingPeriodBlocks: false,
    lines, missingTerms: missing,
  }
}

/** Where the annual maximum stands, and where it would stand after the planned care. */
export function annualMaximumUsage(plan, estimates) {
  const total = plan.annualMaximumCents ?? 0
  const usedCents = plan.annualMaximumUsedCents ?? 0
  let running = usedCents
  const timeline = estimates.map((e) => {
    running += e.planPaysCents
    return {
      procedureCode: e.procedureCode,
      planPaysCents: e.planPaysCents,
      usedAfterCents: Math.min(running, total),
      remainingAfterCents: Math.max(0, total - running),
    }
  })
  return {
    totalCents: total,
    usedCents,
    remainingCents: Math.max(0, total - usedCents),
    projectedUsedCents: Math.min(running, total),
    projectedRemainingCents: Math.max(0, total - running),
    exceedsMaximum: running > total,
    timeline,
  }
}

/** The same procedure both ways, so the difference is visible rather than asserted. */
export function compareNetworks(plan, procedureCode) {
  const inNetwork = estimateProcedure({ ...plan, network: 'IN_NETWORK' }, procedureCode)
  const outOfNetwork = estimateProcedure({ ...plan, network: 'OUT_OF_NETWORK' }, procedureCode)
  return {
    procedureCode,
    inNetwork: { allowedCents: inNetwork.allowedCents, employeeOwesCents: inNetwork.employeeOwesCents },
    outOfNetwork: { allowedCents: outOfNetwork.allowedCents, employeeOwesCents: outOfNetwork.employeeOwesCents },
    differenceCents: outOfNetwork.employeeOwesCents - inNetwork.employeeOwesCents,
  }
}

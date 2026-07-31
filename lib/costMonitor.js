'use strict';

// Rough running-cost tripwire for the LLM enrichment stream (DESIGN.md §6,
// §10: "cost is a first-class metric here, not an afterthought"). Precision
// doesn't matter much at Phase A's low single-digit USD/month target — what
// matters is a cheap, conservative estimate that fires an alert before a
// runaway ingest loop or a pricing surprise turns into a real bill.
const DEFAULT_COST_PER_CALL_USD = 0.0005;
const DEFAULT_CEILING_USD = 5;

function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

class CostMonitor {
  constructor({ ceilingUsd, costPerCallUsd, now = () => new Date() } = {}) {
    this.ceilingUsd = ceilingUsd ?? (Number(process.env.LLM_MONTHLY_COST_CEILING_USD) || DEFAULT_CEILING_USD);
    this.costPerCallUsd = costPerCallUsd ?? DEFAULT_COST_PER_CALL_USD;
    this.now = now;
    this.monthKey = currentMonthKey(this.now());
    this.callsThisMonth = 0;
  }

  rolloverIfNewMonth() {
    const month = currentMonthKey(this.now());
    if (month !== this.monthKey) {
      this.monthKey = month;
      this.callsThisMonth = 0;
    }
  }

  recordCalls(count) {
    this.rolloverIfNewMonth();
    this.callsThisMonth += count;
    return this.estimatedSpendUsd();
  }

  estimatedSpendUsd() {
    return this.callsThisMonth * this.costPerCallUsd;
  }

  isOverCeiling() {
    this.rolloverIfNewMonth();
    return this.estimatedSpendUsd() > this.ceilingUsd;
  }
}

module.exports = { CostMonitor, currentMonthKey, DEFAULT_COST_PER_CALL_USD, DEFAULT_CEILING_USD };

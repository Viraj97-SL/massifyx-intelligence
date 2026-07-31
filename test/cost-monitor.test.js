'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CostMonitor, currentMonthKey } = require('../lib/costMonitor');

test('currentMonthKey formats as zero-padded YYYY-MM', () => {
  assert.equal(currentMonthKey(new Date(Date.UTC(2026, 0, 15))), '2026-01');
  assert.equal(currentMonthKey(new Date(Date.UTC(2026, 10, 3))), '2026-11');
});

test('recordCalls accumulates estimated spend within the same month', () => {
  const monitor = new CostMonitor({ costPerCallUsd: 0.001, ceilingUsd: 100 });
  monitor.recordCalls(100);
  monitor.recordCalls(50);
  assert.equal(monitor.estimatedSpendUsd(), 0.15);
});

test('isOverCeiling is false under the ceiling and true once it is exceeded', () => {
  const monitor = new CostMonitor({ costPerCallUsd: 1, ceilingUsd: 10 });
  monitor.recordCalls(9);
  assert.equal(monitor.isOverCeiling(), false);
  monitor.recordCalls(2);
  assert.equal(monitor.isOverCeiling(), true);
});

test('spend resets when the calendar month rolls over', () => {
  let current = new Date(Date.UTC(2026, 0, 31));
  const monitor = new CostMonitor({ costPerCallUsd: 1, ceilingUsd: 10, now: () => current });

  monitor.recordCalls(9);
  assert.equal(monitor.estimatedSpendUsd(), 9);

  current = new Date(Date.UTC(2026, 1, 1));
  monitor.recordCalls(1);
  assert.equal(monitor.estimatedSpendUsd(), 1);
});

test('defaults come from LLM_MONTHLY_COST_CEILING_USD when set', () => {
  const original = process.env.LLM_MONTHLY_COST_CEILING_USD;
  process.env.LLM_MONTHLY_COST_CEILING_USD = '2';
  try {
    const monitor = new CostMonitor({ costPerCallUsd: 1 });
    monitor.recordCalls(3);
    assert.equal(monitor.isOverCeiling(), true);
  } finally {
    if (original === undefined) delete process.env.LLM_MONTHLY_COST_CEILING_USD;
    else process.env.LLM_MONTHLY_COST_CEILING_USD = original;
  }
});

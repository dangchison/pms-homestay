import { type RatePlanRule } from './types';

/**
 * Áp rate_plan_rules theo priority (cao thắng), tie-break theo created_at
 * (docs/13 §6, docs/07 §3) — TODO(task 2.3).
 */
export function applyRatePlanRules(_rules: RatePlanRule[], _localDate: string): RatePlanRule[] {
  throw new Error(
    'TODO(task 2.3): applyRatePlanRules chưa implement — xem docs/07-pricing-engine.md §3',
  );
}

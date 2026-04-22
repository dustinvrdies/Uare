export const PRODUCT_PLANS = [
  {
    plan_id: 'free',
    name: 'Free',
    price_monthly: 0,
    credits_monthly: 100,
    features: ['1 workspace owner', 'basic solver queue', 'memory replay window'],
  },
  {
    plan_id: 'pro',
    name: 'Pro',
    price_monthly: 49,
    credits_monthly: 2500,
    features: ['priority workers', 'analytics dashboard', 'patent provider bridge'],
  },
  {
    plan_id: 'studio',
    name: 'Studio',
    price_monthly: 199,
    credits_monthly: 15000,
    features: ['multi-user team', 'autonomous worker fleet', 'advanced learning intelligence'],
  },
  {
    plan_id: 'enterprise',
    name: 'Enterprise',
    price_monthly: null,
    credits_monthly: null,
    features: ['sso / enterprise auth', 'broker-backed distributed ops', 'dedicated support + custom deployment'],
  },
];

export function getPlan(planId = 'free') {
  return PRODUCT_PLANS.find((plan) => plan.plan_id === planId) || PRODUCT_PLANS[0];
}

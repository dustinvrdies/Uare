export function registerSubscriptionLifecycleRoutes(app) {
  app.get('/billing/lifecycle', (req, res) => {
    res.json({
      currentPlan: 'free',
      status: 'active',
      trialEndsAt: null,
      renewsAt: null,
      cancelAtPeriodEnd: false,
      paymentState: 'good',
      nextRecommendedAction: 'upgrade'
    });
  });
}

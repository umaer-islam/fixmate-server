import Stripe from 'stripe';
import { env } from './env.js';

let stripeClientInstance: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClientInstance) {
    const key = env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
    stripeClientInstance = new Stripe(key);
  }
  return stripeClientInstance;
}

export function _setMockStripeClientForTest(mock: Stripe | null): void {
  stripeClientInstance = mock;
}

/**
 * Side-effect import: replaces the Razorpay SDK with a fake before the billing controller
 * constructs its client, so tests never call the real API. Import before any app code.
 * Set `razorpayOrders.create` per test to control order creation.
 */
import { replaceModule } from './stub';

export const razorpayOrders: { create: (options: Record<string, unknown>) => Promise<Record<string, unknown>> } = {
    create: async () => {
        throw new Error('razorpayOrders.create not set for this test');
    },
};

replaceModule('razorpay', {
    __esModule: true,
    default: class FakeRazorpay {
        orders = { create: (options: Record<string, unknown>) => razorpayOrders.create(options) };
    },
});

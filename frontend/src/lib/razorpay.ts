export type RazorpayOrderData = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  planName: string;
  email: string;
};

export type RazorpaySuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export const loadRazorpay = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

type OpenCheckoutHandlers = {
  onSuccess: (response: RazorpaySuccessResponse) => void | Promise<void>;
  onDismiss?: () => void;
  onFailure?: (error: Error) => void;
};

export const openRazorpayCheckout = async (
  order: RazorpayOrderData,
  handlers: OpenCheckoutHandlers
) => {
  const loaded = await loadRazorpay();
  if (!loaded || !(window as any).Razorpay) {
    throw new Error('Failed to load Razorpay checkout');
  }

  const rzp = new (window as any).Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    name: 'YouTube Automation',
    description: `YouTube Automation ${order.planName} Subscription`,
    prefill: {
      email: order.email,
    },
    notes: {
      plan: order.planName,
    },
    theme: {
      color: '#7C5CFF',
    },
    handler: (response: RazorpaySuccessResponse) => {
      handlers.onSuccess(response);
    },
    modal: {
      ondismiss: () => handlers.onDismiss?.(),
    },
  });

  if (handlers.onFailure) {
    rzp.on('payment.failed', (event: any) => {
      const message = event?.error?.description || 'Payment failed';
      handlers.onFailure?.(new Error(message));
    });
  }

  rzp.open();
};

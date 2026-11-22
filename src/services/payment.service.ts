import { ObjectId, Filter } from 'mongodb';
import { getBookingsCollection, getPaymentsCollection } from '../db/collections.js';
import { getStripeClient } from '../config/stripe.js';
import { env } from '../config/env.js';
import type { BookingDocument, PaymentDocument } from '../types/database.js';
import type { AuthenticatedUser } from '../types/auth.js';
import { parseBookingId, buildCustomerBookingOwnershipFilter } from './booking.service.js';

export type PaymentServiceResult<T = any> =
  | { success: true; data?: T; message?: string }
  | { success: false; status: number; message: string; details?: any };

/**
 * Initiates a Stripe Checkout Session for a customer's completed, unpaid booking.
 */
export async function createCheckoutSession(
  customerUser: AuthenticatedUser,
  bookingId: string
): Promise<PaymentServiceResult<{ url: string; sessionId: string }>> {
  const bookingsCollection = getBookingsCollection();
  const paymentsCollection = getPaymentsCollection();
  const parsedId = parseBookingId(bookingId);

  // 1. Authoritative booking lookup scoped to authenticated customer
  const booking = await bookingsCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...buildCustomerBookingOwnershipFilter(customerUser),
  });

  if (!booking) {
    return {
      success: false,
      status: 404,
      message: 'Booking not found or not owned by the authenticated customer.',
    };
  }

  // 2. Validate booking lifecycle status
  if (booking.status !== 'completed') {
    return {
      success: false,
      status: 400,
      message: `Cannot initiate payment for booking with status "${booking.status}". Only completed bookings can be paid.`,
    };
  }

  // 3. Validate payment status
  if (booking.paymentStatus === 'paid') {
    return {
      success: false,
      status: 409,
      message: 'This booking has already been paid.',
    };
  }

  // 4. Validate finalAmount
  if (
    typeof booking.finalAmount !== 'number' ||
    isNaN(booking.finalAmount) ||
    booking.finalAmount <= 0
  ) {
    return {
      success: false,
      status: 400,
      message: 'The booking does not have a valid, positive final payable amount.',
    };
  }

  // 5. Confirm no settled payment already exists in database
  const existingPayment = await paymentsCollection.findOne({
    bookingId: booking._id as unknown as ObjectId,
    paymentStatus: { $in: ['paid', 'succeeded'] as any },
  });

  if (existingPayment) {
    return {
      success: false,
      status: 409,
      message: 'A verified payment already exists for this booking.',
    };
  }

  const stripe = getStripeClient();
  const unitAmountInCents = Math.round(booking.finalAmount * 100);

  // 6. Check for existing open Checkout Session to prevent duplicate sessions
  if (booking.stripeSessionId) {
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(
        booking.stripeSessionId
      );
      if (existingSession && existingSession.status === 'open' && existingSession.url) {
        return {
          success: true,
          data: {
            url: existingSession.url,
            sessionId: existingSession.id,
          },
        };
      }
    } catch {
      // If retrieval fails (e.g. expired or invalid id), proceed to create a new session
    }
  }

  // 7. Create new Stripe Checkout Session in payment mode
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: customerUser.email.toLowerCase(),
        client_reference_id: booking._id!.toString(),
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: booking.serviceTitle,
                description: `FixMate Repair Service for ${booking.customerName} (Booking ID: ${booking._id})`,
              },
              unit_amount: unitAmountInCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: booking._id!.toString(),
          customerId: customerUser.id,
          customerEmail: customerUser.email.toLowerCase(),
          finalAmount: booking.finalAmount.toString(),
        },
        success_url: `${env.CLIENT_URL}/dashboard/bookings/${booking._id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.CLIENT_URL}/dashboard/bookings/${booking._id}?payment=cancelled`,
      },
      {
        idempotencyKey: `cs_${booking._id}_${unitAmountInCents}`,
      }
    );

    // Save session ID on booking for tracking and duplicate prevention
    await bookingsCollection.updateOne(
      { _id: booking._id },
      { $set: { stripeSessionId: session.id, updatedAt: new Date() } }
    );

    return {
      success: true,
      data: {
        url: session.url!,
        sessionId: session.id,
      },
    };
  } catch (stripeError: any) {
    console.error('[Stripe Checkout Error]', stripeError?.message || stripeError);
    return {
      success: false,
      status: 502,
      message: 'Failed to create Stripe Checkout Session. Please try again.',
    };
  }
}

/**
 * Handles Stripe webhook delivery with raw signature verification and atomic settlement.
 */
export async function handleStripeWebhookEvent(
  rawBody: Buffer | string,
  signatureHeader?: string
): Promise<PaymentServiceResult> {
  if (!signatureHeader) {
    return {
      success: false,
      status: 400,
      message: 'Missing Stripe signature header.',
    };
  }

  const stripe = getStripeClient();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder';

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch (err: any) {
    return {
      success: false,
      status: 400,
      message: `Webhook signature verification failed: ${err.message}`,
    };
  }

  // Only process checkout.session.completed events
  if (event.type !== 'checkout.session.completed') {
    return {
      success: true,
      message: `Event type ${event.type} acknowledged and ignored.`,
    };
  }

  const session = event.data.object as any;

  // Verify payment status and mode
  if (session.mode !== 'payment' || session.payment_status !== 'paid') {
    return {
      success: false,
      status: 400,
      message: 'Checkout Session is not in paid payment mode.',
    };
  }

  const bookingIdStr = session.metadata?.bookingId;
  if (!bookingIdStr) {
    return {
      success: false,
      status: 400,
      message: 'Missing bookingId in Stripe session metadata.',
    };
  }

  const bookingsCollection = getBookingsCollection();
  const paymentsCollection = getPaymentsCollection();
  const parsedBookingId = parseBookingId(bookingIdStr);

  // Check if this session or booking is already processed (Idempotency)
  const existingPayment = await paymentsCollection.findOne({
    $or: [
      { stripeSessionId: session.id },
      { bookingId: parsedBookingId as unknown as ObjectId },
    ],
  });

  if (existingPayment) {
    return {
      success: true,
      message: 'Payment has already been processed and acknowledged.',
    };
  }

  // Load authoritative booking
  const booking = await bookingsCollection.findOne({
    _id: parsedBookingId as unknown as ObjectId,
  });

  if (!booking) {
    return {
      success: false,
      status: 404,
      message: `Booking referenced in metadata (${bookingIdStr}) was not found.`,
    };
  }

  if (booking.status !== 'completed') {
    return {
      success: false,
      status: 400,
      message: `Cannot finalize payment for booking with status "${booking.status}". Must be completed.`,
    };
  }

  // Verify currency and amount
  if (session.currency?.toLowerCase() !== 'usd') {
    return {
      success: false,
      status: 400,
      message: `Currency mismatch: expected usd, received ${session.currency}.`,
    };
  }

  const expectedAmountInCents = Math.round((booking.finalAmount || 0) * 100);
  if (session.amount_total !== expectedAmountInCents) {
    return {
      success: false,
      status: 400,
      message: `Amount mismatch: expected ${expectedAmountInCents} cents, received ${session.amount_total} cents.`,
    };
  }

  // Atomic state finalization:
  // Update booking paymentStatus from unpaid to paid
  const now = new Date();
  const updateBooking = await bookingsCollection.findOneAndUpdate(
    {
      _id: booking._id,
      paymentStatus: 'unpaid',
      status: 'completed',
    },
    {
      $set: {
        paymentStatus: 'paid',
        stripeSessionId: session.id,
        updatedAt: now,
      },
    },
    { returnDocument: 'after' }
  );

  if (!updateBooking) {
    // Already marked paid or state changed concurrently
    return {
      success: true,
      message: 'Booking was already paid or settled by a competing process.',
    };
  }

  // Insert payment record
  const paymentDoc: PaymentDocument = {
    bookingId: booking._id!,
    serviceTitle: booking.serviceTitle,
    customerId: booking.customerId,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianId: booking.technicianId,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: booking.finalAmount!,
    currency: 'usd',
    transactionId: (session.payment_intent as string) || session.id,
    stripeSessionId: session.id,
    stripePaymentIntentId: (session.payment_intent as string) || null,
    paymentStatus: 'paid',
    paidAt: now,
    createdAt: now,
  };

  try {
    await paymentsCollection.insertOne(paymentDoc);
  } catch (err: any) {
    if (err && (err.code === 11000 || err.message?.includes('E11000'))) {
      // Unique index caught duplicate insertion safely
      return {
        success: true,
        message: 'Duplicate payment record prevented by unique index constraint.',
      };
    }
    throw err;
  }

  return {
    success: true,
    message: 'Payment finalized successfully.',
  };
}

export function buildCustomerPaymentOwnershipFilter(
  customerUser: AuthenticatedUser
): Filter<PaymentDocument> {
  const custId = customerUser.id;
  const custEmail = customerUser.email.toLowerCase();

  const idConditions: Filter<PaymentDocument>[] = [
    { customerId: custId },
  ];

  if (ObjectId.isValid(custId) && custId.length === 24) {
    idConditions.push({ customerId: new ObjectId(custId) });
  }

  idConditions.push({
    customerEmail: custEmail,
    customerId: { $in: [null as any, undefined as any] },
  });

  return { $or: idConditions };
}

/**
 * Customer retrieves their own payment history.
 */
export async function getCustomerPayments(
  customerUser: AuthenticatedUser,
  params: { page: number; limit: number }
) {
  const paymentsCollection = getPaymentsCollection();
  const filter: Filter<PaymentDocument> = {
    ...buildCustomerPaymentOwnershipFilter(customerUser),
  };

  const skip = (params.page - 1) * params.limit;

  const [payments, totalCount] = await Promise.all([
    paymentsCollection
      .find(filter)
      .sort({ paidAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .toArray(),
    paymentsCollection.countDocuments(filter),
  ]);

  return {
    payments,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

/**
 * Customer retrieves payment status for a specific booking.
 */
export async function getBookingPaymentStatus(
  customerUser: AuthenticatedUser,
  bookingId: string
): Promise<PaymentServiceResult<{ bookingId: string; paymentStatus: string; payment: PaymentDocument | null }>> {
  const bookingsCollection = getBookingsCollection();
  const paymentsCollection = getPaymentsCollection();
  const parsedId = parseBookingId(bookingId);

  const booking = await bookingsCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...buildCustomerBookingOwnershipFilter(customerUser),
  });

  if (!booking) {
    return {
      success: false,
      status: 404,
      message: 'Booking not found or not owned by the authenticated customer.',
    };
  }

  const payment = await paymentsCollection.findOne({
    bookingId: booking._id as unknown as ObjectId,
  });

  return {
    success: true,
    data: {
      bookingId: booking._id!.toString(),
      paymentStatus: booking.paymentStatus,
      payment,
    },
  };
}

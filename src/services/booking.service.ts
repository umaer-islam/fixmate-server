import { ObjectId, Filter } from 'mongodb';
import { getBookingsCollection, getServicesCollection } from '../db/collections.js';
import type {
  BookingDocument,
  BookingStatus,
  ServiceDocument,
} from '../types/database.js';
import type { AuthenticatedUser } from '../types/auth.js';

export function parseBookingId(id: string): ObjectId | string {
  const trimmed = id.trim();
  if (ObjectId.isValid(trimmed) && trimmed.length === 24) {
    return new ObjectId(trimmed);
  }
  return trimmed;
}

/**
 * Builds ownership filter strictly anchored on the immutable technicianId.
 * Fallback to technicianEmail is allowed ONLY for legacy records that completely lack technicianId.
 */
export function buildTechnicianBookingOwnershipFilter(
  techUser: AuthenticatedUser
): Filter<BookingDocument> {
  const techId = techUser.id;
  const techEmail = techUser.email.toLowerCase();

  const idConditions: Filter<BookingDocument>[] = [
    { technicianId: techId },
  ];

  if (ObjectId.isValid(techId) && techId.length === 24) {
    idConditions.push({ technicianId: new ObjectId(techId) });
  }

  // Allow email fallback ONLY for legacy records lacking technicianId
  idConditions.push({
    technicianEmail: techEmail,
    technicianId: { $in: [null as any, undefined as any] },
  });

  return { $or: idConditions };
}

/**
 * Builds ownership filter strictly anchored on the authenticated customerId.
 * Fallback to customerEmail is allowed ONLY for legacy records lacking customerId.
 */
export function buildCustomerBookingOwnershipFilter(
  customerUser: AuthenticatedUser
): Filter<BookingDocument> {
  const custId = customerUser.id;
  const custEmail = customerUser.email.toLowerCase();

  const idConditions: Filter<BookingDocument>[] = [
    { customerId: custId },
  ];

  if (ObjectId.isValid(custId) && custId.length === 24) {
    idConditions.push({ customerId: new ObjectId(custId) });
  }

  // Allow email fallback ONLY for legacy records lacking customerId
  idConditions.push({
    customerEmail: custEmail,
    customerId: { $in: [null as any, undefined as any] },
  });

  return { $or: idConditions };
}

export interface CreateBookingPayload {
  serviceId: string;
  customerPhone: string;
  address: string;
  preferredDate: Date;
  problemDescription: string;
}

export interface BookingQueryParams {
  status?: BookingStatus;
  page: number;
  limit: number;
}

export type BookingServiceResult<T = BookingDocument> =
  | { success: true; data: T }
  | { success: false; status: number; message: string; details?: any };

/**
 * Customer booking creation with atomic duplicate active booking prevention.
 */
export async function createBooking(
  customerUser: AuthenticatedUser,
  payload: CreateBookingPayload
): Promise<BookingServiceResult> {
  const servicesCollection = getServicesCollection();
  const bookingsCollection = getBookingsCollection();

  const parsedServiceId = parseBookingId(payload.serviceId);

  // 1. Load service from database
  const service = await servicesCollection.findOne({
    _id: parsedServiceId as unknown as ObjectId,
  });

  if (!service) {
    return {
      success: false,
      status: 404,
      message: 'The requested service was not found.',
    };
  }

  // 2. Eligibility checks
  if (service.approvalStatus !== 'approved') {
    return {
      success: false,
      status: 400,
      message: 'Cannot book a service that is not yet approved.',
    };
  }

  if (!service.isAvailable) {
    return {
      success: false,
      status: 400,
      message: 'This service is currently unavailable for new bookings.',
    };
  }

  // 3. Confirm authenticated customer is not the technician who owns the service
  const techIdStr = service.technicianId ? service.technicianId.toString() : '';
  const techEmailStr = service.technicianEmail ? service.technicianEmail.toLowerCase() : '';
  if (
    techIdStr === customerUser.id ||
    techEmailStr === customerUser.email.toLowerCase()
  ) {
    return {
      success: false,
      status: 400,
      message: 'Technicians cannot book their own service.',
    };
  }

  // 4. Duplicate active booking check (preliminary check)
  const custId = ObjectId.isValid(customerUser.id) && customerUser.id.length === 24
    ? new ObjectId(customerUser.id)
    : customerUser.id;

  const activeExisting = await bookingsCollection.findOne({
    $and: [
      {
        $or: [
          { customerId: customerUser.id },
          ...(ObjectId.isValid(customerUser.id) && customerUser.id.length === 24
            ? [{ customerId: new ObjectId(customerUser.id) }]
            : []),
        ],
      },
      {
        $or: [
          { serviceId: service._id },
          { serviceId: service._id?.toString() },
        ],
      },
      {
        status: { $in: ['requested', 'accepted', 'in-progress'] },
      },
    ],
  });

  if (activeExisting) {
    return {
      success: false,
      status: 409,
      message: 'You already have an active booking for this service.',
    };
  }

  // 5. Construct immutable service snapshot and booking document
  const now = new Date();
  const newBooking: BookingDocument = {
    // Snapshot
    serviceId: service._id!,
    serviceTitle: service.title,
    serviceImage: service.image || service.imageUrl || '',
    serviceCategory: service.category,
    basePrice: service.basePrice,
    technicianId: service.technicianId,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,

    // Customer
    customerId: custId as any,
    customerName: customerUser.name || 'Customer',
    customerEmail: customerUser.email.toLowerCase(),
    customerPhone: payload.customerPhone,
    address: payload.address,

    // Details & Initial State
    preferredDate: payload.preferredDate,
    problemDescription: payload.problemDescription,
    status: 'requested',
    finalAmount: null,
    paymentStatus: 'unpaid',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const insertResult = await bookingsCollection.insertOne(newBooking);
    return {
      success: true,
      data: {
        ...newBooking,
        _id: insertResult.insertedId,
      },
    };
  } catch (error: any) {
    // Concurrency race duplicate caught by idx_bookings_active_unique partial index
    if (error && (error.code === 11000 || error.message?.includes('E11000'))) {
      return {
        success: false,
        status: 409,
        message: 'You already have an active booking for this service.',
      };
    }
    throw error;
  }
}

/**
 * Customer gets their own bookings.
 */
export async function getCustomerBookings(
  customerUser: AuthenticatedUser,
  params: BookingQueryParams
) {
  const bookingsCollection = getBookingsCollection();
  const filter: Filter<BookingDocument> = {
    ...buildCustomerBookingOwnershipFilter(customerUser),
  };

  if (params.status) {
    filter.status = params.status;
  }

  const skip = (params.page - 1) * params.limit;

  const [bookings, totalCount] = await Promise.all([
    bookingsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .toArray(),
    bookingsCollection.countDocuments(filter),
  ]);

  return {
    bookings,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

/**
 * Customer gets single booking by ID.
 */
export async function getCustomerBookingById(
  customerUser: AuthenticatedUser,
  bookingId: string
): Promise<BookingDocument | null> {
  const bookingsCollection = getBookingsCollection();
  const parsedId = parseBookingId(bookingId);

  const filter: Filter<BookingDocument> = {
    _id: parsedId as unknown as ObjectId,
  };

  // Admins can inspect any customer booking; other roles are scoped to their owned bookings
  if (customerUser.role !== 'admin') {
    Object.assign(filter, buildCustomerBookingOwnershipFilter(customerUser));
  }

  return await bookingsCollection.findOne(filter);
}

/**
 * Customer cancels a booking. Only allowed if status === 'requested'.
 */
export async function cancelCustomerBooking(
  customerUser: AuthenticatedUser,
  bookingId: string
): Promise<BookingServiceResult> {
  const bookingsCollection = getBookingsCollection();
  const parsedId = parseBookingId(bookingId);
  const customerFilter = customerUser.role === 'admin'
    ? {}
    : buildCustomerBookingOwnershipFilter(customerUser);

  const now = new Date();

  // Atomic update checking status === 'requested'
  const updatedDoc = await bookingsCollection.findOneAndUpdate(
    {
      _id: parsedId as unknown as ObjectId,
      ...customerFilter,
      status: 'requested',
    },
    {
      $set: {
        status: 'cancelled',
        updatedAt: now,
      },
    },
    { returnDocument: 'after' }
  );

  if (updatedDoc) {
    return {
      success: true,
      data: updatedDoc,
    };
  }

  // Inspect existing document to return exact error (404 vs 409)
  const existing = await bookingsCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...customerFilter,
  });

  if (!existing) {
    return {
      success: false,
      status: 404,
      message: 'Booking not found.',
    };
  }

  return {
    success: false,
    status: 409,
    message: `Cannot cancel booking with current status "${existing.status}". Only requested bookings can be cancelled.`,
  };
}

/**
 * Technician gets their assigned bookings.
 */
export async function getTechnicianBookings(
  techUser: AuthenticatedUser,
  params: BookingQueryParams
) {
  const bookingsCollection = getBookingsCollection();
  const filter: Filter<BookingDocument> = {
    ...buildTechnicianBookingOwnershipFilter(techUser),
  };

  if (params.status) {
    filter.status = params.status;
  }

  const skip = (params.page - 1) * params.limit;

  const [bookings, totalCount] = await Promise.all([
    bookingsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .toArray(),
    bookingsCollection.countDocuments(filter),
  ]);

  return {
    bookings,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

/**
 * Technician gets single assigned booking by ID.
 */
export async function getTechnicianBookingById(
  techUser: AuthenticatedUser,
  bookingId: string
): Promise<BookingDocument | null> {
  const bookingsCollection = getBookingsCollection();
  const parsedId = parseBookingId(bookingId);

  return await bookingsCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...buildTechnicianBookingOwnershipFilter(techUser),
  });
}

/**
 * Technician lifecycle transitions:
 * requested -> accepted | rejected
 * accepted -> in-progress
 * in-progress -> completed (requires positive finalAmount)
 */
export async function updateTechnicianBookingStatus(
  techUser: AuthenticatedUser,
  bookingId: string,
  nextStatus: BookingStatus,
  finalAmount?: number
): Promise<BookingServiceResult> {
  const bookingsCollection = getBookingsCollection();
  const parsedId = parseBookingId(bookingId);
  const techFilter = buildTechnicianBookingOwnershipFilter(techUser);

  // Determine required current status
  let requiredCurrentStatus: BookingStatus | BookingStatus[];
  if (nextStatus === 'accepted' || nextStatus === 'rejected') {
    requiredCurrentStatus = 'requested';
  } else if (nextStatus === 'in-progress') {
    requiredCurrentStatus = 'accepted';
  } else if (nextStatus === 'completed') {
    requiredCurrentStatus = 'in-progress';
  } else {
    return {
      success: false,
      status: 400,
      message: `Invalid target status "${nextStatus}".`,
    };
  }

  const now = new Date();
  const updateFields: any = {
    status: nextStatus,
    updatedAt: now,
  };

  if (nextStatus === 'completed') {
    if (typeof finalAmount !== 'number' || isNaN(finalAmount) || finalAmount <= 0) {
      return {
        success: false,
        status: 400,
        message: 'finalAmount is required and must be a finite positive number when completing a booking.',
      };
    }
    updateFields.finalAmount = finalAmount;
    updateFields.paymentStatus = 'unpaid';
    updateFields.completedAt = now;
  }

  // Atomic state transition checking current status
  const updatedDoc = await bookingsCollection.findOneAndUpdate(
    {
      _id: parsedId as unknown as ObjectId,
      ...techFilter,
      status: requiredCurrentStatus,
    },
    {
      $set: updateFields,
    },
    { returnDocument: 'after' }
  );

  if (updatedDoc) {
    return {
      success: true,
      data: updatedDoc,
    };
  }

  // Check if booking exists for technician to return 404 or 409
  const existing = await bookingsCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...techFilter,
  });

  if (!existing) {
    return {
      success: false,
      status: 404,
      message: 'Booking not found.',
    };
  }

  return {
    success: false,
    status: 409,
    message: `Cannot transition booking from current status "${existing.status}" to "${nextStatus}". Required previous status is "${requiredCurrentStatus}".`,
  };
}

/**
 * Admin gets all bookings with filtering and pagination.
 */
export async function getAdminBookings(params: BookingQueryParams) {
  const bookingsCollection = getBookingsCollection();
  const filter: Filter<BookingDocument> = {};

  if (params.status) {
    filter.status = params.status;
  }

  const skip = (params.page - 1) * params.limit;

  const [bookings, totalCount] = await Promise.all([
    bookingsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .toArray(),
    bookingsCollection.countDocuments(filter),
  ]);

  return {
    bookings,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

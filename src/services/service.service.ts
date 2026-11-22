import { ObjectId, Filter, Sort } from 'mongodb';
import { getServicesCollection } from '../db/collections.js';
import type { ServiceDocument, ServiceApprovalStatus } from '../types/database.js';
import type { AuthenticatedUser } from '../types/auth.js';

export function escapeRegex(input: string, maxLength = 100): string {
  if (typeof input !== 'string') return '';
  return input.slice(0, maxLength).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseServiceId(id: string): ObjectId | string {
  const trimmed = id.trim();
  if (ObjectId.isValid(trimmed) && trimmed.length === 24) {
    return new ObjectId(trimmed);
  }
  return trimmed;
}

export function normalizeServiceDocument(doc: ServiceDocument): ServiceDocument {
  return {
    ...doc,
    image: doc.image || doc.imageUrl || '',
  };
}

/**
 * Builds ownership filter strictly anchored on the immutable technicianId.
 * A technician with a changed email retains ownership of their services.
 * Another technician with a different ID but same email cannot hijack ownership.
 * Fallback to technicianEmail is allowed ONLY for legacy records that completely lack technicianId.
 */
export function buildTechnicianOwnershipFilter(techUser: AuthenticatedUser): Filter<ServiceDocument> {
  const techId = techUser.id;
  const techEmail = techUser.email.toLowerCase();

  const idConditions: Filter<ServiceDocument>[] = [
    { technicianId: techId },
  ];

  if (ObjectId.isValid(techId) && techId.length === 24) {
    idConditions.push({ technicianId: new ObjectId(techId) });
  }

  // Allow email fallback ONLY for legacy records that completely lack technicianId
  idConditions.push({
    technicianEmail: techEmail,
    technicianId: { $in: [null as any, undefined as any] },
  });

  return { $or: idConditions };
}

export interface PublicServiceQueryParams {
  search?: string;
  category?: string;
  serviceMode?: 'onsite' | 'remote' | 'both';
  minPrice?: number;
  maxPrice?: number;
  sort: 'newest' | 'price_asc' | 'price_desc';
  page: number;
  limit: number;
}

export async function getPublicServices(params: PublicServiceQueryParams) {
  const servicesCollection = getServicesCollection();
  const filter: Filter<ServiceDocument> = {
    approvalStatus: 'approved',
    isAvailable: true,
  };

  if (params.category) {
    filter.category = params.category;
  }

  if (params.serviceMode) {
    filter.serviceMode = params.serviceMode;
  }

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    filter.basePrice = {};
    if (params.minPrice !== undefined) {
      filter.basePrice.$gte = params.minPrice;
    }
    if (params.maxPrice !== undefined) {
      filter.basePrice.$lte = params.maxPrice;
    }
  }

  if (params.search && params.search.trim().length > 0) {
    const escaped = escapeRegex(params.search.trim());
    filter.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
    ];
  }

  let sortOption: Sort = { createdAt: -1 };
  if (params.sort === 'price_asc') {
    sortOption = { basePrice: 1 };
  } else if (params.sort === 'price_desc') {
    sortOption = { basePrice: -1 };
  }

  const skip = (params.page - 1) * params.limit;

  const [rawServices, totalCount] = await Promise.all([
    servicesCollection.find(filter).sort(sortOption).skip(skip).limit(params.limit).toArray(),
    servicesCollection.countDocuments(filter),
  ]);

  const services = rawServices.map(normalizeServiceDocument);

  return {
    services,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

export async function getPublicServiceById(id: string): Promise<ServiceDocument | null> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);

  const doc = await servicesCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    approvalStatus: 'approved',
    isAvailable: true,
  });

  return doc ? normalizeServiceDocument(doc) : null;
}

export async function createTechnicianService(
  techUser: AuthenticatedUser,
  payload: Omit<ServiceDocument, '_id' | 'technicianId' | 'technicianName' | 'technicianEmail' | 'approvalStatus' | 'isAvailable' | 'createdAt' | 'updatedAt'>
): Promise<ServiceDocument> {
  const servicesCollection = getServicesCollection();
  const now = new Date();

  const newService: ServiceDocument = {
    ...payload,
    image: payload.image,
    imageUrl: payload.image, // Backwards compatibility for legacy consumers
    technicianId: techUser.id,
    technicianName: techUser.name || 'Technician',
    technicianEmail: techUser.email.toLowerCase(),
    approvalStatus: 'pending', // Server-forced rule: new services always start as pending
    isAvailable: true,          // Server-forced rule: new services start as available
    createdAt: now,
    updatedAt: now,
  };

  const insertResult = await servicesCollection.insertOne(newService);
  return normalizeServiceDocument({
    ...newService,
    _id: insertResult.insertedId,
  });
}

export async function getTechnicianServices(
  techUser: AuthenticatedUser,
  params: { approvalStatus?: ServiceApprovalStatus; page: number; limit: number }
) {
  const servicesCollection = getServicesCollection();
  const ownershipFilter = buildTechnicianOwnershipFilter(techUser);

  const filter: Filter<ServiceDocument> = {
    ...ownershipFilter,
  };

  if (params.approvalStatus) {
    filter.approvalStatus = params.approvalStatus;
  }

  const skip = (params.page - 1) * params.limit;

  const [rawServices, totalCount] = await Promise.all([
    servicesCollection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(params.limit).toArray(),
    servicesCollection.countDocuments(filter),
  ]);

  const services = rawServices.map(normalizeServiceDocument);

  return {
    services,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

export async function getTechnicianServiceById(
  techUser: AuthenticatedUser,
  id: string
): Promise<ServiceDocument | null> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);
  const ownershipFilter = buildTechnicianOwnershipFilter(techUser);

  const doc = await servicesCollection.findOne({
    _id: parsedId as unknown as ObjectId,
    ...ownershipFilter,
  });

  return doc ? normalizeServiceDocument(doc) : null;
}

export async function updateTechnicianService(
  techUser: AuthenticatedUser,
  id: string,
  updateFields: Partial<ServiceDocument>
): Promise<ServiceDocument | null> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);
  const ownershipFilter = buildTechnicianOwnershipFilter(techUser);

  // Critical rule: Technician content edits return approvalStatus to 'pending'
  const updatePayload = {
    ...updateFields,
    ...(updateFields.image ? { image: updateFields.image, imageUrl: updateFields.image } : {}),
    approvalStatus: 'pending' as ServiceApprovalStatus,
    updatedAt: new Date(),
  };

  const filter: Filter<ServiceDocument> = {
    _id: parsedId as unknown as ObjectId,
    ...ownershipFilter,
  };

  const result = await servicesCollection.findOneAndUpdate(
    filter,
    { $set: updatePayload },
    { returnDocument: 'after' }
  );

  return result ? normalizeServiceDocument(result) : null;
}

export async function updateTechnicianServiceAvailability(
  techUser: AuthenticatedUser,
  id: string,
  isAvailable: boolean
): Promise<ServiceDocument | null> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);
  const ownershipFilter = buildTechnicianOwnershipFilter(techUser);

  // Rule: Toggling availability alone does NOT alter approvalStatus
  const filter: Filter<ServiceDocument> = {
    _id: parsedId as unknown as ObjectId,
    ...ownershipFilter,
  };

  const result = await servicesCollection.findOneAndUpdate(
    filter,
    {
      $set: {
        isAvailable,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  return result ? normalizeServiceDocument(result) : null;
}

export async function deleteTechnicianService(
  techUser: AuthenticatedUser,
  id: string
): Promise<boolean> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);
  const ownershipFilter = buildTechnicianOwnershipFilter(techUser);

  const filter: Filter<ServiceDocument> = {
    _id: parsedId as unknown as ObjectId,
    ...ownershipFilter,
  };

  const result = await servicesCollection.deleteOne(filter);
  return result.deletedCount > 0;
}

export async function getAdminServices(params: {
  approvalStatus?: ServiceApprovalStatus;
  category?: string;
  search?: string;
  page: number;
  limit: number;
}) {
  const servicesCollection = getServicesCollection();
  const filter: Filter<ServiceDocument> = {};

  if (params.approvalStatus) {
    filter.approvalStatus = params.approvalStatus;
  }

  if (params.category) {
    filter.category = params.category;
  }

  if (params.search && params.search.trim().length > 0) {
    const escaped = escapeRegex(params.search.trim());
    filter.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
      { technicianName: { $regex: escaped, $options: 'i' } },
      { technicianEmail: { $regex: escaped, $options: 'i' } },
    ];
  }

  const skip = (params.page - 1) * params.limit;

  const [rawServices, totalCount] = await Promise.all([
    servicesCollection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(params.limit).toArray(),
    servicesCollection.countDocuments(filter),
  ]);

  const services = rawServices.map(normalizeServiceDocument);

  return {
    services,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit) || 1,
  };
}

export async function moderateServiceApproval(
  id: string,
  approvalStatus: 'approved' | 'rejected',
  moderationNotes?: string
): Promise<ServiceDocument | null> {
  const servicesCollection = getServicesCollection();
  const parsedId = parseServiceId(id);

  const updateSet: Partial<ServiceDocument> = {
    approvalStatus,
    updatedAt: new Date(),
    ...(moderationNotes !== undefined ? { moderationNotes } : {}),
  };

  const result = await servicesCollection.findOneAndUpdate(
    { _id: parsedId as unknown as ObjectId },
    { $set: updateSet },
    { returnDocument: 'after' }
  );

  return result ? normalizeServiceDocument(result) : null;
}

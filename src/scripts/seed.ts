import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import { ObjectId } from 'mongodb';
import { connectDB } from '../db/connection.js';
import {
  getUsersCollection,
  getServicesCollection,
  getBookingsCollection,
  getPaymentsCollection,
} from '../db/collections.js';
import { initAuth } from '../auth/auth.js';
import type { ServiceDocument, BookingDocument, PaymentDocument } from '../types/database.js';

async function seed() {
  console.log('--- Starting FixMate Database Seeding ---');
  const db = await connectDB();
  const auth = initAuth(db);

  const usersCollection = getUsersCollection();
  const servicesCollection = getServicesCollection();
  const bookingsCollection = getBookingsCollection();
  const paymentsCollection = getPaymentsCollection();

  // Clear existing collections safely
  console.log('Cleaning existing domain data...');
  await servicesCollection.deleteMany({});
  await bookingsCollection.deleteMany({});
  await paymentsCollection.deleteMany({});

  console.log('Creating examiner accounts via BetterAuth...');

  const userSeedDefs = [
    {
      name: 'Alex Rivera (FixMate Admin)',
      email: 'admin@fixmate.io',
      password: 'Password123!',
      role: 'admin' as const,
      phone: '+1 (555) 019-8800',
      area: 'Austin Central HQ',
      bio: 'Executive Operations and Service Quality Assurance Administrator.',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    },
    {
      name: 'Marcus Vance (Master Tech)',
      email: 'marcus.tech@fixmate.io',
      password: 'Password123!',
      role: 'technician' as const,
      phone: '+1 (555) 012-3456',
      area: 'Metro Austin & North Suburbs',
      bio: 'Certified electronics engineer with 12+ years experience in micro-soldering, board-level smartphone logic repairs, and high-end display replacements.',
      specialties: ['Smartphone', 'Laptop & PC', 'TV'],
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    },
    {
      name: 'Elena Rostova (Senior Appliance Pro)',
      email: 'elena.tech@fixmate.io',
      password: 'Password123!',
      role: 'technician' as const,
      phone: '+1 (555) 019-7890',
      area: 'Austin South & West Lake',
      bio: 'Licensed HVAC technician and EPA Universal certified specialist focusing on inverter ACs, smart refrigerators, and high-efficiency washing machine restoration.',
      specialties: ['AC', 'Refrigerator', 'Washing Machine', 'Electrical'],
      avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
    },
    {
      name: 'Sarah Jenkins (Customer)',
      email: 'customer@fixmate.io',
      password: 'Password123!',
      role: 'customer' as const,
      phone: '+1 (555) 014-9922',
      area: 'Downtown Austin',
      bio: 'FixMate verified residential customer.',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
    },
    {
      name: 'John Doe',
      email: 'john.doe@fixmate.io',
      password: 'Password123!',
      role: 'customer' as const,
      phone: '+1 (555) 017-3311',
      area: 'Cedar Park',
      bio: 'Tech enthusiast and device repair client.',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    },
  ];

  const userMap: Record<string, any> = {};

  for (const u of userSeedDefs) {
    try {
      // Create user with BetterAuth to generate password hash and session structures
      await auth.api.signUpEmail({
        body: {
          name: u.name,
          email: u.email,
          password: u.password,
        },
      });
    } catch {
      // If already registered, ignore and update
    }

    // Authoritatively set role, phone, area, bio, and specialties
    const updated = await usersCollection.findOneAndUpdate(
      { email: u.email.toLowerCase() },
      {
        $set: {
          name: u.name,
          role: u.role,
          phone: u.phone,
          area: u.area,
          bio: u.bio,
          avatarUrl: u.avatarUrl,
          specialties: (u as any).specialties || [],
          isAvailable: true,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (updated) {
      userMap[u.email] = updated;
      console.log(`✓ Account ready: ${u.email} [${u.role}] (ID: ${updated._id || (updated as any).id})`);
    }
  }

  const techMarcus = userMap['marcus.tech@fixmate.io'];
  const techElena = userMap['elena.tech@fixmate.io'];
  const custSarah = userMap['customer@fixmate.io'];

  const marcusId = techMarcus._id ? techMarcus._id.toString() : (techMarcus as any).id;
  const elenaId = techElena._id ? techElena._id.toString() : (techElena as any).id;
  const sarahId = custSarah._id ? custSarah._id.toString() : (custSarah as any).id;

  console.log('\nSeeding 14 Approved Services across all 7 assignment categories...');

  const now = new Date();

  const servicesData: Partial<ServiceDocument>[] = [
    // 1. Smartphone (Marcus)
    {
      title: 'iPhone 13 / 14 / 15 OLED Screen & Digitizer Replacement',
      category: 'Smartphone',
      description: 'Factory-grade OLED panel replacement restoring 120Hz ProMotion and TrueTone calibration. Includes oleophobic coating and water-resistant perimeter seal with zero touch ghosting.',
      image: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?auto=format&fit=crop&w=1000&q=80',
      basePrice: 89.0,
      estimatedDuration: '45-60 mins',
      serviceMode: 'Home Visit',
      serviceArea: 'Metro Austin, Round Rock & Pflugerville',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 10 * 86400000),
      updatedAt: now,
    },
    // 2. Smartphone (Marcus)
    {
      title: 'Samsung Galaxy Ultra Logic Board & Charge Port Micro-soldering',
      category: 'Smartphone',
      description: 'Advanced SMD micro-soldering resolving no-charge, boot-loop, or power management IC failures. Conducted under microscope with post-repair thermal imaging diagnostics.',
      image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1000&q=80',
      basePrice: 110.0,
      estimatedDuration: '2-3 hours',
      serviceMode: 'Shop Drop-off',
      serviceArea: 'Central Austin Lab',
      turnaroundTime: '24 Hours',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 9 * 86400000),
      updatedAt: now,
    },
    // 3. Laptop & PC (Marcus)
    {
      title: 'MacBook Pro Apple Silicon Liquid Damage & Board Diagnostics',
      category: 'Laptop & PC',
      description: 'Ultrasonic board cleaning, corroded trace re-bridging, and power rail diagnostics for liquid-exposed M1/M2/M3 MacBooks. Preserves internal SSD data integrity.',
      image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1000&q=80',
      basePrice: 145.0,
      estimatedDuration: '1-2 business days',
      serviceMode: 'Shop Drop-off',
      serviceArea: 'Austin Central Lab',
      turnaroundTime: '48 Hours',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 8 * 86400000),
      updatedAt: now,
    },
    // 4. Laptop & PC (Marcus)
    {
      title: 'Precision Thermal Overhaul & Fan Replacement for Gaming Laptops',
      category: 'Laptop & PC',
      description: 'Complete heatsink de-dusting, high-performance Honeywell PTM7950 phase-change thermal pad application, and dual blower fan replacement. Drops GPU/CPU thermal throttling by up to 18°C.',
      image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?auto=format&fit=crop&w=1000&q=80',
      basePrice: 65.0,
      estimatedDuration: '90 mins',
      serviceMode: 'Home Visit',
      serviceArea: 'Greater Austin & Surrounding Areas',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 7 * 86400000),
      updatedAt: now,
    },
    // 5. AC (Elena)
    {
      title: 'Inverter Split AC Comprehensive Deep Clean & Chemical Flush',
      category: 'AC',
      description: 'High-pressure anti-bacterial chemical jet wash of evaporator coils, blower fan barrel, and drain pan. Removes mold spores, eliminates odor, and maximizes cooling airflow efficiency.',
      image: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1000&q=80',
      basePrice: 75.0,
      estimatedDuration: '2 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Austin Metro, Westlake & Buda',
      turnaroundTime: 'Same Day / 24h',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 6 * 86400000),
      updatedAt: now,
    },
    // 6. AC (Elena)
    {
      title: 'AC Inverter Compressor Diagnostic, Leak Seal & R410A Eco Refill',
      category: 'AC',
      description: 'Nitrogen pressure leak detection, copper braze re-soldering, vacuum decay test, and digital manifold precision R410A gas charge according to manufacturer sub-cooling specs.',
      image: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=1000&q=80',
      basePrice: 125.0,
      estimatedDuration: '2-3 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Travis & Williamson County',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 5 * 86400000),
      updatedAt: now,
    },
    // 7. Refrigerator (Elena)
    {
      title: 'French-Door Smart Refrigerator Cooling & Defrost Sensor Repair',
      category: 'Refrigerator',
      description: 'Diagnostic troubleshooting of evaporator freeze-up, faulty bi-metal defrost thermostats, thermal fuses, and evaporator fan motors for Samsung, LG, and Whirlpool refrigerators.',
      image: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=1000&q=80',
      basePrice: 95.0,
      estimatedDuration: '90 mins',
      serviceMode: 'Home Visit',
      serviceArea: 'Austin South, Downtown & Barton Creek',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 5 * 86400000),
      updatedAt: now,
    },
    // 8. Refrigerator (Elena)
    {
      title: 'Inverter Refrigerator Compressor Replacement & R600a Purge',
      category: 'Refrigerator',
      description: 'EPA certified recovery and safe installation of linear inverter compressors using ultrasonic swaging and lockring technology with precise R600a refrigerant charging.',
      image: 'https://images.unsplash.com/photo-1584992236310-6edddc08acff?auto=format&fit=crop&w=1000&q=80',
      basePrice: 160.0,
      estimatedDuration: '3 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Greater Austin Metro',
      turnaroundTime: '24 Hours',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 4 * 86400000),
      updatedAt: now,
    },
    // 9. TV (Marcus)
    {
      title: '4K OLED & QLED TV Backlight & Mainboard Precision Repair',
      category: 'TV',
      description: 'Component-level repair of sound-without-picture, intermittent power shutdowns, and distorted HDMI input ports. Replaces burnt LED strips with factory OEM assemblies.',
      image: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&w=1000&q=80',
      basePrice: 99.0,
      estimatedDuration: '2-4 hours',
      serviceMode: 'Shop Drop-off',
      serviceArea: 'Austin Display Workshop',
      turnaroundTime: '24-48 Hours',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 4 * 86400000),
      updatedAt: now,
    },
    // 10. TV (Marcus)
    {
      title: 'Smart TV Power Board Surge Protection & Capacitor Refurbishment',
      category: 'TV',
      description: 'On-site power supply module diagnostics for TVs failing to power on after electrical storms. Replaces blown Schottky diodes, MOSFET switches, and filter capacitors.',
      image: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=1000&q=80',
      basePrice: 85.0,
      estimatedDuration: '1-2 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Central Austin & Surrounds',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      createdAt: new Date(now.getTime() - 3 * 86400000),
      updatedAt: now,
    },
    // 11. Washing Machine (Elena)
    {
      title: 'Front-Load Washing Machine Drum Bearing & Damper Overhaul',
      category: 'Washing Machine',
      description: 'Resolves loud jet-engine rumbling during high spin cycles. Replaces dual rear tub bearings, heavy-duty shaft seal, and hydraulic shock dampers with genuine OEM kits.',
      image: 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=1000&q=80',
      basePrice: 115.0,
      estimatedDuration: '2.5 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Austin Metro & Lakeway',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 3 * 86400000),
      updatedAt: now,
    },
    // 12. Washing Machine (Elena)
    {
      title: 'Washing Machine Drain Pump, Door Lock & PCB Controller Replacement',
      category: 'Washing Machine',
      description: 'Fixes OE/5E drain error codes, locked door switches, and unresponsive wash cycle selection boards. Clears drain impeller obstructions and calibrates water level pressure switch.',
      image: 'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&w=1000&q=80',
      basePrice: 80.0,
      estimatedDuration: '1 hour',
      serviceMode: 'Home Visit',
      serviceArea: 'Austin & Cedar Park',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 2 * 86400000),
      updatedAt: now,
    },
    // 13. Electrical (Elena)
    {
      title: 'Main Service Panel Inspection & Whole-House Surge Protector Install',
      category: 'Electrical',
      description: 'Comprehensive thermal infrared scan of breaker buses, neutral ground bonding check, and installation of Type 2 50kA whole-home surge protector safeguarding appliances.',
      image: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=1000&q=80',
      basePrice: 130.0,
      estimatedDuration: '2 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'All Austin Municipal Areas',
      turnaroundTime: 'Next Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 2 * 86400000),
      updatedAt: now,
    },
    // 14. Electrical (Elena)
    {
      title: 'Pure Sine Wave Inverter & Home Battery Backup System Diagnostic',
      category: 'Electrical',
      description: 'Complete battery state-of-health impedance testing, automatic transfer switch (ATS) calibration, and inverter MOSFET voltage regulator servicing for uninterrupted domestic power.',
      image: 'https://images.unsplash.com/photo-1558441719-8b489c634a10?auto=format&fit=crop&w=1000&q=80',
      basePrice: 90.0,
      estimatedDuration: '1.5 hours',
      serviceMode: 'Home Visit',
      serviceArea: 'Austin & Hill Country',
      turnaroundTime: 'Same Day',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      createdAt: new Date(now.getTime() - 1 * 86400000),
      updatedAt: now,
    },
  ];

  const insertedServices = await servicesCollection.insertMany(servicesData as any);
  const serviceIds = Object.values(insertedServices.insertedIds);
  console.log(`✓ Inserted ${serviceIds.length} approved services.`);

  console.log('\nSeeding multi-status bookings connected to Sarah Jenkins (customer@fixmate.io)...');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const bookingsData: Partial<BookingDocument>[] = [
    // 1. Requested status (Marcus)
    {
      serviceId: serviceIds[0],
      serviceTitle: servicesData[0].title!,
      serviceCategory: servicesData[0].category!,
      serviceImage: servicesData[0].image,
      basePrice: servicesData[0].basePrice!,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: tomorrow,
      problemDescription: 'iPhone 14 Pro dropped on pavement. Glass is shattered and top touch quadrant is unresponsive.',
      status: 'requested',
      finalAmount: null,
      paymentStatus: 'unpaid',
      createdAt: new Date(now.getTime() - 2 * 3600000),
      updatedAt: new Date(now.getTime() - 2 * 3600000),
    },
    // 2. Accepted status (Elena)
    {
      serviceId: serviceIds[4],
      serviceTitle: servicesData[4].title!,
      serviceCategory: servicesData[4].category!,
      serviceImage: servicesData[4].image,
      basePrice: servicesData[4].basePrice!,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: new Date(now.getTime() + 2 * 86400000),
      problemDescription: 'Living room split AC airflow has weakened significantly and smells musty upon starting.',
      status: 'accepted',
      finalAmount: null,
      paymentStatus: 'unpaid',
      createdAt: new Date(now.getTime() - 5 * 3600000),
      updatedAt: new Date(now.getTime() - 1 * 3600000),
    },
    // 3. In-Progress status (Marcus)
    {
      serviceId: serviceIds[2],
      serviceTitle: servicesData[2].title!,
      serviceCategory: servicesData[2].category!,
      serviceImage: servicesData[2].image,
      basePrice: servicesData[2].basePrice!,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: now,
      problemDescription: 'MacBook Pro had coffee spill near MagSafe port. Diagnostics currently on bench.',
      status: 'in-progress',
      finalAmount: null,
      paymentStatus: 'unpaid',
      createdAt: new Date(now.getTime() - 12 * 3600000),
      updatedAt: new Date(now.getTime() - 30 * 60000),
    },
    // 4. Completed & Unpaid (Elena) -> Ready to test Stripe Checkout Redirect!
    {
      serviceId: serviceIds[6],
      serviceTitle: servicesData[6].title!,
      serviceCategory: servicesData[6].category!,
      serviceImage: servicesData[6].image,
      basePrice: servicesData[6].basePrice!,
      technicianId: elenaId,
      technicianName: techElena.name,
      technicianEmail: techElena.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: new Date(now.getTime() - 24 * 3600000),
      problemDescription: 'Samsung French-Door Refrigerator was freezing up. Defrost sensor and bi-metal heater replaced.',
      status: 'completed',
      finalAmount: 110.0,
      paymentStatus: 'unpaid',
      completedAt: new Date(now.getTime() - 2 * 3600000),
      createdAt: new Date(now.getTime() - 26 * 3600000),
      updatedAt: new Date(now.getTime() - 2 * 3600000),
    },
    // 5. Completed & Paid (Marcus) -> Settled with Stripe Payment
    {
      serviceId: serviceIds[8],
      serviceTitle: servicesData[8].title!,
      serviceCategory: servicesData[8].category!,
      serviceImage: servicesData[8].image,
      basePrice: servicesData[8].basePrice!,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: new Date(now.getTime() - 4 * 86400000),
      problemDescription: 'LG 65-inch 4K TV had sound but dark screen. Backlight arrays replaced and fully tested.',
      status: 'completed',
      finalAmount: 99.0,
      paymentStatus: 'paid',
      stripeSessionId: 'cs_test_seed_settled_001',
      completedAt: new Date(now.getTime() - 3 * 86400000),
      createdAt: new Date(now.getTime() - 4 * 86400000),
      updatedAt: new Date(now.getTime() - 3 * 86400000),
    },
    // 6. Cancelled status
    {
      serviceId: serviceIds[1],
      serviceTitle: servicesData[1].title!,
      serviceCategory: servicesData[1].category!,
      serviceImage: servicesData[1].image,
      basePrice: servicesData[1].basePrice!,
      technicianId: marcusId,
      technicianName: techMarcus.name,
      technicianEmail: techMarcus.email,
      customerId: sarahId,
      customerName: custSarah.name,
      customerEmail: custSarah.email,
      customerPhone: custSarah.phone || '+1 555-014-9922',
      address: '742 Evergreen Terrace, Austin, TX 78701',
      preferredDate: new Date(now.getTime() - 6 * 86400000),
      problemDescription: 'Client upgraded phone and cancelled the repair request.',
      status: 'cancelled',
      finalAmount: null,
      paymentStatus: 'unpaid',
      createdAt: new Date(now.getTime() - 7 * 86400000),
      updatedAt: new Date(now.getTime() - 6 * 86400000),
    },
  ];

  const insertedBookings = await bookingsCollection.insertMany(bookingsData as any);
  const bookingIds = Object.values(insertedBookings.insertedIds);
  console.log(`✓ Inserted ${bookingIds.length} bookings covering all lifecycle stages.`);

  // Insert payment record for Booking 5
  console.log('\nSeeding settled Stripe transaction record for paid booking...');
  const paidBookingId = bookingIds[4];
  const paymentRecord: PaymentDocument = {
    bookingId: paidBookingId,
    serviceTitle: bookingsData[4].serviceTitle!,
    customerId: sarahId,
    customerName: custSarah.name,
    customerEmail: custSarah.email,
    technicianId: marcusId,
    technicianName: techMarcus.name,
    technicianEmail: techMarcus.email,
    amount: 99.0,
    currency: 'usd',
    transactionId: 'pi_test_3N8291FxMtSettled001',
    stripeSessionId: 'cs_test_seed_settled_001',
    stripePaymentIntentId: 'pi_test_3N8291FxMtSettled001',
    paymentStatus: 'paid',
    paidAt: new Date(now.getTime() - 3 * 86400000),
    createdAt: new Date(now.getTime() - 3 * 86400000),
  };

  await paymentsCollection.insertOne(paymentRecord);
  console.log('✓ Inserted Stripe payment record.');

  console.log('\n======================================================');
  console.log('--- FIXMATE SEEDING COMPLETED SUCCESSFULLY ---');
  console.log('======================================================');
  console.log('Examiner Credentials:');
  console.log('1. Admin:      admin@fixmate.io       / Password123!');
  console.log('2. Tech 1:     marcus.tech@fixmate.io / Password123!');
  console.log('3. Tech 2:     elena.tech@fixmate.io  / Password123!');
  console.log('4. Customer:   customer@fixmate.io    / Password123!');
  console.log('======================================================\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

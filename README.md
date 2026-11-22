# FixMate — Smart Device & Home Appliance Repair Platform (Backend API)

FixMate API is a robust, production-ready REST service built with Express 5, TypeScript, native MongoDB driver, BetterAuth authentication with JWT role verification, and Stripe Checkout SDK.

---

## 🚀 Live API Deployment & Links

- **Production API Base:** `https://fixmate-server-h0gr.onrender.com/api`
- **Health Check Endpoint:** `https://fixmate-server-h0gr.onrender.com/api/health`
- **Frontend Client (Live Site):** `https://fixmate23.vercel.app`
- **GitHub Server Repository:** `https://github.com/umaer-islam/fixmate-server`
- **GitHub Client Repository:** `https://github.com/umaer-islam/fixmate-client`
- **Author:** Umaer Islam (umaerislam23@gmail.com)

---

## 🔑 Examiner Test Accounts

The MongoDB database is pre-seeded with test accounts across all three platform roles:

| Role | Email | Password | Responsibilities |
|---|---|---|---|
| **Admin** | `admin@fixmate.io` | `Password123!` | Service moderation, user inspection, full payment ledger audit |
| **Technician 1** | `marcus.tech@fixmate.io` | `Password123!` | Smartphone & Laptop repairs, booking queue lifecycle |
| **Technician 2** | `elena.tech@fixmate.io` | `Password123!` | Home appliance repairs (AC, Refrigerator, Electrical) |
| **Customer** | `customer@fixmate.io` | `Password123!` | Zero-upfront repair bookings, Stripe checkout settlement |

To re-seed the live database at any time:
```bash
npm run seed
```

---

## 🗄️ Database Architecture & Collections

FixMate operates on four domain collections in MongoDB Atlas, in addition to internal BetterAuth authentication collections:

1. `users` — Stores customer, technician, and administrator identities, profile metadata (phone, area, bio, avatar), and roles.
2. `services` — Repair service offerings including category, serviceMode (`Home Visit`, `Shop Drop-off`), base price, duration, and moderation status (`approved`, `pending`, `rejected`).
3. `bookings` — Service contracts with immutable service snapshots, customer contact and location info, lifecycle stage (`requested`, `accepted`, `in-progress`, `completed`, `cancelled`, `rejected`), and payment status (`unpaid`, `paid`).
4. `payments` — Audited transaction ledger recording Stripe session and payment intent IDs, customer and technician emails, settled amounts, and timestamps.

### Critical Database Indexes
- **`idx_bookings_active_unique`**:
  - Keys: `{ customerId: 1, serviceId: 1 }`
  - `unique: true`
  - Partial Filter: `status: { $in: ['requested', 'accepted', 'in-progress'] }`
  - *Guarantees that a customer cannot open duplicate concurrent repair jobs for the same service while one is still active.*
- **`idx_services_category_mode`**: Compound index on `{ category: 1, serviceMode: 1, isApproved: 1 }`.
- **`idx_payments_stripe_session`**: Unique index on `{ stripeSessionId: 1 }` for idempotent payment processing.

---

## 📡 Authoritative REST API Endpoints

### 1. Authentication & User Profile
- `POST /api/auth/sign-in/email` — Authenticate with email and password, receives JWT token.
- `POST /api/auth/sign-up/email` — Register new customer or technician.
- `GET /api/users/profile` — Retrieve authenticated user profile.
- `PUT /api/users/profile` — Update phone, area, bio, and avatar.
- `GET /api/users` — Admin endpoint to inspect all registered platform accounts.

### 2. Service Management
- `GET /api/services` — Public catalog with search, category, mode, sort, and pagination.
- `GET /api/services/:id` — Public single service detail with technician snapshot.
- `POST /api/services` — Technician creates a new repair listing (defaults to pending moderation).
- `PUT /api/services/:id` — Technician updates own listing (or Admin updates any).
- `DELETE /api/services/:id` — Technician deletes own service.
- `GET /api/services/technician/my` — Retrieve all services listed by the authenticated technician.
- `PATCH /api/services/:id/moderate` — Admin approves or rejects a service listing.

### 3. Booking Lifecycle
- `POST /api/bookings` — Customer creates a repair request with zero upfront fee.
- `GET /api/bookings/my` — Customer retrieves their booking history.
- `GET /api/bookings/:id` — Retrieve single booking details (ownership enforced).
- `GET /api/bookings/technician/queue` — Technician retrieves assigned requests.
- `PATCH /api/bookings/:id/status` — Technician transitions status (`accepted`, `in-progress`, `completed` with final amount).
- `PATCH /api/bookings/:id/cancel` — Customer cancels a booking in `requested` status.
- `GET /api/bookings/admin/all` — Admin inspects all bookings across the platform.

### 4. Stripe Checkout & Payments
- `POST /api/payments/create-checkout-session` — Customer initializes Stripe Checkout for a completed, unpaid booking.
- `POST /api/payments/verify-session` — Cryptographically verifies Stripe Checkout session return URL and confirms payment.
- `POST /api/payments/webhook` — Stripe raw webhook listener updating booking to `paid` and creating `PaymentDocument`.
- `GET /api/payments/admin/all` — Admin retrieves complete financial transaction ledger.

### 5. Media Upload & Health
- `POST /api/upload/image` — Upload diagnostic images / avatars to ImgBB cloud storage.
- `GET /api/health` — Platform status, database connection, and uptime health check.

---

## 🛠️ Environment Configuration

```env
NODE_ENV=production
PORT=5000
DATABASE_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/fixmate?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_key_here
CLIENT_URL=https://fixmate-client.vercel.app
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
IMGBB_API_KEY=your_imgbb_key_here
```

---

## 💻 Local Setup & Execution

```bash
# 1. Install dependencies
npm install

# 2. Seed database with examiner accounts and services
npm run seed

# 3. Start development server
npm run dev

# 4. Compile production build
npm run build
npm start
```

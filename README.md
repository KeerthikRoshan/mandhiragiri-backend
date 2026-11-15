# Mandhiragiri Jothidam – Backend API

> Production-ready, enterprise-grade RESTful backend for **Mandhiragiri Jothidam**, built with Node.js, Express.js, and MySQL.

---

## 1. Architectural Overview

The backend is built adhering to the strict layered request lifecycle:

```text
Routes → Validation → Middleware → Controller → Service → Model → MySQL
```

### Architectural Principles & Layer Responsibilities

- **Routes (`src/routes/`)**: Define RESTful API endpoints and map them to validator chains, middleware, and controllers.
- **Validators (`src/validators/`)**: Strict request body and parameter validation using `express-validator` to reject malformed input before controller execution.
- **Middleware (`src/middleware/`)**: Authentication (`JWT`), Role-Based Access Control (`RBAC`), rate limiting, request logging, and centralized error handling.
- **Controllers (`src/controllers/`)**: Handle HTTP request extraction, status codes, and standard responses. Controllers contain **zero** business logic and **zero** direct SQL.
- **Services (`src/services/`)**: Encapsulate all business logic, password verification, token generation, session lifecycle, and domain rules. Contains **zero** direct SQL.
- **Models (`src/models/`)**: Execute parameterized MySQL queries using `mysql2/promise` connection pool. Protects against SQL injection.
- **Utils (`src/utils/`)**: Standardized API response wrappers (`sendSuccess`, `sendError`), custom error classes (`ApiError`), cryptographic and token utilities.

---

## 2. Prerequisites

- **Node.js**: `v18.x` or `v20.x` LTS
- **npm**: `v9.x` or `v10.x`
- **XAMPP for Windows**: Running Apache and MySQL (`MariaDB 10.4+` / `MySQL 8.0+`)
- **PowerShell**: Windows PowerShell 5.1 or PowerShell 7+

---

## 3. Local Setup Instructions (XAMPP & Windows)

### Step 1: Start MySQL in XAMPP
1. Open the **XAMPP Control Panel**.
2. Click **Start** next to **MySQL**.
3. Verify that MySQL is running on port `3308` (default).

> *Note: By default in XAMPP, the MySQL root user has no password (`password: ""`).*

### Step 2: Install Node Dependencies
Open PowerShell in the project root (`mandhiragiri-backend`) and run:

```powershell
npm install
```

### Step 3: Configure Environment Variables
Copy the `.env.example` file to create your local `.env`:

```powershell
Copy-Item .env.example .env
```

Verify your `.env` configuration:

```env
# Server Configuration
NODE_ENV=development
PORT=5000
CORS_ORIGIN=*

# MySQL Database (XAMPP Default)
DB_HOST=127.0.0.1
DB_PORT=3308
DB_USER=root
DB_PASSWORD=
DB_NAME=mandhiragiri_db
DB_CONNECTION_LIMIT=10

# JWT Security
JWT_ACCESS_SECRET=mandhiragiri_jwt_access_secret_key_change_in_production_2026!
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY_DAYS=7

# Initial Super Admin Seed Credentials
SUPER_ADMIN_NAME="Super Admin"
SUPER_ADMIN_MOBILE=9876543210
SUPER_ADMIN_PASSWORD=Admin@1234
SUPER_ADMIN_EMAIL=admin@mandhiragiri.com
```

### Step 4: Run Database Migrations
Execute the automated migration runner. This automatically creates the database `mandhiragiri_db` (if it does not already exist) and runs all migration files idempotently:

```powershell
npm run migrate
```

### Step 5: Seed Super Admin & RBAC Roles
Seed the predefined roles (`SUPER_ADMIN`, `ADMIN`, `PRIEST`, `ASSISTANT`), granular permissions, and initial Super Admin user:

```powershell
npm run seed:admin
```

> *Note: The seeder is idempotent and safe to run multiple times. It will never overwrite an existing Super Admin password.*

### Step 6: Start the Development Server

```powershell
npm run dev
```

The server will start with hot-reloading enabled at `http://localhost:5000`.

---

## 4. Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts server with `nodemon` for local development. |
| `npm run start` | Starts server in production mode with standard `node`. |
| `npm run migrate` | Executes pending database schema migrations. |
| `npm run seed:admin` | Seeds initial roles, permissions, and Super Admin user safely. |
| `npm run panchang:import -- --start YYYY-MM-DD --end YYYY-MM-DD --location Madurai --lat 9.9252 --lon 78.1198 --timezone Asia/Kolkata` | Imports Panchangam records from OneBhakthi in English and Tamil. |
| `npm run panchang:import -- --start 2026-01-01 --end 2040-12-31 --all-tamil-nadu` | Imports calendar data for all 38 Tamil Nadu district headquarters. |

### Panchangam calendar data

The Panchangam calendar uses OneBhakthi's documented Panchang endpoint. Add an API key to the local, git-ignored `.env` as `ONEBHAKTHI_API_KEY=...`; never commit or share the key. Run migrations, then import a date range:

```powershell
npm run migrate
npm run panchang:import -- --start 2026-01-01 --end 2040-12-31 --location Madurai --lat 9.9252 --lon 78.1198 --timezone Asia/Kolkata
```

The import is resumable and safe to rerun: it upserts one row per date and location and skips completed batches. The provider returns up to 31 days per call; 2026–2040 takes 177 batches per location, fetched in English and Tamil. One location costs 354 calls; all 38 district headquarters in [tamilNaduDistrictHeadquarters.js](./database/tamilNaduDistrictHeadquarters.js) cost 13,452 calls. The Free plan's published 5,000 daily / 120 per minute limits are respected by sequential, paced requests; the all-city run spans at least three daily quota windows. If the daily quota runs out, rerun the same command after its reset to resume without repeating completed batches.

`GET /api/v1/panchangam/today?date=YYYY-MM-DD&location=Madurai` keeps its existing fields and adds `dataSource` and `calendarData`. For imported rows, `calendarData.english` and `calendarData.tamil` contain the full provider response, including sunrise, sunset, tithi, nakshatra, yoga, karana, lunar month, Rahu Kalam, and attribution. Unsupported legacy fields such as Nalla Neram and Tamil solar-date badge remain `null`; the backend does not fabricate values. The provider uses Lahiri astronomical calculations, not Tamil Nadu's Vakya tables, so festival/observance dates can differ from a particular temple or printed almanac. Verify those decisions with the temple/priest before treating them as authoritative.

### Profile image uploads

Administrators (`ADMIN` or `SUPER_ADMIN`) can upload an image for their own profile or for a staff member. Run `npm run migrate` against the target database before using these endpoints. Uploads use `multipart/form-data` with one file field named `image`; accepted formats are JPEG/JPG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, and HEIF, up to 5 MB. SVG is not supported. The backend checks both the declared MIME type and the file signature, stores files under separate `uploads/admin/` and `uploads/staff/` folders with generated filenames, and makes them publicly readable at `/uploads/...`. The resulting relative URL is returned as `imageUrl` and is also exposed as `avatarUrl` in the relevant profile response.

| Method | Endpoint | Access |
| --- | --- | --- |
| `POST` | `/api/v1/admin/profile/image` | Admin or Super Admin; updates the caller's profile image |
| `POST` | `/api/v1/admin/staff/:staffId/image` | Admin or Super Admin; updates that staff profile's image |

Send a bearer access token and form-data key `image` with a supported file. Replacing an image removes the previous backend-managed file after the database update succeeds.

---

## 5. API Documentation

### Base URL: `/api/v1`

### 1. Health Checks
- `GET /health` or `GET /api/v1/health`
  - **Access**: Public
  - **Response**:
    ```json
    {
      "success": true,
      "message": "Health status check",
      "data": {
        "status": "UP",
        "uptimeSeconds": 42,
        "timestamp": "2026-11-03T00:30:00.000Z",
        "database": "CONNECTED",
        "environment": "development"
      }
    }
    ```

### 2. Authentication Endpoints

#### `POST /api/v1/auth/login`
- **Access**: Public (Protected by IP rate limiting: 10 attempts / 15 mins)
- **Body**:
  ```json
  {
    "mobile": "9876543210",
    "password": "Admin@1234"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "4a7b9f8e2c1d...",
      "user": {
        "id": 1,
        "name": "Super Admin",
        "mobile": "9876543210",
        "role": "SUPER_ADMIN",
        "mustChangePassword": false,
        "permissions": [
          "admins:create",
          "bookings:manage",
          "bookings:read",
          "panchangam:manage",
          "panchangam:read",
          "reports:view",
          "staff:create",
          "users:manage",
          "users:read"
        ]
      }
    }
  }
  ```
- **Failure Response (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "message": "Invalid mobile number or password",
    "data": null
  }
  ```

#### `POST /api/v1/auth/refresh`
- **Access**: Public (Requires valid active refresh token)
- **Body**:
  ```json
  {
    "refreshToken": "4a7b9f8e2c1d..."
  }
  ```
- **Behavior**: Implements **Refresh Token Rotation**. The old token hash is immediately revoked and replaced with a newly issued cryptographically secure token pair. If a revoked token is reused, all sessions for that user are terminated for defense-in-depth.

#### `POST /api/v1/auth/logout`
- **Access**: Public / Authenticated
- **Body**:
  ```json
  {
    "refreshToken": "4a7b9f8e2c1d..."
  }
  ```
- **Behavior**: Server-side session revocation in `user_sessions`.

#### `GET /api/v1/auth/me`
- **Access**: Private (Requires `Authorization: Bearer <accessToken>`)
- **Headers**:
  - `Authorization`: `Bearer <accessToken>`
- **Response (200 OK)**: Returns full user profile, role, status, and permissions.

#### `POST /api/v1/auth/change-password`
- **Access**: Private (Requires `Authorization: Bearer <accessToken>`)
- **Body**:
  ```json
  {
    "currentPassword": "Admin@1234",
    "newPassword": "NewStrongPassword@2026"
  }
  ```
- **Behavior**: Validates password complexity, updates hash using `bcrypt` (12 rounds), clears `must_change_password`, and terminates all active refresh sessions to enforce re-login.

### Staff and administrator profile APIs (updated 2026-11-15)

This update adds profile lookups by `user_id`, aligns staff creation validation with generated passwords and default designations, and expands profile image uploads to common raster formats.

All endpoints below use the base URL `http://localhost:5000/api/v1` locally. Replace the host and port when calling another environment.

| Method | Endpoint | Purpose | Access |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/profile` | Get the signed-in administrator's profile | Admin or Super Admin |
| `GET` | `/api/v1/admin/profile/:user_id` | Get one admin profile by account ID | Admin or Super Admin |
| `GET` | `/api/v1/staff/:user_id` | Get one staff profile by linked account ID | Admin or Super Admin |
| `GET` | `/api/v1/auth/me` | Get the signed-in user's profile | Any authenticated user |
| `GET` | `/api/v1/staff` | List staff, optionally filtered by `status` and `search` | Admin or Super Admin |
| `POST` | `/api/v1/createStaff` | Create a staff account | Admin or Super Admin |
| `POST` | `/api/v1/admin/profile/image` | Upload the signed-in admin's profile image | Admin or Super Admin |
| `POST` | `/api/v1/admin/staff/:staffId/image` | Upload a staff member's profile image | Admin or Super Admin |

For admin and staff lookups by ID, `user_id` is the positive integer `users.id`, not the staff row ID or the formatted `staffId`. The admin lookup only returns users with the `ADMIN` or `SUPER_ADMIN` role. Both profile-by-ID endpoints require:

```http
Authorization: Bearer <valid-admin-access-token>
```

No query string or request body is needed for either lookup. For example:

```http
GET /api/v1/admin/profile/42
GET /api/v1/staff/57
```

#### Admin profile response

Successful requests return HTTP `200` with the standard response envelope. The profile data includes account fields and the fields stored in `admin_profiles`.

```json
{
  "status": 1,
  "success": true,
  "message": "Administrator profile retrieved.",
  "data": {
    "id": "42",
    "userId": "42",
    "nameEnglish": "Example Admin",
    "nameTamil": "Example Name",
    "titleTamil": null,
    "phone": "+919876500001",
    "email": "admin@example.com",
    "avatarUrl": null,
    "addressTamil": null,
    "metrics": {
      "yearsExperience": null,
      "horoscopeCount": null,
      "homamCount": null,
      "accuracyRate": null
    },
    "ashramDetails": {
      "peedamNameTamil": null,
      "morningHours": null,
      "eveningHours": null
    },
    "updatedAt": null
  },
  "errors": null,
  "timestamp": "2026-11-15T10:00:00.000Z"
}
```

#### Staff profile response

`user_id` selects the staff row through `staff.user_id`. The response also includes the related account email.

```json
{
  "status": 1,
  "success": true,
  "message": "Staff profile retrieved.",
  "data": {
    "id": "8",
    "staffId": "MJSTF00008",
    "userId": "57",
    "nameEnglish": "Example Priest",
    "nameTamil": "Example Name",
    "staffRole": "Priest",
    "designation": "Priest",
    "phone": "+919876500002",
    "phoneDisplay": "91987XXXXXXX",
    "tradition": null,
    "expertise": null,
    "certification": null,
    "languagesSpoken": null,
    "avatarUrl": null,
    "status": "active",
    "userStatus": "active",
    "isDeleted": false,
    "createdAt": null,
    "updatedAt": null,
    "designationTamil": "Priest",
    "designationEnglish": "Priest",
    "roleCategory": "PRIEST",
    "roleBadge": "Priest",
    "fullTitleTamil": "Example Name - Priest",
    "traditionTamil": null,
    "certificationTamil": null,
    "expertiseTamil": null,
    "languagesTamil": null,
    "metrics": {
      "totalBookings": 0,
      "thisWeekBookings": 0,
      "conflictsCount": 0
    },
    "tabCounts": {
      "past": 0,
      "active": 0,
      "upcoming": 0
    },
    "email": "priest@example.com"
  },
  "errors": null,
  "timestamp": "2026-11-15T10:00:00.000Z"
}
```

#### Create staff request

`nameEnglish`, `nameTamil`, and `phone` are required. The phone must be unique and contain 10-15 digits (an optional leading `+`, spaces, or hyphens are accepted). `staffRole` can be `Priest` or `Assistant`; it defaults to `Priest`. `designation` defaults based on the role. If `password` is omitted, the API generates one and returns it once as `temporaryPassword`; a supplied password must be at least 6 characters.

Optional fields: `email` (valid email), `tradition`, `expertise`, `certification`, `languagesSpoken` (up to 255 characters each), and `avatarUrl` (up to 500 characters).

```http
POST /api/v1/createStaff
Authorization: Bearer <valid-admin-access-token>
Content-Type: application/json
```

```json
{
  "nameEnglish": "Example Priest",
  "nameTamil": "உதாரண புரோகிதர்",
  "staffRole": "Priest",
  "designation": "Priest",
  "phone": "+919876500003",
  "email": "priest@example.com",
  "tradition": "Vedic",
  "expertise": "Homam",
  "certification": "Certified",
  "languagesSpoken": "Tamil"
}
```

Successful creation returns HTTP `201`; the `data` object contains the new staff profile and the generated `temporaryPassword` when no password was supplied. Use `/api/v1/createStaff`; `POST /api/v1/staff` is not a registered route.

```json
{
  "status": 1,
  "success": true,
  "message": "புரோகிதர் வெற்றிகரமாக சேர்க்கப்பட்டார்.",
  "data": {
    "id": "8",
    "staffId": "MJSTF00008",
    "userId": "57",
    "nameEnglish": "Example Priest",
    "nameTamil": "உதாரண புரோகிதர்",
    "staffRole": "Priest",
    "designation": "Priest",
    "phone": "+919876500003",
    "status": "active",
    "temporaryPassword": "<generated-once>"
  },
  "errors": null,
  "timestamp": "2026-11-15T10:00:00.000Z"
}
```

#### Image upload response

Send exactly one file as the `image` form-data field. The `staffId` upload parameter is the numeric staff row ID. A successful upload returns HTTP `200`:

```json
{
  "status": 1,
  "success": true,
  "message": "Admin profile image uploaded successfully.",
  "data": {
    "imageUrl": "/uploads/admin/<generated-file>.png",
    "category": "admin"
  },
  "errors": null,
  "timestamp": "2026-11-15T10:00:00.000Z"
}
```

Staff image uploads return the same shape with `category: "staff"` and an `/uploads/staff/...` URL.

#### Refresh an expired access token

Send `POST /api/v1/auth/refresh` with the current refresh token:

```json
{
  "refreshToken": "<refresh-token>"
}
```

The success response contains a new `data.token` (access token) and a rotated `data.refreshToken`. Replace both saved tokens before retrying the original request.

```json
{
  "status": 1,
  "success": true,
  "message": "Session token refreshed successfully.",
  "data": {
    "token": "<new-access-token>",
    "refreshToken": "<rotated-refresh-token>",
    "expiresAt": "2026-11-16T10:00:00.000Z",
    "user": {
      "id": 42,
      "nameEnglish": "Example Admin",
      "nameTamil": null,
      "role": "ADMIN",
      "phone": "+919876500001"
    }
  },
  "errors": null,
  "timestamp": "2026-11-15T10:00:00.000Z"
}
```

#### Common errors

All errors use the same envelope with `status: 0`, `success: false`, `data: null`, an `errors` value, and a `timestamp`.

| HTTP status | Example message | Meaning |
| --- | --- | --- |
| `400` | `Validation failed for the submitted fields.` | `user_id` must be a positive integer or a request field is invalid. |
| `401` | `Access token has expired. Please refresh your session.` | Refresh the access token and retry. |
| `409` | `Phone number already registered.` | The phone number is already assigned to an account. |
| `404` | `Administrator profile not found.` | The ID is not an ADMIN/SUPER_ADMIN account. |
| `404` | `Staff profile not found.` | No staff record is linked to that `users.id`. |
| `422` | `The uploaded file content does not match a supported image format.` | The file bytes do not match the declared image type, or the type is unsupported. |
| `404` | `Route not found: GET /api/v1/staff/57` | The request is reaching a server that has not loaded the updated route; restart/deploy the current backend and confirm `baseUrl`. |

The local database was migrated through migration `014` on 2026-11-15. Run `npm run migrate` against each deployment database before deploying these changes.

### 3. Bookings and Balances

Both endpoints require an Admin or Super Admin Bearer token.

#### `POST /api/v1/bookings`
- **Purpose**: Create a pooja, horoscope, or outdoor event booking.
- **Body**: Client and priest balances are calculated from the total and received/paid amounts.
  ```json
  {
    "dateKey": "2026-10-28",
    "title": "Ganapathi Homam",
    "clientName": "Customer name",
    "phone": "+919840122334",
    "location": "Temple address",
    "category": "temple",
    "categoryLabelTamil": "கோவில்",
    "timeSlot": "09:00 AM - 10:30 AM",
    "priestId": "p-murugan",
    "priestName": "Murugan",
    "totalEventCharge": 5000,
    "clientAdvanceAmount": 1000,
    "clientTotalReceived": 1000,
    "priestTotalPay": 2500,
    "priestAdvancePaid": 500
  }
  ```

#### `GET /api/v1/bookings/:bookingId/balance`
- **Purpose**: Retrieve the client amount due and priest amount due for a booking.
- **Example**: `GET /api/v1/bookings/1/balance`
- **Response data**:
  ```json
  {
    "bookingId": "1",
    "bookingNumber": "MJ-2026-...",
    "clientName": "Customer name",
    "financials": {
      "totalEventCharge": 5000,
      "clientTotalReceived": 2000,
      "clientBalanceAmount": 3000,
      "priestTotalPay": 2500,
      "priestAdvancePaid": 1000,
      "priestBalanceAmount": 1500
    }
  }
  ```

---

## 6. Database Schema & Migration Strategy

### Tables
1. **`roles`**: System roles (`SUPER_ADMIN`, `ADMIN`, `PRIEST`, `ASSISTANT`).
2. **`permissions`**: Granular system permissions grouped by module.
3. **`role_permissions`**: Many-to-many junction table mapping permissions to roles.
4. **`users`**: System users with role foreign key, mobile index, bcrypt password hash, and `must_change_password` flag.
5. **`user_sessions`**: Session storage for refresh token rotation, tracking SHA-256 token hashes, client IP, user agent, expiration, and server-side revocation.
6. **`bookings`**: Pooja/event booking details and client/priest financial totals used by the balance endpoint.
7. **`schema_migrations`**: Migration tracker to ensure schema migrations are applied exactly once.

### Adding New Migrations
When adding a new feature (e.g., Bookings):
1. Create a new `.sql` file in `database/migrations/` with a prefixed numbering format:
   ```text
  database/migrations/002_create_bookings_table.sql
   ```
2. Write clean, idempotent DDL queries (`CREATE TABLE IF NOT EXISTS`, explicit foreign keys, `InnoDB`, `utf8mb4`).
3. Run `npm run migrate` to apply it to your database.

---

## 7. Team Collaboration & Git Workflow (3–5 Developers)

### Git Branching Model
- **`main`**: Production-ready code only. Direct commits and pushes are prohibited.
- **`develop`**: Integration branch for tested feature work.
- **Feature Branches**: Branch off `develop` using the format:
  - `feature/auth-refresh-rotation`
  - `feature/booking-calendar`
  - `bugfix/mobile-login-validation`
  - `chore/db-migration-indexes`

### Workflow Rules
1. Always branch from the latest `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```
2. Commit messages should follow conventional commits:
   - `feat: implement refresh token rotation`
   - `fix: handle expired JWT gracefully in authMiddleware`
   - `chore: update database connection pool limits`
3. Pull Requests require review and approval from at least 1 team member before merging into `develop`.
4. **Never commit `.env` or credentials** to git.

---

## 8. Security Highlights

- **Bcrypt Password Hashing**: Hashed with a cost factor of 12. Plaintext passwords never reach storage or logs.
- **Timing Attack Mitigation**: Login handles missing accounts with a dummy bcrypt check to prevent timing analysis.
- **Opaque Cryptographic Refresh Tokens**: Random 40-byte hex strings. Only SHA-256 hashes are persisted in MySQL.
- **Token Rotation**: Old refresh tokens are invalidated upon use. Reuse triggers session invalidation.
- **No Client-Supplied Role Trust**: Mobile apps cannot dictate user roles or permissions; all authorization is strictly derived from MySQL via the JWT payload and DB lookup.
- **Security Headers & Sanitization**: Enforced via `helmet`, CORS restriction, and strict request body size caps (`100kb`).
- **Rate Limiting**: Mitigates brute-force attacks on the login endpoint.

# Mandhiragiri Jothidam - Production Database Schema & Seed Data Export

This document provides complete instructions for importing, verifying, and configuring the Mandhiragiri Jothidam enterprise database schema and baseline seed data for production deployment.

---

## 1. File Overview

- **Export Artifact:** [`mandhiragiri_production_full.sql`](./mandhiragiri_production_full.sql)
- **Database Engine:** MariaDB / MySQL (InnoDB engine)
- **Character Set:** `utf8mb4`
- **Collation:** `utf8mb4_unicode_ci`
- **Session Timezone:** UTC (`+00:00`)
- **Total Tables:** 26
- **Foreign Key Constraints:** 31
- **Operational Data:** Clean slate (0 bookings, 0 staff, 0 transactions, 0 test records)

---

## 2. Server & Engine Compatibility

| Database Engine | Supported Versions | Validated Version |
| :--- | :--- | :--- |
| **MariaDB** | 10.4.x, 10.5.x, 10.6.x, 10.11.x LTS | **10.4.32-MariaDB** |
| **MySQL** | 8.0.x, 8.4.x LTS | 8.0.x compatible |
| **Engine Requirements** | `InnoDB` default storage engine | Validated |
| **JSON Support** | Native `JSON` or `longtext` with `json_valid()` | Validated |

---

## 3. Database Creation & Import Instructions

### Option A: Command Line (Linux / macOS / Windows CMD / PowerShell)

#### Step 1: Create the empty database with UTF-8 Unicode encoding
```bash
mysql -u root -p -e "CREATE DATABASE mandhiragiri_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

#### Step 2: Import the SQL export file
```bash
# Linux / macOS:
mysql -u root -p --default-character-set=utf8mb4 mandhiragiri_db < database/exports/mandhiragiri_production_full.sql

# Windows (Command Prompt / PowerShell):
mysql.exe --user=root --host=127.0.0.1 --port=3306 --default-character-set=utf8mb4 mandhiragiri_db < "database\exports\mandhiragiri_production_full.sql"
```

---

### Option B: phpMyAdmin / Web GUI

1. Open phpMyAdmin (`http://localhost/phpmyadmin` or production hosting URL).
2. Click **New** in the left sidebar to create a database.
3. Database Name: `mandhiragiri_db`.
4. Collation: Select `utf8mb4_unicode_ci`. Click **Create**.
5. Select `mandhiragiri_db` in the sidebar and navigate to the **Import** tab.
6. Under **File to import**, click **Choose File** and select `mandhiragiri_production_full.sql`.
7. Ensure **Character set of the file** is set to `utf-8`.
8. Click **Import** (or **Go**). All 26 tables and seed data will be created without errors.

---

### Option C: Docker Container

```bash
docker exec -i <mariadb_container_name> mysql -u root -p<password> --default-character-set=utf8mb4 mandhiragiri_db < database/exports/mandhiragiri_production_full.sql
```

---

## 4. Schema & Seed Data Inventory

### 4.1 Schema Tables (26 Total)

| Category | Table Name | Purpose |
| :--- | :--- | :--- |
| **Authentication & RBAC** | `roles` | 5 user roles (`STAFF`, `SUPER_ADMIN`, `ADMIN`, `PRIEST`, `ASSISTANT`) |
| | `permissions` | 9 granular system permissions |
| | `role_permissions` | 18 permission-role junction assignments |
| | `users` | User credentials, password hash, status (`ACTIVE`, `INACTIVE`, `DELETED`) |
| | `user_sessions` | JWT refresh tokens and server-side revocation tracking |
| **Staff & Attendance** | `staff` | Priest and Assistant profiles, tradition, expertise, languages |
| | `attendance_records` | Daily attendance (`PRESENT`, `ABSENT`, `LEAVE`) |
| | `staff_attendance_audit` | Immutable audit trail for attendance overrides and approvals |
| | `leave_requests` | Staff leave applications, decision status, admin remarks |
| | `staff_reminders` | Task reminders assigned to staff |
| **Booking & Rituals** | `event_types` | Catalog of Poojas, Homams, and Astrology services |
| | `bookings` | Customer bookings, schedule versions, venue, payment status |
| | `booking_priests` | Multi-priest assignments and individual compensation tracking |
| | `booking_transactions` | Client payments and Priest payout transaction records |
| **Panchangam & Calendar** | `panchangam_days` | Daily Tithi, Nakshatra, Nalla Neram, Rahu Kalam data |
| | `calendar_day_settings` | Muhurtham dates and booking blockouts |
| **Admin Profiles** | `admin_profiles` | Chief Administrator profile, experience, peedam details |
| **Notifications** | `notifications` | Multilingual notification event store (English & Tamil) |
| | `notification_recipients` | Delivery status and read receipts per user |
| | `notification_preferences` | User push and in-app notification toggles |
| | `notification_jobs` | Push delivery scheduled job queue |
| | `notification_outbox` | Transactional outbox for guaranteed delivery |
| | `notification_device_deliveries` | Per-device FCM dispatch audit log |
| | `user_devices` | FCM push notification registration tokens |
| **Infrastructure** | `api_idempotency_records` | Replay protection for financial and critical mutations |
| | `schema_migrations` | Migration version tracker (14 migrations tracked) |

---

### 4.2 Default Seed Data Included

#### 1. Roles (5 Rows)
- `STAFF` (ID: 1): Temple staff including Priests and Assistants.
- `SUPER_ADMIN` (ID: 2): Full system access and administrator management.
- `ADMIN` (ID: 3): Temple management, staff supervision, and bookings.
- `PRIEST` (ID: 4): Astrology consultations, poojas, and temple rituals.
- `ASSISTANT` (ID: 5): Ritual assistance, queue logistics, and schedule support.

#### 2. Permissions (9 Rows)
- `users:manage` (USERS)
- `admins:create` (USERS)
- `staff:create` (USERS)
- `users:read` (USERS)
- `bookings:manage` (BOOKINGS)
- `bookings:read` (BOOKINGS)
- `panchangam:manage` (PANCHANGAM)
- `panchangam:read` (PANCHANGAM)
- `reports:view` (REPORTS)

#### 3. Role-Permission Mappings (18 Rows)
- **SUPER_ADMIN:** 9 permissions (Full administrative access).
- **ADMIN:** 6 permissions (`staff:create`, `users:read`, `bookings:manage`, `bookings:read`, `panchangam:read`, `reports:view`).
- **PRIEST:** 2 permissions (`bookings:read`, `panchangam:read`).
- **ASSISTANT:** 1 permission (`bookings:read`).

#### 4. Pooja / Event Types Catalog (9 Rows)
All 9 default Pooja event types are seeded with authentic Tamil Unicode typography and base pricing:

| ID | English Title | Tamil Title | Category | Duration | Base Price |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | Horoscope & Prasannam | ஜாதகம் & பிரசன்னம் | `jathagam` | 60 min | ₹1,000.00 |
| 2 | Ganapathi Homam | கணபதி ஹோமம் | `temple` | 120 min | ₹5,000.00 |
| 3 | Navagraha Homam | நவக்கிரக ஹோமம் | `temple` | 120 min | ₹6,000.00 |
| 4 | Sudarshana Homam | சுதர்சன ஹோமம் | `temple` | 180 min | ₹7,500.00 |
| 5 | Ayushya Homam | ஆயுஷ்ய ஹோமம் | `temple` | 180 min | ₹6,500.00 |
| 6 | Grihapravesam & Vastu | கிரகப்பிரவேசம் & வாஸ்து | `outdoor` | 180 min | ₹8,000.00 |
| 7 | Marriage Muhurtham | திருமண முகூர்த்தம் | `outdoor` | 240 min | ₹15,000.00 |
| 8 | Temple Abhishekam | கோவில் அபிஷேகம் & அர்ச்சனை | `temple` | 60 min | ₹2,500.00 |
| 9 | Special Outdoor Pooja | சிறப்பு வெளி நிகழ்வு பூஜை | `outdoor` | 120 min | ₹5,000.00 |

#### 5. Initial Super Admin Account (1 Row)
- **User ID:** `1`
- **Role:** `SUPER_ADMIN` (Role ID: 2)
- **Mobile Number:** `9876543210`
- **Name:** `Super Admin`
- **Email:** `admin@mandhiragiri.com`
- **Password:** `Admin@1234` (Stored securely as bcrypt hash)
- **Status:** `ACTIVE`

#### 6. Schema Migrations (14 Rows)
Contains migration records `001_create_auth_tables.sql` through `014_create_notification_outbox_and_enhance_jobs.sql`, ensuring that running `node database/migrate.js` on production detects the schema as fully up to date.

---

## 5. Initial Super Admin Login Procedure

After importing the database and starting the backend server, test authentication via the Admin Login endpoint:

### API Request:
```http
POST /api/v1/auth/login HTTP/1.1
Host: your-domain-or-ip:5000
Content-Type: application/json

{
  "mobile": "9876543210",
  "password": "Admin@1234"
}
```

### Successful Response:
```json
{
  "status": 1,
  "success": true,
  "message": "உள்நுழைவு வெற்றிகரமாக முடிந்தது (Sign in successful)",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "10d726e1938f3c8a120ff77b...",
    "expiresAt": "2026-11-15T06:23:53.222Z",
    "user": {
      "id": 1,
      "role": "admin",
      "nameEnglish": "Super Admin",
      "phone": "+919876543210",
      "email": "admin@mandhiragiri.com"
    }
  }
}
```

---

## 6. Production Security & Pre-Deployment Checklist

Before exposing the production backend to the public internet:

1. **Change Default Super Admin Password:**
   Immediately change the Super Admin password upon initial login via `POST /api/v1/auth/change-password` with a strong passphrase.
2. **Rotate JWT Secrets:**
   In production `.env`, change `JWT_ACCESS_SECRET` to a 64+ character random string (e.g. generated via `openssl rand -hex 32`).
3. **Dedicated Database User:**
   Do NOT run production backend queries under MariaDB `root`. Create a dedicated least-privilege user:
   ```sql
   CREATE USER 'mandhiragiri_user'@'localhost' IDENTIFIED BY 'StrongRandomDbPassword#2026!';
   GRANT SELECT, INSERT, UPDATE, DELETE ON mandhiragiri_db.* TO 'mandhiragiri_user'@'localhost';
   FLUSH PRIVILEGES;
   ```
4. **Enforce SSL/TLS:**
   Configure SSL for MariaDB connections and reverse proxy HTTPS via Nginx or Cloudflare.
5. **Verify UTC Timezone:**
   Ensure the database server session timezone is UTC (`+00:00`), which is automatically verified by `src/config/database.js`.

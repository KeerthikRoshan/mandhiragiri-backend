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
3. Verify that MySQL is running on port `3306` (default).

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
DB_PORT=3306
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

---

## 6. Database Schema & Migration Strategy

### Tables
1. **`roles`**: System roles (`SUPER_ADMIN`, `ADMIN`, `PRIEST`, `ASSISTANT`).
2. **`permissions`**: Granular system permissions grouped by module.
3. **`role_permissions`**: Many-to-many junction table mapping permissions to roles.
4. **`users`**: System users with role foreign key, mobile index, bcrypt password hash, and `must_change_password` flag.
5. **`user_sessions`**: Session storage for refresh token rotation, tracking SHA-256 token hashes, client IP, user agent, expiration, and server-side revocation.
6. **`schema_migrations`**: Migration tracker to ensure schema migrations are applied exactly once.

### Adding New Migrations
When adding a new feature (e.g., Bookings):
1. Create a new `.sql` file in `database/migrations/` with a prefixed numbering format:
   ```text
   database/migrations/002_create_bookings_tables.sql
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

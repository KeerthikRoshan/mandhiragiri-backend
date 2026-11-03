# Postman API Testing

## Start the backend

1. Start MySQL in the XAMPP Control Panel.
2. In PowerShell, change to the backend folder. If `.env` does not exist yet, create it from the example:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Install dependencies, apply migrations, create the Super Admin, and start the API:

   ```powershell
   npm.cmd install
   npm.cmd run migrate
   npm.cmd run seed:admin
   npm.cmd run dev
   ```

4. Confirm `http://localhost:5000/api/v1/health` returns HTTP 200 and `database: CONNECTED`.

## Import and run the collection

Import `collections/Mandhiragiri API.postman_collection.json` into Postman. The collection's `baseUrl` defaults to `http://localhost:5000/api/v1`.

Before the first run, verify the `adminPhone` and `adminPassword` collection variables match `.env`. The defaults match `.env.example`. `staffPhone` and `staffEmail` must be unique in the database; change them before rerunning the collection if the prior test staff account already exists.

Select **Run collection** and run requests in listed order. The requests log in the admin, create and log in a test priest, create a booking, record a client payment, verify the updated balance and payment history, then exercise schedule, attendance, leave, event completion, dashboard, Panchangam, profile, and expected unauthorized behavior. Tests capture access tokens, IDs, and generated staff password from responses.

The collection changes the Super Admin password to `PostmanTest@1234` near the end. On a later run, make sure the `adminPassword` collection variable has that value. If your Postman version discards local collection-variable changes after a run, update it manually before rerunning.

The Panchangam write request stores clearly labelled test values for today's date and Madurai. Replace them with verified astrological data for real use.

## Endpoints covered

- `GET /health`, `GET /api/v1/health`
- `POST /api/v1/auth/login`, `POST /api/v1/auth/staff-login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `POST /api/v1/auth/change-password`
- `GET /api/v1/dashboard/overview`, `GET /api/v1/panchangam/today`, `PUT /api/v1/admin/panchangam`
- `GET /api/v1/schedule/bookings`, `POST /api/v1/bookings`, `GET /api/v1/bookings/:bookingId/balance`
- `POST /api/v1/bookings/:bookingId/payments`, `GET /api/v1/bookings/:bookingId/payments`, `GET /api/v1/reports/balances`
- `GET /api/v1/staff`, `POST /api/v1/staff`, `GET /api/v1/staff/me/dashboard`, `POST /api/v1/staff/me/leaves`
- `GET /api/v1/attendance/daily`, `PUT /api/v1/attendance/record`, `POST /api/v1/attendance/self`
- `GET /api/v1/leaves/admin/all`, `POST /api/v1/leaves/admin/:leaveId/decision`
- `POST /api/v1/events/:eventId/complete`
- `GET /api/v1/admin/profile`, `PUT /api/v1/admin/profile`

## Check database rows

In phpMyAdmin or a MySQL client:

```sql
USE mandhiragiri_db;
SHOW TABLES;

SELECT id, booking_number, total_event_charge, client_total_received,
       priest_total_pay, priest_advance_paid
FROM bookings
ORDER BY id DESC
LIMIT 10;

SELECT booking_id, party, amount, payment_method, reference, paid_at
FROM booking_transactions
ORDER BY id DESC
LIMIT 20;
```

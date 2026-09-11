# LeaveFlow HR — Production Deployment Runbook & Smoke-Test Checklist

This runbook documents the deployment architecture, configuration steps, release sequence, and post-deployment verification procedures for **LeaveFlow HR**.

---

## 1. Architecture Overview

```
[ Browser Client ]
        |
        | (Same-origin relative requests: /api/*)
        v
[ Vercel Edge Proxy ] ──(Rewrite in vercel.json)──> [ Render Web Service ]
  (Static HTML/CSS/JS)                                 (Node.js HTTP Server)
                                                                 |
                                                                 | (pg connection pool)
                                                                 v
                                                      [ Managed PostgreSQL ]
```

- **Frontend**: Hosted on Vercel as static files from `public/`.
- **API Proxy**: `vercel.json` rewrites relative `/api/:path*` requests to the Render backend service (`https://leaveflow-hr-hvfh.onrender.com/api/$1`).
- **Backend**: Hosted on Render as a Web Service running Node.js (`backend/server.cjs`).
- **Database**: Managed PostgreSQL (e.g., Render Managed PostgreSQL, Neon, or Supabase).
- **Authentication**: Stateful, revocable session tokens stored as SHA-256 hashes in PostgreSQL `sessions` table. Tokens are delivered via an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`Secure` in production). State-changing requests require a synchronizer CSRF token in the `x-csrf-token` header.

---

## 2. Infrastructure Setup & Environment Variables

### A. Managed PostgreSQL Database

1. Provision a managed PostgreSQL instance (v14+ / v15+ / v16+ / v17+) on Render, Neon, or Supabase.
2. Retrieve the standard PostgreSQL connection URI (`DATABASE_URL`).
3. **Safety Constraint**: Never configure or use `ALLOW_IN_MEMORY_DB=true` or SQLite in production.

### B. Render Web Service Configuration

1. In the Render Dashboard, create a new **Web Service** connected to the repository.
2. Set build and start commands:
   - **Environment**: Node
   - **Build Command**: `npm ci`
   - **Start Command**: `node backend/server.cjs`
3. Configure **Environment Variables** on Render:

| Variable | Value / Format | Required | Purpose |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | `production` | **Yes** | Enforces production security rules, Secure cookies, strict secrets, and disables in-memory fallbacks. |
| `DATABASE_URL` | `postgresql://postgres:password@host:5432/dbname` | **Yes** | Connection string for managed PostgreSQL. Password must be URL-encoded if special characters exist. |
| `RATE_LIMIT_SECRET` | 32+ character random hex/string | **Yes** | Secret for HMAC-SHA256 login throttle keys. Must be cryptographically random and non-placeholder. |
| `PORT` | Auto-assigned by Render | Optional | Render injects `PORT` automatically; code defaults to `PORT || 3000`. |
| `DATABASE_SSL` | `true` | Optional | Set to `true` if your cloud database requires TLS/SSL connection. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` | Optional | Set to `false` only if the cloud PostgreSQL provider uses self-signed or internal CA certificates. |
| `DATABASE_POOL_MAX` | `10` | Optional | Maximum concurrent connections in the PostgreSQL connection pool (default: 10). |

4. **Strictly Prohibited in Production**:
   - `ALLOW_IN_MEMORY_DB=true` (Server will immediately abort startup if set in production).
   - `ALLOW_DB_RESET=true` (Server will abort startup if set in production).

5. **Generate a Strong `RATE_LIMIT_SECRET`**:
   Run locally in PowerShell or terminal (never commit the output):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### C. Vercel Frontend Configuration

1. In the Vercel Dashboard, import the repository.
2. Root Directory: `.` (repository root).
3. Output Directory: Leave as default (Vercel automatically detects `public/` and `vercel.json`).
4. **Environment Variables on Vercel**:
   - **None required**.
   - **Security Requirement**: Never add `DATABASE_URL` or `RATE_LIMIT_SECRET` to Vercel environment settings. Client-side code does not access them.

---

## 3. Deployment & Release Sequence

Follow this strict ordering to avoid downtime or authentication failures:

1. **Step 1: Provision Database**: Ensure the managed PostgreSQL database is provisioned, active, and reachable.
2. **Step 2: Configure Render Secrets**: Add `NODE_ENV=production`, `DATABASE_URL`, and `RATE_LIMIT_SECRET` to Render Web Service settings.
3. **Step 3: Deploy Backend**:
   - Trigger deployment on Render.
   - Monitor Render deployment logs.
   - Confirm successful startup message:
     ```text
     Connecting to PostgreSQL database at postgresql://postgres:***@host:5432/dbname...
     Connected to PostgreSQL database pool.
     PostgreSQL migrations complete.
     Employee Leave Management System running at http://localhost:PORT
     ```
   - Confirm database tables (`employees`, `leave_requests`, `sessions`, `login_rate_limits`) and default seed accounts were initialized idempotently.
4. **Step 4: Deploy Frontend**:
   - Deploy to Vercel.
   - Confirm `vercel.json` rewrite routes `/api/:path*` to the deployed Render service URL.
5. **Step 5: Post-Deployment Smoke Testing**:
   - Execute the verification checklist below on the live production URLs.
6. **Step 6: Rollback Procedure (if needed)**:
   - If an issue is encountered, roll back the code deployment in Render/Vercel to the previous stable release.
   - Do **not** run `--reset-db` or drop database tables during rollback. The database schema migrations are additive and backward-compatible.

---

## 4. Post-Deployment Smoke-Test Checklist

Perform these tests on the live production frontend (`https://leaveflow-hr-ten.vercel.app/`):

### 4.1. Connectivity & Proxy Verification
- [ ] Load the frontend root URL in a browser.
- [ ] Confirm the login screen renders cleanly without console errors.
- [ ] Confirm `/api/login` does **not** return a Vercel 404 (verifies Vercel rewrite to Render backend is active).
- [ ] If Render is cold-starting (free tier spin-up), confirm the login button displays a disabled pending state (`Signing in…` with `aria-busy="true"`) without UI crash.
- [ ] Confirm no raw HTML or gateway error pages are leaked into the user interface.

### 4.2. Cookies, Sessions & State Persistence
- [ ] Log in with Employee credentials (`aarav@leaveflow.test` / `emp123`).
- [ ] Open Browser DevTools > Application > Cookies:
  - [ ] Cookie `leaveflow_session` is present.
  - [ ] `HttpOnly` flag is checked (`true`).
  - [ ] `Secure` flag is checked (`true`).
  - [ ] `SameSite` attribute is set to `Lax`.
  - [ ] `Path` attribute is `/`.
  - [ ] Expiry/Max-Age matches 8 hours (28,800 seconds).
- [ ] Check `localStorage` and `sessionStorage`:
  - [ ] Confirm **no** tokens, passwords, or session IDs are stored in web storage.
- [ ] Inspect network request headers:
  - [ ] Confirm **no** `Authorization: Bearer` header is sent.
- [ ] Refresh the browser page (`F5`):
  - [ ] The application automatically calls `/api/bootstrap`.
  - [ ] Session is recognized from the cookie and dashboard is restored without requiring re-login.
  - [ ] CSRF token is refreshed and stored in application memory.
- [ ] Click **Logout**:
  - [ ] Server revokes the session in PostgreSQL.
  - [ ] `leaveflow_session` cookie is cleared (`Max-Age=0`).
  - [ ] UI resets to the login screen.
  - [ ] Attempting to access `/api/bootstrap` or `/api/leave-requests` returns `401 Unauthorized`.

### 4.3. CSRF Protection
- [ ] Submit a new leave request via the UI:
  - [ ] Network request includes `x-csrf-token` header matching the bootstrap session token.
  - [ ] Request succeeds (`201 Created`).
- [ ] Using an external tool (e.g., cURL with valid cookie), send a `POST /api/leave-requests` with:
  - [ ] Missing `x-csrf-token` header -> returns `403 Forbidden` (`{"error": "Invalid or missing CSRF token"}`).
  - [ ] Invalid `x-csrf-token` header -> returns `403 Forbidden`.

### 4.4. RBAC & Privacy Scoping
- [ ] **Employee (`aarav@leaveflow.test`)**:
  - [ ] Dashboard title displays: `My Leave Dashboard`.
  - [ ] Employee dropdown in Apply Leave form displays only Aarav Sharma.
  - [ ] Leave requests table displays only Aarav Sharma’s requests.
  - [ ] Approvals panel is hidden; no review buttons accessible.
- [ ] **Manager (`manager@leaveflow.test`)**:
  - [ ] Dashboard title displays: `Team Leave Dashboard`.
  - [ ] Employee dropdown displays self and direct reports (Aarav, Diya).
  - [ ] Requests table displays team requests.
  - [ ] Review buttons (Approve / Reject) appear only for direct reports.
  - [ ] Manager **cannot** approve their own leave request (self-approval prohibited).
- [ ] **Admin (`admin@leaveflow.test`)**:
  - [ ] Dashboard title displays: `Organization Leave Dashboard`.
  - [ ] Employee dropdown and request table display organization-wide records.
- [ ] Inspect API responses:
  - [ ] Confirm `password_hash`, `token_hash`, and internal system secrets are **never** present in any JSON payload.

### 4.5. Concurrency & Overspending Protection
- [ ] Submit leave requests consuming available balance (initial: 18 days).
- [ ] Confirm that requests exceeding remaining annual balance are rejected with `400 Bad Request`.
- [ ] (Verified locally via automated PostgreSQL concurrency suite: row-level `SELECT ... FOR UPDATE` prevents race-condition overspending).

### 4.6. PostgreSQL Persistence
- [ ] Submit a test leave request.
- [ ] Trigger a backend service restart on Render (without database reset).
- [ ] Reload the frontend page after the service recovers:
  - [ ] Confirm the submitted request and active session persist intact.
  - [ ] Confirm no in-memory data loss occurred.

### 4.7. HTTP Security Headers
Inspect response headers from the production backend (`/api/*`):
- [ ] `Content-Security-Policy`: `default-src 'self'; script-src 'self'; ...`
- [ ] `X-Content-Type-Options`: `nosniff`
- [ ] `X-Frame-Options`: `DENY`
- [ ] `Referrer-Policy`: `strict-origin-when-cross-origin`
- [ ] `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`
- [ ] `Cache-Control`: `no-store, no-cache, must-revalidate, private` on authenticated API endpoints.
- [ ] `Strict-Transport-Security` (HSTS): Verified as a live platform/reverse-proxy edge header check (Render and Vercel automatically attach `Strict-Transport-Security` on HTTPS edge termination; not injected by the Node.js application process).

---

## 5. Live Production URLs & Status

| Component | Target URL | Pre-Release Status | Post-Release Status |
| :--- | :--- | :---: | :---: |
| **Frontend** | `https://leaveflow-hr-ten.vercel.app/` | Deployed (legacy build) | Awaiting Git Push & Redeploy |
| **Backend** | `https://leaveflow-hr-hvfh.onrender.com/` | Deployed (legacy build) | Awaiting Git Push & Redeploy |
| **Database** | Managed PostgreSQL instance | Unprovisioned / External | Awaiting User Provisioning |

# LeaveFlow HR

A full-stack, role-based Employee Leave Management System engineered with vanilla web technologies, Node.js, PostgreSQL, and defense-in-depth web application security.

---

## 1. Project Overview

LeaveFlow HR is a production-hardened leave management system that handles employee time-off requests, hierarchical manager approvals, and organization-wide HR oversight. It provides:

- **Employee Self-Service**: Employees submit leave requests across Annual, Sick, Casual, and Unpaid categories against an allocated 18-day annual balance.
- **Hierarchical Approvals**: Managers review and approve/reject leave requests specifically for their direct reports, with strict enforcement preventing self-approval.
- **Administrative Governance**: Administrators supervise company-wide leave schedules and audit leave distributions.
- **Role-Scoped Privacy**: Strict server-side RBAC ensures employees cannot enumerate colleagues' profiles or view unrelated leave histories.
- **Concurrency & Overspending Control**: Database transactions with PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) prevent concurrent requests from driving annual leave balances below zero.
- **Zero Framework Bloat**: Pure vanilla HTML5, CSS3 (custom properties & system-ui typography), CommonJS JavaScript, and native Canvas data visualizations—no React, Tailwind, TypeScript, or external UI libraries.

---

## 2. Live Links & Deployment Status

| Service | Target URL | Verification Status |
| :--- | :--- | :--- |
| **Frontend** | [https://leaveflow-hr-ten.vercel.app/](https://leaveflow-hr-ten.vercel.app/) | Deployed (legacy build) |
| **Backend API** | [https://leaveflow-hr-hvfh.onrender.com/](https://leaveflow-hr-hvfh.onrender.com/) | Deployed (legacy build) |

> [!IMPORTANT]
> **Deployment Status**: The URLs above point to initial cloud deployments. The Phase 1–6 local security enhancements, PostgreSQL session engine, CSRF layer, and dark SaaS interface have been verified locally and are prepared for final deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) for the release checklist.

---

## 3. Visual Interface & Screenshots

LeaveFlow HR features a calm, technical dark SaaS dashboard styled with high-contrast system typography and WCAG AA accessibility compliance across mobile, tablet, and desktop viewports.

### Curated Interface Previews

#### Login Experience (Desktop — 1440×900)
![LeaveFlow HR Login Desktop](docs/screenshots/login_desktop.png)

#### Admin Console (Desktop — 1440×900)
![LeaveFlow HR Organization Leave Dashboard Desktop](docs/screenshots/admin_dashboard_desktop.png)

#### Manager Portal (Tablet — 1024×768)
![LeaveFlow HR Team Leave Dashboard Tablet](docs/screenshots/manager_dashboard_tablet.png)

#### Employee Workspace (Mobile — 390×844)
![LeaveFlow HR My Leave Dashboard Mobile](docs/screenshots/employee_dashboard_mobile.png)

*(The automated headless Chromium verification suite validates 75 state-and-viewport combinations across 6 responsive breakpoints locally).*

---

## 4. Role & Authorization Matrix

All authorization boundaries are strictly enforced on the server (`backend/server.cjs` & `backend/database.cjs`). Frontend UI controls adapt dynamically to authorized API responses.

| Capability | Employee (`aarav@`) | Manager (`manager@`) | Administrator (`admin@`) |
| :--- | :---: | :---: | :---: |
| **Visible Employee Scope** | Self only | Self + Direct reports | All organization employees |
| **Visible Requests Scope** | Own requests only | Own + Direct reports' requests | All company requests |
| **Submit Leave Request** | Yes | Yes | Yes |
| **Review / Approve Leave** | No | Yes (direct reports only) | Yes (all except own requests) |
| **Self-Approval Allowed** | No | **Forbidden (403)** | **Forbidden (403)** |
| **Review Other Teams** | No | **Forbidden (403)** | Allowed |
| **Analytics Scope** | Personal request mix | Team request mix | Company-wide request mix |

---

## 5. System Architecture

```
[ Browser Client ]
        │
        │ Same-origin relative requests (/api/*) with HttpOnly cookie & CSRF header
        ▼
[ Vercel Edge Proxy ] ───(Rewrite in vercel.json)───► [ Render Web Service ]
  (Static HTML/CSS/JS)                                   (Node.js HTTP Server)
                                                                   │
                                                                   │ pg connection pool
                                                                   ▼
                                                        [ Managed PostgreSQL ]
                                                        (Tables: employees,
                                                         leave_requests,
                                                         sessions,
                                                         login_rate_limits)
```

- **Frontend**: Static distribution hosted via Vercel Edge.
- **Edge Routing**: `vercel.json` rewrites relative `/api/:path*` requests to the Render backend, allowing the frontend to use same-origin relative paths and avoid cross-origin cookie restrictions.
- **Backend**: Native Node.js `http.createServer` service running CommonJS modules without heavy web frameworks.
- **Data Persistence**: Provider-neutral PostgreSQL accessed via the official `pg` (node-postgres) connection pool.

---

## 6. Security Model

LeaveFlow HR implements defense-in-depth web security standards:

1. **Password Security**:
   - Passwords hashed using **Argon2id** (`argon2` module) with cryptographically random salts.
   - Timing-safe dummy hash evaluations prevent user enumeration for unregistered emails.
2. **Revocable Server-Side Sessions**:
   - Cryptographically random 256-bit (32-byte) hex session tokens generated on authentication via `crypto.randomBytes(32)`.
   - **Zero token exposure in database**: Only SHA-256 hashes (`crypto.createHash('sha256')`) of session tokens are stored in the PostgreSQL `sessions` table.
   - Delivered exclusively via `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800` (8 hours) cookie (`leaveflow_session`).
   - `Secure` cookie attribute enforced in production (`NODE_ENV=production`).
   - Fixed 8-hour lifetime; no sliding renewal revival; immediate revocation upon logout.
   - **No JWTs and no authentication tokens in `localStorage` or `sessionStorage`**.
3. **Cross-Site Request Forgery (CSRF)**:
   - Double-submit synchronizer token pattern tied to each active database session.
   - Issued to client memory on `/api/login` and `/api/bootstrap`.
   - Client sends token via `x-csrf-token` header on state-changing requests (`POST /api/leave-requests`, `POST /api/leave-requests/:id/review`, `POST /api/logout`).
   - Validated server-side using constant-time comparison (`crypto.timingSafeEqual`).
4. **PostgreSQL-Backed Rate Limiting**:
   - Login attempts throttled to a maximum of 5 attempts per 15-minute window per IP + email identity.
   - Throttle keys are hashed using **HMAC-SHA256** with `RATE_LIMIT_SECRET` to protect user privacy in database logs.
   - Excess attempts return `429 Too Many Requests` with a `Retry-After` header.
5. **PostgreSQL Concurrency Protection**:
   - Leave approval transactions acquire row-level locks on employee records (`SELECT ... FOR UPDATE`).
   - Eliminates race conditions where concurrent requests could exceed available leave balance.
6. **HTTP Security Headers & Transport Security**:
   - `Content-Security-Policy`: Restricts scripts, styles, and connections to `'self'`.
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - `Cache-Control: no-store, no-cache, must-revalidate, private` on authenticated endpoints.
   - `Strict-Transport-Security` (HSTS): Enforced automatically at the platform edge by Vercel and Render HTTPS reverse proxies during TLS termination (rather than injected by the Node.js application process), ensuring all browser transport remains strictly encrypted.

---

## 7. Local Development

LeaveFlow HR supports two local development workflows:

### Path A: In-Memory PostgreSQL Emulation using pg-mem (Zero Setup)

Recommended for quick evaluation and UI/feature testing without installing PostgreSQL:

**PowerShell (Windows)**:
```powershell
$env:ALLOW_IN_MEMORY_DB="true"
$env:PORT="3000"
node backend/server.cjs
```

**Bash / macOS / Linux**:
```bash
ALLOW_IN_MEMORY_DB=true PORT=3000 node backend/server.cjs
```

The server will automatically initialize an in-memory PostgreSQL instance with seeded test accounts at:
`http://localhost:3000`

### Path B: Real PostgreSQL Database

To test against an actual PostgreSQL instance (local or hosted):

1. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Configure your connection string and rate limit secret:
   ```env
   DATABASE_URL=postgresql://postgres:password@localhost:5432/leaveflow_db
   RATE_LIMIT_SECRET=your_32_character_cryptographically_random_secret_here
   ```
3. Run the application:
   ```powershell
   npm start
   ```

### Seed Credentials for Testing

| Role | Name | Email | Password |
| :--- | :--- | :--- | :--- |
| **Admin** | Priya Nair | `admin@leaveflow.test` | `admin123` |
| **Manager** | Rajesh Patel | `manager@leaveflow.test` | `manager123` |
| **Employee** | Aarav Sharma | `aarav@leaveflow.test` | `emp123` |
| **Employee** | Diya Mehta | `diya@leaveflow.test` | `emp123` |
| **Employee** | Rohan Verma | `rohan@leaveflow.test` | `emp123` |

*(Note: Passwords are automatically hashed with Argon2id upon database initialization).*

---

## 8. Environment Variables Reference

Every environment variable read by backend code is documented below:

| Variable | Scope | Type | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `PORT` | All | Integer | `3000` | Port on which the HTTP server listens. |
| `NODE_ENV` | All | String | `development` | Runtime mode (`development`, `test`, `production`). In `production`, strict security assertions and Secure cookies are enforced. |
| `DATABASE_URL` | Production | String (URI) | None | Standard PostgreSQL connection URI. **Required in production**. |
| `RATE_LIMIT_SECRET` | Production | String | None | Cryptographic secret (>= 32 chars) for HMAC-SHA256 rate-limit keys. **Required in production**. |
| `ALLOW_IN_MEMORY_DB` | Dev/Test only | Boolean | `false` | Enables in-memory PostgreSQL emulation (`pg-mem`). **Strictly forbidden in production** (aborts startup). |
| `ALLOW_DB_RESET` | Dev/Test only | Boolean | `false` | Required flag to allow running `node backend/server.cjs --reset-db`. **Strictly forbidden in production**. |
| `DATABASE_SSL` | Optional | Boolean | `false` | Enforces TLS/SSL configuration on the `pg` connection pool. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Optional | Boolean | `true` | When set to `false`, allows connecting to cloud providers using self-signed or internal CA certs. |
| `DATABASE_POOL_MAX` | Optional | Integer | `10` | Maximum number of concurrent connections in the PostgreSQL pool. |

---

## 9. Testing & Quality Assurance

LeaveFlow HR includes comprehensive regression and verification test suites covering all security, API, and accessibility requirements.

### Test Commands

```powershell
# Run the authoritative Master Verification Suite (Phase 5B & full regressions)
npm test

# Run individual phase regression suites
npm run test:phase1    # Vercel rewrite, API hardening, parsing safety
npm run test:phase2    # RBAC privacy scoping, team isolation, self-approval
npm run test:phase3    # PostgreSQL connection pooling, transactions, FOR UPDATE row locking
npm run test:phase4    # Argon2id hashing, session engine, CSRF, HMAC rate limits, security headers
npm run test:phase5a   # WCAG AA contrast, ARIA semantics, isolated feedback containers
npm run test:phase5b   # Real browser CDP zero-overflow across 6 viewports, responsive layout

# Master preflight check
npm run verify

# Automated screenshot suite (CDP device emulation across 75 viewport/scenario combinations)
npm run screenshots:phase5b

# Dependency security audit
npm audit

# Syntax check across all JavaScript files
node --check backend/server.cjs
node --check backend/database.cjs
node --check public/app.js
```

### PostgreSQL Test Coverage Note
- When `DATABASE_URL` is omitted, test suites automatically use fast, deterministic in-memory PostgreSQL emulation via `pg-mem`.
- When `DATABASE_URL` is supplied, tests execute live against the targeted PostgreSQL database, including transaction concurrency races.

---

## 10. Deployment Guide

Detailed step-by-step production deployment instructions, cloud secret configurations, and release sequences are provided in:
👉 **[DEPLOYMENT.md](DEPLOYMENT.md)**

---

## 11. Known Limitations & Scope Boundaries

To maintain technical integrity, the following intentional boundaries are documented:

1. **Portfolio / Demonstration Context**: Seed demo credentials are intentionally documented and discoverable in the UI for review purposes.
2. **Shared State**: Public demo users on deployed environments may modify shared demo balances and requests.
3. **Out-of-Scope Features**: Automated email notifications, password-reset emails, SSO/SAML integration, and visual audit log explorers are not included in this release.
4. **Cloud Free-Tier Characteristics**: Render free-tier Web Services may experience cold-start spin-up delays (~30–50s) on initial connection. Pending UI states handle this gracefully.
5. **Post-Deployment Verification**: Vercel proxy-cookie forwarding and managed PostgreSQL persistence require final live smoke testing after deployment as outlined in `DEPLOYMENT.md`.

---

## 12. License & Author

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Author**: Rakesh Kumar  
**GitHub**: https://github.com/rakeshkumar0804

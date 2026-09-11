# LeaveFlow HR

<div align="center">

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Security](https://img.shields.io/badge/Cryptography-Argon2id-critical?style=for-the-badge)](https://en.wikipedia.org/wiki/Argon2)
[![Accessibility](https://img.shields.io/badge/Accessibility-WCAG_AA-success?style=for-the-badge)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Frontend Status](https://img.shields.io/badge/Frontend-Vercel_Live-black?style=for-the-badge&logo=vercel)](https://leaveflow-hr-ten.vercel.app/)
[![Backend Status](https://img.shields.io/badge/Backend-Render_Live-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://leaveflow-hr-hvfh.onrender.com/)

**A production-hardened, zero-framework Employee Leave Management System engineered with native Node.js, PostgreSQL row-level concurrency control, Argon2id cryptography, and a premium dark SaaS dashboard.**

[Live Application](https://leaveflow-hr-ten.vercel.app/) • [API Endpoint](https://leaveflow-hr-hvfh.onrender.com/) • [Deployment Guide](DEPLOYMENT.md) • [Demo Credentials](#-demo-credentials)

</div>

---

## 📖 Table of Contents

1. [Project Overview](#-project-overview)
2. [Live Deployments](#-live-deployments)
3. [Interface Showcase](#-interface-showcase)
4. [Demo Credentials](#-demo-credentials)
5. [Core Engineering Highlights](#-core-engineering-highlights)
6. [Role & Authorization Matrix (RBAC)](#-role--authorization-matrix-rbac)
7. [System Architecture](#-system-architecture)
8. [Project Structure](#-project-structure)
9. [Local Development](#-local-development)
10. [Environment Variables Reference](#-environment-variables-reference)
11. [Testing & Quality Assurance](#-testing--quality-assurance)
12. [Deployment & Release Sequence](#-deployment--release-sequence)
13. [License & Author](#-license--author)

---

## 🌟 Project Overview

**LeaveFlow HR** is a full-stack, enterprise-grade leave management platform designed to streamline employee time-off requests, hierarchical managerial approvals, and company-wide HR governance.

Unlike conventional modern web applications laden with bloated JavaScript frameworks, LeaveFlow HR is deliberately engineered from first principles with **zero frontend frameworks**—utilizing pure vanilla HTML5, semantic CSS3 with custom design tokens, native browser Canvas visualizations, and standard CommonJS Node.js with raw PostgreSQL connection pooling.

### Key Capabilities

- **Employee Self-Service**: Employees track real-time leave balances across Annual, Sick, Casual, and Unpaid categories against an allocated 18-day balance, submit new time-off requests, and monitor chronological approval histories.
- **Hierarchical Approvals**: Department managers review pending requests exclusively for their direct reports, with automated balance validation and strict enforcement prohibiting self-approval.
- **Organization Governance**: Administrators supervise company-wide leave schedules, manage leave policies, and audit organizational leave metrics.
- **Data Minimization & Privacy**: Strict server-side access control guarantees employees cannot enumerate colleagues' profiles, read salary or private metadata, or view unrelated leave histories.
- **PostgreSQL Row Locking**: Approvals execute within atomic database transactions with row-level locks (`SELECT ... FOR UPDATE`) to mathematically eliminate race conditions that could drive leave balances below zero.
- **Calm Dark SaaS Aesthetic**: Polished dark theme interface inspired by modern enterprise tooling, with WCAG AA compliance (text contrast >= 4.5:1, status badges >= 6.3:1) and zero page-level horizontal overflow across mobile, tablet, and desktop screens.

---

## 🚀 Live Deployments

| Component | Target URL | Hosting Platform | Deployment Status |
| :--- | :--- | :--- | :---: |
| **Frontend Web Application** | [https://leaveflow-hr-ten.vercel.app/](https://leaveflow-hr-ten.vercel.app/) | **Vercel Edge Network** | **Live & Operational** |
| **Backend API Service** | [https://leaveflow-hr-hvfh.onrender.com/](https://leaveflow-hr-hvfh.onrender.com/) | **Render Web Service** | **Live & Operational** |
| **Production Database** | Managed PostgreSQL (16.x) | **Neon Serverless PostgreSQL** | **Active & Persisted** |

> [!NOTE]
> The frontend communicates with the backend via a reverse-proxy rewrite rule defined in [`vercel.json`](vercel.json) (`/api/:path* -> https://leaveflow-hr-hvfh.onrender.com/api/:path*`). This allows the browser to issue same-origin relative requests (`/api/*`), guaranteeing secure `HttpOnly`, `SameSite=Lax` cookie delivery without third-party cross-origin cookie blocking.

---

## 📸 Interface Showcase

### Admin Console — Organization Overview (Desktop: 1440×900)
Supervisory dashboard with company-wide leave distribution analytics, department breakdown, and global leave history.
![LeaveFlow HR Organization Leave Dashboard Desktop](docs/screenshots/admin_dashboard_desktop.png)

### Manager Portal — Team Approvals (Tablet: 1024×768)
Direct-report approval queue with real-time balance safeguards, dynamic filter buttons, and team analytics.
![LeaveFlow HR Team Leave Dashboard Tablet](docs/screenshots/manager_dashboard_tablet.png)

### Employee Workspace — Personal Leave Dashboard (Mobile: 390×844)
Optimized responsive mobile interface with zero page overflow, touch-friendly inputs, and isolated action feedback.
![LeaveFlow HR My Leave Dashboard Mobile](docs/screenshots/employee_dashboard_mobile.png)

### Minimalist Authentication Screen (Desktop: 1440×900)
Secure authentication interface featuring quick-fill demo buttons for rapid role testing.
![LeaveFlow HR Login Desktop](docs/screenshots/login_desktop.png)

---

## 👥 Demo Credentials

The database comes pre-seeded with realistic, role-differentiated demonstration accounts:

| Role | Name | Email | Password | Scope & Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | Priya Nair | `admin@leaveflow.test` | `admin123` | Full supervisory access; reviews all company requests; company analytics |
| **Manager** | Rajesh Patel | `manager@leaveflow.test` | `manager123` | Reviews direct reports only; team analytics; self-approval prohibited |
| **Employee** | Aarav Sharma | `aarav@leaveflow.test` | `emp123` | Submits personal requests; views own balance and personal history only |
| **Employee** | Diya Mehta | `diya@leaveflow.test` | `emp123` | Submits personal requests; reports to Rajesh Patel |
| **Employee** | Rohan Verma | `rohan@leaveflow.test` | `emp123` | Submits personal requests; reports to Rajesh Patel |

*(All passwords are cryptographically hashed using Argon2id with unique random salts upon database initialization).*

---

## 🛡️ Core Engineering Highlights

### 1. Zero-Framework Vanilla Architecture
- **Frontend**: Pure HTML5 and modern CSS3 utilizing CSS custom properties (`--bg-app`, `--panel-bg`, `--border-subtle`) and native system sans-serif typography (`ui-sans-serif, system-ui, -apple-system, Segoe UI`). Zero external font CDNs, zero Tailwind CSS, zero React, and zero build tool overhead.
- **Data Visualizations**: Custom High-DPI HTML5 Canvas chart renderer with sub-pixel crispness, debounced resize handling, and hidden ARIA live text summaries for screen readers.
- **Backend**: Native Node.js `http.createServer` application running CommonJS modules without Express or heavy middleware.

### 2. Defense-in-Depth Security Model
- **Argon2id Password Hashing**: Passwords hashed with **Argon2id** via the native `argon2` library. Constant-time dummy hash evaluations prevent user enumeration when unregistered email addresses are queried.
- **Revocable Server-Side Sessions**: 256-bit cryptographically random tokens (`crypto.randomBytes(32)`) delivered via `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800` (8 hours), `Secure` cookies. The database persists exclusively **SHA-256 hashes** of tokens—never plaintext session tokens. No tokens are stored in `localStorage` or `sessionStorage`.
- **Double-Submit CSRF Defense**: Dynamic anti-CSRF token bound to the server session, delivered on authentication/bootstrap, and validated server-side using constant-time buffer comparison (`crypto.timingSafeEqual`) on all state-changing endpoints (`POST /api/leave-requests`, `POST /api/leave-requests/:id/review`, `POST /api/logout`).
- **HMAC-SHA256 Login Rate Limiting**: PostgreSQL-backed rate limiting throttles authentication to 5 attempts per 15-minute window per IP + email identity. Rate-limit identifiers are hashed with **HMAC-SHA256** using `RATE_LIMIT_SECRET` to protect user IP privacy in database tables.
- **HTTP Security Headers**: Comprehensive headers enforced on all responses:
  - `Content-Security-Policy`: Restricts scripts, styles, and connections strictly to `'self'`.
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (clickjacking mitigation)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` on authenticated API endpoints.
  - `Strict-Transport-Security` (HSTS): Enforced at the cloud platform edge by Vercel and Render HTTPS reverse proxies.

### 3. PostgreSQL Concurrency & Balance Protection
To eliminate double-spending race conditions where concurrent approval clicks could exhaust an employee's leave balance below zero, leave reviews are wrapped in atomic PostgreSQL transactions with row-level locks:
```sql
BEGIN;
SELECT id, remaining_days FROM employees WHERE id = $1 FOR UPDATE;
-- Validates remaining_days >= requested_days before applying approval decrement
UPDATE employees SET remaining_days = remaining_days - $2 WHERE id = $1;
UPDATE leave_requests SET status = 'Approved', updated_at = NOW() WHERE id = $3;
COMMIT;
```

### 4. WCAG AA Accessibility & Zero-Overflow Layout
- **High Contrast**: Verified text and UI contrast exceeding WCAG AA requirements (Normal text >= 17:1 on dark surfaces; Pending badge: 10.9:1; Approved badge: 9.4:1; Rejected badge: 6.5:1).
- **Keyboard Navigation**: High-contrast `:focus-visible` outline rings (`#38bdf8`) on all interactive controls with `prefers-reduced-motion` support.
- **Screen Reader Semantics**: Proper ARIA live message containers (`aria-live="polite"`), toggle attributes (`aria-pressed`), dynamic validation states (`aria-invalid`), and table header scoping.
- **Browser Automation Verification**: Validated via real Chrome Headless CDP automation across 6 standard viewport breakpoints (1440×900, 1280×800, 1024×768, 768×1024, 390×844, 360×800) with zero horizontal document scrollbar overflow.

---

## 🔒 Role & Authorization Matrix (RBAC)

All authorization boundaries are strictly verified on the server side:

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

## 📐 System Architecture

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

- **Frontend Distribution**: Hosted at Vercel Edge with global CDN caching for static HTML, CSS, and JS assets.
- **Edge Routing**: `vercel.json` rewrites incoming relative `/api/:path*` calls directly to the Render backend service.
- **Application Layer**: Node.js `http.createServer` service running CommonJS without third-party web frameworks.
- **Persistence Layer**: Provider-neutral PostgreSQL accessed via the official `pg` (node-postgres) connection pool.

---

## 📁 Project Structure

```text
leaveflow-hr/
├── backend/
│   ├── database.cjs       # PostgreSQL schema, connection pooling, migrations & queries
│   └── server.cjs         # HTTP server, routing, cookies, session engine & security headers
├── data/
│   └── leave-management.sqlite # Tracked legacy baseline database (preserved untouched)
├── docs/
│   └── screenshots/       # Curated production release screenshots (Desktop, Tablet, Mobile)
│       ├── admin_dashboard_desktop.png
│       ├── employee_dashboard_mobile.png
│       ├── login_desktop.png
│       └── manager_dashboard_tablet.png
├── public/
│   ├── app.js             # Vanilla client application, state machine & Canvas chart engine
│   ├── index.html         # Semantic HTML5 markup, ARIA containers & role shells
│   └── styles.css         # Dark SaaS design system, responsive grid & WCAG AA tokens
├── scripts/
│   ├── capture_phase5b_screenshots.cjs # Automated 75-viewport CDP screenshot generator
│   ├── scan_secrets.cjs   # Repository-wide secret and credential scanner
│   ├── verify_clean_install.cjs        # Clean npm ci and startup verification
│   └── verify_prod_isolation.cjs       # Production dependency isolation tester
├── .env.example           # Safe environment variable configuration template
├── .gitignore             # Comprehensive Git ignore rules (ignoring node_modules, logs, etc.)
├── DEPLOYMENT.md          # Production deployment guide, cloud checklists & rollback plan
├── LICENSE                # MIT License
├── package.json           # Node.js 24.x engine, scripts matrix & pinned dependencies
├── package-lock.json      # Dependency lockfile
├── vercel.json            # Vercel Edge proxy rewrite configuration
└── README.md              # Project documentation
```

---

## 💻 Local Development

LeaveFlow HR supports two local development workflows:

### Path A: Zero-Config In-Memory PostgreSQL Emulation (`pg-mem`)

Ideal for quick evaluation and UI/feature testing without needing PostgreSQL installed:

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

The server initializes an in-memory PostgreSQL instance with seeded test accounts at:
👉 **`http://localhost:3000`**

### Path B: Real PostgreSQL Database

To develop against a real PostgreSQL instance (local or hosted):

1. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Configure your connection string and rate limit secret in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:password@localhost:5432/leaveflow_db
   RATE_LIMIT_SECRET=your_32_character_cryptographically_random_secret_here
   ```
3. Start the application:
   ```powershell
   npm start
   ```

---

## ⚙️ Environment Variables Reference

Every environment variable utilized by the application backend is detailed below:

| Variable | Scope | Type | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `PORT` | All | Integer | `3000` | Port on which the HTTP server listens. |
| `NODE_ENV` | All | String | `development` | Runtime mode (`development`, `test`, `production`). Strict security assertions and `Secure` cookies enforced in `production`. |
| `DATABASE_URL` | Production | String (URI) | None | Standard PostgreSQL connection URI. **Required in production**. |
| `RATE_LIMIT_SECRET` | Production | String | None | Cryptographic secret (>= 32 chars) for HMAC-SHA256 rate-limit keys. **Required in production**. |
| `ALLOW_IN_MEMORY_DB` | Dev/Test only | Boolean | `false` | Enables in-memory PostgreSQL emulation (`pg-mem`). **Strictly forbidden in production** (aborts startup). |
| `ALLOW_DB_RESET` | Dev/Test only | Boolean | `false` | Guard flag for `node backend/server.cjs --reset-db`. **Strictly forbidden in production**. |
| `DATABASE_SSL` | Optional | Boolean | `false` | Enables TLS/SSL connection to cloud PostgreSQL providers. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Optional | Boolean | `true` | Set to `false` if cloud PostgreSQL provider uses self-signed or internal CA certificates. |
| `DATABASE_POOL_MAX` | Optional | Integer | `10` | Maximum concurrent connections in the PostgreSQL pool. |

---

## 🧪 Testing & Quality Assurance

LeaveFlow HR includes rigorous automated verification and regression suites covering all security, API, parsing, concurrency, accessibility, and responsive requirements.

### Test Commands Matrix

```powershell
# Run the authoritative Master Preflight Suite (Phase 5B & full regressions)
npm test

# Run individual phase regression suites
npm run test:phase1    # Vercel rewrite, API parsing safety, network recovery
npm run test:phase2    # RBAC privacy scoping, team isolation, self-approval guards
npm run test:phase3    # PostgreSQL connection pool, migrations, FOR UPDATE locking
npm run test:phase4    # Argon2id hashing, session engine, CSRF, HMAC rate limits, headers
npm run test:phase5a   # WCAG AA contrast, ARIA semantics, isolated feedback containers
npm run test:phase5b   # Real browser CDP zero-overflow across 6 viewports, responsive layout

# Master preflight check
npm run verify

# Automated screenshot suite (CDP device emulation across 75 viewport/scenario combinations)
npm run screenshots:phase5b

# Dependency security audit
npm audit

# Secret scanner across all candidate files
node scripts/scan_secrets.cjs

# Production dependency isolation test (verifies npm ci --omit=dev without pg-mem)
node scripts/verify_prod_isolation.cjs
```

---

## 🚀 Deployment & Release Sequence

Detailed production deployment procedures, cloud environment configuration on Render and Vercel, and the 7-category live post-deployment smoke test checklist are provided in:
👉 **[DEPLOYMENT.md](DEPLOYMENT.md)**

---

## 📄 License & Author

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

**Author**: **Rakesh Kumar**
**GitHub**: [@rakeshkumar0804](https://github.com/rakeshkumar0804)
**Project Repository**: [https://github.com/rakeshkumar0804/leaveflow-hr](https://github.com/rakeshkumar0804/leaveflow-hr)

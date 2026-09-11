const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const {
  openDatabase,
  getUserByEmail,
  getUserForAuth,
  getUsers,
  getRequests,
  getBalances,
  getMetrics,
  getChartData,
  createLeaveRequest,
  updateRequestStatus,
  createSession,
  getSessionByToken,
  revokeSession,
  cleanupExpiredSessions,
  getRateLimitKey,
  checkRateLimit,
  recordFailedLogin,
  clearRateLimit,
  cleanupExpiredRateLimits,
  verifyPassword,
  dummyVerifyPassword,
  sanitizeDatabaseUrl,
  dbPath,
  SESSION_LIFETIME_SECONDS,
  validateRateLimitSecret
} = require("./database.cjs");

let pool = null;
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");

function setPool(p) {
  pool = p;
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function setSecurityHeaders(response, urlPath) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (urlPath && urlPath.startsWith("/api/")) {
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key && cookies[key] === undefined) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function serializeCookie(name, val, options = {}) {
  const isProd = process.env.NODE_ENV === "production";
  // Production safeguard: always enforce Secure flag in production environment
  const secure = isProd ? true : Boolean(options.secure);
  const parts = [`${name}=${encodeURIComponent(val)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    if (ips[0]) return ips[0];
  }
  return request.socket?.remoteAddress || "127.0.0.1";
}

function validateCsrf(request, session) {
  const presented = request.headers["x-csrf-token"];
  if (!presented || typeof presented !== "string") return false;
  if (!session || !session.csrfToken) return false;

  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(session.csrfToken);
  if (presentedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(presentedBuf, expectedBuf);
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Payload too large"));
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function publicUser(user) {
  return {
    id: user.id,
    employeeCode: user.employee_code,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    designation: user.designation
  };
}

function toDateString(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "string") {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : val;
  }
  return String(val);
}

function toIsoString(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toISOString();
  }
  return String(val);
}

function normalizeRequest(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeCode: row.employee_code,
    department: row.department,
    designation: row.designation,
    leaveType: row.leave_type,
    startDate: toDateString(row.start_date),
    endDate: toDateString(row.end_date),
    days: Number(row.days),
    reason: row.reason,
    status: row.status,
    reviewerName: row.reviewer_name || null,
    reviewedAt: toIsoString(row.reviewed_at),
    createdAt: toIsoString(row.created_at)
  };
}

function normalizeEmployee(row) {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    department: row.department,
    designation: row.designation,
    managerId: row.manager_id,
    annualBalance: Number(row.annual_balance),
    sickBalance: Number(row.sick_balance),
    casualBalance: Number(row.casual_balance),
    annualAvailable: Number(row.annual_available),
    sickAvailable: Number(row.sick_available),
    casualAvailable: Number(row.casual_available)
  };
}

async function getBootstrap(user, poolInstance = pool) {
  const balances = await getBalances(poolInstance, user);
  const requests = await getRequests(poolInstance, user);
  const metrics = await getMetrics(poolInstance, user);
  const charts = await getChartData(poolInstance, user);

  return {
    user: publicUser(user),
    employees: balances.map(normalizeEmployee),
    requests: requests.map(normalizeRequest),
    metrics,
    charts
  };
}

async function handleApi(request, response, url) {
  setSecurityHeaders(response, url.pathname);

  // Production safeguard: enforce HTTPS in production
  if (process.env.NODE_ENV === "production") {
    const proto = request.headers["x-forwarded-proto"];
    const isEncrypted = Boolean(request.socket?.encrypted || proto === "https");
    if (!isEncrypted) {
      sendJson(response, 403, { error: "HTTPS is required in production." });
      return;
    }
  }

  try {
    if (!pool) {
      sendJson(response, 503, { error: "Database not initialized." });
      return;
    }

    // ------------------------------------------------------------------------
    // POST /api/login: Authentication with Rate Limiting & Argon2id
    // ------------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(request);
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";

      if (!email || !password || email.length > 255 || password.length > 255) {
        sendJson(response, 400, { error: "Invalid email or password format." });
        return;
      }

      // Check rate limit before performing expensive cryptographic operations
      const clientIp = getClientIp(request);
      const rateLimitKey = getRateLimitKey(email, clientIp);
      const limitCheck = await checkRateLimit(pool, rateLimitKey);
      if (limitCheck.blocked) {
        response.setHeader("Retry-After", String(limitCheck.retryAfter));
        sendJson(response, 429, { error: "Too many login attempts. Please try again later." });
        return;
      }

      const user = await getUserForAuth(pool, email);

      if (!user) {
        // Timing mitigation: perform dummy verification against pre-computed Argon2id hash
        await dummyVerifyPassword(password);
        await recordFailedLogin(pool, rateLimitKey);
        sendJson(response, 401, { error: "Invalid email or password." });
        return;
      }

      const valid = await verifyPassword(user.password_hash, password);
      if (!valid) {
        await recordFailedLogin(pool, rateLimitKey);
        sendJson(response, 401, { error: "Invalid email or password." });
        return;
      }

      // Successful authentication: clear rate limits, bounded cleanup of expired sessions & limits
      await clearRateLimit(pool, rateLimitKey);
      await cleanupExpiredSessions(pool, 500);
      await cleanupExpiredRateLimits(pool, 500);

      const session = await createSession(pool, user.id);
      const sessionCookie = serializeCookie("leaveflow_session", session.token, {
        maxAge: SESSION_LIFETIME_SECONDS,
        path: "/",
        httpOnly: true,
        sameSite: "Lax"
      });
      response.setHeader("Set-Cookie", sessionCookie);

      sendJson(response, 200, {
        user: publicUser(user),
        csrfToken: session.csrfToken
      });
      return;
    }

    // ------------------------------------------------------------------------
    // Session Resolution for Protected Endpoints
    // ------------------------------------------------------------------------
    const cookies = parseCookies(request.headers.cookie);
    const rawSessionToken = cookies.leaveflow_session;
    const session = rawSessionToken ? await getSessionByToken(pool, rawSessionToken) : null;

    if (!session) {
      sendJson(response, 401, { error: "Please log in to continue." });
      return;
    }

    const user = session.user;

    // ------------------------------------------------------------------------
    // CSRF Protection on State-Changing Authenticated Methods
    // ------------------------------------------------------------------------
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      if (!validateCsrf(request, session)) {
        sendJson(response, 403, { error: "Invalid or missing CSRF token." });
        return;
      }
    }

    // ------------------------------------------------------------------------
    // POST /api/logout
    // ------------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/logout") {
      if (rawSessionToken) {
        await revokeSession(pool, rawSessionToken);
      }
      const isProd = process.env.NODE_ENV === "production";
      const clearCookie = serializeCookie("leaveflow_session", "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: isProd
      });
      response.setHeader("Set-Cookie", clearCookie);
      sendJson(response, 200, { success: true });
      return;
    }

    // ------------------------------------------------------------------------
    // GET /api/bootstrap
    // ------------------------------------------------------------------------
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const data = await getBootstrap(user);
      sendJson(response, 200, { ...data, csrfToken: session.csrfToken });
      return;
    }

    // ------------------------------------------------------------------------
    // GET /api/employees
    // ------------------------------------------------------------------------
    if (request.method === "GET" && url.pathname === "/api/employees") {
      if (!["admin", "manager"].includes(user.role)) {
        sendJson(response, 403, { error: "Employees cannot access full employee records." });
        return;
      }
      const balances = await getBalances(pool, user);
      sendJson(response, 200, { employees: balances.map(normalizeEmployee) });
      return;
    }

    // ------------------------------------------------------------------------
    // POST /api/leave-requests
    // ------------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/leave-requests") {
      const body = await readBody(request);
      await createLeaveRequest(pool, user, body);
      const data = await getBootstrap(user);
      sendJson(response, 201, { ...data, csrfToken: session.csrfToken });
      return;
    }

    // ------------------------------------------------------------------------
    // PATCH /api/leave-requests/:id/status
    // ------------------------------------------------------------------------
    const statusMatch = url.pathname.match(/^\/api\/leave-requests\/([^/]+)\/status$/);
    if (request.method === "PATCH" && statusMatch) {
      const body = await readBody(request);
      await updateRequestStatus(pool, user, statusMatch[1], String(body.status || ""));
      const data = await getBootstrap(user);
      sendJson(response, 200, { ...data, csrfToken: session.csrfToken });
      return;
    }

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    const isClientError = [
      "Please choose",
      "Please enter",
      "Managers can",
      "Leave dates overlap",
      "Requested days exceed",
      "Invalid approval action",
      "Only managers and admins",
      "Leave request not found",
      "This request has already been reviewed",
      "Cannot approve",
      "Employees cannot access"
    ].some((msg) => error.message && error.message.includes(msg));

    if (isClientError) {
      sendJson(response, 400, { error: error.message });
    } else {
      console.error("API service error:", error.message);
      sendJson(response, 500, { error: "Service temporarily unavailable. Please try again in a moment." });
    }
  }
}

function serveStatic(request, response, url) {
  setSecurityHeaders(response, url.pathname);

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(publicDir, `.${pathname}`);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "text/plain" });
    response.end(content);
  });
}

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) {
      console.error("FATAL: DATABASE_URL environment variable is required in production mode.");
      process.exit(1);
    }
    try {
      validateRateLimitSecret();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const shouldReset = process.argv.includes("--reset-db");
  if (shouldReset) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DB_RESET !== "true") {
      console.error("FATAL: Database reset is not permitted in production or without ALLOW_DB_RESET=true.");
      process.exit(1);
    }
  }

  if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production" && process.env.ALLOW_IN_MEMORY_DB !== "true") {
    console.error("ERROR: No DATABASE_URL provided. Please configure DATABASE_URL or set ALLOW_IN_MEMORY_DB=true for local in-memory development.");
    process.exit(1);
  }

  try {
    if (process.env.DATABASE_URL) {
      console.log(`Connecting to PostgreSQL database at ${sanitizeDatabaseUrl(process.env.DATABASE_URL)}...`);
    } else {
      console.warn("[WARN] Starting with transient in-memory PostgreSQL database (ALLOW_IN_MEMORY_DB=true). Data will reset on server restart.");
    }

    pool = await openDatabase({ reset: shouldReset });
    if (shouldReset) {
      console.log("Database reset completed successfully.");
      process.exit(0);
    }
  } catch (err) {
    console.error("Database connection/initialization failure:", err.message);
    process.exit(1);
  }

  // Periodic bounded cleanup: sweeps up to 500 expired sessions & rate limit records every 15 minutes
  const cleanupTimer = setInterval(async () => {
    if (pool) {
      await cleanupExpiredSessions(pool, 500).catch(() => {});
      await cleanupExpiredRateLimits(pool, 500).catch(() => {});
    }
  }, 15 * 60 * 1000);
  cleanupTimer.unref();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `localhost:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url);
      return;
    }

    serveStatic(request, response, url);
  });

  server.listen(port, () => {
    console.log(`Employee Leave Management System running at http://localhost:${port}`);
  });

  return { server, pool };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  handleApi,
  getBootstrap,
  normalizeRequest,
  normalizeEmployee,
  publicUser,
  setPool,
  parseCookies,
  serializeCookie,
  getClientIp,
  validateCsrf,
  setSecurityHeaders
};

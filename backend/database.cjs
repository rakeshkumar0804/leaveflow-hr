const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool, types } = require("pg");
const argon2 = require("argon2");

// Configure pg type parser for DATE (OID 1082) so date strings return as YYYY-MM-DD
types.setTypeParser(1082, (val) => val);

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "leave-management.sqlite");

// OWASP-compliant Argon2id configuration (~19 MiB memory, 2 iterations, 1 parallelism)
const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1
};

// Stable pre-computed dummy hash used to mitigate timing attacks on non-existent accounts
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$4p/35hDSNuGK5ax/9ju5lQ$7b67OlUnJ5T+H/OTjtVEM02W98cg7MT0lPDiiogDxcI";

// Stable pre-computed Argon2id hashes for demo seed accounts
const SEED_PASSWORD_HASHES = {
  admin123: "$argon2id$v=19$m=19456,p=1,t=2$4p/35hDSNuGK5ax/9ju5lQ$7b67OlUnJ5T+H/OTjtVEM02W98cg7MT0lPDiiogDxcI",
  manager123: "$argon2id$v=19$m=19456,p=1,t=2$TYS6dhIT5qkfH7UAJN9yCA$0LuPC7o7c4FYXsdI8S3Kvs7BMGeRwjKU5hs1HGpI8II",
  emp123: "$argon2id$v=19$m=19456,p=1,t=2$va5BdEXmbQzxIZRQf0eEGg$D0W5vZAiVOPzDqmsO2uX/yc7+DWhaiw0tOcIMjsF8zE"
};

async function hashPassword(password) {
  return await argon2.hash(password, ARGON2_CONFIG);
}

async function verifyPassword(hash, password) {
  if (!hash || !password) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function dummyVerifyPassword(password) {
  try {
    await argon2.verify(DUMMY_ARGON2_HASH, password || "dummy");
  } catch {}
  return false;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function parseLocalDate(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function calculateDays(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return 0;
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return 0;
  return Math.round(diff / 86400000) + 1;
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

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function sanitizeDatabaseUrl(url) {
  if (!url) return "<none>";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port || "5432";
    const db = parsed.pathname.replace(/^\//, "");
    return `postgresql://****:****@${host}:${port}/${db}`;
  } catch {
    return "postgresql://****:****@****/dbname";
  }
}

function createInMemoryPool() {
  const { newDb } = require("pg-mem");
  const mem = newDb();
  const { Pool: MemPool } = mem.adapters.createPg();
  return new MemPool();
}

function getPoolConfig(connectionString) {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required.");
  }

  const sslEnv = process.env.DATABASE_SSL;
  let ssl = undefined;
  if (sslEnv === "true" || (url.includes("sslmode=require") && sslEnv !== "false")) {
    ssl = {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
    };
  }

  return {
    connectionString: url,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  };
}

async function openDatabase({ reset = false, inMemory = false, pool: customPool } = {}) {
  let pool = customPool;
  if (!pool) {
    if (inMemory || process.env.ALLOW_IN_MEMORY_DB === "true" || (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production")) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("In-memory database is strictly forbidden in production mode.");
      }
      pool = createInMemoryPool();
    } else {
      const config = getPoolConfig();
      pool = new Pool(config);
    }
  }

  if (reset) {
    await resetDatabase(pool);
  } else {
    await initDatabase(pool);
  }

  return pool;
}

async function resetDatabase(pool) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database reset is strictly prohibited in production.");
  }
  if (process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("Database reset requires ALLOW_DB_RESET=true environment variable.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP TABLE IF EXISTS login_attempts CASCADE");
    await client.query("DROP TABLE IF EXISTS sessions CASCADE");
    await client.query("DROP TABLE IF EXISTS leave_requests CASCADE");
    await client.query("DROP TABLE IF EXISTS users CASCADE");
    await client.query("COMMIT");
    await initDatabase(pool);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function initDatabase(pool) {
  await createSchema(pool);
  await migrateSchema(pool);
  await seedDatabase(pool);
}

async function createSchema(pool) {
  let usersExist = false;
  try {
    await pool.query("SELECT 1 FROM users LIMIT 0");
    usersExist = true;
  } catch {}

  if (!usersExist) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        employee_code VARCHAR(32) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
        department VARCHAR(128) NOT NULL,
        designation VARCHAR(128) NOT NULL,
        manager_id VARCHAR(64),
        annual_balance INTEGER NOT NULL DEFAULT 18,
        sick_balance INTEGER NOT NULL DEFAULT 8,
        casual_balance INTEGER NOT NULL DEFAULT 6,
        joined_on DATE NOT NULL,
        FOREIGN KEY (manager_id) REFERENCES users(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
    `);
  }

  let requestsExist = false;
  try {
    await pool.query("SELECT 1 FROM leave_requests LIMIT 0");
    requestsExist = true;
  } catch {}

  if (!requestsExist) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id VARCHAR(64) PRIMARY KEY,
        employee_id VARCHAR(64) NOT NULL,
        leave_type VARCHAR(32) NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(32) NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
        reviewed_by VARCHAR(64),
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES users(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      );
    `);
  }

  let sessionsExist = false;
  try {
    await pool.query("SELECT 1 FROM sessions LIMIT 0");
    sessionsExist = true;
  } catch {}

  if (!sessionsExist) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        csrf_token VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
    `);
  }

  let loginAttemptsExist = false;
  try {
    await pool.query("SELECT 1 FROM login_attempts LIMIT 0");
    loginAttemptsExist = true;
  } catch {}

  if (!loginAttemptsExist) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key VARCHAR(64) PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 1,
        first_attempt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_attempt TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        blocked_until TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS login_attempts_blocked_until_idx ON login_attempts (blocked_until);
    `);
  }
}

async function migrateSchema(pool) {
  let usersExist = false;
  try {
    await pool.query("SELECT 1 FROM users LIMIT 0");
    usersExist = true;
  } catch {}
  if (!usersExist) return;

  const colRes = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users'
  `);
  const colNames = colRes.rows.map((r) => r.column_name);

  // If password column exists (legacy Phase 3 schema)
  if (colNames.includes("password")) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (!colNames.includes("password_hash")) {
        await client.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)");
      }

      const rows = await client.query("SELECT id, password, password_hash FROM users");
      for (const row of rows.rows) {
        if (!row.password_hash) {
          let hash;
          if (row.password && row.password.startsWith("$argon2id$")) {
            hash = row.password;
          } else {
            hash = await hashPassword(row.password || "");
          }
          await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, row.id]);
        }
      }

      // Check all rows have password_hash
      const nullCheck = await client.query("SELECT COUNT(*) AS count FROM users WHERE password_hash IS NULL");
      if (Number(nullCheck.rows[0].count) === 0) {
        await client.query("ALTER TABLE users DROP COLUMN password");
        try {
          await client.query("ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL");
        } catch {}
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function seedDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const users = [
      ["u-admin", "EMP-001", "Priya Menon", "admin@leaveflow.test", SEED_PASSWORD_HASHES.admin123, "admin", "People Operations", "HR Admin", null, 24, 10, 8, "2021-01-04"],
      ["u-manager", "EMP-014", "Arjun Mehta", "manager@leaveflow.test", SEED_PASSWORD_HASHES.manager123, "manager", "Engineering", "Engineering Manager", "u-admin", 22, 8, 6, "2020-08-17"],
      ["u-101", "EMP-101", "Aarav Sharma", "aarav@leaveflow.test", SEED_PASSWORD_HASHES.emp123, "employee", "Engineering", "Frontend Developer", "u-manager", 18, 8, 6, "2023-04-10"],
      ["u-102", "EMP-102", "Meera Kapoor", "meera@leaveflow.test", SEED_PASSWORD_HASHES.emp123, "employee", "People Operations", "HR Executive", "u-admin", 20, 8, 6, "2022-11-21"],
      ["u-103", "EMP-103", "Rohan Verma", "rohan@leaveflow.test", SEED_PASSWORD_HASHES.emp123, "employee", "Sales", "Sales Manager", "u-admin", 18, 8, 6, "2021-06-07"],
      ["u-104", "EMP-104", "Nisha Iyer", "nisha@leaveflow.test", SEED_PASSWORD_HASHES.emp123, "employee", "Engineering", "QA Engineer", "u-manager", 16, 8, 6, "2023-09-18"],
      ["u-105", "EMP-105", "Kabir Khan", "kabir@leaveflow.test", SEED_PASSWORD_HASHES.emp123, "employee", "Design", "Product Designer", "u-admin", 18, 8, 6, "2024-02-12"]
    ];

    for (const user of users) {
      await client.query(
        `INSERT INTO users (
          id, employee_code, name, email, password_hash, role, department, designation, manager_id,
          annual_balance, sick_balance, casual_balance, joined_on
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING`,
        user
      );
    }

    const requests = [
      ["req-seed-1", "u-101", "Annual", offsetDate(4), offsetDate(6), "Family function in Jaipur", "Pending", null],
      ["req-seed-2", "u-104", "Casual", offsetDate(9), offsetDate(9), "Personal appointment", "Pending", null],
      ["req-seed-3", "u-103", "Sick", offsetDate(-5), offsetDate(-4), "Medical recovery and rest", "Approved", "u-admin"],
      ["req-seed-4", "u-102", "Annual", offsetDate(13), offsetDate(16), "Planned vacation", "Approved", "u-admin"],
      ["req-seed-5", "u-105", "Casual", offsetDate(-2), offsetDate(-2), "Urgent personal work", "Rejected", "u-admin"],
      ["req-seed-6", "u-101", "Sick", offsetDate(-25), offsetDate(-24), "Fever and doctor consultation", "Approved", "u-manager"],
      ["req-seed-7", "u-104", "Annual", offsetDate(20), offsetDate(22), "Travel with family", "Approved", "u-manager"]
    ];

    for (const [id, employeeId, type, start, end, reason, status, reviewer] of requests) {
      const days = calculateDays(start, end);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO leave_requests (
          id, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING`,
        [
          id,
          employeeId,
          type,
          start,
          end,
          days,
          reason,
          status,
          reviewer,
          reviewer ? now : null,
          now
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function getLeaveColumn(type) {
  return {
    Annual: "annual_balance",
    Sick: "sick_balance",
    Casual: "casual_balance"
  }[type];
}

async function getUsers(pool) {
  const res = await pool.query(
    `SELECT id, employee_code, name, email, role, department, designation, manager_id,
            annual_balance, sick_balance, casual_balance, joined_on
     FROM users
     ORDER BY employee_code ASC`
  );
  return res.rows.map((u) => ({
    ...u,
    joined_on: toDateString(u.joined_on)
  }));
}

async function getUserByEmail(pool, email) {
  const res = await pool.query(
    `SELECT id, employee_code, name, email, role, department, designation, manager_id,
            annual_balance, sick_balance, casual_balance, joined_on
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [String(email || "")]
  );
  if (!res.rows[0]) return null;
  const u = res.rows[0];
  return { ...u, joined_on: toDateString(u.joined_on) };
}

async function getUserForAuth(pool, email) {
  const res = await pool.query(
    `SELECT id, employee_code, name, email, password_hash, role, department, designation, manager_id,
            annual_balance, sick_balance, casual_balance, joined_on
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [String(email || "")]
  );
  return res.rows[0] || null;
}

async function getUserById(pool, id) {
  const res = await pool.query(
    `SELECT id, employee_code, name, email, role, department, designation, manager_id,
            annual_balance, sick_balance, casual_balance, joined_on
     FROM users WHERE id = $1`,
    [String(id || "")]
  );
  if (!res.rows[0]) return null;
  const u = res.rows[0];
  return { ...u, joined_on: toDateString(u.joined_on) };
}

async function canAccessEmployee(pool, user, employeeId) {
  if (user.role === "admin" || user.id === employeeId) return true;
  const mgrId = await getManagerIdForEmployee(pool, employeeId);
  return user.id === mgrId;
}

async function getManagerIdForEmployee(pool, employeeId) {
  const res = await pool.query("SELECT manager_id FROM users WHERE id = $1", [
    String(employeeId || "")
  ]);
  return res.rows[0] ? res.rows[0].manager_id : null;
}

async function getRequests(pool, user) {
  const sql = `
    SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.days,
           lr.reason, lr.status, lr.reviewed_by, lr.reviewed_at, lr.created_at,
           u.name AS employee_name, u.employee_code, u.department, u.designation,
           reviewer.name AS reviewer_name
    FROM leave_requests lr
    JOIN users u ON u.id = lr.employee_id
    LEFT JOIN users reviewer ON reviewer.id = lr.reviewed_by
  `;

  let res;
  if (user.role === "admin") {
    res = await pool.query(`${sql} ORDER BY lr.created_at DESC`);
  } else if (user.role === "manager") {
    res = await pool.query(
      `${sql} WHERE lr.employee_id = $1 OR u.manager_id = $2 ORDER BY lr.created_at DESC`,
      [user.id, user.id]
    );
  } else {
    res = await pool.query(
      `${sql} WHERE lr.employee_id = $1 ORDER BY lr.created_at DESC`,
      [user.id]
    );
  }
  return res.rows.map((r) => ({
    ...r,
    start_date: toDateString(r.start_date),
    end_date: toDateString(r.end_date),
    reviewed_at: toIsoString(r.reviewed_at),
    created_at: toIsoString(r.created_at)
  }));
}

async function getApprovedDays(poolOrClient, employeeId, leaveType) {
  const res = await poolOrClient.query(
    `SELECT COALESCE(SUM(days), 0) AS days
     FROM leave_requests
     WHERE employee_id = $1 AND leave_type = $2 AND status = 'Approved'`,
    [employeeId, leaveType]
  );
  return Number(res.rows[0].days);
}

async function getAvailableBalance(poolOrClient, employeeId, leaveType) {
  if (leaveType === "Unpaid") return Number.POSITIVE_INFINITY;
  const column = getLeaveColumn(leaveType);
  if (!column) return 0;

  const res = await poolOrClient.query(
    `SELECT annual_balance, sick_balance, casual_balance FROM users WHERE id = $1`,
    [employeeId]
  );
  if (res.rows.length === 0) return 0;
  const employee = res.rows[0];
  const approvedDays = await getApprovedDays(poolOrClient, employeeId, leaveType);
  return Number(employee[column]) - approvedDays;
}

async function getScopedEmployees(pool, user) {
  if (!user) return [];
  const sql = `
    SELECT id, employee_code, name, department, designation, manager_id,
           annual_balance, sick_balance, casual_balance
    FROM users
  `;

  let res;
  if (user.role === "admin") {
    res = await pool.query(`${sql} ORDER BY employee_code ASC`);
  } else if (user.role === "manager") {
    res = await pool.query(
      `${sql} WHERE id = $1 OR manager_id = $2 ORDER BY employee_code ASC`,
      [user.id, user.id]
    );
  } else {
    res = await pool.query(
      `${sql} WHERE id = $1 ORDER BY employee_code ASC`,
      [user.id]
    );
  }
  return res.rows;
}

async function getBalances(pool, user) {
  const employees = user ? await getScopedEmployees(pool, user) : await getUsers(pool);
  const balances = [];
  for (const employee of employees) {
    const annual_available = await getAvailableBalance(pool, employee.id, "Annual");
    const sick_available = await getAvailableBalance(pool, employee.id, "Sick");
    const casual_available = await getAvailableBalance(pool, employee.id, "Casual");
    balances.push({
      ...employee,
      annual_available,
      sick_available,
      casual_available
    });
  }
  return balances;
}

async function createLeaveRequest(pool, user, payload) {
  const employeeId = user.role === "employee" ? user.id : payload.employeeId;
  const leaveType = payload.leaveType;
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const reason = String(payload.reason || "").trim();
  const days = calculateDays(startDate, endDate);

  if (!["Annual", "Sick", "Casual", "Unpaid"].includes(leaveType)) {
    throw new Error("Please choose a valid leave type.");
  }
  if (!days) throw new Error("Please choose a valid date range.");
  if (!reason) throw new Error("Please enter a valid reason.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock employee row to serialize leave requests for this employee
    const empRes = await client.query(
      `SELECT id, annual_balance, sick_balance, casual_balance, manager_id
       FROM users WHERE id = $1 FOR UPDATE`,
      [employeeId]
    );
    if (empRes.rows.length === 0) throw new Error("Please choose a valid employee.");
    const emp = empRes.rows[0];

    if (user.role === "manager" && employeeId !== user.id && emp.manager_id !== user.id) {
      throw new Error("Managers can apply only for themselves or their direct reports.");
    }

    const overlap = await client.query(
      `SELECT COUNT(*) AS count FROM leave_requests
       WHERE employee_id = $1
       AND status IN ('Pending', 'Approved')
       AND start_date <= $2
       AND end_date >= $3`,
      [employeeId, endDate, startDate]
    );
    if (Number(overlap.rows[0].count) > 0) {
      throw new Error("Leave dates overlap with an existing request.");
    }

    if (leaveType !== "Unpaid") {
      const column = getLeaveColumn(leaveType);
      const approvedRes = await client.query(
        `SELECT COALESCE(SUM(days), 0) AS days FROM leave_requests
         WHERE employee_id = $1 AND leave_type = $2 AND status = 'Approved'`,
        [employeeId, leaveType]
      );
      const available = Number(emp[column]) - Number(approvedRes.rows[0].days);
      if (days > available) {
        throw new Error("Requested days exceed available leave balance.");
      }
    }

    const request = {
      id: crypto.randomUUID(),
      employeeId,
      leaveType,
      startDate,
      endDate,
      days,
      reason,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO leave_requests (
        id, employee_id, leave_type, start_date, end_date, days, reason, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        request.id,
        employeeId,
        leaveType,
        startDate,
        endDate,
        days,
        reason,
        request.status,
        request.createdAt
      ]
    );

    await client.query("COMMIT");
    return request;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateRequestStatus(pool, user, id, status) {
  if (!["Approved", "Rejected"].includes(status)) throw new Error("Invalid approval action.");
  if (!["manager", "admin"].includes(user.role)) throw new Error("Only managers and admins can approve leave.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the leave request row to prevent race conditions or concurrent reviews
    const reqRes = await client.query(
      `SELECT lr.*, u.manager_id
       FROM leave_requests lr
       JOIN users u ON u.id = lr.employee_id
       WHERE lr.id = $1 FOR UPDATE`,
      [id]
    );

    if (reqRes.rows.length === 0) throw new Error("Leave request not found.");
    const request = reqRes.rows[0];

    if (request.status !== "Pending") throw new Error("This request has already been reviewed.");
    if (request.employee_id === user.id) {
      throw new Error("Managers cannot approve their own leave requests.");
    }
    if (user.role === "manager" && request.manager_id !== user.id && request.employee_id !== user.id) {
      throw new Error("Managers can review only their own team's requests.");
    }

    if (status === "Approved" && request.leave_type !== "Unpaid") {
      // Lock employee row for accurate real-time balance check
      const empRes = await client.query(
        `SELECT annual_balance, sick_balance, casual_balance FROM users WHERE id = $1 FOR UPDATE`,
        [request.employee_id]
      );
      const column = getLeaveColumn(request.leave_type);
      const totalBalance = Number(empRes.rows[0][column]);
      const approvedRes = await client.query(
        `SELECT COALESCE(SUM(days), 0) AS days FROM leave_requests
         WHERE employee_id = $1 AND leave_type = $2 AND status = 'Approved'`,
        [request.employee_id, request.leave_type]
      );
      const available = totalBalance - Number(approvedRes.rows[0].days);
      if (Number(request.days) > available) {
        throw new Error("Cannot approve: employee does not have enough leave balance.");
      }
    }

    const reviewedAt = new Date().toISOString();
    const updateRes = await client.query(
      `UPDATE leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = $3
       WHERE id = $4 AND status = 'Pending'`,
      [status, user.id, reviewedAt, id]
    );

    if (updateRes.rowCount === 0) {
      throw new Error("This request has already been reviewed.");
    }

    const updatedRes = await client.query("SELECT * FROM leave_requests WHERE id = $1", [id]);
    await client.query("COMMIT");
    const row = updatedRes.rows[0];
    return {
      ...row,
      start_date: toDateString(row.start_date),
      end_date: toDateString(row.end_date),
      reviewed_at: toIsoString(row.reviewed_at),
      created_at: toIsoString(row.created_at)
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getMetrics(pool, user) {
  const requests = await getRequests(pool, user);
  const now = new Date();

  const visibleBalances = await getBalances(pool, user);
  const teamBalance = visibleBalances.reduce(
    (sum, employee) => sum + employee.annual_available + employee.sick_available + employee.casual_available,
    0
  );
  const thisMonth = requests
    .filter((request) => {
      const start = parseLocalDate(toDateString(request.start_date));
      return (
        request.status === "Approved" &&
        start &&
        start.getMonth() === now.getMonth() &&
        start.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, request) => sum + Number(request.days), 0);

  return {
    pending: requests.filter((request) => request.status === "Pending").length,
    approved: requests.filter((request) => request.status === "Approved").length,
    rejected: requests.filter((request) => request.status === "Rejected").length,
    teamBalance,
    thisMonth
  };
}

async function getChartData(pool, user) {
  const requests = await getRequests(pool, user);
  const statusCounts = { Pending: 0, Approved: 0, Rejected: 0 };
  const typeDays = { Annual: 0, Sick: 0, Casual: 0, Unpaid: 0 };

  requests.forEach((request) => {
    if (statusCounts[request.status] !== undefined) {
      statusCounts[request.status] += 1;
    }
    if (request.status === "Approved" && typeDays[request.leave_type] !== undefined) {
      typeDays[request.leave_type] += Number(request.days);
    }
  });

  return { statusCounts, typeDays };
}

// --------------------------------------------------------------------------
// Session Management (PostgreSQL-backed, revocable, SHA-256 hashed tokens)
// Fixed Eight-Hour Lifetime Policy:
// - Lifetime is strictly fixed to 8 hours (28,800 seconds) matching cookie Max-Age=28800
// - Database expiration (expires_at) and cookie Max-Age match exactly
// - expires_at is NOT updated on session lookup (no sliding renewal)
// - last_used_at is updated for informational auditing only
// - Expired sessions are deleted and can never be revived
// - Primary key is strictly token_hash across schema, lookups, and cleanups
// --------------------------------------------------------------------------

const SESSION_LIFETIME_SECONDS = 8 * 3600; // 28,800 seconds fixed lifetime

async function createSession(pool, userId, maxAgeSeconds = SESSION_LIFETIME_SECONDS) {
  const rawSessionToken = crypto.randomBytes(32).toString("hex");
  const sessionHash = hashToken(rawSessionToken);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = new Date(now + maxAgeSeconds * 1000).toISOString();

  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, last_used_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)`,
    [sessionHash, userId, csrfToken, expiresAt]
  );

  return {
    token: rawSessionToken,
    csrfToken,
    expiresAt
  };
}

async function getSessionByToken(pool, rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const sessionHash = hashToken(rawToken);

  const res = await pool.query(
    `SELECT s.token_hash AS session_id, s.user_id, s.csrf_token, s.expires_at, s.created_at, s.last_used_at,
            u.id, u.employee_code, u.name, u.email, u.role, u.department, u.designation,
            u.manager_id, u.annual_balance, u.sick_balance, u.casual_balance, u.joined_on
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [sessionHash]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];

  const now = Date.now();
  const expiresAtMs = new Date(row.expires_at).getTime();

  // Fixed lifetime check: if past expires_at, session is permanently expired and deleted
  if (now >= expiresAtMs) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
    return null;
  }

  // Update last_used_at as purely informational auditing (expires_at is NEVER modified)
  pool.query(
    "UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = $1",
    [sessionHash]
  ).catch(() => {});

  const user = {
    id: row.id,
    employee_code: row.employee_code,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    designation: row.designation,
    manager_id: row.manager_id,
    annual_balance: row.annual_balance,
    sick_balance: row.sick_balance,
    casual_balance: row.casual_balance,
    joined_on: toDateString(row.joined_on)
  };

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    user
  };
}

async function revokeSession(pool, rawToken) {
  if (!rawToken || typeof rawToken !== "string") return;
  const sessionHash = hashToken(rawToken);
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
}

async function cleanupExpiredSessions(pool, batchLimit = 500) {
  try {
    const nowIso = new Date().toISOString();
    await pool.query(
      `DELETE FROM sessions
       WHERE token_hash IN (
         SELECT token_hash FROM sessions WHERE expires_at < $1 LIMIT $2
       )`,
      [nowIso, batchLimit]
    );
  } catch (err) {
    try {
      const nowIso = new Date().toISOString();
      await pool.query("DELETE FROM sessions WHERE expires_at < $1", [nowIso]);
    } catch {}
  }
}

// --------------------------------------------------------------------------
// Rate Limiting (PostgreSQL-backed, privacy-preserving HMAC-SHA256 keys, expiring)
// Keys are generated via HMAC-SHA256 with RATE_LIMIT_SECRET to prevent
// rainbow-table reversing even if the database is compromised.
// Production startup fails safely if RATE_LIMIT_SECRET is absent, placeholder-like
// or insufficiently strong (< 32 characters).
// --------------------------------------------------------------------------

function validateRateLimitSecret() {
  const secret = process.env.RATE_LIMIT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret || typeof secret !== "string") {
      throw new Error("FATAL: RATE_LIMIT_SECRET environment variable is required in production mode.");
    }
    const trimmed = secret.trim();
    const placeholders = [
      "change_me", "changeme", "default", "secret", "leaveflow",
      "placeholder", "password", "123456", "admin"
    ];
    if (placeholders.some((p) => trimmed.toLowerCase().includes(p))) {
      throw new Error("FATAL: RATE_LIMIT_SECRET contains an insecure placeholder in production mode.");
    }
    if (trimmed.length < 32) {
      throw new Error("FATAL: RATE_LIMIT_SECRET is insufficiently strong (must be at least 32 characters) in production mode.");
    }
    return trimmed;
  }

  // Deterministic fallback permitted ONLY in explicit test/development mode
  return (secret && secret.trim()) || "leaveflow_dev_deterministic_rate_limit_secret_32chars!";
}

function getRateLimitKey(email, clientIp, secret) {
  const hmacSecret = secret || validateRateLimitSecret();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedIp = String(clientIp || "127.0.0.1").trim();
  return crypto.createHmac("sha256", hmacSecret).update(`${normalizedEmail}:${normalizedIp}`).digest("hex");
}

async function checkRateLimit(pool, key, maxAttempts = 5, windowMinutes = 15) {
  const res = await pool.query(
    `SELECT attempts, first_attempt, last_attempt, blocked_until
     FROM login_attempts WHERE key = $1`,
    [key]
  );

  if (res.rows.length === 0) {
    return { blocked: false, retryAfter: 0 };
  }

  const row = res.rows[0];
  const now = new Date();

  // If currently blocked
  if (row.blocked_until) {
    const blockedUntilDate = new Date(row.blocked_until);
    if (blockedUntilDate > now) {
      const retryAfter = Math.max(1, Math.ceil((blockedUntilDate.getTime() - now.getTime()) / 1000));
      return { blocked: true, retryAfter };
    }
  }

  // If window expired, clear stale entry
  const windowMs = windowMinutes * 60 * 1000;
  if (now.getTime() - new Date(row.first_attempt).getTime() > windowMs) {
    await pool.query("DELETE FROM login_attempts WHERE key = $1", [key]);
    return { blocked: false, retryAfter: 0 };
  }

  return { blocked: false, retryAfter: 0 };
}

async function recordFailedLogin(pool, key, maxAttempts = 5, blockMinutes = 15) {
  const res = await pool.query("SELECT attempts, first_attempt FROM login_attempts WHERE key = $1", [key]);
  const now = new Date();

  if (res.rows.length === 0) {
    await pool.query(
      `INSERT INTO login_attempts (key, attempts, first_attempt, last_attempt, blocked_until)
       VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`,
      [key]
    );
  } else {
    const currentAttempts = Number(res.rows[0].attempts) + 1;
    let blockedUntil = null;
    if (currentAttempts >= maxAttempts) {
      const blockDate = new Date(now.getTime() + blockMinutes * 60 * 1000);
      blockedUntil = blockDate.toISOString();
    }
    await pool.query(
      `UPDATE login_attempts
       SET attempts = $1, last_attempt = CURRENT_TIMESTAMP, blocked_until = $2
       WHERE key = $3`,
      [currentAttempts, blockedUntil, key]
    );
  }
}

async function clearRateLimit(pool, key) {
  await pool.query("DELETE FROM login_attempts WHERE key = $1", [key]);
}

async function cleanupExpiredRateLimits(pool, batchLimit = 500) {
  try {
    await pool.query(
      `DELETE FROM login_attempts
       WHERE key IN (
         SELECT key FROM login_attempts
         WHERE last_attempt < CURRENT_TIMESTAMP - INTERVAL '1 hour'
         LIMIT $1
       )`,
      [batchLimit]
    );
  } catch (err) {
    try {
      await pool.query("DELETE FROM login_attempts WHERE last_attempt < CURRENT_TIMESTAMP - INTERVAL '1 hour'");
    } catch {}
  }
}

module.exports = {
  openDatabase,
  initDatabase,
  resetDatabase,
  migrateSchema,
  createInMemoryPool,
  getUsers,
  getScopedEmployees,
  getUserByEmail,
  getUserForAuth,
  getUserById,
  getRequests,
  getBalances,
  getMetrics,
  getChartData,
  createLeaveRequest,
  updateRequestStatus,
  calculateDays,
  toDateString,
  toIsoString,
  hashToken,
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  createSession,
  getSessionByToken,
  revokeSession,
  cleanupExpiredSessions,
  getRateLimitKey,
  checkRateLimit,
  recordFailedLogin,
  clearRateLimit,
  cleanupExpiredRateLimits,
  sanitizeDatabaseUrl,
  dbPath,
  ARGON2_CONFIG,
  SEED_PASSWORD_HASHES,
  SESSION_LIFETIME_SECONDS,
  validateRateLimitSecret
};

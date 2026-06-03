const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("crypto");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "leave-management.sqlite");

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

function openDatabase({ reset = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (reset && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  createSchema(db);
  seedDatabase(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      employee_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
      department TEXT NOT NULL,
      designation TEXT NOT NULL,
      manager_id TEXT,
      annual_balance INTEGER NOT NULL DEFAULT 18,
      sick_balance INTEGER NOT NULL DEFAULT 8,
      casual_balance INTEGER NOT NULL DEFAULT 6,
      joined_on TEXT NOT NULL,
      FOREIGN KEY (manager_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      leave_type TEXT NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );
  `);
}

function seedDatabase(db) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (existing.count > 0) return;

  const users = [
    ["u-admin", "EMP-001", "Priya Menon", "admin@leaveflow.test", "admin123", "admin", "People Operations", "HR Admin", null, 24, 10, 8, "2021-01-04"],
    ["u-manager", "EMP-014", "Arjun Mehta", "manager@leaveflow.test", "manager123", "manager", "Engineering", "Engineering Manager", "u-admin", 22, 8, 6, "2020-08-17"],
    ["u-101", "EMP-101", "Aarav Sharma", "aarav@leaveflow.test", "emp123", "employee", "Engineering", "Frontend Developer", "u-manager", 18, 8, 6, "2023-04-10"],
    ["u-102", "EMP-102", "Meera Kapoor", "meera@leaveflow.test", "emp123", "employee", "People Operations", "HR Executive", "u-admin", 20, 8, 6, "2022-11-21"],
    ["u-103", "EMP-103", "Rohan Verma", "rohan@leaveflow.test", "emp123", "employee", "Sales", "Sales Manager", "u-admin", 18, 8, 6, "2021-06-07"],
    ["u-104", "EMP-104", "Nisha Iyer", "nisha@leaveflow.test", "emp123", "employee", "Engineering", "QA Engineer", "u-manager", 16, 8, 6, "2023-09-18"],
    ["u-105", "EMP-105", "Kabir Khan", "kabir@leaveflow.test", "emp123", "employee", "Design", "Product Designer", "u-admin", 18, 8, 6, "2024-02-12"]
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, employee_code, name, email, password, role, department, designation, manager_id,
      annual_balance, sick_balance, casual_balance, joined_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  users.forEach((user) => insertUser.run(...user));

  const insertRequest = db.prepare(`
    INSERT INTO leave_requests (
      id, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const requests = [
    ["u-101", "Annual", offsetDate(4), offsetDate(6), "Family function in Jaipur", "Pending", null],
    ["u-104", "Casual", offsetDate(9), offsetDate(9), "Personal appointment", "Pending", null],
    ["u-103", "Sick", offsetDate(-5), offsetDate(-4), "Medical recovery and rest", "Approved", "u-admin"],
    ["u-102", "Annual", offsetDate(13), offsetDate(16), "Planned vacation", "Approved", "u-admin"],
    ["u-105", "Casual", offsetDate(-2), offsetDate(-2), "Urgent personal work", "Rejected", "u-admin"],
    ["u-101", "Sick", offsetDate(-25), offsetDate(-24), "Fever and doctor consultation", "Approved", "u-manager"],
    ["u-104", "Annual", offsetDate(20), offsetDate(22), "Travel with family", "Approved", "u-manager"]
  ];

  requests.forEach(([employeeId, type, start, end, reason, status, reviewer]) => {
    const days = calculateDays(start, end);
    insertRequest.run(
      randomUUID(),
      employeeId,
      type,
      start,
      end,
      days,
      reason,
      status,
      reviewer,
      reviewer ? new Date().toISOString() : null,
      new Date().toISOString()
    );
  });
}

function getLeaveColumn(type) {
  return {
    Annual: "annual_balance",
    Sick: "sick_balance",
    Casual: "casual_balance"
  }[type];
}

function getUsers(db) {
  return db
    .prepare(
      `SELECT id, employee_code, name, email, role, department, designation, manager_id,
              annual_balance, sick_balance, casual_balance, joined_on
       FROM users
       ORDER BY employee_code`
    )
    .all();
}

function getUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email);
}

function getUserById(db, id) {
  return db
    .prepare(
      `SELECT id, employee_code, name, email, role, department, designation, manager_id,
              annual_balance, sick_balance, casual_balance, joined_on
       FROM users WHERE id = ?`
    )
    .get(id);
}

function canAccessEmployee(user, employeeId) {
  return user.role === "admin" || user.id === employeeId || user.id === getManagerIdForEmployee(user.db, employeeId);
}

function getManagerIdForEmployee(db, employeeId) {
  const employee = db.prepare("SELECT manager_id FROM users WHERE id = ?").get(employeeId);
  return employee ? employee.manager_id : null;
}

function getRequests(db, user) {
  const sql = `
    SELECT lr.*, u.name AS employee_name, u.employee_code, u.department, u.designation,
           reviewer.name AS reviewer_name
    FROM leave_requests lr
    JOIN users u ON u.id = lr.employee_id
    LEFT JOIN users reviewer ON reviewer.id = lr.reviewed_by
  `;

  if (user.role === "admin") {
    return db.prepare(`${sql} ORDER BY lr.created_at DESC`).all();
  }

  if (user.role === "manager") {
    return db
      .prepare(`${sql} WHERE lr.employee_id = ? OR u.manager_id = ? ORDER BY lr.created_at DESC`)
      .all(user.id, user.id);
  }

  return db.prepare(`${sql} WHERE lr.employee_id = ? ORDER BY lr.created_at DESC`).all(user.id);
}

function getApprovedDays(db, employeeId, leaveType) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(days), 0) AS days
       FROM leave_requests
       WHERE employee_id = ? AND leave_type = ? AND status = 'Approved'`
    )
    .get(employeeId, leaveType).days;
}

function getAvailableBalance(db, employeeId, leaveType) {
  if (leaveType === "Unpaid") return Number.POSITIVE_INFINITY;
  const column = getLeaveColumn(leaveType);
  if (!column) return 0;

  const employee = db.prepare(`SELECT ${column} AS balance FROM users WHERE id = ?`).get(employeeId);
  if (!employee) return 0;
  return employee.balance - getApprovedDays(db, employeeId, leaveType);
}

function getBalances(db) {
  return getUsers(db).map((user) => ({
    ...user,
    annual_available: getAvailableBalance(db, user.id, "Annual"),
    sick_available: getAvailableBalance(db, user.id, "Sick"),
    casual_available: getAvailableBalance(db, user.id, "Casual")
  }));
}

function createLeaveRequest(db, user, payload) {
  const employeeId = user.role === "employee" ? user.id : payload.employeeId;
  const leaveType = payload.leaveType;
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const reason = String(payload.reason || "").trim();
  const days = calculateDays(startDate, endDate);

  if (!employeeId || !getUserById(db, employeeId)) throw new Error("Please choose a valid employee.");
  if (!["Annual", "Sick", "Casual", "Unpaid"].includes(leaveType)) throw new Error("Please choose a valid leave type.");
  if (!days) throw new Error("Please choose a valid date range.");
  if (!reason) throw new Error("Please enter a valid reason.");
  if (user.role === "manager" && employeeId !== user.id && getManagerIdForEmployee(db, employeeId) !== user.id) {
    throw new Error("Managers can apply only for themselves or their direct reports.");
  }
  const overlap = db.prepare(
    `SELECT COUNT(*) AS count FROM leave_requests
     WHERE employee_id = ?
     AND status IN ('Pending','Approved')
     AND start_date <= ?
     AND end_date >= ?`
  ).get(employeeId, endDate, startDate);
  if (overlap.count > 0) throw new Error("Leave dates overlap with an existing request.");

  if (leaveType !== "Unpaid" && days > getAvailableBalance(db, employeeId, leaveType)) {
    throw new Error("Requested days exceed available leave balance.");
  }

  const request = {
    id: randomUUID(),
    employeeId,
    leaveType,
    startDate,
    endDate,
    days,
    reason,
    status: "Pending",
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO leave_requests (
      id, employee_id, leave_type, start_date, end_date, days, reason, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(request.id, employeeId, leaveType, startDate, endDate, days, reason, request.status, request.createdAt);

  return request;
}

function updateRequestStatus(db, user, id, status) {
  if (!["Approved", "Rejected"].includes(status)) throw new Error("Invalid approval action.");
  if (!["manager", "admin"].includes(user.role)) throw new Error("Only managers and admins can approve leave.");

  const request = db
    .prepare(
      `SELECT lr.*, u.manager_id
       FROM leave_requests lr
       JOIN users u ON u.id = lr.employee_id
       WHERE lr.id = ?`
    )
    .get(id);

  if (!request) throw new Error("Leave request not found.");
  if (request.status !== "Pending") throw new Error("This request has already been reviewed.");
  if (request.employee_id === user.id) {
    throw new Error("Managers cannot approve their own leave requests.");
  }
  if (user.role === "manager" && request.manager_id !== user.id && request.employee_id !== user.id) {
    throw new Error("Managers can review only their own team's requests.");
  }
  if (status === "Approved" && request.leave_type !== "Unpaid") {
    const available = getAvailableBalance(db, request.employee_id, request.leave_type);
    if (request.days > available) throw new Error("Cannot approve: employee does not have enough leave balance.");
  }

  db.prepare(
    `UPDATE leave_requests
     SET status = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`
  ).run(status, user.id, new Date().toISOString(), id);

  return db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id);
}

function getMetrics(db, user) {
  const requests = getRequests(db, user);
  const users = getUsers(db);
  const now = new Date();

  const visibleEmployeeIds = new Set(requests.map((request) => request.employee_id));
  if (user.role === "admin") users.forEach((employee) => visibleEmployeeIds.add(employee.id));
  if (user.role === "employee") visibleEmployeeIds.add(user.id);

  const visibleBalances = getBalances(db).filter((employee) => visibleEmployeeIds.has(employee.id));
  const teamBalance = visibleBalances.reduce(
    (sum, employee) => sum + employee.annual_available + employee.sick_available + employee.casual_available,
    0
  );
  const thisMonth = requests
    .filter((request) => {
      const start = parseLocalDate(request.start_date);
      return (
        request.status === "Approved" &&
        start &&
        start.getMonth() === now.getMonth() &&
        start.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, request) => sum + request.days, 0);

  return {
    pending: requests.filter((request) => request.status === "Pending").length,
    approved: requests.filter((request) => request.status === "Approved").length,
    rejected: requests.filter((request) => request.status === "Rejected").length,
    teamBalance,
    thisMonth
  };
}

function getChartData(db, user) {
  const requests = getRequests(db, user);
  const statusCounts = { Pending: 0, Approved: 0, Rejected: 0 };
  const typeDays = { Annual: 0, Sick: 0, Casual: 0, Unpaid: 0 };

  requests.forEach((request) => {
    statusCounts[request.status] += 1;
    if (request.status === "Approved") typeDays[request.leave_type] += request.days;
  });

  return { statusCounts, typeDays };
}

module.exports = {
  openDatabase,
  getUsers,
  getUserByEmail,
  getRequests,
  getBalances,
  getMetrics,
  getChartData,
  createLeaveRequest,
  updateRequestStatus,
  calculateDays,
  dbPath
};

const fs = require("fs");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  openDatabase,
  getUserByEmail,
  getUsers,
  getRequests,
  getBalances,
  getMetrics,
  getChartData,
  createLeaveRequest,
  updateRequestStatus,
  dbPath
} = require("./database.cjs");

const shouldReset = process.argv.includes("--reset-db");
const db = openDatabase({ reset: shouldReset });
const sessions = new Map();
const loginAttempts = new Map();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");

if (shouldReset) {
  console.log(`Database reset at ${dbPath}`);
  process.exit(0);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

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

function requireUser(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return session.user;
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
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    reason: row.reason,
    status: row.status,
    reviewerName: row.reviewer_name || null,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function normalizeEmployee(row) {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    designation: row.designation,
    managerId: row.manager_id,
    annualBalance: row.annual_balance,
    sickBalance: row.sick_balance,
    casualBalance: row.casual_balance,
    annualAvailable: row.annual_available,
    sickAvailable: row.sick_available,
    casualAvailable: row.casual_available,
    joinedOn: row.joined_on
  };
}

function getBootstrap(user) {
  return {
    user: publicUser(user),
    employees: getBalances(db).map(normalizeEmployee),
    requests: getRequests(db, user).map(normalizeRequest),
    metrics: getMetrics(db, user),
    charts: getChartData(db, user)
  };
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(request);
      const user = getUserByEmail(db, String(body.email || ""));
      if (!user || user.password !== String(body.password || "")) {
        const ip = request.socket.remoteAddress || "unknown";
        const cur = loginAttempts.get(ip) || {count:0,time:Date.now()};
        loginAttempts.set(ip,{count:cur.count+1,time:Date.now()});
        sendJson(response, 401, { error: "Invalid email or password." });
        return;
      }

      const ip = request.socket.remoteAddress || "unknown";
      const attempt = loginAttempts.get(ip);
      if (attempt && attempt.count >= 10 && Date.now() - attempt.time < 900000) {
        sendJson(response,429,{error:"Too many login attempts."}); return;
      }
      const token = randomUUID();
      sessions.set(token, {user, expiresAt: Date.now()+8*60*60*1000});
      sendJson(response, 200, { token, user: publicUser(user) });
      return;
    }

    const user = requireUser(request);
    if (!user) {
      sendJson(response, 401, { error: "Please login first." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(response, 200, getBootstrap(user));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/employees") {
      if (!["admin","manager"].includes(user.role)) {
        sendJson(response,403,{error:"Forbidden"});
        return;
      }
      sendJson(response, 200, { employees: getUsers(db).map(normalizeEmployee) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/leave-requests") {
      const body = await readBody(request);
      createLeaveRequest(db, user, body);
      sendJson(response, 201, getBootstrap(user));
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/leave-requests\/([^/]+)\/status$/);
    if (request.method === "PATCH" && statusMatch) {
      const body = await readBody(request);
      updateRequestStatus(db, user, statusMatch[1], String(body.status || ""));
      sendJson(response, 200, getBootstrap(user));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      sessions.delete(token);
      sendJson(response,200,{success:true});
      return;
    }

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

function serveStatic(request, response, url) {
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

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `localhost:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url);
      return;
    }

    serveStatic(request, response, url);
  })
  .listen(port, () => {
    console.log(`Employee Leave Management System running at http://localhost:${port}`);
  });

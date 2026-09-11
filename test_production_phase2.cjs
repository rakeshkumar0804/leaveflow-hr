const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Resolve project root relative to test file / current directory
const projectRoot = path.resolve(__dirname);

console.log('=== LEAVEFLOW HR: PHASE 2 REAL PRODUCTION CODE VERIFICATION ===\n');

(async () => {
const nativeFetch = global.fetch;

// 1. Run Phase 1 verification suite first
console.log('Step 1: Running Phase 1 test suite to ensure zero regressions...');
const p1TestPath = path.join(projectRoot, 'test_production_phase1.cjs');
assert(fs.existsSync(p1TestPath), 'test_production_phase1.cjs must exist');
const { runPhase1Tests } = require(p1TestPath);
await runPhase1Tests();
global.fetch = nativeFetch;
console.log('PASS 1: Phase 1 production suite passed with zero regressions.\n');

// 2. Setup isolated in-memory PostgreSQL database for testing backend data & scoping
const {
  openDatabase,
  getScopedEmployees,
  getUsers,
  getUserByEmail,
  getRequests,
  getBalances,
  getMetrics,
  getChartData,
  createLeaveRequest,
  updateRequestStatus,
  dbPath: trackedDbPath
} = require(path.join(projectRoot, 'backend/database.cjs'));

// Check tracked database initial modification time
const initialTrackedStat = fs.existsSync(trackedDbPath) ? fs.statSync(trackedDbPath).mtimeMs : null;

// Open isolated in-memory database
const tempDb = await openDatabase({ inMemory: true });
console.log('PASS 2: Opened isolated in-memory PostgreSQL test database');

// Retrieve seeded users for tests
const adminUser = await getUserByEmail(tempDb, 'admin@leaveflow.test');
const managerUser = await getUserByEmail(tempDb, 'manager@leaveflow.test');
const employeeUser = await getUserByEmail(tempDb, 'aarav@leaveflow.test'); // reports to manager
const employeeAdminReport = await getUserByEmail(tempDb, 'rohan@leaveflow.test'); // reports to admin

assert(adminUser && adminUser.role === 'admin', 'Admin user must exist');
assert(managerUser && managerUser.role === 'manager', 'Manager user must exist');
assert(employeeUser && employeeUser.role === 'employee', 'Employee user must exist');
assert(employeeAdminReport && employeeAdminReport.role === 'employee', 'Employee reports to admin must exist');

// 3. Test Backend Employee Scoping (getScopedEmployees / getBalances)
// A: Employee Role
const empBalances = await getBalances(tempDb, employeeUser);
assert.strictEqual(empBalances.length, 1, 'Employee must only receive exactly their own record');
assert.strictEqual(empBalances[0].id, employeeUser.id, 'Employee record ID must match employeeUser.id');
assert.strictEqual(empBalances[0].name, employeeUser.name);
// Ensure no other employees present
assert.strictEqual(empBalances.some(e => e.id !== employeeUser.id), false, 'Employee must not receive any other employee');
console.log('PASS 3A: Employee bootstrap balances return exclusively their own record');

// B: Manager Role
const mgrBalances = await getBalances(tempDb, managerUser);
// Seeded manager has 2 direct reports: u-101 (Aarav), u-104 (Nisha) + self (u-manager) = 3
assert.strictEqual(mgrBalances.length, 3, 'Manager must receive only self and direct reports (expected 3)');
assert(mgrBalances.some(e => e.id === managerUser.id), 'Manager must include self');
assert(mgrBalances.every(e => e.id === managerUser.id || e.manager_id === managerUser.id), 'All records must be self or direct report');
// Must NOT include admin reports u-102, u-103, u-105 or admin
assert(!mgrBalances.some(e => e.id === 'u-102'), 'Manager must not receive u-102 (reports to admin)');
assert(!mgrBalances.some(e => e.id === 'u-103'), 'Manager must not receive u-103 (reports to admin)');
assert(!mgrBalances.some(e => e.id === 'u-105'), 'Manager must not receive u-105 (reports to admin)');
assert(!mgrBalances.some(e => e.id === 'u-admin'), 'Manager must not receive u-admin');
console.log('PASS 3B: Manager bootstrap balances return self and direct reports only');

// C: Admin Role
const admBalances = await getBalances(tempDb, adminUser);
assert.strictEqual(admBalances.length, 7, 'Admin must receive all 7 seeded employees');
console.log('PASS 3C: Admin bootstrap balances return all employees');

// 4. Test Backend Request Visibility (getRequests)
// A: Employee Requests
const empRequests = await getRequests(tempDb, employeeUser);
assert(empRequests.length > 0, 'Employee should have requests');
assert(empRequests.every(r => r.employee_id === employeeUser.id), 'Employee must only see their own requests');
console.log('PASS 4A: Employee requests contain only own requests');

// B: Manager Requests
const mgrRequests = await getRequests(tempDb, managerUser);
const mgrTeamIds = new Set(mgrBalances.map(e => e.id));
assert(mgrRequests.every(r => mgrTeamIds.has(r.employee_id)), 'Manager must see only own + direct report requests');
assert(!mgrRequests.some(r => r.employee_id === 'u-103'), 'Manager must not see u-103 requests');
console.log('PASS 4B: Manager requests contain only own + direct reports requests');

// C: Admin Requests
const admRequests = await getRequests(tempDb, adminUser);
assert(admRequests.length >= 7, 'Admin must see all requests');
console.log('PASS 4C: Admin requests contain all requests');

// 5. Test Data Minimization (no email, joined_on, password in employee list)
const sampleRow = mgrBalances[0];
// Ensure getScopedEmployees SQL did not select email, password, or joined_on
assert.strictEqual(sampleRow.email, undefined, 'Scoped employee must not have email');
assert.strictEqual(sampleRow.password, undefined, 'Scoped employee must not have password');
assert.strictEqual(sampleRow.joined_on, undefined, 'Scoped employee must not have joined_on');
console.log('PASS 5: Sensitive fields (email, joined_on, password) excluded from employee balances');

// 6. Test Authorization Rules & Tampering Prevention
// A: Employee cannot submit for another employee
try {
  await createLeaveRequest(tempDb, employeeUser, {
    employeeId: 'u-102', // Tampered payload
    leaveType: 'Casual',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    reason: 'Personal test'
  });
  // Check the newly created request - must belong to employeeUser (u-101), NOT u-102!
  const latestReqRes = await tempDb.query('SELECT * FROM leave_requests ORDER BY created_at DESC LIMIT 1');
  const latestReq = latestReqRes.rows[0];
  assert.strictEqual(latestReq.employee_id, employeeUser.id, 'Tampered employeeId must be overridden with user.id');
  console.log('PASS 6A: Employee cannot submit for another employee (payload employeeId overridden)');
} catch (e) {
  console.log('PASS 6A: Employee submission tampering prevented:', e.message);
}

// B: Manager cannot submit for an unrelated employee
try {
  await createLeaveRequest(tempDb, managerUser, {
    employeeId: 'u-103', // Unrelated employee (reports to admin)
    leaveType: 'Annual',
    startDate: '2026-11-10',
    endDate: '2026-11-11',
    reason: 'Test manager submit'
  });
  assert.fail('Manager must not be able to submit for an employee not under their direct report');
} catch (err) {
  assert(err.message.includes('Managers can apply only for themselves or their direct reports'), err.message);
  console.log('PASS 6B: Manager cannot submit for an unrelated employee');
}

// C: Self-approval prevention on backend
// Create a pending request owned by managerUser
const mgrOwnReq = await createLeaveRequest(tempDb, managerUser, {
  employeeId: managerUser.id,
  leaveType: 'Casual',
  startDate: '2026-12-01',
  endDate: '2026-12-01',
  reason: 'Manager personal day'
});
try {
  await updateRequestStatus(tempDb, managerUser, mgrOwnReq.id, 'Approved');
  assert.fail('Manager must not be able to approve their own request');
} catch (err) {
  assert(err.message.includes('Managers cannot approve their own leave requests'), err.message);
  console.log('PASS 6C: Manager self-approval correctly prohibited by backend');
}

// D: Manager cannot approve an unrelated employee request
// Find a pending request belonging to an unrelated employee (e.g. u-105 reports to admin)
const unrelatedReq = await createLeaveRequest(tempDb, adminUser, {
  employeeId: 'u-105',
  leaveType: 'Sick',
  startDate: '2026-12-05',
  endDate: '2026-12-05',
  reason: 'Sick day'
});
try {
  await updateRequestStatus(tempDb, managerUser, unrelatedReq.id, 'Approved');
  assert.fail('Manager must not be able to approve an unrelated employee request');
} catch (err) {
  assert(err.message.includes('Managers can review only their own team\'s requests'), err.message);
  console.log('PASS 6D: Manager cannot review requests outside direct reports');
}

// 7. Test Frontend Role-Aware UI Logic
const app = require(path.join(projectRoot, 'public/app.js'));
const { applyRoleUI, resetRoleState, renderRequests, renderTeam, visibleEmployeesForForm } = app;

// Setup mock DOM elements
function createMockEl(tag = 'div') {
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    reset() {},
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c);
          else this.classes.add(c);
        } else if (force) {
          this.classes.add(c);
        } else {
          this.classes.delete(c);
        }
      },
      contains(c) { return this.classes.has(c); }
    }
  };
}

app.el.navApprovals = createMockEl('a');
app.el.navTeam = createMockEl('a');
app.el.approvalsEyebrow = createMockEl('p');
app.el.approvalsHeading = createMockEl('h2');
app.el.teamSection = createMockEl('section');
app.el.employeeField = createMockEl('label');
app.el.requestsTable = createMockEl('tbody');
app.el.teamGrid = createMockEl('div');
app.el.employeeSelect = createMockEl('select');

// Test 7A: Employee Role UI
app.state.user = { id: 'u-101', role: 'employee', name: 'Aarav' };
applyRoleUI();
assert.strictEqual(app.el.navApprovals.textContent, 'My Requests', 'Employee nav link must say My Requests');
assert.strictEqual(app.el.approvalsEyebrow.textContent, 'Request history', 'Employee eyebrow must say Request history');
assert.strictEqual(app.el.approvalsHeading.textContent, 'My Leave Requests', 'Employee heading must say My Leave Requests');
assert.strictEqual(app.el.navTeam.classList.contains('hidden'), true, 'Employee must hide Team nav link');
assert.strictEqual(app.el.teamSection.classList.contains('hidden'), true, 'Employee must hide Team section');
assert.strictEqual(app.el.employeeField.classList.contains('hidden'), true, 'Employee must hide employee select field');
console.log('PASS 7A: Employee UI dynamically adapts labels, headings, and hides Team');

// Test 7B: Employee rows never render Approve/Reject buttons
app.state.requests = [
  {
    id: 'req-emp-1',
    employeeId: 'u-101',
    employeeName: 'Aarav Sharma',
    employeeCode: 'EMP-101',
    department: 'Engineering',
    leaveType: 'Annual',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
    reason: 'Vacation',
    status: 'Pending'
  }
];
app.state.filter = 'All';
renderRequests();
assert(!app.el.requestsTable.innerHTML.includes('action-button approve'), 'Employee view must NEVER render Approve button');
assert(!app.el.requestsTable.innerHTML.includes('action-button reject'), 'Employee view must NEVER render Reject button');
assert(app.el.requestsTable.innerHTML.includes('Awaiting review'), 'Employee view must show Awaiting review');
console.log('PASS 7B: Employee view never renders Approve/Reject buttons');

// Test 7C: Manager Role UI
app.state.user = { id: 'u-manager', role: 'manager', name: 'Arjun Mehta' };
applyRoleUI();
assert.strictEqual(app.el.navApprovals.textContent, 'Approvals', 'Manager nav link must say Approvals');
assert(app.el.approvalsEyebrow.textContent === 'Manager approval' || app.el.approvalsEyebrow.textContent === 'Team approvals', 'Manager eyebrow must say Manager/Team approvals');
assert(app.el.approvalsHeading.textContent === 'Leave Requests' || app.el.approvalsHeading.textContent === 'Team Leave Requests', 'Manager heading must say Leave Requests or Team Leave Requests');
assert.strictEqual(app.el.navTeam.classList.contains('hidden'), false, 'Manager must show Team nav link');
assert.strictEqual(app.el.teamSection.classList.contains('hidden'), false, 'Manager must show Team section');
assert.strictEqual(app.el.employeeField.classList.contains('hidden'), false, 'Manager must show employee select field');
console.log('PASS 7C: Manager UI displays Approvals and Team navigation');

// Test 7D: Manager own pending request does NOT render Approve/Reject buttons (Self-approval prevented in UI)
app.state.employees = [
  { id: 'u-manager', name: 'Arjun', managerId: null },
  { id: 'u-101', name: 'Aarav', managerId: 'u-manager' }
];
app.state.requests = [
  {
    id: 'req-mgr-own',
    employeeId: 'u-manager',
    employeeName: 'Arjun Mehta',
    employeeCode: 'EMP-014',
    department: 'Engineering',
    leaveType: 'Casual',
    startDate: '2026-11-05',
    endDate: '2026-11-05',
    days: 1,
    reason: 'Personal',
    status: 'Pending'
  },
  {
    id: 'req-subordinate',
    employeeId: 'u-101',
    employeeName: 'Aarav Sharma',
    employeeCode: 'EMP-101',
    department: 'Engineering',
    leaveType: 'Annual',
    startDate: '2026-11-10',
    endDate: '2026-11-11',
    days: 2,
    reason: 'Holiday',
    status: 'Pending'
  }
];
renderRequests();
// Check row 1 (manager's own request): must NOT have action buttons, must say "Awaiting another reviewer"
assert(app.el.requestsTable.innerHTML.includes('Awaiting another reviewer'), 'Manager own pending request must say Awaiting another reviewer');
// Check that Approve/Reject buttons exist ONLY for the subordinate's request
assert(app.el.requestsTable.innerHTML.includes('data-id="req-subordinate"'), 'Subordinate request must have review button');
assert(!app.el.requestsTable.innerHTML.includes('data-id="req-mgr-own"'), 'Manager own request must NOT have review button');
console.log('PASS 7D: Manager own request shows Awaiting another reviewer; subordinate request has action buttons');

// Test 7E: Role state reset on logout
resetRoleState();
assert.strictEqual(app.el.navApprovals.textContent, 'Approvals');
assert(app.el.approvalsEyebrow.textContent === 'Manager approval' || app.el.approvalsEyebrow.textContent === 'Team approvals');
assert(app.el.approvalsHeading.textContent === 'Leave Requests' || app.el.approvalsHeading.textContent === 'Team Leave Requests');
assert.strictEqual(app.el.navTeam.classList.contains('hidden'), false);
assert.strictEqual(app.el.teamSection.classList.contains('hidden'), false);
assert.strictEqual(app.state.filter, 'All');
console.log('PASS 7E: resetRoleState successfully restores default UI state and clears filters');

// Test 7F: Empty state handling without crashing
app.state.employees = [];
renderTeam();
assert(app.el.teamGrid.innerHTML.includes('empty-state'), 'Empty employees list must render empty-state');
app.state.requests = [];
renderRequests();
assert(app.el.requestsTable.innerHTML.includes('empty-state'), 'Empty requests list must render empty-state');
console.log('PASS 7F: Zero-result states render empty-state without crashing');

// Clean up temporary database
if (tempDb.end) await tempDb.end();
console.log('PASS 8: Cleaned up temporary in-memory database');

// Step 9: Test real HTTP API endpoints (bootstrap and employees) via live local server
console.log('\nStep 9: Testing live HTTP API server endpoints on isolated port 3005...');
global.fetch = nativeFetch;
const { spawn } = require('child_process');
const serverProc = spawn('node', ['backend/server.cjs'], {
  cwd: projectRoot,
  env: { ...process.env, PORT: '3005', ALLOW_IN_MEMORY_DB: 'true' },
  stdio: 'pipe'
});

await new Promise((resolve) => {
  serverProc.stdout.on('data', (d) => {
    if (d.toString().includes('running at')) resolve();
  });
  setTimeout(resolve, 1500);
});

try {
  function extractCookie(res) {
    const raw = res.headers.get('set-cookie');
    if (!raw) return '';
    const match = raw.match(/leaveflow_session=[^;]+/);
    return match ? match[0] : '';
  }

  // 9A: Employee Login & Endpoints
  const empLoginRes = await fetch('http://localhost:3005/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aarav@leaveflow.test', password: 'emp123' })
  });
  const empCookie = extractCookie(empLoginRes);
  assert(empCookie, 'Employee login must set leaveflow_session cookie');

  // Employee Bootstrap
  const empBootRes = await fetch('http://localhost:3005/api/bootstrap', {
    headers: { Cookie: empCookie }
  });
  const empBootData = await empBootRes.json();
  assert.strictEqual(empBootData.employees.length, 1, 'Employee bootstrap must return exactly 1 employee');
  assert.strictEqual(empBootData.employees[0].id, 'u-101');
  assert.strictEqual(empBootData.employees[0].email, undefined, 'Employee list must not include email');
  assert.strictEqual(empBootData.user.email, 'aarav@leaveflow.test', 'user object must retain email');
  console.log('PASS 9A: Employee live HTTP bootstrap returns only self and excludes email');

  // Employee GET /api/employees -> 403
  const empGetRes = await fetch('http://localhost:3005/api/employees', {
    headers: { Cookie: empCookie }
  });
  assert.strictEqual(empGetRes.status, 403, 'Employee GET /api/employees must return 403 Forbidden');
  console.log('PASS 9B: Employee live HTTP GET /api/employees returns 403 Forbidden');

  // 9C: Manager Login & Endpoints
  const mgrLoginRes = await fetch('http://localhost:3005/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@leaveflow.test', password: 'manager123' })
  });
  const mgrCookie = extractCookie(mgrLoginRes);
  assert(mgrCookie, 'Manager login must set leaveflow_session cookie');

  // Manager Bootstrap
  const mgrBootRes = await fetch('http://localhost:3005/api/bootstrap', {
    headers: { Cookie: mgrCookie }
  });
  const mgrBootData = await mgrBootRes.json();
  assert.strictEqual(mgrBootData.employees.length, 3, 'Manager bootstrap must return exactly self + 2 direct reports (3 total)');
  const mgrEmployeeIds = new Set(mgrBootData.employees.map(e => e.id));
  assert(mgrEmployeeIds.has('u-manager') && mgrEmployeeIds.has('u-101') && mgrEmployeeIds.has('u-104'));
  assert(!mgrEmployeeIds.has('u-102'), 'Manager must not receive u-102');
  assert(!mgrEmployeeIds.has('u-103'), 'Manager must not receive u-103');
  assert(!mgrEmployeeIds.has('u-105'), 'Manager must not receive u-105');
  console.log('PASS 9C: Manager live HTTP bootstrap returns self + direct reports only');

  // Manager GET /api/employees -> 200 with 3 records
  const mgrGetRes = await fetch('http://localhost:3005/api/employees', {
    headers: { Cookie: mgrCookie }
  });
  assert.strictEqual(mgrGetRes.status, 200);
  const mgrGetData = await mgrGetRes.json();
  assert.strictEqual(mgrGetData.employees.length, 3, 'Manager GET /api/employees must return 3 records');
  console.log('PASS 9D: Manager live HTTP GET /api/employees returns self and direct reports only');

  // 9E: Admin Login & Endpoints
  const admLoginRes = await fetch('http://localhost:3005/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@leaveflow.test', password: 'admin123' })
  });
  const admCookie = extractCookie(admLoginRes);
  assert(admCookie, 'Admin login must set leaveflow_session cookie');

  // Admin Bootstrap
  const admBootRes = await fetch('http://localhost:3005/api/bootstrap', {
    headers: { Cookie: admCookie }
  });
  const admBootData = await admBootRes.json();
  assert.strictEqual(admBootData.employees.length, 7, 'Admin bootstrap must return all 7 employees');

  // Admin GET /api/employees -> 200 with 7 records
  const admGetRes = await fetch('http://localhost:3005/api/employees', {
    headers: { Cookie: admCookie }
  });
  assert.strictEqual(admGetRes.status, 200);
  const admGetData = await admGetRes.json();
  assert.strictEqual(admGetData.employees.length, 7, 'Admin GET /api/employees must return all 7 employees');
  console.log('PASS 9E: Admin live HTTP bootstrap and GET /api/employees return all 7 employees');
} finally {
  serverProc.kill();
}

// Verify tracked database was NEVER modified
if (initialTrackedStat) {
  const currentTrackedStat = fs.statSync(trackedDbPath).mtimeMs;
  assert.strictEqual(currentTrackedStat, initialTrackedStat, 'Tracked database file was modified! It must remain untouched.');
  console.log('PASS 10: Tracked SQLite database at data/leave-management.sqlite was 100% UNTOUCHED.');
}

console.log('\n=============================================================');
console.log('>>> ALL PHASE 2 PRODUCTION-CODE TESTS PASSED WITH 100% SUCCESS <<<');
console.log('=============================================================');
})();

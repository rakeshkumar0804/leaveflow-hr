const demoAccounts = {
  admin: ["admin@leaveflow.test", "admin123"],
  manager: ["manager@leaveflow.test", "manager123"],
  employee: ["aarav@leaveflow.test", "emp123"]
};

const state = {
  token: localStorage.getItem("leaveflow-token") || "",
  user: null,
  employees: [],
  requests: [],
  metrics: {},
  charts: {},
  filter: "All"
};

const el = {
  loginScreen: document.getElementById("loginScreen"),
  appShell: document.getElementById("appShell"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginMessage: document.getElementById("loginMessage"),
  logoutButton: document.getElementById("logoutButton"),
  refreshButton: document.getElementById("refreshButton"),
  userRole: document.getElementById("userRole"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  pendingMetric: document.getElementById("pendingMetric"),
  approvedMetric: document.getElementById("approvedMetric"),
  rejectedMetric: document.getElementById("rejectedMetric"),
  monthMetric: document.getElementById("monthMetric"),
  leaveForm: document.getElementById("leaveForm"),
  employeeField: document.getElementById("employeeField"),
  employeeSelect: document.getElementById("employeeSelect"),
  leaveType: document.getElementById("leaveType"),
  daysPreview: document.getElementById("daysPreview"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  reason: document.getElementById("reason"),
  balancePreview: document.getElementById("balancePreview"),
  formMessage: document.getElementById("formMessage"),
  requestsTable: document.getElementById("requestsTable"),
  teamGrid: document.getElementById("teamGrid"),
  statusChart: document.getElementById("statusChart"),
  typeChart: document.getElementById("typeChart")
};

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
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return new Date(year, month - 1, day);
}

function calculateDays(start, end) {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (!startDate || !endDate) return 0;
  const diff = endDate.getTime() - startDate.getTime();
  return diff < 0 ? 0 : Math.round(diff / 86400000) + 1;
}

function formatDate(value) {
  const date = parseLocalDate(value);
  if (!date) return "Invalid date";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setMessage(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("error", isError);
}

async function login(email, password) {
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  state.token = data.token;
  localStorage.setItem("leaveflow-token", state.token);
  await loadDashboard();
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  state.user = data.user;
  state.employees = data.employees;
  state.requests = data.requests;
  state.metrics = data.metrics;
  state.charts = data.charts;
  render();
}

async function logout() {
  try { await api("/api/logout",{method:"POST"}); } catch(e) {}
  state.token = "";
  state.user = null;
  localStorage.removeItem("leaveflow-token");
  el.loginScreen.classList.remove("hidden");
  el.appShell.classList.add("hidden");
}

function render() {
  el.loginScreen.classList.add("hidden");
  el.appShell.classList.remove("hidden");
  renderUser();
  renderMetrics();
  renderEmployeeOptions();
  renderFormSummary();
  renderRequests();
  renderTeam();
  drawCharts();
}

function renderUser() {
  el.userRole.textContent = state.user.role.toUpperCase();
  el.userName.textContent = state.user.name;
  el.userEmail.textContent = state.user.email;
  el.employeeField.classList.toggle("hidden", state.user.role === "employee");
}

function renderMetrics() {
  el.pendingMetric.textContent = state.metrics.pending || 0;
  el.approvedMetric.textContent = state.metrics.approved || 0;
  el.rejectedMetric.textContent = state.metrics.rejected || 0;
  el.monthMetric.textContent = state.metrics.thisMonth || 0;
}

function visibleEmployeesForForm() {
  if (state.user.role === "admin") return state.employees;
  if (state.user.role === "manager") {
    return state.employees.filter((employee) => employee.id === state.user.id || employee.managerId === state.user.id);
  }
  return state.employees.filter((employee) => employee.id === state.user.id);
}

function renderEmployeeOptions() {
  const employees = visibleEmployeesForForm();
  el.employeeSelect.innerHTML = employees
    .map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)} (${escapeHTML(employee.employeeCode)})</option>`)
    .join("");
  if (!el.employeeSelect.value && employees[0]) el.employeeSelect.value = employees[0].id;
}

function selectedEmployee() {
  const employeeId = state.user.role === "employee" ? state.user.id : el.employeeSelect.value;
  return state.employees.find((employee) => employee.id === employeeId);
}

function selectedBalance() {
  const employee = selectedEmployee();
  if (!employee) return "--";
  const type = el.leaveType.value;
  if (type === "Unpaid") return "Unlimited";
  return {
    Annual: employee.annualAvailable,
    Sick: employee.sickAvailable,
    Casual: employee.casualAvailable
  }[type];
}

function renderFormSummary() {
  const days = calculateDays(el.startDate.value, el.endDate.value);
  el.daysPreview.value = days ? `${days} day(s)` : "Invalid dates";
  el.balancePreview.textContent = `Balance: ${selectedBalance()}`;
}

function renderRequests() {
  const canApprove = ["manager", "admin"].includes(state.user.role);
  const requests = state.requests.filter((request) => state.filter === "All" || request.status === state.filter);

  if (!requests.length) {
    el.requestsTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">No leave requests found.</div></td></tr>';
    return;
  }

  el.requestsTable.innerHTML = requests
    .map((request) => {
      const action =
        canApprove && request.status === "Pending"
          ? `<div class="request-actions">
              <button class="action-button approve" data-id="${request.id}" data-status="Approved" type="button">Approve</button>
              <button class="action-button reject" data-id="${request.id}" data-status="Rejected" type="button">Reject</button>
            </div>`
          : `<span class="muted">${request.reviewerName ? `Reviewed by ${escapeHTML(request.reviewerName)}` : "No action"}</span>`;

      return `<tr>
        <td>
          <div class="employee-cell">
            <strong>${escapeHTML(request.employeeName)}</strong>
            <small>${escapeHTML(request.employeeCode)} · ${escapeHTML(request.department)}</small>
          </div>
        </td>
        <td>${escapeHTML(request.leaveType)}<br><small class="muted">${request.days} day(s)</small></td>
        <td>${formatDate(request.startDate)} - ${formatDate(request.endDate)}</td>
        <td>${escapeHTML(request.reason)}</td>
        <td><span class="badge ${request.status}">${request.status}</span></td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
}

function renderTeam() {
  el.teamGrid.innerHTML = state.employees
    .map((employee) => {
      const annualWidth = Math.max(0, Math.min(100, (employee.annualAvailable / employee.annualBalance) * 100));
      const sickWidth = Math.max(0, Math.min(100, (employee.sickAvailable / employee.sickBalance) * 100));
      const casualWidth = Math.max(0, Math.min(100, (employee.casualAvailable / employee.casualBalance) * 100));
      return `<article class="team-card">
        <strong>${escapeHTML(employee.name)}</strong>
        <span class="muted">${escapeHTML(employee.designation)} · ${escapeHTML(employee.department)}</span>
        <div class="balance-row">
          <span>Annual ${employee.annualAvailable}/${employee.annualBalance}</span><div class="bar"><i style="width:${annualWidth}%"></i></div>
          <span>Sick ${employee.sickAvailable}/${employee.sickBalance}</span><div class="bar"><i style="width:${sickWidth}%"></i></div>
          <span>Casual ${employee.casualAvailable}/${employee.casualBalance}</span><div class="bar"><i style="width:${casualWidth}%"></i></div>
        </div>
      </article>`;
    })
    .join("");
}

function drawCharts() {
  drawDonut(el.statusChart, state.charts.statusCounts || {}, {
    Pending: "#d97706",
    Approved: "#16a34a",
    Rejected: "#dc2626"
  });
  drawBars(el.typeChart, state.charts.typeDays || {}, "#2563eb");
}

function drawDonut(canvas, values, colors) {
  const ctx = canvas.getContext("2d");
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "13px Segoe UI";

  if (!total) {
    ctx.fillStyle = "#64748b";
    ctx.fillText("No data yet", 118, 110);
    return;
  }

  let start = -Math.PI / 2;
  Object.entries(values).forEach(([label, value], index) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(110, 100);
    ctx.arc(110, 100, 78, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[label];
    ctx.fill();
    ctx.fillRect(220, 42 + index * 28, 14, 14);
    ctx.fillStyle = "#334155";
    ctx.fillText(`${label}: ${value}`, 242, 54 + index * 28);
    start += angle;
  });

  ctx.beginPath();
  ctx.arc(110, 100, 42, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

function drawBars(canvas, values, color) {
  const ctx = canvas.getContext("2d");
  const entries = Object.entries(values);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "13px Segoe UI";
  entries.forEach(([label, value], index) => {
    const y = 32 + index * 42;
    const width = (value / max) * 190;
    ctx.fillStyle = "#64748b";
    ctx.fillText(label, 16, y + 15);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(86, y, 196, 20);
    ctx.fillStyle = color;
    ctx.fillRect(86, y, width, 20);
    ctx.fillStyle = "#172033";
    ctx.fillText(String(value), 292, y + 15);
  });
}

async function submitLeave(event) {
  event.preventDefault();
  setMessage(el.formMessage, "");

  try {
    const payload = {
      employeeId: state.user.role === "employee" ? state.user.id : el.employeeSelect.value,
      leaveType: el.leaveType.value,
      startDate: el.startDate.value,
      endDate: el.endDate.value,
      reason: el.reason.value
    };
    const data = await api("/api/leave-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    Object.assign(state, data);
    el.leaveForm.reset();
    setDefaultDates();
    setMessage(el.formMessage, "Leave request submitted.");
    render();
  } catch (error) {
    setMessage(el.formMessage, error.message, true);
  }
}

async function reviewRequest(button) {
  button.disabled = true;
  try {
    const data = await api(`/api/leave-requests/${button.dataset.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.status })
    });
    Object.assign(state, data);
    setMessage(el.formMessage, `Request ${button.dataset.status.toLowerCase()}.`);
    render();
  } catch (error) {
    button.disabled = false;
    setMessage(el.formMessage, error.message, true);
  }
}

function setDefaultDates() {
  el.startDate.value = offsetDate(1);
  el.endDate.value = offsetDate(1);
}

function bindEvents() {
  el.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(el.loginMessage, "");
    try {
      await login(el.loginEmail.value, el.loginPassword.value);
    } catch (error) {
      setMessage(el.loginMessage, error.message, true);
    }
  });

  document.querySelectorAll("[data-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      const [email, password] = demoAccounts[button.dataset.demo];
      el.loginEmail.value = email;
      el.loginPassword.value = password;
    });
  });

  el.logoutButton.addEventListener("click", logout);
  el.refreshButton.addEventListener("click", loadDashboard);
  el.leaveForm.addEventListener("submit", submitLeave);
  [el.employeeSelect, el.leaveType, el.startDate, el.endDate].forEach((input) => {
    input.addEventListener("change", renderFormSummary);
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      renderRequests();
    });
  });

  el.requestsTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (button) reviewRequest(button);
  });
}

setDefaultDates();
bindEvents();
if (state.token) {
  loadDashboard().catch(() => logout());
}

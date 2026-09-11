const demoAccounts = {
  admin: ["admin@leaveflow.test", "admin123"],
  manager: ["manager@leaveflow.test", "manager123"],
  employee: ["aarav@leaveflow.test", "emp123"]
};

const state = {
  csrfToken: "",
  user: null,
  employees: [],
  requests: [],
  metrics: {},
  charts: {},
  filter: "All"
};

const el = (typeof window !== "undefined" && typeof document !== "undefined") ? {
  loginScreen: document.getElementById("loginScreen"),
  appShell: document.getElementById("appShell"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginMessage: document.getElementById("loginMessage"),
  logoutButton: document.getElementById("logoutButton"),
  refreshButton: document.getElementById("refreshButton"),
  dashboardMessage: document.getElementById("dashboardMessage"),
  dashboardEyebrow: document.getElementById("dashboardEyebrow"),
  dashboardHeading: document.getElementById("dashboardHeading"),
  dashboardSubtitle: document.getElementById("dashboardSubtitle"),
  userRole: document.getElementById("userRole"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  pendingMetric: document.getElementById("pendingMetric"),
  pendingMetricLabel: document.getElementById("pendingMetricLabel"),
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
  typeChart: document.getElementById("typeChart"),
  navApprovals: document.getElementById("navApprovals"),
  navTeam: document.getElementById("navTeam"),
  approvalsEyebrow: document.getElementById("approvalsEyebrow"),
  approvalsHeading: document.getElementById("approvalsHeading"),
  requestsMessage: document.getElementById("requestsMessage"),
  statusChartSummary: document.getElementById("statusChartSummary"),
  typeChartSummary: document.getElementById("typeChartSummary"),
  teamSection: document.getElementById("team")
} : {};

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

const API_TIMEOUT_MS = 60000;

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    const isStateChanging = ["POST", "PATCH", "PUT", "DELETE"].includes((options.method || "GET").toUpperCase());
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(state.csrfToken && isStateChanging ? { "X-CSRF-Token": state.csrfToken } : {}),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    if (networkError.name === "AbortError") {
      const err = new Error("The server took too long to respond. Please try again in a moment.");
      err.isTimeout = true;
      throw err;
    }
    const err = new Error("Unable to connect to the service. Please check your connection and try again.");
    err.isNetwork = true;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    rawText = "";
  }

  let data = null;
  if (rawText && rawText.trim()) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }

  if (response.ok) {
    if (data && typeof data === "object" && data.csrfToken) {
      state.csrfToken = data.csrfToken;
    }
    if (data !== null) return data;
    if (!rawText || !rawText.trim()) return {};
    const err = new Error("Service returned an unexpected response. Please try again.");
    err.status = response.status;
    throw err;
  }

  let errorMessage = "";
  if (data && typeof data === "object" && typeof data.error === "string" && data.error.trim()) {
    const rawMsg = data.error.trim();
    if (!rawMsg.includes("<") && !rawMsg.includes("at ") && !rawMsg.toLowerCase().includes("syntaxerror")) {
      errorMessage = rawMsg;
    }
  }

  if (!errorMessage) {
    if (response.status === 401) {
      errorMessage = "Invalid email or password.";
    } else if (response.status === 403) {
      errorMessage = "Access denied.";
    } else {
      errorMessage = "Service is temporarily unavailable. Please try again in a moment.";
    }
  }

  const err = new Error(errorMessage);
  err.status = response.status;
  throw err;
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
  if (data && data.csrfToken) {
    state.csrfToken = data.csrfToken;
  }
  state.filter = "All";
  await loadDashboard();
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  if (data && data.csrfToken) {
    state.csrfToken = data.csrfToken;
  }
  state.user = data.user;
  state.employees = data.employees;
  state.requests = data.requests;
  state.metrics = data.metrics;
  state.charts = data.charts;
  render();
}

function resetRoleState() {
  state.filter = "All";
  if (typeof document !== "undefined") {
    document.querySelectorAll(".filter-button").forEach((item) => {
      const isActive = item.dataset.filter === "All";
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
    document.querySelectorAll(".sidebar nav a").forEach((link) => {
      const isDashboard = link.getAttribute("href") === "#dashboard";
      link.classList.toggle("active", isDashboard);
      if (isDashboard) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    if (el.loginMessage) setMessage(el.loginMessage, "");
    if (el.dashboardMessage) setMessage(el.dashboardMessage, "");
    if (el.formMessage) setMessage(el.formMessage, "");
    if (el.requestsMessage) setMessage(el.requestsMessage, "");
    if (el.leaveForm && typeof el.leaveForm.reset === "function") el.leaveForm.reset();
    if (el.employeeSelect) el.employeeSelect.innerHTML = "";
    if (el.requestsTable) el.requestsTable.innerHTML = "";
    if (el.teamGrid) el.teamGrid.innerHTML = "";
    if (el.navApprovals) el.navApprovals.textContent = "Approvals";
    if (el.approvalsEyebrow) el.approvalsEyebrow.textContent = "Team approvals";
    if (el.approvalsHeading) el.approvalsHeading.textContent = "Team Leave Requests";
    if (el.dashboardEyebrow) el.dashboardEyebrow.textContent = "Leave Overview";
    if (el.dashboardHeading) el.dashboardHeading.textContent = "Leave Dashboard";
    if (el.dashboardSubtitle) el.dashboardSubtitle.textContent = "Real-time leave balance and request overview.";
    if (el.pendingMetricLabel) el.pendingMetricLabel.textContent = "Awaiting decision";
    if (el.navTeam) el.navTeam.classList.remove("hidden");
    if (el.teamSection) el.teamSection.classList.remove("hidden");
    if (el.employeeField) el.employeeField.classList.remove("hidden");
    if (el.endDate && typeof el.endDate.removeAttribute === "function") el.endDate.removeAttribute("aria-invalid");
    setDefaultDates();
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch(e) {}
  state.csrfToken = "";
  state.user = null;
  state.employees = [];
  state.requests = [];
  state.metrics = {};
  state.charts = {};
  state.filter = "All";
  resetRoleState();
  el.loginScreen.classList.remove("hidden");
  el.appShell.classList.add("hidden");
}

function applyRoleUI() {
  const role = state.user ? state.user.role : "";
  const isEmployee = role === "employee";
  const isManager = role === "manager";

  if (el.dashboardEyebrow) {
    el.dashboardEyebrow.textContent = isEmployee ? "Employee Workspace" : isManager ? "Manager Portal" : "Admin Console";
  }
  if (el.dashboardHeading) {
    if (isEmployee) {
      el.dashboardHeading.textContent = "My Leave Dashboard";
    } else if (isManager) {
      el.dashboardHeading.textContent = "Team Leave Dashboard";
    } else {
      el.dashboardHeading.textContent = "Organization Leave Dashboard";
    }
  }
  if (el.dashboardSubtitle) {
    const userName = (state.user && state.user.name) ? state.user.name : "User";
    if (isEmployee) {
      el.dashboardSubtitle.textContent = `Personal leave overview for ${userName}.`;
    } else if (isManager) {
      el.dashboardSubtitle.textContent = `Team leave oversight and approval queue for ${userName}.`;
    } else {
      el.dashboardSubtitle.textContent = `Organization-wide leave management and administration for ${userName}.`;
    }
  }
  if (el.pendingMetricLabel) {
    if (isEmployee) {
      el.pendingMetricLabel.textContent = "Awaiting decision";
    } else if (isManager) {
      el.pendingMetricLabel.textContent = "Team reviews pending";
    } else {
      el.pendingMetricLabel.textContent = "Organization reviews";
    }
  }

  if (el.navApprovals) {
    el.navApprovals.textContent = isEmployee ? "My Requests" : "Approvals";
  }
  if (el.approvalsEyebrow) {
    if (isEmployee) {
      el.approvalsEyebrow.textContent = "Request history";
    } else if (isManager) {
      el.approvalsEyebrow.textContent = "Team approvals";
    } else {
      el.approvalsEyebrow.textContent = "Organization approvals";
    }
  }
  if (el.approvalsHeading) {
    if (isEmployee) {
      el.approvalsHeading.textContent = "My Leave Requests";
    } else if (isManager) {
      el.approvalsHeading.textContent = "Team Leave Requests";
    } else {
      el.approvalsHeading.textContent = "Organization Leave Requests";
    }
  }
  if (el.navTeam) {
    el.navTeam.classList.toggle("hidden", isEmployee);
  }
  if (el.teamSection) {
    el.teamSection.classList.toggle("hidden", isEmployee);
  }
  if (el.employeeField) {
    el.employeeField.classList.toggle("hidden", isEmployee);
  }
}

function render() {
  el.loginScreen.classList.add("hidden");
  el.appShell.classList.remove("hidden");
  applyRoleUI();
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
  const metrics = state.metrics || {};
  el.pendingMetric.textContent = metrics.pending || 0;
  el.approvedMetric.textContent = metrics.approved || 0;
  el.rejectedMetric.textContent = metrics.rejected || 0;
  el.monthMetric.textContent = metrics.thisMonth || 0;
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
  if (!employees.length) {
    el.employeeSelect.innerHTML = '<option value="">No employees available</option>';
    return;
  }
  el.employeeSelect.innerHTML = employees
    .map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)} (${escapeHTML(employee.employeeCode)})</option>`)
    .join("");
  if (!el.employeeSelect.value && employees[0]) el.employeeSelect.value = employees[0].id;
}

function selectedEmployee() {
  const employeeId = state.user.role === "employee" ? state.user.id : el.employeeSelect.value;
  return state.employees.find((employee) => employee.id === employeeId) || null;
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
  if (!days && el.startDate.value && el.endDate.value) {
    if (el.endDate && typeof el.endDate.setAttribute === "function") el.endDate.setAttribute("aria-invalid", "true");
  } else {
    if (el.endDate && typeof el.endDate.removeAttribute === "function") el.endDate.removeAttribute("aria-invalid");
  }
  el.balancePreview.textContent = `Balance: ${selectedBalance()}`;
}

function renderRequests() {
  const isReviewer = ["manager", "admin"].includes(state.user.role);
  const requests = state.requests.filter((request) => state.filter === "All" || request.status === state.filter);

  if (!requests.length) {
    el.requestsTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">No leave requests found.</div></td></tr>';
    return;
  }

  el.requestsTable.innerHTML = requests
    .map((request) => {
      const isOwn = request.employeeId === state.user.id;
      let action = "";

      if (request.status === "Pending") {
        if (isOwn) {
          action = `<span class="muted">${isReviewer ? "Awaiting another reviewer" : "Awaiting review"}</span>`;
        } else if (isReviewer) {
          const canApprove =
            state.user.role === "admin" ||
            (state.user.role === "manager" &&
              state.employees.some((e) => e.id === request.employeeId && e.managerId === state.user.id));

          if (canApprove) {
            action = `<div class="request-actions">
              <button class="action-button approve" data-id="${request.id}" data-status="Approved" type="button">Approve</button>
              <button class="action-button reject" data-id="${request.id}" data-status="Rejected" type="button">Reject</button>
            </div>`;
          } else {
            action = `<span class="muted">No action</span>`;
          }
        } else {
          action = `<span class="muted">No action</span>`;
        }
      } else {
        action = `<span class="muted">${request.reviewerName ? `Reviewed by ${escapeHTML(request.reviewerName)}` : "Reviewed"}</span>`;
      }

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
  if (!state.employees.length) {
    el.teamGrid.innerHTML = '<div class="empty-state">No team balances found.</div>';
    return;
  }

  el.teamGrid.innerHTML = state.employees
    .map((employee) => {
      const annualBalance = employee.annualBalance || 1;
      const sickBalance = employee.sickBalance || 1;
      const casualBalance = employee.casualBalance || 1;
      const annualWidth = Math.max(0, Math.min(100, ((employee.annualAvailable || 0) / annualBalance) * 100));
      const sickWidth = Math.max(0, Math.min(100, ((employee.sickAvailable || 0) / sickBalance) * 100));
      const casualWidth = Math.max(0, Math.min(100, ((employee.casualAvailable || 0) / casualBalance) * 100));
      return `<article class="team-card">
        <strong>${escapeHTML(employee.name)}</strong>
        <span class="muted">${escapeHTML(employee.designation)} · ${escapeHTML(employee.department)}</span>
        <div class="balance-row">
          <span>Annual ${employee.annualAvailable ?? 0}/${employee.annualBalance ?? 0}</span><div class="bar"><i style="width:${annualWidth}%"></i></div>
          <span>Sick ${employee.sickAvailable ?? 0}/${employee.sickBalance ?? 0}</span><div class="bar"><i style="width:${sickWidth}%"></i></div>
          <span>Casual ${employee.casualAvailable ?? 0}/${employee.casualBalance ?? 0}</span><div class="bar"><i style="width:${casualWidth}%"></i></div>
        </div>
      </article>`;
    })
    .join("");
}

function drawCharts() {
  const statusCounts = state.charts.statusCounts || {};
  const typeDays = state.charts.typeDays || {};

  drawDonut(el.statusChart, statusCounts, {
    Pending: "#fbbf24",
    Approved: "#34d399",
    Rejected: "#f87171"
  });
  drawBars(el.typeChart, typeDays, "#3b82f6");

  const statusTotal = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  if (el.statusChartSummary) {
    if (statusTotal === 0) {
      el.statusChartSummary.textContent = "Status mix: No data available";
    } else {
      const pending = statusCounts.Pending || 0;
      const approved = statusCounts.Approved || 0;
      const rejected = statusCounts.Rejected || 0;
      el.statusChartSummary.textContent = `Status mix: Pending: ${pending}, Approved: ${approved}, Rejected: ${rejected}`;
    }
  }

  const typeTotal = Object.values(typeDays).reduce((sum, value) => sum + value, 0);
  if (el.typeChartSummary) {
    if (typeTotal === 0) {
      el.typeChartSummary.textContent = "Approved days: No data available";
    } else {
      const annual = typeDays.Annual || 0;
      const sick = typeDays.Sick || 0;
      const casual = typeDays.Casual || 0;
      const unpaid = typeDays.Unpaid || 0;
      el.typeChartSummary.textContent = `Approved days by type: Annual: ${annual}, Sick: ${sick}, Casual: ${casual}, Unpaid: ${unpaid}`;
    }
  }
}

function drawDonut(canvas, values, colors) {
  if (!canvas || typeof canvas.getContext !== "function") return;
  const ctx = canvas.getContext("2d");
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);

  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const logicalWidth = 280;
  const logicalHeight = 160;
  if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
  }
  if (canvas.style) {
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
  }
  if (typeof ctx.setTransform === "function") ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (typeof ctx.scale === "function") ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  if (!total) {
    ctx.beginPath();
    ctx.arc(58, 80, 40, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 12;
    if (typeof ctx.stroke === "function") ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    if (typeof ctx.textAlign !== "undefined") ctx.textAlign = "center";
    ctx.fillText("No data yet", 58, 84);
    if (typeof ctx.textAlign !== "undefined") ctx.textAlign = "start";
    return;
  }

  let start = -Math.PI / 2;
  Object.entries(values).forEach(([label, value], index) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(58, 80);
    ctx.arc(58, 80, 46, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[label] || "#64748b";
    ctx.fill();

    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(122, 28 + index * 26, 9, 9, 2);
      ctx.fillStyle = colors[label] || "#64748b";
      ctx.fill();
    } else {
      ctx.fillStyle = colors[label] || "#64748b";
      ctx.fillRect(122, 28 + index * 26, 9, 9);
    }

    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`${label}: ${value}`, 138, 37 + index * 26);
    start += angle;
  });

  // Dark cutout matching dark subpanel surface (--bg-elevated: #131f38)
  ctx.beginPath();
  ctx.arc(58, 80, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#131f38";
  ctx.fill();

  // Subtle inner border for depth
  ctx.beginPath();
  ctx.arc(58, 80, 26, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  if (typeof ctx.stroke === "function") ctx.stroke();
}

function drawBars(canvas, values, color) {
  if (!canvas || typeof canvas.getContext !== "function") return;
  const ctx = canvas.getContext("2d");
  const entries = Object.entries(values);
  const max = Math.max(1, ...entries.map(([, value]) => value));

  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const logicalWidth = 280;
  const logicalHeight = 160;
  if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
  }
  if (canvas.style) {
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
  }
  if (typeof ctx.setTransform === "function") ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (typeof ctx.scale === "function") ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  entries.forEach(([label, value], index) => {
    const y = 16 + index * 34;
    const barWidth = (value / max) * 110;

    // Category label
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(label, 4, y + 11);

    // Track background
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(56, y, 110, 14, 3);
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(56, y, 110, 14);
    }

    // Value fill bar
    if (value > 0) {
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(56, y, Math.max(4, barWidth), 14, 3);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(56, y, Math.max(4, barWidth), 14);
      }
    }

    // Value count
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(String(value), 174, y + 11);
  });
}

let chartResizeDebounce;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("resize", () => {
    clearTimeout(chartResizeDebounce);
    chartResizeDebounce = setTimeout(() => {
      if (state.user) {
        drawCharts();
      }
    }, 150);
  });
}

let isSubmittingLeave = false;

async function submitLeave(event) {
  event.preventDefault();
  if (isSubmittingLeave) return;

  const submitButton = el.leaveForm.querySelector('button[type="submit"]');
  const originalText = submitButton ? submitButton.textContent : "Submit Request";

  isSubmittingLeave = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    submitButton.setAttribute("aria-busy", "true");
  }
  setMessage(el.formMessage, "");
  if (el.endDate && typeof el.endDate.removeAttribute === "function") el.endDate.removeAttribute("aria-invalid");

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
    if (error && error.status === 401) {
      await logout();
      setMessage(el.loginMessage, "Session expired. Please log in again.", true);
    } else {
      setMessage(el.formMessage, error.message, true);
      if (el.endDate && typeof el.endDate.setAttribute === "function" && error.message && (error.message.toLowerCase().includes("date") || error.message.toLowerCase().includes("balance"))) {
        el.endDate.setAttribute("aria-invalid", "true");
      }
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
      submitButton.removeAttribute("aria-busy");
    }
    isSubmittingLeave = false;
  }
}

const pendingReviewIds = new Set();

async function reviewRequest(button) {
  const requestId = button.dataset.id;
  const status = button.dataset.status;
  if (!requestId || !status || pendingReviewIds.has(requestId)) return;
  pendingReviewIds.add(requestId);

  const originalText = button.textContent;
  const actionContainer = button.closest(".request-actions");
  const actionButtons = actionContainer ? Array.from(actionContainer.querySelectorAll("button")) : [button];

  actionButtons.forEach((b) => (b.disabled = true));
  button.textContent = status === "Approved" ? "Approving…" : "Rejecting…";
  button.setAttribute("aria-busy", "true");
  if (el.requestsMessage) setMessage(el.requestsMessage, "");

  try {
    const data = await api(`/api/leave-requests/${requestId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    Object.assign(state, data);
    if (el.requestsMessage) {
      setMessage(el.requestsMessage, `Request ${status.toLowerCase()}.`);
    }
    render();
  } catch (error) {
    button.textContent = originalText;
    button.removeAttribute("aria-busy");
    actionButtons.forEach((b) => (b.disabled = false));
    if (error && error.status === 401) {
      await logout();
      setMessage(el.loginMessage, "Session expired. Please log in again.", true);
    } else {
      if (el.requestsMessage) {
        setMessage(el.requestsMessage, error.message, true);
      }
    }
  } finally {
    button.removeAttribute("aria-busy");
    pendingReviewIds.delete(requestId);
  }
}

let isRefreshing = false;

async function handleRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;

  const originalText = el.refreshButton.textContent;
  el.refreshButton.disabled = true;
  el.refreshButton.textContent = "Refreshing…";
  el.refreshButton.setAttribute("aria-busy", "true");
  if (el.dashboardMessage) setMessage(el.dashboardMessage, "");

  try {
    await loadDashboard();
    if (el.dashboardMessage) setMessage(el.dashboardMessage, "Dashboard refreshed.");
  } catch (error) {
    if (error && error.status === 401) {
      await logout();
      setMessage(el.loginMessage, "Session expired. Please log in again.", true);
    } else {
      if (el.dashboardMessage) setMessage(el.dashboardMessage, error.message, true);
    }
  } finally {
    el.refreshButton.disabled = false;
    el.refreshButton.textContent = originalText;
    el.refreshButton.removeAttribute("aria-busy");
    isRefreshing = false;
  }
}

let isLoggingIn = false;

async function handleLogin(event) {
  event.preventDefault();
  if (isLoggingIn) return;

  const submitButton = el.loginForm.querySelector('button[type="submit"]');
  const originalText = submitButton ? submitButton.textContent : "Login";

  isLoggingIn = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Signing in…";
    submitButton.setAttribute("aria-busy", "true");
  }
  setMessage(el.loginMessage, "Starting your workspace. This may take a few moments.", false);

  try {
    await login(el.loginEmail.value, el.loginPassword.value);
    setMessage(el.loginMessage, "");
  } catch (error) {
    setMessage(el.loginMessage, error.message, true);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
      submitButton.removeAttribute("aria-busy");
    }
    isLoggingIn = false;
  }
}

function setDefaultDates() {
  if (el.startDate) el.startDate.value = offsetDate(1);
  if (el.endDate) el.endDate.value = offsetDate(1);
}

function bindEvents() {
  el.loginForm.addEventListener("submit", handleLogin);

  document.querySelectorAll("[data-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      const [email, password] = demoAccounts[button.dataset.demo];
      el.loginEmail.value = email;
      el.loginPassword.value = password;
    });
  });

  el.logoutButton.addEventListener("click", logout);
  el.refreshButton.addEventListener("click", handleRefresh);
  el.leaveForm.addEventListener("submit", submitLeave);
  [el.employeeSelect, el.leaveType, el.startDate, el.endDate].forEach((input) => {
    input.addEventListener("change", renderFormSummary);
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      state.filter = button.dataset.filter;
      renderRequests();
    });
  });

  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".sidebar nav a").forEach((item) => {
        item.classList.remove("active");
        item.removeAttribute("aria-current");
      });
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    });
  });

  el.requestsTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (button) reviewRequest(button);
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("leaveflow-token");
    }
  } catch {}

  setDefaultDates();
  bindEvents();

  loadDashboard().catch((error) => {
    state.csrfToken = "";
    state.user = null;
    el.loginScreen.classList.remove("hidden");
    el.appShell.classList.add("hidden");
    if (error && error.status === 401) {
      // Clean unauthenticated initial view
    } else if (error && error.message) {
      setMessage(
        el.loginMessage,
        "Unable to connect to your workspace. Please check your connection and try logging in again.",
        true
      );
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    api,
    API_TIMEOUT_MS,
    state,
    el,
    login,
    loadDashboard,
    logout,
    submitLeave,
    reviewRequest,
    handleRefresh,
    handleLogin,
    setMessage,
    applyRoleUI,
    resetRoleState,
    visibleEmployeesForForm,
    renderRequests,
    renderTeam,
    drawCharts,
    renderFormSummary,
    getPendingFlags: () => ({
      isLoggingIn,
      isRefreshing,
      isSubmittingLeave,
      pendingReviewIds
    })
  };
}

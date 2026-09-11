/**
 * scripts/capture_phase5b_screenshots.cjs
 *
 * Automated Screenshot Capturer using Chrome DevTools Protocol (CDP) for Phase 5B.
 * Captures to screenshots/phase5b-final/ with zero cache, exact pixel device metrics,
 * zero DOM hierarchy mutation, and authentic scrollIntoView positions.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3015;
const CDP_PORT = 9233;
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'phase5b-final');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];

async function ensureRoleLoggedIn(send, role) {
  await send('Runtime.evaluate', {
    expression: `(async () => {
      const shell = document.getElementById('appShell');
      const curRole = (document.getElementById('userRole') ? document.getElementById('userRole').textContent : '').toLowerCase();
      if (shell && !shell.classList.contains('hidden') && curRole === '${role}'.toLowerCase()) {
        window.scrollTo(0, 0);
        return;
      }
      const logoutBtn = document.getElementById('logoutButton');
      if (logoutBtn && shell && !shell.classList.contains('hidden')) {
        logoutBtn.click();
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (!shell || shell.classList.contains('hidden')) break;
        }
      }
      const submitBtn = document.querySelector('#loginForm button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = 'Login';
      }
      const demoBtn = document.querySelector('button[data-demo="${role}"]');
      if (demoBtn) demoBtn.click();
      if (submitBtn) submitBtn.click();
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (shell && !shell.classList.contains('hidden')) break;
      }
      window.scrollTo(0, 0);
    })()`,
    awaitPromise: true
  });
}

const SCENARIOS = [
  {
    name: 'login',
    setup: async (send) => {
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const logoutBtn = document.getElementById('logoutButton');
          const shell = document.getElementById('appShell');
          if (logoutBtn && shell && !shell.classList.contains('hidden')) {
            logoutBtn.click();
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 100));
              if (!shell || shell.classList.contains('hidden')) break;
            }
          }
          const submitBtn = document.querySelector('#loginForm button[type="submit"]');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = 'Login';
          }
          window.scrollTo(0, 0);
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'employee_dashboard',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'employee');
      await send('Runtime.evaluate', {
        expression: `window.scrollTo(0, 0)`
      });
    }
  },
  {
    name: 'manager_dashboard',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'manager');
      await send('Runtime.evaluate', {
        expression: `window.scrollTo(0, 0)`
      });
    }
  },
  {
    name: 'admin_dashboard',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'admin');
      await send('Runtime.evaluate', {
        expression: `window.scrollTo(0, 0)`
      });
    }
  },
  {
    name: 'empty_requests',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'manager');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const fBtn = document.querySelector('.filter-button[data-filter="Rejected"]');
          if (fBtn) fBtn.click();
          const approvals = document.getElementById('approvals');
          if (approvals) approvals.scrollIntoView();
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'validation_error',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'employee');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const start = document.getElementById('startDate');
          const end = document.getElementById('endDate');
          const msg = document.getElementById('formMessage');
          if (start && end && msg) {
            start.value = '2026-10-10';
            end.value = '2026-10-02';
            end.setAttribute('aria-invalid', 'true');
            msg.textContent = 'End date must be after start date.';
            msg.className = 'message error';
          }
          const apply = document.getElementById('apply');
          if (apply) apply.scrollIntoView();
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'login_pending',
    setup: async (send) => {
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const logoutBtn = document.getElementById('logoutButton');
          const shell = document.getElementById('appShell');
          if (logoutBtn && shell && !shell.classList.contains('hidden')) {
            logoutBtn.click();
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 100));
              if (!shell || shell.classList.contains('hidden')) break;
            }
          }
          const btn = document.querySelector('#loginForm button[type="submit"]');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Signing in\u2026';
            btn.setAttribute('aria-busy', 'true');
          }
          window.scrollTo(0, 0);
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'submit_pending',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'employee');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const btn = document.querySelector('#leaveForm button[type="submit"]');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Submitting\u2026';
            btn.setAttribute('aria-busy', 'true');
          }
          const apply = document.getElementById('apply');
          if (apply) apply.scrollIntoView();
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'review_pending',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'manager');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const approvals = document.getElementById('approvals');
          if (approvals) approvals.scrollIntoView();
          const btn = document.querySelector('.action-button.approve');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Approving\u2026';
            btn.setAttribute('aria-busy', 'true');
          }
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'success_feedback',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'manager');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const approvals = document.getElementById('approvals');
          if (approvals) approvals.scrollIntoView();
          const msg = document.getElementById('requestsMessage');
          if (msg) {
            msg.textContent = 'Request approved.';
            msg.className = 'message';
          }
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'request_error',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'manager');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const approvals = document.getElementById('approvals');
          if (approvals) approvals.scrollIntoView();
          const msg = document.getElementById('requestsMessage');
          if (msg) {
            msg.textContent = 'Leave dates overlap with an existing approved request.';
            msg.className = 'message error';
          }
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'visible_focus',
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'employee');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          window.scrollTo(0, 0);
          const btn = document.getElementById('refreshButton');
          if (btn) btn.focus();
        })()`,
        awaitPromise: true
      });
    }
  },
  {
    name: 'horizontal_table_scroll',
    viewportsOnly: ['768x1024', '390x844', '360x800'],
    setup: async (send) => {
      await ensureRoleLoggedIn(send, 'employee');
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const approvals = document.getElementById('approvals');
          if (approvals) approvals.scrollIntoView();
          const wrap = document.querySelector('.table-wrap');
          if (wrap) wrap.scrollLeft = 150;
        })()`,
        awaitPromise: true
      });
    }
  }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('Step 1: Starting LeaveFlow server on port ' + PORT + '...');
  const serverProc = spawn('node', ['backend/server.cjs'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      ALLOW_IN_MEMORY_DB: 'true',
      DATABASE_URL: ''
    },
    stdio: 'ignore'
  });

  await sleep(2500);

  console.log('Step 2: Launching Chrome with CDP on port ' + CDP_PORT + '...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `http://localhost:${PORT}/`
  ]);

  await sleep(2000);

  let successCount = 0;
  let failCount = 0;

  try {
    const targets = await fetchJson(`http://localhost:${CDP_PORT}/json`);
    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes(String(PORT)));
    if (!pageTarget) throw new Error('Chrome DevTools page target not found');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise(resolve => ws.onopen = resolve);

    let cdpId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = cdpId++;
        const handler = (event) => {
          const res = JSON.parse(event.data);
          if (res.id === id) {
            ws.removeEventListener('message', handler);
            resolve(res.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('DOM.enable');
    await send('CSS.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });

    console.log('Step 3: Capturing screenshots via CDP Emulation across all scenarios and viewports...\n');

    for (const scenario of SCENARIOS) {
      console.log(`--- Scenario: ${scenario.name} ---`);
      const targetViewports = scenario.viewportsOnly
        ? VIEWPORTS.filter((v) => scenario.viewportsOnly.includes(v.name))
        : VIEWPORTS;

      for (const vp of targetViewports) {
        const filename = `${scenario.name}_${vp.name}.png`;
        const filePath = path.join(SCREENSHOT_DIR, filename);

        try {
          await send('Emulation.setDeviceMetricsOverride', {
            width: vp.width,
            height: vp.height,
            deviceScaleFactor: 1,
            mobile: vp.width <= 768
          });

          await sleep(100);
          await scenario.setup(send);
          await sleep(200);

          const shot = await send('Page.captureScreenshot', { format: 'png' });
          if (shot && shot.data) {
            fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
            const size = fs.statSync(filePath).size;
            console.log(`  [OK] ${filename} (${size} bytes)`);
            successCount++;
          } else {
            console.error(`  [FAIL] Could not capture ${filename}`);
            failCount++;
          }
        } catch (e) {
          console.error(`  [ERROR] Failed to capture ${filename}:`, e.message);
          failCount++;
        }
      }
    }

    ws.close();
    console.log(`\nScreenshot capture finished: ${successCount} captured, ${failCount} failed.`);
    console.log(`Saved to screenshots/phase5b-final/.`);
  } finally {
    chromeProc.kill();
    serverProc.kill();
  }
}

main().catch((err) => {
  console.error('Fatal error in screenshot runner:', err);
  process.exit(1);
});

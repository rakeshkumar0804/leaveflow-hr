const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveflow-clean-ci-'));
console.log('Clean CI directory:', tmpDir);

async function run() {
  try {
    const copyRecursive = (src, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      for (const item of fs.readdirSync(src)) {
        if (item === 'node_modules' || item === '.git' || item === 'screenshots') continue;
        const s = path.join(src, item);
        const d = path.join(dest, item);
        if (fs.statSync(s).isDirectory()) copyRecursive(s, d);
        else fs.copyFileSync(s, d);
      }
    };
    copyRecursive(process.cwd(), tmpDir);
    console.log('Files copied to temporary checkout.');

    // 1. Run npm ci
    console.log('Running npm ci...');
    const ciOut = execSync('npm ci', { cwd: tmpDir, stdio: 'pipe' }).toString();
    console.log('npm ci output:', ciOut.trim().split('\n').pop());

    // 2. Syntax check
    console.log('Checking syntax...');
    ['backend/server.cjs', 'backend/database.cjs', 'public/app.js'].forEach(f => {
      execSync('node --check ' + f, { cwd: tmpDir });
    });
    console.log('Syntax check: PASS');

    // 3. Test local pg-mem startup
    console.log('Testing pg-mem startup...');
    const proc = spawn('node', ['backend/server.cjs'], {
      cwd: tmpDir,
      env: { ...process.env, PORT: '3099', ALLOW_IN_MEMORY_DB: 'true', NODE_ENV: 'development', DATABASE_URL: '' },
      stdio: 'pipe'
    });
    let started = false;
    proc.stdout.on('data', d => {
      if (d.toString().includes('3099')) started = true;
    });
    await new Promise(r => setTimeout(r, 2000));
    proc.kill();
    console.log('pg-mem startup verified:', started ? 'PASS' : 'FAIL');

    // 4. Test production safe-failure without DATABASE_URL
    console.log('Testing production safe-failure without DATABASE_URL...');
    try {
      execSync('node backend/server.cjs', {
        cwd: tmpDir,
        env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', RATE_LIMIT_SECRET: 'a'.repeat(32) },
        stdio: 'pipe'
      });
      console.error('FAIL: Production started without DATABASE_URL!');
    } catch (e) {
      const err = e.stderr ? e.stderr.toString() : e.message;
      console.log('Production safe-failure (no DATABASE_URL):', err.includes('DATABASE_URL environment variable is required') ? 'PASS' : 'FAIL');
    }

    // 5. Test production safe-failure without valid RATE_LIMIT_SECRET
    console.log('Testing production safe-failure without valid RATE_LIMIT_SECRET...');
    try {
      execSync('node backend/server.cjs', {
        cwd: tmpDir,
        env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres:password@localhost:5432/test', RATE_LIMIT_SECRET: '' },
        stdio: 'pipe'
      });
      console.error('FAIL: Production started without RATE_LIMIT_SECRET!');
    } catch (e) {
      const err = e.stderr ? e.stderr.toString() : e.message;
      console.log('Production safe-failure (no RATE_LIMIT_SECRET):', err.includes('RATE_LIMIT_SECRET environment variable is required') ? 'PASS' : 'FAIL');
    }

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log('Temporary directory cleaned up.');
  }
}

run().catch(console.error);

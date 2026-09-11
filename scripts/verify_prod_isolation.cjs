const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveflow-prod-isolation-'));
console.log('Temporary production checkout:', tmpDir);

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

  // 1. Run npm ci --omit=dev
  console.log('Running npm ci --omit=dev...');
  const ciOut = execSync('npm ci --omit=dev', { cwd: tmpDir, stdio: 'pipe' }).toString();
  console.log(ciOut.trim());

  // Check if pg-mem exists in node_modules
  const pgMemPath = path.join(tmpDir, 'node_modules', 'pg-mem');
  console.log('Is pg-mem installed in node_modules?:', fs.existsSync(pgMemPath));

  // 2. Verify production modules load without pg-mem
  console.log('Loading backend/database.cjs in Node without pg-mem...');
  execSync('node -e "require(\'./backend/database.cjs\'); console.log(\'backend/database.cjs loaded successfully without pg-mem!\');"', { cwd: tmpDir, stdio: 'inherit' });

  // 3. Test production safe-failure without DATABASE_URL
  console.log('Testing production safe-failure without DATABASE_URL (NODE_ENV=production)...');
  try {
    execSync('node backend/server.cjs', {
      cwd: tmpDir,
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', RATE_LIMIT_SECRET: 'a'.repeat(32) },
      stdio: 'pipe'
    });
    console.error('FAIL: Started without DATABASE_URL');
  } catch (e) {
    const err = e.stderr ? e.stderr.toString() : e.message;
    console.log('Safe validation output (no DATABASE_URL):', err.trim());
  }

  // 4. Test production safe-failure without RATE_LIMIT_SECRET
  console.log('Testing production safe-failure without RATE_LIMIT_SECRET (NODE_ENV=production)...');
  try {
    execSync('node backend/server.cjs', {
      cwd: tmpDir,
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://postgres:password@localhost:5432/test', RATE_LIMIT_SECRET: '' },
      stdio: 'pipe'
    });
    console.error('FAIL: Started without RATE_LIMIT_SECRET');
  } catch (e) {
    const err = e.stderr ? e.stderr.toString() : e.message;
    console.log('Safe validation output (no RATE_LIMIT_SECRET):', err.trim());
  }

} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  console.log('Temporary directory cleaned up.');
}

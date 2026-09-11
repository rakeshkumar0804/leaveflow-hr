const fs = require('fs');
const path = require('path');

const patterns = [
  { name: 'Private Key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Generic API Key', re: /(api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][0-9a-zA-Z]{16,}['"]/i },
  { name: 'Bearer Token', re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i },
  { name: 'Hardcoded Real Connection String', re: /postgres(ql)?:\/\/(?!postgres:(password|\*\*\*|demo))[^:]+:[^@]+@[^:]+:[0-9]+/i }
];

const scanned = [];
const findings = [];

function scanDir(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const normalized = p.replace(/\\/g, '/');
    if (
      normalized === 'node_modules' ||
      normalized === '.git' ||
      normalized === 'screenshots' ||
      normalized === '.tmp_chrome' ||
      normalized.startsWith('node_modules/') ||
      normalized.startsWith('.git/') ||
      normalized.startsWith('screenshots/') ||
      normalized.startsWith('.tmp_chrome/') ||
      normalized.includes('scripts/debug')
    ) {
      continue;
    }
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      scanDir(p);
    } else {
      scanned.push(normalized);
      if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.sqlite') || f.endsWith('.ico')) {
        continue;
      }
      const content = fs.readFileSync(p, 'utf8');
      patterns.forEach(pat => {
        if (
          pat.re.test(content) &&
          !f.endsWith('.example') &&
          !f.startsWith('test_') &&
          !f.includes('scan_secrets')
        ) {
          findings.push({ file: normalized, pattern: pat.name });
        }
      });
    }
  }
}
scanDir('.');
console.log('Scanned files count:', scanned.length);
console.log('Findings count:', findings.length);
if (findings.length > 0) {
  console.log('Findings:', JSON.stringify(findings, null, 2));
  process.exit(1);
} else {
  console.log('ZERO active secrets found across all scanned files.');
}

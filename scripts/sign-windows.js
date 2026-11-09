// Windows Authenticode signing for Leise DNS.
// Driven only by environment variables. With no certificate configured this
// does nothing, so a normal build stays unsigned and still succeeds.
// Passwords stay in the environment and are never printed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function flag(value) {
  return /^(1|true|yes)$/i.test(String(value || ''));
}

function signingPlan(env = process.env) {
  const passwordSet = !!(env.LEISE_SIGN_PASSWORD || env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD);
  if (flag(env.LEISE_AZURE_SIGN)) return azurePlan(env);
  const pfx = String(env.LEISE_SIGN_PFX || '').trim();
  const b64 = String(env.LEISE_SIGN_PFX_BASE64 || '').trim();
  const csc = String(env.WIN_CSC_LINK || env.CSC_LINK || '').trim();
  if (pfx || b64 || csc) {
    return {
      mode: 'pfx',
      source: pfx ? 'file' : b64 ? 'base64' : 'csc',
      // A long CSC_LINK is the base64 certificate itself; never treat it as a path to log.
      file: pfx || (csc.length > 260 || /^https?:/i.test(csc) ? '' : csc),
      hasPassword: passwordSet
    };
  }
  const thumb = String(env.LEISE_SIGN_THUMBPRINT || '').replace(/\s+/g, '').toUpperCase();
  if (thumb) return { mode: 'thumbprint', thumbprint: thumb, hasPassword: false };
  if (env.LEISE_AZURE_ACCOUNT && env.LEISE_AZURE_PROFILE) return azurePlan(env);
  return { mode: 'skip', hasPassword: false };
}

function azurePlan(env) {
  return {
    mode: 'azure',
    endpoint: env.LEISE_AZURE_ENDPOINT || 'https://eus.codesigning.azure.net',
    account: env.LEISE_AZURE_ACCOUNT || '',
    profile: env.LEISE_AZURE_PROFILE || '',
    publisher: env.LEISE_AZURE_PUBLISHER || '',
    timestamp: env.LEISE_TIMESTAMP_URL || 'http://timestamp.acs.microsoft.com',
    dlib: env.LEISE_AZURE_DLIB || '',
    hasSecret: !!(env.AZURE_CLIENT_SECRET || env.AZURE_CLIENT_CERTIFICATE_PATH)
  };
}

function planError(plan, env = process.env) {
  if (!plan || plan.mode === 'skip') return '';
  if (plan.mode === 'pfx') {
    if (!plan.hasPassword) return 'Zertifikat ist gesetzt, aber kein Passwort (LEISE_SIGN_PASSWORD oder WIN_CSC_KEY_PASSWORD).';
    if (plan.source === 'file' && plan.file && !fs.existsSync(plan.file)) return `Zertifikatsdatei nicht gefunden: ${plan.file}`;
    return '';
  }
  if (plan.mode === 'thumbprint') {
    if (!/^[0-9A-F]{40}$/.test(plan.thumbprint)) return 'LEISE_SIGN_THUMBPRINT muss der SHA-1-Fingerabdruck (40 Hex-Zeichen) sein.';
    return '';
  }
  if (!plan.account || !plan.profile || !plan.publisher) return 'Azure Trusted Signing braucht LEISE_AZURE_ACCOUNT, LEISE_AZURE_PROFILE und LEISE_AZURE_PUBLISHER.';
  if (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID || !plan.hasSecret) return 'Azure Trusted Signing braucht AZURE_TENANT_ID, AZURE_CLIENT_ID und AZURE_CLIENT_SECRET (oder ein Zertifikat).';
  return '';
}

function describePlan(plan) {
  if (plan.mode === 'skip') return 'Signierung übersprungen: kein Zertifikat konfiguriert.';
  if (plan.mode === 'pfx') return `Signierung: PFX (${plan.source}), Passwort ${plan.hasPassword ? 'gesetzt' : 'fehlt'}.`;
  if (plan.mode === 'thumbprint') return `Signierung: Zertifikatsspeicher ${plan.thumbprint}.`;
  return `Signierung: Azure Trusted Signing, Konto ${plan.account || '(fehlt)'}, Profil ${plan.profile || '(fehlt)'}.`;
}

function findSigntool(env = process.env) {
  if (env.SIGNTOOL && fs.existsSync(env.SIGNTOOL)) return env.SIGNTOOL;
  const roots = [
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Windows Kits', '10', 'bin')
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root)) {
      for (const arch of ['x64', 'arm64']) {
        const candidate = path.join(root, version, arch, 'signtool.exe');
        if (fs.existsSync(candidate)) found.push(candidate);
      }
    }
  }
  found.sort();
  return found.at(-1) || '';
}

function run(tool, args, env) {
  const result = spawnSync(tool, args, { env, windowsHide: true, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(tool)} wurde mit Code ${result.status} beendet.`);
}

// Signs one file in place. Returns {signed:false} when no certificate is configured.
function signFile(file, env = process.env) {
  const plan = signingPlan(env);
  if (plan.mode === 'skip') {
    console.log(`[leise-sign] ${describePlan(plan)} (${path.basename(file)})`);
    return { signed: false, plan };
  }
  const error = planError(plan);
  if (error) throw new Error(error);
  if (process.platform !== 'win32') throw new Error('Signieren mit signtool geht nur auf Windows. Der Build-Rechner muss Windows sein.');
  const tool = findSigntool(env);
  if (!tool) throw new Error('signtool.exe nicht gefunden. Windows SDK installieren oder SIGNTOOL auf den vollen Pfad setzen.');
  const timestamp = plan.mode === 'azure' ? plan.timestamp : (env.LEISE_TIMESTAMP_URL || 'http://timestamp.digicert.com');
  const args = ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', timestamp, '/d', 'Leise DNS'];
  if (plan.mode === 'thumbprint') args.push('/sha1', plan.thumbprint);
  else if (plan.mode === 'pfx') {
    const pfx = materializePfx(plan, env);
    args.push('/f', pfx);
    const password = env.LEISE_SIGN_PASSWORD || env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD || '';
    if (password) args.push('/p', password);
  } else {
    if (!plan.dlib || !fs.existsSync(plan.dlib)) throw new Error('LEISE_AZURE_DLIB muss auf Azure.CodeSigning.Dlib.dll zeigen. Alternativ npm run dist, das die Azure-Option von electron-builder nutzt.');
    const meta = writeAzureMetadata(plan);
    args.push('/dlib', plan.dlib, '/dmdf', meta);
  }
  args.push(file);
  console.log(`[leise-sign] signtool sign /fd SHA256 ${path.basename(file)}`);
  try { run(tool, args, env); }
  finally { cleanupPfx(plan); }
  return { signed: true, plan };
}

let temporaryPfx = '';
function materializePfx(plan, env) {
  if (plan.source === 'file') return plan.file;
  if (plan.source === 'csc' && plan.file && fs.existsSync(plan.file)) return plan.file;
  const raw = plan.source === 'base64' ? env.LEISE_SIGN_PFX_BASE64 : env.WIN_CSC_LINK || env.CSC_LINK;
  temporaryPfx = path.join(require('node:os').tmpdir(), `leise-sign-${process.pid}.pfx`);
  fs.writeFileSync(temporaryPfx, Buffer.from(String(raw).trim(), 'base64'));
  return temporaryPfx;
}
function cleanupPfx() {
  if (!temporaryPfx) return;
  try { fs.rmSync(temporaryPfx, { force: true }); } catch { /* temp cert is best-effort */ }
  temporaryPfx = '';
}
function writeAzureMetadata(plan) {
  const file = path.join(require('node:os').tmpdir(), `leise-azure-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({
    Endpoint: plan.endpoint,
    CodeSigningAccountName: plan.account,
    CertificateProfileName: plan.profile
  }));
  return file;
}

// electron-builder custom hook (win.signtoolOptions.sign). Returning false means
// "not signed"; the builder only fails on that when forceCodeSigning is set,
// which the dist wrapper enables only when a certificate is actually configured.
async function hook(configuration) {
  const file = configuration && configuration.path;
  if (!file) return false;
  const result = signFile(file);
  return result.signed;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const fileFlag = process.argv.indexOf('--file');
  if (check || fileFlag === -1) {
    const plan = signingPlan();
    console.log(describePlan(plan));
    const error = planError(plan);
    if (error) { console.error(error); process.exit(1); }
    process.exit(0);
  }
  signFile(process.argv[fileFlag + 1]);
}

module.exports = hook;
module.exports.signingPlan = signingPlan;
module.exports.planError = planError;
module.exports.describePlan = describePlan;
module.exports.signFile = signFile;
module.exports.findSigntool = findSigntool;

// Windows installer build. Signing is plugged in through environment variables
// and skipped entirely when none are set. See docs/smartscreen-und-signierung.md.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signingPlan, planError, describePlan } = require('./sign-windows');

function builderArgs(env = process.env) {
  const plan = signingPlan(env);
  const error = planError(plan, env);
  const childEnv = { ...env, CSC_IDENTITY_AUTO_DISCOVERY: plan.mode === 'skip' ? 'false' : 'true' };
  const config = {};
  if (plan.mode === 'pfx') {
    if (plan.source === 'file') childEnv.WIN_CSC_LINK = plan.file;
    else if (plan.source === 'base64') childEnv.WIN_CSC_LINK = env.LEISE_SIGN_PFX_BASE64;
    else if (!childEnv.WIN_CSC_LINK && env.CSC_LINK) childEnv.WIN_CSC_LINK = env.CSC_LINK;
    childEnv.WIN_CSC_KEY_PASSWORD = env.LEISE_SIGN_PASSWORD || env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD || '';
    config.win = { signtoolOptions: { signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: env.LEISE_TIMESTAMP_URL || 'http://timestamp.digicert.com' } };
    config.forceCodeSigning = true;
  } else if (plan.mode === 'thumbprint') {
    config.win = { signtoolOptions: { signingHashAlgorithms: ['sha256'], certificateSha1: plan.thumbprint, rfc3161TimeStampServer: env.LEISE_TIMESTAMP_URL || 'http://timestamp.digicert.com' } };
    config.forceCodeSigning = true;
  } else if (plan.mode === 'azure') {
    config.win = { azureSignOptions: {
      publisherName: plan.publisher,
      endpoint: plan.endpoint,
      codeSigningAccountName: plan.account,
      certificateProfileName: plan.profile,
      fileDigest: 'SHA256',
      timestampRfc3161: plan.timestamp,
      timestampDigest: 'SHA256'
    } };
    config.forceCodeSigning = true;
  }
  const args = ['electron-builder', '--win', 'nsis'];
  return { plan, error, args, env: childEnv, config };
}

function run() {
  const built = builderArgs();
  console.log(`[leise-dist] ${describePlan(built.plan)}`);
  if (built.error) { console.error(built.error); process.exit(1); }
  let configFile = '';
  if (Object.keys(built.config).length) {
    configFile = path.join(os.tmpdir(), `leise-builder-${process.pid}.json`);
    fs.writeFileSync(configFile, JSON.stringify(built.config));
    built.args.push('--config', configFile);
  }
  const bin = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
  const command = fs.existsSync(bin) ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = fs.existsSync(bin) ? [bin, ...built.args.slice(1)] : built.args;
  const result = spawnSync(command, args, { stdio: 'inherit', env: built.env, windowsHide: true });
  if (configFile) fs.rmSync(configFile, { force: true });
  process.exit(result.status == null ? 1 : result.status);
}

if (require.main === module) run();
module.exports = { builderArgs };

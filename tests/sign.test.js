const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signingPlan, planError, describePlan } = require('../scripts/sign-windows');
const { builderArgs } = require('../scripts/dist-windows');

const empty = {
  LEISE_AZURE_SIGN: '', LEISE_SIGN_PFX: '', LEISE_SIGN_PFX_BASE64: '', LEISE_SIGN_PASSWORD: '',
  LEISE_SIGN_THUMBPRINT: '', LEISE_AZURE_ACCOUNT: '', LEISE_AZURE_PROFILE: '', LEISE_AZURE_PUBLISHER: '',
  LEISE_AZURE_ENDPOINT: '', LEISE_AZURE_DLIB: '', WIN_CSC_LINK: '', CSC_LINK: '',
  WIN_CSC_KEY_PASSWORD: '', CSC_KEY_PASSWORD: '', AZURE_TENANT_ID: '', AZURE_CLIENT_ID: '', AZURE_CLIENT_SECRET: ''
};

test('Ohne Zertifikat wird die Signierung übersprungen und der Build erzwingt sie nicht', () => {
  const plan = signingPlan(empty);
  assert.equal(plan.mode, 'skip');
  assert.equal(planError(plan), '');
  assert.match(describePlan(plan), /übersprungen/);
  const built = builderArgs(empty);
  assert.equal(built.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  assert.equal(built.config.forceCodeSigning, undefined);
  assert.deepEqual(built.args.slice(0, 3), ['electron-builder', '--win', 'nsis']);
});

test('PFX aus Umgebungsvariablen, Passwort nie im Plan', () => {
  const env = { ...empty, LEISE_SIGN_PFX: 'C:\\secrets\\leise.pfx', LEISE_SIGN_PASSWORD: 's3cret-value' };
  const plan = signingPlan(env);
  assert.equal(plan.mode, 'pfx');
  assert.equal(plan.hasPassword, true);
  assert.equal(JSON.stringify(plan).includes('s3cret-value'), false);
  const built = builderArgs(env);
  assert.equal(built.env.WIN_CSC_LINK, env.LEISE_SIGN_PFX);
  assert.equal(built.env.WIN_CSC_KEY_PASSWORD, 's3cret-value');
  assert.equal(built.config.forceCodeSigning, true);
  assert.deepEqual(built.config.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.equal(planError({ ...plan, hasPassword: false }), 'Zertifikat ist gesetzt, aber kein Passwort (LEISE_SIGN_PASSWORD oder WIN_CSC_KEY_PASSWORD).');
});

test('WIN_CSC_LINK bleibt kompatibel, Base64 landet nicht als Dateipfad im Protokoll', () => {
  const big = 'A'.repeat(400);
  const plan = signingPlan({ ...empty, CSC_LINK: big, CSC_KEY_PASSWORD: 'x' });
  assert.equal(plan.mode, 'pfx');
  assert.equal(plan.file, '');
  assert.equal(JSON.stringify(plan).includes(big), false);
});

test('Fingerabdruck und Azure werden erkannt, unvollständige Angaben scheitern vor dem Build', () => {
  const thumb = signingPlan({ ...empty, LEISE_SIGN_THUMBPRINT: 'ab cd ef 12 34 56 78 90 ab cd ef 12 34 56 78 90 ab cd ef 12' });
  assert.equal(thumb.mode, 'thumbprint');
  assert.equal(thumb.thumbprint, 'ABCDEF1234567890ABCDEF1234567890ABCDEF12');
  assert.equal(builderArgs({ ...empty, LEISE_SIGN_THUMBPRINT: thumb.thumbprint }).config.win.signtoolOptions.certificateSha1, thumb.thumbprint);
  const azureEnv = { ...empty, LEISE_AZURE_SIGN: '1', LEISE_AZURE_ACCOUNT: 'leise', LEISE_AZURE_PROFILE: 'app', LEISE_AZURE_PUBLISHER: 'Leise DNS', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 'secret-value' };
  const azure = signingPlan(azureEnv);
  assert.equal(azure.mode, 'azure');
  assert.equal(JSON.stringify(azure).includes('secret-value'), false);
  const built = builderArgs(azureEnv);
  assert.equal(built.config.win.azureSignOptions.codeSigningAccountName, 'leise');
  assert.equal(built.config.win.azureSignOptions.publisherName, 'Leise DNS');
  assert.equal(built.config.win.signtoolOptions, undefined);
  assert.match(planError(signingPlan({ ...empty, LEISE_AZURE_SIGN: '1' })), /LEISE_AZURE_ACCOUNT/);
});

test('Ein gesetztes PFX hat Vorrang vor nur teilweise gesetzten Azure-Variablen', () => {
  const plan = signingPlan({ ...empty, LEISE_SIGN_PFX: 'a.pfx', LEISE_SIGN_PASSWORD: 'p', LEISE_AZURE_ACCOUNT: 'leise', LEISE_AZURE_PROFILE: 'app' });
  assert.equal(plan.mode, 'pfx');
});

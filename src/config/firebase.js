
const path = require('path');
const fs = require('fs');

const {
  initializeApp,
  cert,
  getApps,
} = require('firebase-admin/app');

const {
  getMessaging,
} = require('firebase-admin/messaging');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT_JSON === 'string'
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  } catch (err) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON environment variable: ' + err.message);
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decoded);
  } catch (err) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable: ' + err.message);
  }
} else {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : path.join(__dirname, 'firebase-service-account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      'Firebase service account credentials not found. Provide FIREBASE_SERVICE_ACCOUNT_BASE64 / FIREBASE_SERVICE_ACCOUNT_JSON or place file at: ' + serviceAccountPath
    );
  }

  serviceAccount = require(serviceAccountPath);
}

const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

const messaging = getMessaging(app);

console.log(
  'Firebase Admin initialized:',
  serviceAccount.project_id
);

module.exports = { app, messaging };

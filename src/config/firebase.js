
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

const serviceAccountPath = path.join(
  __dirname,
  'firebase-service-account.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(
    'Firebase service account file not found: ' + serviceAccountPath
  );
}

const serviceAccount = require(serviceAccountPath);

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

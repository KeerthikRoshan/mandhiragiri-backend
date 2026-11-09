
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(
  __dirname,
  'firebase-service-account.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(
    'Firebase service account file not found: ' +
    serviceAccountPath
  );
}

const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

console.log(
  'Firebase Admin initialized:',
  serviceAccount.project_id
);

module.exports = admin;

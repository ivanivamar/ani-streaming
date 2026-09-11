import { createApp } from './app.js';
import { config } from './config.js';
import { initFirebaseAdmin } from './firebase-admin.js';

initFirebaseAdmin();

const app = createApp();
app.listen(config.port, () => {
  console.log(`ani-stream server listening on :${config.port}`);
  console.log(`API docs at http://localhost:${config.port}/api-docs`);
  if (!config.ownerUid) {
    console.warn('OWNER_UID is not set — every request will be rejected. See .env.example.');
  }
});

// Local run: node local.js  (SECRET and BOOT must be in the environment)
import { createAppServer } from './lib/server.js';

const port = Number(process.env.PORT || 8787);
createAppServer().listen(port, () => console.log(`tgproxy-vercel listening on :${port}`));

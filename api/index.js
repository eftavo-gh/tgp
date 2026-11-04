// Vercel Function entry: export the http.Server (Fluid compute runs it and
// pipes WebSocket upgrades to it, per Vercel's WebSocket support).
// All paths are rewritten to this function by vercel.json.
import { createAppServer } from '../lib/server.js';

export default createAppServer();

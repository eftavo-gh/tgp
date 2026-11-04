// One http.Server that serves every route of the proxy:
//   GET  /                  bridge page (or fallback page without ?bridge=)
//   GET  /health
//   POST /api/v1/session    bootstrap -> session token
//   DEL  /api/v1/session
//   GET  /api/v1/ws         WebSocket lane upgrade
// The same server object is exported as the Vercel Function (api/index.js)
// and listened on directly for local runs (local.js).
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { routeHttp, attachLane } from './core.js';
import { ShimWS, dialWS } from './shim.js';

globalThis.__TG_DIAL_WS = dialWS;

const env = () => ({ SECRET: process.env.SECRET, BOOT: process.env.BOOT });

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
}

export function createAppServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const host = req.headers.host || 'localhost';
            const url = `https://${host}${req.url}`;
            const needsBody = req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT';
            const bodyBuf = needsBody ? await readBody(req) : undefined;
            const request = new Request(url, {
                method: req.method,
                headers: req.headers,
                body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
            });
            const response = await routeHttp(request, env());
            const buf = Buffer.from(await response.arrayBuffer());
            const headers = {};
            response.headers.forEach((v, k) => { headers[k] = v; });
            res.writeHead(response.status, headers);
            res.end(req.method === 'HEAD' ? undefined : buf);
        } catch (e) {
            try { res.writeHead(500); res.end('internal error'); } catch {}
        }
    });

    const wss = new WebSocketServer({
        noServer: true,
        handleProtocols: (protocols) => { const arr = [...(protocols || [])]; return arr.length ? arr[0] : false; },
    });

    server.on('upgrade', (req, socket, head) => {
        (async () => {
            const host = req.headers.host || 'localhost';
            const url = new URL(req.url, `https://${host}`);
            if (url.pathname !== '/api/v1/ws') { socket.destroy(); return; }
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
            wss.handleUpgrade(req, socket, head, async (raw) => {
                const ok = await attachLane(headers, `https://${host}`, env(), new ShimWS(raw));
                if (process.env.TG_DEBUG) console.log(`[tg] lane attach ${url.pathname} ok=${ok}`);
                if (!ok) { try { raw.close(1008); } catch {} }
            });
        })().catch(() => { try { socket.destroy(); } catch {} });
    });

    return server;
}

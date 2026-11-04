// Browser-like WebSocket shim on top of the `ws` package.
// The upstream core (lib/core.js) was written against the Workers/DOM API:
//   ws.binaryType = 'arraybuffer'
//   ws.addEventListener('open'|'message'|'error'|'close', handler)
//   message events carry { data: ArrayBuffer }, close events carry { code }
//   ws.send(Uint8Array), ws.close(code, reason), ws.protocol, ws.accept()
// ShimWS provides exactly that surface for both lane (server-side) sockets
// and the outbound KWS client socket.
import { WebSocket as WSClient } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';

export class ShimWS {
    constructor(raw) {
        this.raw = raw;
        this._binaryType = 'arraybuffer';
        this._listeners = new Map();
        raw.on('message', (data) => {
            let d = data;
            if (Buffer.isBuffer(data)) d = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            this._emit('message', { data: d });
        });
        raw.on('open', () => this._emit('open', {}));
        raw.on('error', (err) => this._emit('error', { error: err }));
        raw.on('close', (code, reason) => this._emit('close', { code, reason: reason ? reason.toString() : '' }));
    }
    get protocol() { return this.raw.protocol || ''; }
    set binaryType(v) { this._binaryType = v; try { this.raw.binaryType = 'arraybuffer'; } catch {} }
    get binaryType() { return this._binaryType; }
    accept() {} // Workers-only; a Node `ws` socket is already accepted
    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
        const a = this._listeners.get(type);
        if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    }
    _emit(type, ev) {
        for (const fn of [...(this._listeners.get(type) || [])]) { try { fn(ev); } catch {} }
    }
    send(data) {
        try {
            const b = data instanceof Uint8Array ? data : new Uint8Array(data);
            this.raw.send(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
        } catch {}
    }
    close(code = 1000, reason = '') { try { this.raw.close(code, reason); } catch {} }
}

// Outbound dial to Telegram KWS. On Vercel this is a direct connection.
// When an HTTPS_PROXY-style env is present (e.g. a local sandbox whose only
// egress is a proxy), route through it; the value is read from the
// environment at runtime and never stored.
export function dialWS(url) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
    const opts = {};
    if (proxy) { try { opts.agent = new HttpsProxyAgent(proxy); } catch {} }
    const shim = new ShimWS(new WSClient(url, 'binary', opts));
    if (process.env.TG_DEBUG) {
        const t0 = Date.now();
        shim.addEventListener('open', () => console.log(`[tg] dial ${url} open in ${Date.now() - t0}ms protocol=${shim.protocol}`));
        shim.addEventListener('error', (e) => console.log(`[tg] dial ${url} error at ${Date.now() - t0}ms: ${e.error?.message || e.error || ''}`));
        shim.addEventListener('close', (e) => console.log(`[tg] dial ${url} close at ${Date.now() - t0}ms code=${e.code}`));
    }
    return shim;
}

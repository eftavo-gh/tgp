# TGProxy on Vercel（移植版）

把 [CF-Workers-TGProxy](https://github.com/ToiCF/CF-Workers-TGProxy) 从 Cloudflare Workers
移植到 Vercel Functions 的版本。协议核心（obfuscation 解/重封、HMAC token、lane 协议、
流控与小包汇聚）是原仓库 `telegram_webproxy.js` 原样保留，只换了 Workers 专属的
传输层：

- `WebSocketPair` + 101 Response → Node `http.Server` + `ws` 完成 Upgrade（`lib/server.js`）
- 出站 `new WebSocket()` → `ws` 客户端（`lib/shim.js`，浏览器风格接口的垫片）
- 出站拨号超时 7.5s → 20s（冷启动/慢线路下 7.5s 太紧；这是与上游唯一的行为改动）
- 环境里有 `HTTPS_PROXY` 时出站自动走代理（本地沙箱用；Vercel 上无此变量，直连）

本地已实测全链路通过：bridge 页鉴权 → session 签发 → WS lane → 真实 MTProto
`req_pq_multi` 经 lane 到 Telegram KWS → `resPQ` 原路返回（`test/local-test.mjs`，8/8）。

## 部署到 Vercel

1. 把 `app/` 这个目录推到一个 GitHub 仓库（或者本机装 Vercel CLI 后在该目录里跑
   `npx vercel`），在 Vercel 里导入、部署。`vercel.json` 已配好：
   全部路径 rewrite 到 `api/index.js` 这个函数，`maxDuration` 300 秒。
   新项目默认开 Fluid compute，WebSocket 需要它，别关。
2. 在 Vercel 项目 Settings → Environment Variables 里加两个变量（Production）：
   - `SECRET`：32 位 hex，或 `dd`/`ee`/`ef` 前缀 + 32 位 hex（共 34 位）
   - `BOOT`：任意非空随机串，建议 48 位 hex
   生成（PowerShell）：
   ```powershell
   $b = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Fill($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Fill($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   ```
3. 部署完成后先打开 `https://<你的域名>/health`，返回 `{"ok":true}` 说明函数活着。
4. Telegram 里添加 MTProxy：服务器 = 你的域名，端口 = 443，密钥 = `SECRET` 的值。

可选：环境变量 `TG_DEBUG=1` 会把每条 lane 的 attach 结果和出站拨号耗时打到函数日志里，
排障时开，平时关。

## 已知上限（部署前就说清）

- **lane 最长 300 秒**：Hobby 计划函数时长上限就是 300s，`vercel.json` 已顶格。
  Pro 可以把 `maxDuration` 改到 800。lane 断了客户端会自己重开，表现为偶尔重连。
- **session 状态在单个函数实例的内存里**：同一 session 的 lane 若被 Vercel 分到
  不同实例，会找不到租约而失败。Fluid 冷启动少时不明显，高并发/多实例时会暴露。
  这是 Vercel 的结构决定的，本移植没有绕它（绕法是改无状态验签或外挂 Redis，
  那是另一版了）。
- 每次部署/实例回收后，所有 lane 都会断一次，客户端重连即可。

## 本地运行 / 测试

```powershell
$env:SECRET = '<32位hex>'; $env:BOOT = '<随机串>'
npm install
npm start          # 监听 :8787（PORT 可改）
node ../test/local-test.mjs   # 全链路自测，需要能出站到 kws*.web.telegram.org
```

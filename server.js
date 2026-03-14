/**
 * Vakra Reader HTTP API Server
 *
 * 为 Python 后端提供 HTTP 接口，将网页 URL 转换为干净的 Markdown。
 *
 * POST /scrape
 *   Body: { "urls": ["https://..."], "formats": ["markdown"], "concurrency": 5, "timeout": 30000 }
 *   Response: { "success": true, "data": [{ "url": "...", "markdown": "...", "title": "..." }] }
 *
 * GET /health
 *   Response: { "status": "ok" }
 */

import http from "node:http";

const PORT = parseInt(process.env.PORT || "3100", 10);
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// 单例 ReaderClient，跨请求复用（避免重复初始化 HeroCore / 浏览器池）
let readerInstance = null;
let readerInitializing = false;

async function getReader() {
  if (readerInstance) return readerInstance;

  // 防止并发初始化
  if (readerInitializing) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return getReader();
  }

  readerInitializing = true;
  try {
    const { ReaderClient } = await import("@vakra-dev/reader");
    readerInstance = new ReaderClient({
      verbose: process.env.VERBOSE === "true",
      browserPool: {
        size: parseInt(process.env.POOL_SIZE || "3", 10),
        retireAfterPages: 100,
        retireAfterMinutes: 30,
      },
    });
    console.log("[vakra-reader] Reader client initialized");
    return readerInstance;
  } finally {
    readerInitializing = false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── 测试 UI 页面 ──────────────────────────────────────────────────────
  if (url.pathname === "/" && req.method === "GET") {
    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vakra Reader - 测试工具</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 600; color: #58a6ff; }
  header span { font-size: 12px; color: #8b949e; background: #21262d; border: 1px solid #30363d; border-radius: 12px; padding: 2px 8px; }
  .container { display: grid; grid-template-columns: 1fr 1fr; gap: 0; height: calc(100vh - 57px); }
  .panel { display: flex; flex-direction: column; border-right: 1px solid #30363d; }
  .panel-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 16px; font-size: 13px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; }
  .panel-body { flex: 1; overflow: auto; padding: 16px; }
  .input-row { display: flex; gap: 8px; margin-bottom: 12px; }
  textarea#url-input { flex: 1; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; padding: 10px 12px; font-size: 13px; resize: vertical; min-height: 80px; font-family: monospace; line-height: 1.5; }
  textarea#url-input:focus { outline: none; border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88,166,255,.15); }
  .controls { display: flex; gap: 8px; align-items: flex-start; flex-direction: column; }
  .row { display: flex; gap: 8px; align-items: center; width: 100%; }
  label { font-size: 12px; color: #8b949e; white-space: nowrap; }
  select, input[type=number] { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; padding: 6px 8px; font-size: 13px; }
  button#scrape-btn { background: #238636; border: 1px solid #2ea043; border-radius: 6px; color: #fff; cursor: pointer; font-size: 14px; font-weight: 600; padding: 10px 20px; width: 100%; transition: background .15s; }
  button#scrape-btn:hover { background: #2ea043; }
  button#scrape-btn:disabled { background: #21262d; border-color: #30363d; color: #484f58; cursor: not-allowed; }
  .tabs { display: flex; border-bottom: 1px solid #30363d; }
  .tab { padding: 8px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; transition: color .15s; }
  .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  .tab-content { display: none; padding: 16px; height: calc(100% - 41px); overflow: auto; }
  .tab-content.active { display: block; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.6; }
  .markdown-view { font-size: 14px; line-height: 1.75; }
  .markdown-view h1, .markdown-view h2, .markdown-view h3 { color: #58a6ff; margin: 16px 0 8px; }
  .markdown-view h1 { font-size: 20px; } .markdown-view h2 { font-size: 17px; } .markdown-view h3 { font-size: 15px; }
  .markdown-view p { margin-bottom: 10px; }
  .markdown-view code { background: #21262d; border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 12px; }
  .markdown-view pre { background: #21262d; border-radius: 6px; padding: 12px; margin-bottom: 12px; overflow-x: auto; }
  .markdown-view ul, .markdown-view ol { padding-left: 20px; margin-bottom: 10px; }
  .markdown-view table { border-collapse: collapse; width: 100%; margin-bottom: 12px; font-size: 13px; }
  .markdown-view th, .markdown-view td { border: 1px solid #30363d; padding: 6px 10px; }
  .markdown-view th { background: #21262d; }
  .status { font-size: 12px; color: #8b949e; }
  .status.ok { color: #3fb950; }
  .status.err { color: #f85149; }
  .meta-bar { background: #161b22; border-bottom: 1px solid #30363d; padding: 8px 16px; font-size: 12px; color: #8b949e; display: flex; gap: 16px; min-height: 36px; align-items: center; font-family: monospace; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header>
  <h1>Vakra Reader</h1>
  <span>Web Content Extraction API</span>
  <span id="health-badge" style="margin-left:auto;">checking...</span>
</header>
<div class="container">
  <!-- 左侧：输入控制 -->
  <div class="panel">
    <div class="panel-header">输入 URLs</div>
    <div class="panel-body">
      <textarea id="url-input" placeholder="每行输入一个 URL，支持批量&#10;https://example.com&#10;https://another.com"></textarea>
      <div class="controls">
        <div class="row">
          <label>格式</label>
          <select id="format-sel"><option value="markdown">Markdown</option><option value="html">HTML</option></select>
          <label>并发</label>
          <input type="number" id="concurrency" value="3" min="1" max="10" style="width:60px">
          <label>超时(s)</label>
          <input type="number" id="timeout" value="30" min="5" max="120" style="width:70px">
        </div>
        <button id="scrape-btn" onclick="doScrape()">抓取内容</button>
      </div>
    </div>
  </div>

  <!-- 右侧：结果展示 -->
  <div class="panel" style="border-right:none;">
    <div class="panel-header">
      抓取结果
      <span class="status" id="status-text"></span>
    </div>
    <div class="meta-bar" id="meta-bar">等待抓取...</div>
    <div class="tabs" id="tabs-container"></div>
    <div id="tab-contents" style="flex:1;overflow:auto;"></div>
  </div>
</div>

<script>
// Health check
fetch('/health').then(r=>r.json()).then(d=>{
  const b = document.getElementById('health-badge');
  b.textContent = d.status === 'ok' ? 'Service OK' : 'Unhealthy';
  b.style.color = d.status === 'ok' ? '#3fb950' : '#f85149';
}).catch(()=>{
  document.getElementById('health-badge').textContent = 'Unreachable';
});

async function doScrape() {
  const rawUrls = document.getElementById('url-input').value.trim();
  if (!rawUrls) { alert('请输入至少一个 URL'); return; }

  const urls = rawUrls.split('\\n').map(u => u.trim()).filter(u => u.startsWith('http'));
  if (!urls.length) { alert('未检测到有效 URL（需以 http:// 或 https:// 开头）'); return; }

  const format = document.getElementById('format-sel').value;
  const concurrency = parseInt(document.getElementById('concurrency').value);
  const timeoutSec = parseInt(document.getElementById('timeout').value);

  const btn = document.getElementById('scrape-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>抓取中...';
  document.getElementById('status-text').textContent = '';
  document.getElementById('meta-bar').innerHTML = '<span class="spinner"></span>正在抓取 ' + urls.length + ' 个页面...';
  document.getElementById('tabs-container').innerHTML = '';
  document.getElementById('tab-contents').innerHTML = '';

  const t0 = Date.now();
  try {
    const res = await fetch('/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, formats: [format], concurrency, timeout: timeoutSec * 1000 }),
    });
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!data.success) throw new Error(data.error || 'Unknown error');

    const meta = data.metadata || {};
    document.getElementById('meta-bar').innerHTML =
      '成功 <b style="color:#3fb950">' + meta.successful + '</b> / ' + meta.total +
      ' 　失败 <b style="color:#f85149">' + meta.failed + '</b>' +
      ' 　耗时 <b>' + elapsed + 's</b>' +
      ' 　服务端 <b>' + (meta.duration || 0) + 'ms</b>';

    const statusEl = document.getElementById('status-text');
    statusEl.textContent = meta.failed > 0 ? meta.failed + ' 个失败' : '全部成功';
    statusEl.className = 'status ' + (meta.failed > 0 ? 'err' : 'ok');

    // 构建 Tab
    const tabsEl = document.getElementById('tabs-container');
    const contentsEl = document.getElementById('tab-contents');
    tabsEl.innerHTML = '';
    contentsEl.innerHTML = '';

    const items = data.data || [];
    if (!items.length) {
      contentsEl.innerHTML = '<div style="padding:24px;color:#8b949e;text-align:center">未获取到任何内容</div>';
    }

    items.forEach((item, i) => {
      const label = (item.title || item.url || 'Page ' + (i+1)).slice(0, 30);
      const tab = document.createElement('div');
      tab.className = 'tab' + (i === 0 ? ' active' : '');
      tab.textContent = label;
      tab.title = item.url;
      tab.onclick = () => selectTab(i);
      tabsEl.appendChild(tab);

      const content = document.createElement('div');
      content.className = 'tab-content' + (i === 0 ? ' active' : '');
      content.id = 'tab-' + i;
      content.setAttribute('data-raw', item[format] || '');
      content.setAttribute('data-url', item.url);
      content.setAttribute('data-title', item.title || '');

      if (format === 'markdown') {
        content.innerHTML = '<div style="margin-bottom:12px;padding:8px 12px;background:#21262d;border-radius:6px;font-size:12px;font-family:monospace;color:#8b949e">'
          + '<b style="color:#58a6ff">URL:</b> ' + escHtml(item.url) + '<br>'
          + '<b style="color:#58a6ff">Title:</b> ' + escHtml(item.title || '—') + '<br>'
          + '<b style="color:#58a6ff">Length:</b> ' + (item[format] || '').length + ' chars</div>'
          + '<div style="display:flex;gap:8px;margin-bottom:12px">'
          + '<button onclick="toggleView(' + i + ',\\'md\\')" id="btn-md-' + i + '" style="background:#238636;border:1px solid #2ea043;color:#fff;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:12px">渲染预览</button>'
          + '<button onclick="toggleView(' + i + ',\\'raw\\')" id="btn-raw-' + i + '" style="background:#21262d;border:1px solid #30363d;color:#e1e4e8;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:12px">原始 Markdown</button>'
          + '</div>'
          + '<div id="view-md-' + i + '" class="markdown-view">' + simpleMarkdown(item[format] || '') + '</div>'
          + '<pre id="view-raw-' + i + '" style="display:none">' + escHtml(item[format] || '') + '</pre>';
      } else {
        content.innerHTML = '<pre>' + escHtml(item[format] || '') + '</pre>';
      }
      contentsEl.appendChild(content);
    });

    // 错误信息
    if (meta.errors && meta.errors.length) {
      const errTab = document.createElement('div');
      errTab.className = 'tab';
      errTab.textContent = '失败 (' + meta.errors.length + ')';
      errTab.style.color = '#f85149';
      errTab.onclick = () => selectTab(items.length);
      tabsEl.appendChild(errTab);
      const errContent = document.createElement('div');
      errContent.className = 'tab-content';
      errContent.id = 'tab-' + items.length;
      errContent.innerHTML = '<pre style="color:#f85149">' + escHtml(JSON.stringify(meta.errors, null, 2)) + '</pre>';
      contentsEl.appendChild(errContent);
    }

  } catch (err) {
    document.getElementById('meta-bar').textContent = '错误：' + err.message;
    document.getElementById('meta-bar').style.color = '#f85149';
    document.getElementById('status-text').textContent = '失败';
    document.getElementById('status-text').className = 'status err';
  }

  btn.disabled = false;
  btn.textContent = '抓取内容';
}

function selectTab(i) {
  document.querySelectorAll('.tab').forEach((t, j) => t.className = 'tab' + (j === i ? ' active' : ''));
  document.querySelectorAll('.tab-content').forEach((c, j) => c.className = 'tab-content' + (j === i ? ' active' : ''));
}

function toggleView(i, mode) {
  const mdEl = document.getElementById('view-md-' + i);
  const rawEl = document.getElementById('view-raw-' + i);
  const btnMd = document.getElementById('btn-md-' + i);
  const btnRaw = document.getElementById('btn-raw-' + i);
  if (mode === 'md') {
    mdEl.style.display = ''; rawEl.style.display = 'none';
    btnMd.style.background = '#238636'; btnRaw.style.background = '#21262d';
  } else {
    mdEl.style.display = 'none'; rawEl.style.display = '';
    btnMd.style.background = '#21262d'; btnRaw.style.background = '#238636';
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 极简 Markdown 渲染（标题/加粗/斜体/行内代码/代码块/列表/表格）
function simpleMarkdown(md) {
  if (!md) return '';
  let html = escHtml(md);
  // 代码块
  html = html.replace(/\`\`\`[^\\n]*\\n([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
  // 标题
  html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');
  // 加粗 / 斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 行内代码
  html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#58a6ff">$1</a>');
  // 表格（简单处理）
  html = html.replace(/((?:^\\|.+\\|\\n?)+)/gm, (t) => {
    const rows = t.trim().split('\\n').filter(r => !/^\|[-| :]+\|$/.test(r.trim()));
    if (rows.length < 1) return t;
    const cells = rows.map(r => r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));
    let out = '<table><thead><tr>' + cells[0].map(c=>'<th>'+c+'</th>').join('') + '</tr></thead><tbody>';
    cells.slice(1).forEach(r => { out += '<tr>' + r.map(c=>'<td>'+c+'</td>').join('') + '</tr>'; });
    return out + '</tbody></table>';
  });
  // 列表
  html = html.replace(/^[-*]\\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\\n?)+/g, '<ul>$&</ul>');
  // 换行
  html = html.replace(/\\n\\n/g, '</p><p>').replace(/\\n/g, '<br>');
  return '<p>' + html + '</p>';
}

// 回车触发抓取
document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') doScrape();
});
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Health check
  if (url.pathname === "/health" && req.method === "GET") {
    return sendJson(res, 200, { status: "ok" });
  }

  // Scrape endpoint
  if (url.pathname === "/scrape" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const urls = body.urls || [];
      const formats = body.formats || ["markdown"];
      const concurrency = body.concurrency || 5;
      // timeoutMs: 单个 URL 的超时（毫秒）
      const timeoutMs = body.timeout || 30000;
      // batchTimeoutMs: 整批 URL 的总超时，默认是每个 URL 超时的 N 倍
      const batchTimeoutMs = body.batch_timeout || timeoutMs * urls.length + 10000;
      const skipEngines = body.skip_engines || [];

      if (!urls.length) {
        return sendJson(res, 400, { success: false, error: "No URLs provided" });
      }

      console.log(`[vakra-reader] Scraping ${urls.length} URLs (concurrency=${concurrency}, timeout=${timeoutMs}ms)...`);
      const reader = await getReader();

      const result = await reader.scrape({
        urls,
        formats,
        batchConcurrency: concurrency,
        timeoutMs,                  // Bug fix: 单个 URL 超时
        batchTimeoutMs,             // Bug fix: 批量总超时
        maxRetries: 1,
        skipEngines,
      });

      // Bug fix: metadata.website.title 可能是 null，需要安全访问
      const data = result.data.map((item) => ({
        url: item.metadata?.baseUrl || "",
        title: item.metadata?.website?.title || item.metadata?.website?.openGraph?.title || "",
        markdown: item.markdown || "",
        html: item.html || "",
        duration: item.metadata?.duration || 0,
      }));

      console.log(
        `[vakra-reader] Done: ${result.batchMetadata.successfulUrls}/${result.batchMetadata.totalUrls} succeeded in ${result.batchMetadata.totalDuration}ms`
      );

      return sendJson(res, 200, {
        success: true,
        data,
        metadata: {
          total: result.batchMetadata.totalUrls,
          successful: result.batchMetadata.successfulUrls,
          failed: result.batchMetadata.failedUrls,
          duration: result.batchMetadata.totalDuration,
          errors: result.batchMetadata.errors || [],
        },
      });
    } catch (err) {
      console.error("[vakra-reader] Scrape error:", err.message);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // Not found
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[vakra-reader] HTTP server listening on port ${PORT}`);
});

// Graceful shutdown
// Bug fix: ReaderClient 在构造时已注册了 SIGTERM via process.once()，
// 因此这里只需关闭 HTTP server，不重复调用 reader.close()
process.on("SIGTERM", () => {
  console.log("[vakra-reader] SIGTERM received, shutting down HTTP server...");
  server.close(() => {
    console.log("[vakra-reader] HTTP server closed");
    // ReaderClient 会通过自己的 SIGTERM handler 自行关闭（process.once 注册）
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  process.emit("SIGTERM");
});

// 建置腳本：src/ → dist/
//   npm run build   產生 dist/（部署用）
//   npm run dev     建置 + 監看 src/ 自動重建 + 本機伺服器 http://localhost:8080
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const pug = require('pug');
const less = require('less');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;

// 底線開頭的檔案（_layout.pug、_base.less）是共用片段，不單獨輸出
const isPage = (f, ext) => f.endsWith(ext) && !f.startsWith('_');

async function build() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'css'), { recursive: true });

  for (const f of fs.readdirSync(path.join(SRC, 'pug')).filter(f => isPage(f, '.pug'))) {
    const html = pug.renderFile(path.join(SRC, 'pug', f), { pretty: true });
    fs.writeFileSync(path.join(OUT, f.replace(/\.pug$/, '.html')), html);
  }

  for (const f of fs.readdirSync(path.join(SRC, 'less')).filter(f => isPage(f, '.less'))) {
    const file = path.join(SRC, 'less', f);
    const { css } = await less.render(fs.readFileSync(file, 'utf8'), { filename: file });
    fs.writeFileSync(path.join(OUT, 'css', f.replace(/\.less$/, '.css')), css);
  }

  fs.cpSync(path.join(SRC, 'js'), path.join(OUT, 'js'), { recursive: true });
  fs.cpSync(path.join(SRC, 'lib'), path.join(OUT, 'lib'), { recursive: true });

  // 版本號：在 HTML 裡的 css/js 網址後面加上 ?v=內容雜湊。
  // GitHub Pages 會讓瀏覽器快取 10 分鐘；檔案內容一改，網址就跟著變，瀏覽器才會抓新版，
  // 避免「新 HTML 配舊 JS」讓頁面壞掉。
  for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.html'))) {
    const file = path.join(OUT, f);
    const html = fs.readFileSync(file, 'utf8').replace(/(href|src)="((?:css|js|lib)\/[^"?]+)"/g, (m, attr, url) => {
      const asset = path.join(OUT, url);
      if (!fs.existsSync(asset)) return m;
      const v = crypto.createHash('sha1').update(fs.readFileSync(asset)).digest('hex').slice(0, 8);
      return `${attr}="${url}?v=${v}"`;
    });
    fs.writeFileSync(file, html);
  }

  console.log(`[build] 完成 (${Date.now() - t0} ms)`);
}

function serve() {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(OUT, path.normalize(p));
    if (!file.startsWith(OUT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, () => console.log(`[dev] http://localhost:${PORT}/`));
}

function watch() {
  let timer = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch(e => console.error('[build] 失敗：', e.message)), 150);
  });
  console.log('[dev] 監看 src/ 中，存檔會自動重建');
}

(async () => {
  try {
    await build();
  } catch (e) {
    console.error('[build] 失敗：', e.message);
    if (!process.argv.includes('--watch')) process.exit(1);
  }
  if (process.argv.includes('--watch')) { watch(); serve(); }
})();

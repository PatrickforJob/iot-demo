// 老師端監控台：接收手機資料、畫波形、跌倒判斷、送警示
(function () {
  var C = window.IOT_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var WINDOW_MS = 10000, OFFLINE_MS = 5000, FALL_SHOW_MS = 6000, COOLDOWN_MS = 3000, FF_TO_IMPACT_MS = 1000;
  var MAX_DEVICES = 60;                 // 裝置數量上限，避免有人灌入大量假裝置拖垮畫面
  var ID_RE = /^[^\/#+\s]{1,12}$/;      // 與手機端 cleanId() 相同的代號規則
  // 用沒有原型的物件存裝置：代號叫 "__proto__"、"constructor" 也不會汙染內建物件
  var devices = Object.create(null), deviceCount = 0, selected = null, client = null;
  var css = getComputedStyle(document.documentElement);
  function col(n) { return css.getPropertyValue(n).trim(); }

  // ---------- 門檻滑桿 ----------
  function thr() { return { ff: +$('ff').value, im: +$('im').value }; }
  function showThr() { $('ffVal').textContent = thr().ff.toFixed(2) + ' g'; $('imVal').textContent = thr().im.toFixed(1) + ' g'; }
  $('ff').oninput = showThr; $('im').oninput = showThr; showThr();

  // ---------- QR code ----------
  // 手機網址帶上相同的 broker 與頻道設定
  var phoneUrl = new URL('phone.html', location.href);
  phoneUrl.search = '';
  if (C.brokerKey === '2') phoneUrl.searchParams.set('b', '2');
  if (C.room) phoneUrl.searchParams.set('room', C.room);
  (function () {
    var qr = qrcode(0, 'M'); qr.addData(phoneUrl.href); qr.make();
    $('qrImg').src = qr.createDataURL(10, 2);
    $('qrUrl').textContent = phoneUrl.href;
  })();
  $('qrBtn').onclick = function () { $('qrOverlay').classList.add('show'); };
  $('qrOverlay').onclick = function () { $('qrOverlay').classList.remove('show'); };

  // ---------- 裝置與跌倒偵測 ----------
  function getDev(id, simulated) {
    if (devices[id]) return devices[id];
    if (deviceCount >= MAX_DEVICES) return null;
    deviceCount++;
    var el = document.createElement('div');
    el.className = 'dev';
    el.innerHTML = '<div class="top"><span class="name"></span><span class="st"></span></div><canvas></canvas><div class="meta"><span class="mag"></span><span class="falls"></span></div>';
    el.querySelector('.name').textContent = id + (simulated ? ' 🤖' : '');
    el.onclick = function () { selected = id; $('detailTitle').textContent = '裝置「' + id + '」即時波形（最近 10 秒）'; refreshSel(); };
    var empty = $('grid').querySelector('.empty'); if (empty) empty.remove();
    $('grid').appendChild(el);
    devices[id] = { id: id, el: el, samples: [], lastRx: 0, lastFF: -1e15, lastFall: -1e15, fallShownAt: -1e15, falls: 0, simulated: !!simulated };
    if (!selected) { selected = id; $('detailTitle').textContent = '裝置「' + id + '」即時波形（最近 10 秒）'; refreshSel(); }
    return devices[id];
  }
  function refreshSel() { for (var k in devices) devices[k].el.classList.toggle('sel', k === selected); }

  function ingest(id, samples, simulated) {
    var d = getDev(id, simulated);
    if (!d) return;
    var now = Date.now(), t = thr();
    d.lastRx = now;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var m = Math.sqrt(s[1] * s[1] + s[2] * s[2] + s[3] * s[3]);
      d.samples.push({ t: s[0], x: s[1], y: s[2], z: s[3], m: m });
      // AI 規則：失重 → 1 秒內撞擊 = 跌倒
      if (m < t.ff) d.lastFF = s[0];
      if (m > t.im && s[0] - d.lastFF < FF_TO_IMPACT_MS && s[0] - d.lastFall > COOLDOWN_MS) {
        d.lastFall = s[0];
        onFall(d, m);
      }
    }
    var latest = d.samples.length ? d.samples[d.samples.length - 1].t : 0;
    while (d.samples.length && d.samples[0].t < latest - WINDOW_MS) d.samples.shift();
  }

  function onFall(d, peak) {
    d.falls++;
    d.fallShownAt = Date.now();
    d.el.classList.remove('fall'); void d.el.offsetWidth; d.el.classList.add('fall');
    var log = $('log');
    var placeholder = log.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    var li = document.createElement('li');
    var tm = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    li.innerHTML = '<span>⚠️ <b></b> 跌倒（峰值 ' + peak.toFixed(1) + ' g）</span><span class="t">' + tm + '</span>';
    li.querySelector('b').textContent = d.id;
    log.insertBefore(li, log.firstChild);
    if (!d.simulated && client && client.connected) {
      client.publish(C.topicBase + '/' + d.id + '/alert', JSON.stringify({ t: Date.now(), peak: peak }));
    }
  }

  // ---------- MQTT ----------
  function setNet(s, txt) { $('netDot').className = 'dot ' + s; $('netText').textContent = txt; }
  client = mqtt.connect(C.brokerUrl, { clientId: 'dash-' + Math.random().toString(16).slice(2, 10), clean: true, reconnectPeriod: 3000, connectTimeout: 8000 });
  client.on('connect', function () {
    setNet('ok', '已連線 ' + C.brokerUrl.split('/')[2].split(':')[0] + (C.room ? '・頻道 ' + C.room : ''));
    client.subscribe(C.topicBase + '/+/acc');
  });
  client.on('reconnect', function () { setNet('warn', '重新連線中…'); });
  client.on('offline', function () { setNet('err', '離線（可按「加入模擬裝置」示範）'); });
  client.on('error', function () { setNet('err', '連線失敗'); });
  client.on('message', function (topic, msg) {
    // 公開 broker 上任何人都能送訊息，所以收到的資料一律先檢查格式
    try {
      var id = topic.split('/').slice(-2, -1)[0];
      if (!ID_RE.test(id)) return;
      var p = JSON.parse(msg.toString());
      if (!p || !Array.isArray(p.s)) return;
      var samples = p.s.slice(0, 500).filter(function (s) {
        return Array.isArray(s) && s.length >= 4 &&
          isFinite(s[0]) && isFinite(s[1]) && isFinite(s[2]) && isFinite(s[3]) &&
          typeof s[0] === 'number' && typeof s[1] === 'number' && typeof s[2] === 'number' && typeof s[3] === 'number';
      });
      if (samples.length) ingest(id, samples, false);
    } catch (e) {}
  });

  // ---------- 模擬裝置（網路不通時的備案）----------
  var simN = 0;
  $('simBtn').onclick = function () {
    simN++;
    var id = '模擬' + simN, mode = ['走路', '靜止', '走路後跌倒'][(simN - 1) % 3], t0 = Date.now(), lastT = t0;
    setInterval(function () {
      var now = Date.now(), out = [];
      for (var t = lastT + 16; t <= now; t += 16) {
        var sec = (t - t0) / 1000, x = 0, y = 0, z = 1, n = function (a) { return (Math.random() - 0.5) * a; };
        if (mode === '靜止') { x = n(0.02); y = n(0.02); z = 1 + n(0.02); }
        else {
          x = 0.15 * Math.sin(sec * 6) + n(0.05); y = 0.2 * Math.sin(sec * 12) + n(0.05); z = 1 + 0.35 * Math.sin(sec * 12) + n(0.08);
          if (mode === '走路後跌倒') {
            var c = sec % 12;
            if (c > 8 && c < 8.35) { x = n(0.1); y = n(0.1); z = 0.15 + n(0.1); }          // 下墜失重
            else if (c >= 8.35 && c < 8.45) { x = 1.2 + n(0.5); y = n(0.8); z = 2.6 + n(0.6); } // 撞擊
            else if (c >= 8.45 && c < 11) { x = 1 + n(0.03); y = n(0.03); z = n(0.03); }       // 躺在地上
          }
        }
        out.push([t, x, y, z]);
      }
      lastT = now;
      if (out.length) ingest(id, out, true);
    }, 200);
  };

  // ---------- 繪圖 ----------
  function fit(cv) {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }
  function drawSeries(ctx, d, key, color, lw, x0, w, h, ymin, ymax, tEnd) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    var first = true;
    for (var i = 0; i < d.samples.length; i++) {
      var s = d.samples[i];
      var px = x0 + (1 - (tEnd - s.t) / WINDOW_MS) * w;
      var v = Math.max(ymin, Math.min(ymax, s[key]));
      var py = h - (v - ymin) / (ymax - ymin) * h;
      if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  function drawBig() {
    var f = fit($('bigChart')), ctx = f.ctx, L = 34, w = f.w - L - 4, h = f.h - 4;
    ctx.clearRect(0, 0, f.w, f.h);
    var ymin = -3, ymax = 4, t = thr();
    ctx.font = '12px sans-serif'; ctx.fillStyle = col('--muted'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = ymin; g <= ymax; g++) {
      var y = 2 + h - (g - ymin) / (ymax - ymin) * h;
      ctx.strokeStyle = col('--grid'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + w, y); ctx.stroke();
      ctx.fillText(g + 'g', L - 6, y);
    }
    [[t.ff, '失重'], [t.im, '撞擊']].forEach(function (a) {
      var y = 2 + h - (a[0] - ymin) / (ymax - ymin) * h;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = col('--danger'); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + w, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col('--danger'); ctx.textAlign = 'left'; ctx.fillText(a[1], L + 4, y - 8);
    });
    var d = devices[selected];
    if (!d || !d.samples.length) return;
    var tEnd = d.samples[d.samples.length - 1].t;
    ctx.save(); ctx.translate(0, 2);
    drawSeries(ctx, d, 'x', col('--x'), 1.2, L, w, h, ymin, ymax, tEnd);
    drawSeries(ctx, d, 'y', col('--y'), 1.2, L, w, h, ymin, ymax, tEnd);
    drawSeries(ctx, d, 'z', col('--z'), 1.2, L, w, h, ymin, ymax, tEnd);
    drawSeries(ctx, d, 'm', col('--m'), 2.2, L, w, h, ymin, ymax, tEnd);
    ctx.restore();
  }
  function drawCard(d, now) {
    var f = fit(d.el.querySelector('canvas')), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    var y1 = f.h - (1 / 4) * f.h;
    ctx.strokeStyle = col('--grid'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(f.w, y1); ctx.stroke();
    var online = now - d.lastRx < OFFLINE_MS, falling = now - d.fallShownAt < FALL_SHOW_MS;
    if (d.samples.length) drawSeries(ctx, d, 'm', falling ? col('--danger') : col('--accent'), 1.6, 0, f.w, f.h, 0, 4, d.samples[d.samples.length - 1].t);
    var st = d.el.querySelector('.st'), last = d.samples[d.samples.length - 1];
    var recent = d.samples.slice(-60), mean = 0, sd = 0;
    recent.forEach(function (s) { mean += s.m; }); mean /= recent.length || 1;
    recent.forEach(function (s) { sd += (s.m - mean) * (s.m - mean); }); sd = Math.sqrt(sd / (recent.length || 1));
    if (!online) { st.textContent = '離線'; st.style.color = col('--muted'); }
    else if (falling) { st.textContent = '⚠️ 跌倒！'; st.style.color = col('--danger'); }
    else if (sd < 0.04) { st.textContent = '靜止'; st.style.color = col('--muted'); }
    else { st.textContent = '活動中'; st.style.color = col('--ok'); }
    if (!falling) d.el.classList.remove('fall');
    d.el.querySelector('.mag').textContent = last ? last.m.toFixed(2) + ' g' : '';
    d.el.querySelector('.falls').textContent = '跌倒 ' + d.falls + ' 次';
  }
  function loop() {
    var now = Date.now(), n = 0;
    for (var k in devices) { drawCard(devices[k], now); if (now - devices[k].lastRx < OFFLINE_MS) n++; }
    $('count').textContent = n + ' 台裝置在線';
    drawBig();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

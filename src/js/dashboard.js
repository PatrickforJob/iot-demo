// 老師端監控台：接收手機的陀螺儀資料、畫波形、依代號數字分組顯示
(function () {
  var C = window.IOT_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var WINDOW_MS = 10000, OFFLINE_MS = 5000;
  var MAX_DEVICES = 100;                // 裝置數量上限，避免有人灌入大量假裝置拖垮畫面
  var ID_RE = /^[^\/#+\s]{1,12}$/;      // 與手機端 cleanId() 相同的代號規則
  var SID_RE = /^[A-Za-z0-9]{1,16}$/;   // 手機的隨機識別碼，用來分辨「同代號、不同手機」
  var GYRO_MAX = 600;                   // 圖表上下限 ±600 °/s，一般甩動大約落在這個範圍
  var MAX_GROUPS = 3;                   // 最多分 3 組；螢幕太小放不下時，組內允許捲動
  var DEMO_BATCH = 10;                  // 按一次「demo user」加幾個
  // 用沒有原型的物件存裝置：代號叫 "__proto__"、"constructor" 也不會汙染內建物件
  var devices = Object.create(null), deviceCount = 0, selected = null, client = null;
  var css = getComputedStyle(document.documentElement);
  function col(n) { return css.getPropertyValue(n).trim(); }

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

  // ---------- 裝置 ----------
  function updateTitle() {
    $('detailTitle').textContent = selected ? '裝置「' + selected + '」旋轉速度（最近 10 秒）' : '點選下方裝置查看詳細波形';
  }
  function refreshSel() { for (var k in devices) devices[k].el.classList.toggle('sel', k === selected); }

  function getDev(id, demo) {
    if (devices[id]) return devices[id];
    if (deviceCount >= MAX_DEVICES) return null;
    deviceCount++;
    var el = document.createElement('div');
    el.className = 'dev' + (demo ? ' demo' : '');
    el.innerHTML = '<div class="top"><span class="name"></span><span class="st"></span></div>' +
      '<div class="stage"><div class="scene"><div class="phone3d"><div class="screen"></div></div></div></div>' +
      '<div class="meta"><span class="rot"></span><span class="tilt"></span></div>';
    el.querySelector('.name').textContent = id;
    el.onclick = function () { selected = id; updateTitle(); refreshSel(); };
    var empty = $('grid').querySelector('.empty'); if (empty) empty.remove();
    $('grid').appendChild(el);
    devices[id] = { id: id, el: el, samples: [], lastRx: 0, demo: !!demo, sid: undefined, timer: null };
    if (!selected) { selected = id; updateTitle(); refreshSel(); }
    gLayoutKey = '';
    return devices[id];
  }

  function removeDev(id) {
    var d = devices[id];
    if (!d) return;
    if (d.timer) clearInterval(d.timer);
    d.el.remove();
    delete devices[id];
    deviceCount--;
    if (selected === id) {
      selected = Object.keys(devices)[0] || null;
      updateTitle(); refreshSel();
    }
    if (!deviceCount) $('grid').innerHTML = '<div class="empty">等待手機連線…<br>請學生掃描 QR code 開啟網頁</div>';
    gLayoutKey = '';
  }

  // ---------- 代號重複 ----------
  // 同一個代號已經有另一支手機在線上時，擋下新來的手機並通知它換代號。
  // 原本那支離線超過 OFFLINE_MS 後，新手機就可以接手（例如學生換了一支手機）。
  var dupNotified = Object.create(null);
  function rejectDup(id, sid) {
    var key = id + '|' + sid, now = Date.now();
    if (dupNotified[key] && now - dupNotified[key] < 2000) return;
    dupNotified[key] = now;
    if (client && client.connected) client.publish(C.topicBase + '/' + id + '/dup', JSON.stringify({ sid: sid }));
  }

  // 感測器沒有資料的欄位是 null
  function opt(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  // 每筆資料：[時間, 旋轉速度 x, y, z, 傾斜 前後, 傾斜 左右]
  function ingest(id, samples, demo, sid) {
    var now = Date.now();
    sid = demo ? 'demo' : (sid || '');
    var prev = devices[id];
    if (prev && prev.sid !== undefined && prev.sid !== sid && now - prev.lastRx < OFFLINE_MS) {
      if (!demo) rejectDup(id, sid);
      return;
    }
    var d = getDev(id, demo);
    if (!d) return;
    d.sid = sid;
    d.lastRx = now;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var gx = opt(s[1]), gy = opt(s[2]), gz = opt(s[3]);
      var gm = gx === null || gy === null || gz === null ? null : Math.sqrt(gx * gx + gy * gy + gz * gz);
      d.samples.push({ t: s[0], gx: gx, gy: gy, gz: gz, gm: gm, b: opt(s[4]), g: opt(s[5]) });
    }
    var latest = d.samples.length ? d.samples[d.samples.length - 1].t : 0;
    while (d.samples.length && d.samples[0].t < latest - WINDOW_MS) d.samples.shift();
  }

  // ---------- MQTT ----------
  function setNet(s, txt) { $('netDot').className = 'dot ' + s; $('netText').textContent = txt; }
  client = mqtt.connect(C.brokerUrl, { clientId: 'dash-' + Math.random().toString(16).slice(2, 10), clean: true, reconnectPeriod: 3000, connectTimeout: 8000 });
  client.on('connect', function () {
    setNet('ok', '已連線 ' + C.brokerUrl.split('/')[2].split(':')[0] + (C.room ? '・頻道 ' + C.room : ''));
    client.subscribe(C.topicBase + '/+/gyro');
  });
  client.on('reconnect', function () { setNet('warn', '重新連線中…'); });
  client.on('offline', function () { setNet('err', '離線（可按「demo user」示範）'); });
  client.on('error', function () { setNet('err', '連線失敗'); });
  client.on('message', function (topic, msg) {
    // 公開 broker 上任何人都能送訊息，所以收到的資料一律先檢查格式
    try {
      var id = topic.split('/').slice(-2, -1)[0];
      if (!ID_RE.test(id)) return;
      var p = JSON.parse(msg.toString());
      if (!p || !Array.isArray(p.s)) return;
      var samples = p.s.slice(0, 500).filter(function (s) {
        return Array.isArray(s) && s.length >= 6 && typeof s[0] === 'number' && isFinite(s[0]);
      });
      var sid = typeof p.sid === 'string' && SID_RE.test(p.sid) ? p.sid : '';
      if (samples.length) ingest(id, samples, false, sid);
    } catch (e) {}
  });

  // ---------- demo user（沒有學生手機時示範用，只在這個畫面產生，不會送到雲端）----------
  // 五種動作輪流分配：平放靜止、前後點頭、左右搖擺、平面轉圈、偶爾大力甩
  var DEMO_MOTIONS = ['平放靜止', '前後點頭', '左右搖擺', '平面轉圈', '偶爾大力甩'];
  var demoN = 0;
  function n(a) { return (Math.random() - 0.5) * a; }
  function r1(v) { return Math.round(v * 10) / 10; }

  function demoSample(kind, sec, amp) {
    var gx = n(2), gy = n(2), gz = n(2), b = n(1), g = n(1), c;
    if (kind === '前後點頭') {
      b = 35 + 30 * amp * Math.sin(sec * 1.5); g = n(2);
      gx = 45 * amp * Math.cos(sec * 1.5) + n(4);
    } else if (kind === '左右搖擺') {
      b = 40 + n(2); g = 35 * amp * Math.sin(sec * 1.6);
      gy = 56 * amp * Math.cos(sec * 1.6) + n(4);
    } else if (kind === '平面轉圈') {
      b = 4 + n(1); g = n(1);
      gz = 90 * amp + n(8);
    } else if (kind === '偶爾大力甩') {
      c = sec % 5;
      b = 45 + 6 * Math.sin(sec * 2); g = 4 * Math.sin(sec);
      gx = 12 * Math.cos(sec * 2) + n(4); gy = 4 * Math.cos(sec) + n(4);
      if (c > 4 && c < 4.6) {                       // 每 5 秒甩一次，持續 0.6 秒
        var k = Math.sin((c - 4) / 0.6 * Math.PI);
        gx = 450 * amp * k * Math.sin(c * 30) + n(40); gy = 300 * amp * k * Math.cos(c * 25) + n(40); gz = n(120) * k;
        b = 45 + 40 * k * Math.sin(c * 30); g = 30 * k * Math.cos(c * 25);
      }
    }
    return [r1(gx), r1(gy), r1(gz), r1(b), r1(g)];
  }

  function addDemoUser() {
    demoN++;
    var id = 'demo' + (demoN < 10 ? '0' : '') + demoN;
    if (devices[id]) return;
    var kind = DEMO_MOTIONS[(demoN - 1) % DEMO_MOTIONS.length];
    var amp = 0.7 + Math.random() * 0.6, phase = Math.random() * 10;   // 每個人動作幅度、節奏略有不同
    var t0 = Date.now(), lastT = t0;
    ingest(id, [[t0].concat(demoSample(kind, phase, amp))], true);
    var d = devices[id];
    if (!d) return;
    d.timer = setInterval(function () {
      var now = Date.now(), out = [];
      for (var t = lastT + 16; t <= now; t += 16) out.push([t].concat(demoSample(kind, (t - t0) / 1000 + phase, amp)));
      lastT = now;
      if (out.length) ingest(id, out, true);
    }, 200);
  }

  function demoCount() { var c = 0; for (var k in devices) if (devices[k].demo) c++; return c; }
  function refreshDemoButtons() { $('resetBtn').disabled = demoCount() === 0; }

  $('demoBtn').onclick = function () {
    for (var i = 0; i < DEMO_BATCH; i++) addDemoUser();
    refreshDemoButtons();
    layoutGroups(true);
  };
  $('resetBtn').onclick = function () {
    Object.keys(devices).forEach(function (id) { if (devices[id].demo) removeDev(id); });
    demoN = 0;
    refreshDemoButtons();
    layoutGroups(true);
  };

  // ---------- 分組：依代號裡的數字排序，依螢幕大小分成幾組 ----------
  // 只看數字、忽略文字：A07 → [7]、12號 → [12]、3班5 → [3, 5]、3班14 → [3, 14]
  // 依序比較每一段數字；沒有數字的代號排在最後；數字完全相同時才比文字
  var gPage = 0, gPages = 1, gLayoutKey = '', gLastLayout = 0;
  function numKey(id) { return (id.match(/\d+/g) || []).map(function (s) { return parseInt(s, 10); }); }
  function sortedIds() {
    return Object.keys(devices).sort(function (a, b) {
      var na = numKey(a), nb = numKey(b);
      if (!na.length !== !nb.length) return na.length ? -1 : 1;
      for (var i = 0; i < Math.min(na.length, nb.length); i++) if (na[i] !== nb[i]) return na[i] - nb[i];
      if (na.length !== nb.length) return na.length - nb.length;
      return a.localeCompare(b, 'zh-Hant');
    });
  }
  // 一個畫面不捲動時放得下幾張卡片
  function capacity() {
    var g = $('grid'), card = g.querySelector('.dev');
    var cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
    var top = g.getBoundingClientRect().top + window.scrollY;
    var ch = (card && card.offsetHeight ? card.offsetHeight : 151) + 12;
    var rows = Math.max(1, Math.floor((window.innerHeight - top - 16 + 12) / ch));
    return cols * rows;
  }

  function layoutGroups(force) {
    var now = Date.now();
    if (!force && now - gLastLayout < 500) return;
    gLastLayout = now;
    var ids = sortedIds(), pager = $('gpager');
    if (!ids.length) { pager.innerHTML = ''; gPages = 1; return; }
    var pages = Math.min(MAX_GROUPS, Math.max(1, Math.ceil(ids.length / capacity())));
    var per = Math.ceil(ids.length / pages);          // 平均分配，例如 30 人分 2 組 → 15 + 15
    if (gPage >= pages) gPage = pages - 1;
    var key = ids.join('\u0001') + '|' + per + '|' + gPage;
    if (key === gLayoutKey && !force) return;
    gLayoutKey = key;
    gPages = pages;

    var grid = $('grid');
    ids.forEach(function (id, i) {
      var el = devices[id].el;
      grid.appendChild(el);                              // 依排序重新排列
      el.style.display = Math.floor(i / per) === gPage ? '' : 'none';
    });

    pager.innerHTML = '';
    if (pages === 1) return;
    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = '共 ' + ids.length + ' 台，分 ' + pages + ' 組（← → 鍵切換）';
    pager.appendChild(label);
    for (var p = 0; p < pages; p++) {
      var first = ids[p * per], last = ids[Math.min(ids.length, (p + 1) * per) - 1];
      var b = document.createElement('button');
      b.className = p === gPage ? 'active' : '';
      b.textContent = '第 ' + (p + 1) + ' 組';
      var small = document.createElement('small');
      small.textContent = first + (first === last ? '' : '～' + last);
      b.appendChild(small);
      b.onclick = (function (p) { return function () { gPage = p; layoutGroups(true); }; })(p);
      pager.appendChild(b);
    }
  }
  // 簡報筆的翻頁鍵、鍵盤左右鍵都能切換組別
  document.addEventListener('keydown', function (e) {
    if (gPages < 2 || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { gPage = (gPage + 1) % gPages; layoutGroups(true); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { gPage = (gPage - 1 + gPages) % gPages; layoutGroups(true); e.preventDefault(); }
  });
  window.addEventListener('resize', function () { layoutGroups(true); });

  // ---------- 收合大圖表：螢幕高度不到 900px 時預設收合，老師的選擇會記住 ----------
  var collapsed = window.innerHeight < 900;
  try { var saved = localStorage.getItem('iot-chart-collapsed'); if (saved !== null) collapsed = saved === '1'; } catch (e) {}
  function applyCollapse() {
    document.body.classList.toggle('chart-collapsed', collapsed);
    $('chartToggle').textContent = collapsed ? '展開圖表' : '收合圖表';
  }
  $('chartToggle').onclick = function () {
    collapsed = !collapsed;
    try { localStorage.setItem('iot-chart-collapsed', collapsed ? '1' : '0'); } catch (err) {}
    applyCollapse();
    layoutGroups(true);
  };
  applyCollapse();

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
      if (s[key] === null) { first = true; continue; }   // 沒有資料就斷開線段
      var px = x0 + (1 - (tEnd - s.t) / WINDOW_MS) * w;
      var v = Math.max(ymin, Math.min(ymax, s[key]));
      var py = h - (v - ymin) / (ymax - ymin) * h;
      if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawBig() {
    if (collapsed) return;
    var PAD = 8, f = fit($('bigChart')), ctx = f.ctx, L = 44, w = f.w - L - 4, h = f.h - 2 * PAD;
    ctx.clearRect(0, 0, f.w, f.h);
    ctx.font = '12px sans-serif'; ctx.fillStyle = col('--muted'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = -GYRO_MAX; g <= GYRO_MAX; g += 200) {
      var y = PAD + h - (g + GYRO_MAX) / (2 * GYRO_MAX) * h;
      ctx.strokeStyle = col('--grid'); ctx.lineWidth = g === 0 ? 2 : 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + w, y); ctx.stroke();
      ctx.fillText(g + '°', L - 6, y);
    }
    var d = devices[selected];
    if (!d || !d.samples.length) return;
    var tEnd = d.samples[d.samples.length - 1].t;
    ctx.save(); ctx.translate(0, PAD);
    drawSeries(ctx, d, 'gx', col('--x'), 1.2, L, w, h, -GYRO_MAX, GYRO_MAX, tEnd);
    drawSeries(ctx, d, 'gy', col('--y'), 1.2, L, w, h, -GYRO_MAX, GYRO_MAX, tEnd);
    drawSeries(ctx, d, 'gz', col('--z'), 1.2, L, w, h, -GYRO_MAX, GYRO_MAX, tEnd);
    drawSeries(ctx, d, 'gm', col('--m'), 2.2, L, w, h, -GYRO_MAX, GYRO_MAX, tEnd);
    ctx.restore();
    if (!d.samples.some(function (s) { return s.gm !== null; })) {
      ctx.fillStyle = col('--muted'); ctx.textAlign = 'center'; ctx.font = '15px sans-serif';
      ctx.fillText('這台裝置沒有傳送陀螺儀資料', L + w / 2, f.h / 2);
    }
  }

  function drawCard(d, now) {
    var el = d.el, st = el.querySelector('.st');
    var online = now - d.lastRx < OFFLINE_MS;
    // 找最新一筆有陀螺儀資料的樣本
    var last = null;
    for (var i = d.samples.length - 1; i >= 0 && i >= d.samples.length - 30; i--) {
      if (d.samples[i].gm !== null) { last = d.samples[i]; break; }
    }
    el.classList.toggle('no-data', !last);
    if (!online) { st.textContent = '離線'; st.style.color = col('--muted'); }
    else if (!last) { st.textContent = '無陀螺儀資料'; st.style.color = col('--muted'); }
    else {
      // 最近約 0.5 秒的平均旋轉速度判斷是否在轉
      var recent = d.samples.slice(-30).filter(function (s) { return s.gm !== null; }), avg = 0;
      recent.forEach(function (s) { avg += s.gm; }); avg /= recent.length || 1;
      if (avg < 15) { st.textContent = '靜止'; st.style.color = col('--muted'); }
      else { st.textContent = '轉動中'; st.style.color = col('--ok'); }
    }
    el.querySelector('.rot').textContent = last ? Math.round(last.gm) + ' °/s' : '';
    var b = last && last.b !== null ? last.b : 0, g = last && last.g !== null ? last.g : 0;
    el.querySelector('.tilt').textContent = last && last.b !== null ? '前後 ' + Math.round(b) + '°・左右 ' + Math.round(g) + '°' : '';
    // 手機的 Y 軸向上、CSS 的 Y 軸向下，所以前後傾斜要反向
    el.querySelector('.phone3d').style.transform = 'rotateX(' + (-b) + 'deg) rotateY(' + g + 'deg)';
  }

  function loop() {
    var now = Date.now(), online = 0, demo = 0;
    layoutGroups(false);
    for (var k in devices) {
      var d = devices[k];
      if (d.el.style.display !== 'none') drawCard(d, now);   // 只畫目前這組
      if (now - d.lastRx < OFFLINE_MS) { online++; if (d.demo) demo++; }
    }
    $('count').textContent = online + ' 台裝置在線' + (demo ? '（demo ' + demo + '）' : '');
    drawBig();
    requestAnimationFrame(loop);
  }
  updateTitle();
  requestAnimationFrame(loop);
})();

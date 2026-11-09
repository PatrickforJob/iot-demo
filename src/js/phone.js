// 學生手機端：讀加速度計、透過 MQTT 傳到雲端、接收跌倒警示
(function () {
  var C = window.IOT_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var G = 9.80665;
  var client = null, running = false, buf = [], sentCount = 0, sendTimer = null, wakeLock = null, deviceId = '';
  var gotMotion = false;
  var tilt = { b: null, g: null };   // 傾斜角度（來自 deviceorientation）
  var lastUi = 0;                    // 畫面數字更新節流

  // 保留 1 位小數；感測器沒有資料時回傳 null
  function r1(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10) / 10 : null; }

  try { $('name').value = localStorage.getItem('iot-name') || ''; } catch (e) {}

  function setNet(state, text) {
    $('netDot').className = 'dot ' + state;
    $('netText').textContent = text;
  }

  function cleanId(s) {
    return (s || '').trim().replace(/[\/#+\s]/g, '').slice(0, 12);
  }

  function onMotion(e) {
    var a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    gotMotion = true;
    var x = a.x / G, y = a.y / G, z = a.z / G;
    var m = Math.sqrt(x * x + y * y + z * z);
    // 陀螺儀：繞 X 軸（前後翻）、Y 軸（左右翻）、Z 軸（平面轉）的旋轉速度，單位 °/s
    var r = e.rotationRate || {};
    var gx = r1(r.beta), gy = r1(r.gamma), gz = r1(r.alpha);
    // 每筆資料：[時間, 加速度 x, y, z, 旋轉速度 x, y, z, 傾斜 前後, 傾斜 左右]
    buf.push([Date.now(), +x.toFixed(3), +y.toFixed(3), +z.toFixed(3), gx, gy, gz, r1(tilt.b), r1(tilt.g)]);

    var now = Date.now();
    if (now - lastUi < 66) return;   // 畫面每秒更新約 15 次就夠了
    lastUi = now;
    $('mag').textContent = m.toFixed(2) + ' g';
    $('magBar').style.width = Math.min(100, m / 4 * 100) + '%';
    $('ax').textContent = x.toFixed(2); $('ay').textContent = y.toFixed(2); $('az').textContent = z.toFixed(2);
    if (gx !== null) {
      $('rot').textContent = Math.round(Math.sqrt(gx * gx + gy * gy + gz * gz)) + ' °/s';
      $('gx').textContent = Math.round(gx); $('gy').textContent = Math.round(gy); $('gz').textContent = Math.round(gz);
    }
    if (tilt.b !== null) $('tilt').textContent = '傾斜：前後 ' + Math.round(tilt.b) + '°、左右 ' + Math.round(tilt.g) + '°';
  }

  function onOrient(e) {
    if (e.beta === null) return;
    tilt.b = e.beta; tilt.g = e.gamma;
  }

  // iPhone 需要使用者按按鈕後明確授權；動作與方向兩種一起請求（同一個授權，只會跳一次）
  function askPermission() {
    var asks = [];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission());
    return Promise.all(asks.map(function (p) { return p.catch(function () { return 'error'; }); }));
  }

  function flush() {
    if (!client || !client.connected || buf.length === 0) { if (buf.length > 200) buf = buf.slice(-200); return; }
    var payload = JSON.stringify({ id: deviceId, s: buf });
    buf = [];
    client.publish(C.topicBase + '/' + deviceId + '/acc', payload, { qos: 0 });
    sentCount++;
    $('sent').textContent = '已送出 ' + sentCount + ' 包';
  }

  function connect() {
    setNet('warn', '連線到雲端中…');
    client = mqtt.connect(C.brokerUrl, {
      clientId: 'phone-' + deviceId + '-' + Math.random().toString(16).slice(2, 8),
      clean: true, reconnectPeriod: 2000, connectTimeout: 8000
    });
    client.on('connect', function () {
      setNet('ok', '已連線到雲端（' + C.brokerUrl.split('/')[2].split(':')[0] + '）');
      client.subscribe(C.topicBase + '/' + deviceId + '/alert');
    });
    client.on('reconnect', function () { setNet('warn', '重新連線中…'); });
    client.on('offline', function () { setNet('err', '網路中斷，重試中…'); });
    client.on('error', function () { setNet('err', '連線失敗（網路可能被擋，試試改用手機網路）'); });
    client.on('message', function (topic, msg) {
      if (topic.slice(-6) === '/alert') {
        $('alert').classList.add('show');
        if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      }
    });
  }

  async function start() {
    deviceId = cleanId($('name').value);
    if (!deviceId) { alert('請先輸入代號'); return; }
    $('name').value = deviceId;
    try { localStorage.setItem('iot-name', deviceId); } catch (e) {}

    // 部分 Android 瀏覽器不支援 requestPermission，直接繼續；沒資料時下方會提示
    var res = await askPermission();
    if (res.length && res[0] !== 'granted' && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      alert('需要允許「動作與方向」才能讀取感測器。請重新整理頁面再按一次。'); return;
    }
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
    running = true;
    $('btn').textContent = '停止傳送';
    $('btn').classList.add('stop');
    $('name').disabled = true;
    connect();
    sendTimer = setInterval(flush, C.sendIntervalMs);
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    setTimeout(function () {
      if (running && !gotMotion) alert('沒有收到感測器資料。請確認是用手機開啟（電腦沒有加速度計），並使用 Safari 或 Chrome。');
    }, 2500);
  }

  function stop() {
    running = false;
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientation', onOrient);
    clearInterval(sendTimer);
    if (client) { client.end(true); client = null; }
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    setNet('', '已停止');
    $('btn').textContent = '開始傳送';
    $('btn').classList.remove('stop');
    $('name').disabled = false;
  }

  $('btn').addEventListener('click', function () { running ? stop() : start(); });
  $('ack').addEventListener('click', function () { $('alert').classList.remove('show'); });
})();

// 共用設定：手機端 (phone.html) 與老師端 (index.html) 都讀這個檔
//
// 網址參數（兩頁都適用，老師端的 QR code 會自動帶給學生）：
//   ?b=2         改用備用 broker（教室網路擋住主要 broker 時）
//   ?room=xxx    換一個頻道。有人惡作劇送假資料時，換個頻道就能擋掉
//                （只能用英數字、- 和 _，最多 32 字）
(function () {
  var BROKERS = {
    '1': 'wss://mqttgo.io:8084/mqtt',          // MQTTGO（台灣）
    '2': 'wss://broker.hivemq.com:8884/mqtt'   // HiveMQ（德國）
  };
  var params = new URLSearchParams(location.search);
  var b = params.get('b') === '2' ? '2' : '1';
  var room = (params.get('room') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);

  window.IOT_CONFIG = {
    brokerKey: b,
    brokerUrl: BROKERS[b],
    room: room,
    // 所有資料都放在這個 topic 底下，換一個字串就等於換一間教室
    topicBase: 'aimed-iot-class-demo-7k2q' + (room ? '-' + room : ''),
    sendIntervalMs: 200
  };
})();

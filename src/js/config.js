// 共用設定：手機端 (phone.html) 與老師端 (index.html) 都讀這個檔
// 如果教室網路擋住主要 broker，在網址後面加 ?b=2 改用備用 broker
(function () {
  var BROKERS = {
    '1': 'wss://broker.emqx.io:8084/mqtt',
    '2': 'wss://broker.hivemq.com:8884/mqtt'
  };
  var params = new URLSearchParams(location.search);
  var b = params.get('b') === '2' ? '2' : '1';
  window.IOT_CONFIG = {
    brokerKey: b,
    brokerUrl: BROKERS[b],
    // 所有資料都放在這個 topic 底下，換一個字串就等於換一間教室
    topicBase: 'aimed-iot-class-demo-7k2q',
    sendIntervalMs: 200
  };
})();

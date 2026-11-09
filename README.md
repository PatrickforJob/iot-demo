# 手機感測器 IoT 跌倒偵測示範

通識課用：學生手機 → MQTT broker → 老師監控台（AI 判斷）→ 警示回傳手機。

- `index.html`：老師端監控台（投影用），按「顯示 QR code」讓學生掃描
- `phone.html`：學生手機端，讀加速度計並傳到雲端
- `config.js`：broker 與 topic 設定
- 網路擋住主要 broker 時，兩個網址都加上 `?b=2` 改用備用 broker
- 完全沒網路時，監控台按「加入模擬裝置」可示範

只傳加速度數值，代號請用座號或暱稱。

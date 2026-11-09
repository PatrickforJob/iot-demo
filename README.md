# 手機感測器 IoT 跌倒偵測示範

通識課用：學生手機 → MQTT broker → 老師監控台（AI 判斷）→ 警示回傳手機。

線上版：https://patrickforjob.github.io/iot-demo/

- `index.html`：老師端監控台（投影用），按「顯示 QR code」讓學生掃描
- `phone.html`：學生手機端，讀加速度計並傳到雲端
- 網路擋住主要 broker 時，兩個網址都加上 `?b=2` 改用備用 broker
- 完全沒網路時，監控台按「加入模擬裝置」可示範

只傳加速度數值，代號請用座號或暱稱。

## 專案結構

```
src/
├─ pug/    頁面結構（_layout.pug 是共用版型）
├─ less/   樣式（_base.less 是共用樣式與主題色）
├─ js/     程式：config.js（broker 與 topic）、dashboard.js、phone.js
└─ lib/    第三方函式庫：mqtt.min.js、qrcode.js
build.js   把 src/ 編譯到 dist/
```

## 開發

需要 Node.js 22 以上。

```bash
npm install
npm run dev     # 建置 + 監看 src/ 自動重建 + 本機伺服器 http://localhost:8080
npm run build   # 只建置到 dist/
```

## 部署

push 到 `main` 後，GitHub Actions（`.github/workflows/deploy.yml`）會自動建置並發布到 GitHub Pages。

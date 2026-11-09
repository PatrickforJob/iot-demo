# 手機陀螺儀 IoT 示範

通識課用：學生手機的陀螺儀 → MQTT broker → 老師監控台即時顯示每個人手機的旋轉與傾斜。

線上版：https://patrickforjob.github.io/iot-demo/

- `index.html`：老師端監控台（投影用），按「顯示 QR code」讓學生掃描
- `phone.html`：學生手機端，讀陀螺儀與傾斜角度並傳到雲端
- 每張卡片的 3D 手機圖示會跟著學生手機傾斜；卡片依代號裡的數字排序，人多時自動分成 2～3 組（← → 鍵切換）
- 同一個代號只能一支手機使用，重複時第二支手機會被要求換代號
- 主要 broker：MQTTGO（台灣，`mqttgo.io`）；備用：HiveMQ（德國）
- 網路擋住主要 broker 時，兩個網址都加上 `?b=2` 改用備用 broker
- 有人送假資料惡作劇時，監控台網址加上 `?room=任意代碼`（例如 `?room=0315a`）換頻道，再讓學生重掃 QR code
- 沒有學生手機時，按「＋10 個 demo user」加入模擬資料，「重置 demo」全部移除（demo 只在監控台本機產生，不會送到雲端）

只傳陀螺儀數值，代號請用座號或暱稱。

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

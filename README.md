# Air Quality Monitor — Classroom Edition

Real-time ESP32-based air quality dashboard. Currently runs on simulated data; drops into hardware mode automatically when ThingSpeak env vars are set.

## Steps

1. **Wire the ESP32** — pins listed at the top of `hardware/esp32_sketch/esp32_sketch.ino`. Current wiring: DHT data → GPIO4, MQ135 → GPIO5, green LED → GPIO6, red LED → GPIO7, buzzer → GPIO13.
2. **Create a ThingSpeak channel** — [thingspeak.com](https://thingspeak.com) → New Channel → enable field1, field2, field3 (name them Temperature, Humidity, AQI).
3. **Copy your keys**:
   - Channel ID and **Read API Key** → paste into `.env`:
     ```
     VITE_TS_CHANNEL=1234567
     VITE_TS_READ_KEY=XXXXXXXXXXXXXXXX
     ```
   - **Write API Key** + WiFi SSID/password → paste into the three top constants of `hardware/esp32_sketch.ino`.
4. **Flash the ESP32** — open the sketch in Arduino IDE, install "DHT sensor library" by Adafruit if you haven't, select your ESP32 board, upload.
5. **Restart the dashboard** — `npm run dev`. The status pill in the Overview will read **ESP32 Live** once the first reading arrives (~15s).

If ThingSpeak fetches fail, the dashboard auto-falls back to simulated data and the pill shows **Fallback (Hardware Offline)** — so the demo never freezes.

## Local dev

```bash
npm install
npm run dev
```

Then open http://localhost:5174.

## Data-source contract

`sensorData.js` exports one `getReading()` — the whole UI reads through it. It returns either a live ThingSpeak reading, `null` (no new data since last poll), or a mock reading on failure. Nothing else touches the network.

## Field mapping

| ThingSpeak field | Meaning       | Source        |
|------------------|---------------|---------------|
| field1           | Temperature °C| DHT11         |
| field2           | Humidity %    | DHT11         |
| field3           | AQI (0–500)   | MQ135 → mapped|

The ESP32 sketch writes fields in this order. If you change one, change the other.

## Calibration

Real sensors read off the datasheet. Two knobs, no rewrite needed:
- **UI thresholds** — Settings tab; live-edited, no reload.
- **MQ135 → AQI map** — `airToAQI()` in the sketch. Adjust the `500..3500` range if clean-air reads too high or polluted-air reads too low.

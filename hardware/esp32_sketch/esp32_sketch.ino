/*
  ─────────────────────────────────────────────────────────────
  Smart Air Quality & Comfort Monitor
  Board   : ESP32 Dev Module
  Sensors : DHT (temperature + humidity), MQ-135 (air quality)
  Outputs : Green LED (ok), Red LED (alert), Buzzer (alert)
  Cloud   : ThingSpeak (feeds the web dashboard)
  ─────────────────────────────────────────────────────────────
  Reads the environment every 2 seconds, grades it as
  GOOD / MODERATE / POOR, drives the LEDs + buzzer to match,
  and pushes a reading to ThingSpeak every 15 seconds.
*/

#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ══════════════ PART A: WIFI + THINGSPEAK ══════════════

const char* WIFI_SSID     = "NISHA-SEN";
const char* WIFI_PASSWORD = "nisha@77989";
const char* TS_WRITE_KEY  = "XRCMTBW8QNQKWRWT";  // Write key, NOT the Read key

// ══════════════ PART B: PIN CONFIGURATION ══════════════

#define DHT_PIN      4     // DHT data pin
#define DHT_TYPE     DHT11 // matches the sensor now wired in
#define MQ135_PIN    5     // MQ-135 analog out

#define GREEN_LED    18    // "air is fine"
#define RED_LED      17    // "alert"
#define BUZZER_PIN   13    // active buzzer (+ leg)

// ══════════════ PART C: THRESHOLDS & TIMING ══════════════

// Temperature (°C)
const float TEMP_WARN   = 28.0;   // getting warm
const float TEMP_ALERT  = 32.0;   // too hot

// Humidity (%)
const float HUM_LOW     = 30.0;   // too dry
const float HUM_HIGH    = 70.0;   // too humid

// Air quality (raw ADC value, 0–4095 on ESP32)
const int   AIR_WARN    = 1500;   // moderate pollution
const int   AIR_ALERT   = 2500;   // poor air

// Timing
const unsigned long SAMPLE_INTERVAL = 2000;   // read every 2 s
const unsigned long WARMUP_MS       = 20000;  // MQ-135 needs ~20 s to stabilise
const unsigned long UPLOAD_INTERVAL = 15000;  // ThingSpeak free-tier limit

// Smoothing: average the last N gas readings so one spike doesn't trip the alarm
const int SMOOTHING_SAMPLES = 10;

// ══════════════ PART D: GLOBAL OBJECTS & STATE ══════════════

DHT dht(DHT_PIN, DHT_TYPE);

// Three quality levels, used for both air and comfort
enum Level { GOOD = 0, MODERATE = 1, POOR = 2 };

int  airSamples[SMOOTHING_SAMPLES];  // rolling buffer of gas readings
int  sampleIndex   = 0;
bool bufferFilled  = false;

unsigned long lastSampleTime = 0;
unsigned long lastUploadTime = 0;
unsigned long bootTime       = 0;

// Last known-good readings (used if the DHT hiccups on one cycle)
float lastTemp = NAN;
float lastHum  = NAN;

// ══════════════ PART E: SETUP (runs once) ══════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(GREEN_LED,  OUTPUT);
  pinMode(RED_LED,    OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Start with everything off
  digitalWrite(GREEN_LED,  LOW);
  digitalWrite(RED_LED,    LOW);
  digitalWrite(BUZZER_PIN, LOW);

  dht.begin();

  // ESP32 ADC setup: 12-bit (0–4095) across the full 0–3.3 V range
  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);

  connectWiFi();

  bootTime = millis();

  Serial.println();
  Serial.println("===========================================");
  Serial.println("  Smart Air Quality & Comfort Monitor");
  Serial.println("===========================================");
  Serial.println("Warming up the gas sensor, please wait...");
}

// ══════════════ PART F: SENSOR READING HELPERS ══════════════

// Read the gas sensor and return the average of the last N readings
int readAirSmoothed() {
  airSamples[sampleIndex] = analogRead(MQ135_PIN);
  sampleIndex++;
  if (sampleIndex >= SMOOTHING_SAMPLES) {
    sampleIndex = 0;
    bufferFilled = true;
  }

  int count = bufferFilled ? SMOOTHING_SAMPLES : sampleIndex;
  long sum = 0;
  for (int i = 0; i < count; i++) sum += airSamples[i];
  return (int)(sum / count);
}

// Read temperature + humidity. Returns false if the sensor failed this cycle.
bool readDHT(float &temperature, float &humidity) {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    return false;              // bad read — caller decides what to do
  }

  temperature = t;
  humidity    = h;
  lastTemp    = t;             // remember for next time
  lastHum     = h;
  return true;
}

// ══════════════ PART G: DECISION LOGIC ══════════════

// Grade the air quality reading
Level rateAir(int airValue) {
  if (airValue >= AIR_ALERT) return POOR;
  if (airValue >= AIR_WARN)  return MODERATE;
  return GOOD;
}

// Grade how comfortable the temperature + humidity are
Level rateComfort(float t, float h) {
  if (t >= TEMP_ALERT)                 return POOR;
  if (h >= HUM_HIGH || h <= HUM_LOW)   return MODERATE;
  if (t >= TEMP_WARN)                  return MODERATE;
  return GOOD;
}

// Overall level = whichever is worse
Level worseOf(Level a, Level b) {
  return (a > b) ? a : b;
}

// Turn a Level into text for the Serial Monitor
const char* levelName(Level l) {
  switch (l) {
    case GOOD:     return "Good";
    case MODERATE: return "Moderate";
    default:       return "Poor";
  }
}

// A human-readable comfort description
const char* comfortText(float t, float h) {
  if (t >= TEMP_ALERT)  return "Too hot";
  if (t >= TEMP_WARN)   return "Slightly warm";
  if (h >= HUM_HIGH)    return "Humid / stuffy";
  if (h <= HUM_LOW)     return "Too dry";
  return "Comfortable";
}

// ══════════════ PART H: OUTPUT & INDICATORS ══════════════

void updateIndicators(Level overall) {
  bool alert = (overall == POOR);

  digitalWrite(GREEN_LED,  alert ? LOW  : HIGH);
  digitalWrite(RED_LED,    alert ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, alert ? HIGH : LOW);
}

void printReport(float t, float h, int air,
                 Level airLevel, Level comfortLevel, Level overall) {
  Serial.println("-------------------------------------------");
  Serial.print("Temperature : "); Serial.print(t, 1);  Serial.println(" C");
  Serial.print("Humidity    : "); Serial.print(h, 1);  Serial.println(" %");
  Serial.print("Air (raw)   : "); Serial.print(air);
  Serial.print("  ->  ");         Serial.println(levelName(airLevel));
  Serial.print("Comfort     : "); Serial.print(comfortText(t, h));
  Serial.print("  ->  ");         Serial.println(levelName(comfortLevel));
  Serial.print("OVERALL     : "); Serial.print(levelName(overall));
  Serial.println(overall == POOR ? "   *** ALERT ***" : "");
}

// Blink both LEDs slowly while the gas sensor warms up
void showWarmup() {
  bool on = ((millis() / 500) % 2) == 0;
  digitalWrite(GREEN_LED, on);
  digitalWrite(RED_LED,   !on);
}

// ══════════════ PART I: WIFI + THINGSPEAK ══════════════

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" connected: " + WiFi.localIP().toString());
  } else {
    Serial.println(" failed — will retry uploads, LEDs/buzzer still work offline.");
  }
}

// Raw MQ-135 ADC (0-4095) -> AQI-ish 0-500 scale, matching the dashboard's
// Settings tab units (good < 50, moderate < 100). Rough linear map — retune
// the 500..3500 range against a reference sensor if you have one.
int airToAQI(int raw) {
  int aqi = map(raw, 500, 3500, 0, 500);
  return constrain(aqi, 0, 500);
}

// field1=temperature, field2=humidity, field3=AQI — must match src/sensorData.js
void uploadToThingSpeak(float t, float h, int airRaw) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  HTTPClient http;
  String url = "https://api.thingspeak.com/update?api_key=" + String(TS_WRITE_KEY)
             + "&field1=" + String(t, 1)
             + "&field2=" + String(h, 1)
             + "&field3=" + String(airToAQI(airRaw));
  http.begin(url);
  int code = http.GET();
  Serial.print("ThingSpeak upload -> ");
  Serial.println(code);
  http.end();
}

// ══════════════ PART J: MAIN LOOP ══════════════

void loop() {
  unsigned long now = millis();

  // --- Warm-up phase: let the gas sensor settle before trusting it ---
  if (now - bootTime < WARMUP_MS) {
    showWarmup();
    readAirSmoothed();              // keep filling the buffer meanwhile
    return;
  }

  // --- Only sample every SAMPLE_INTERVAL milliseconds ---
  if (now - lastSampleTime < SAMPLE_INTERVAL) return;
  lastSampleTime = now;

  // 1. Read sensors
  float temperature, humidity;
  if (!readDHT(temperature, humidity)) {
    Serial.println("[warn] DHT read failed, using last good values.");
    if (isnan(lastTemp)) return;    // nothing valid yet — skip this cycle
    temperature = lastTemp;
    humidity    = lastHum;
  }
  int airValue = readAirSmoothed();

  // 2. Decide
  Level airLevel     = rateAir(airValue);
  Level comfortLevel = rateComfort(temperature, humidity);
  Level overall      = worseOf(airLevel, comfortLevel);

  // 3. Act + report
  updateIndicators(overall);
  printReport(temperature, humidity, airValue, airLevel, comfortLevel, overall);

  // 4. Push to the cloud (rate-limited independently of the 2s sample loop)
  if (now - lastUploadTime >= UPLOAD_INTERVAL) {
    lastUploadTime = now;
    uploadToThingSpeak(temperature, humidity, airValue);
  }
}

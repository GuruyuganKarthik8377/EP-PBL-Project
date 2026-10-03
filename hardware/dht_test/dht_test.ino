// Minimal DHT11 test — isolates sensor/wiring from the rest of the project.
// Upload this alone. If it also fails, it's wiring/pin/module, not the main sketch.
#include <DHT.h>

#define DHT_PIN  15
DHT dht(DHT_PIN, DHT11);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("DHT11 test starting...");
  dht.begin();
}

void loop() {
  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Read FAILED");
  } else {
    Serial.printf("OK  temp=%.1fC  hum=%.0f%%\n", t, h);
  }
}

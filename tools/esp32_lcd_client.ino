// ESP32 LCD client: polls Python voice bridge and displays text on 20x4 I2C LCD.
// Libraries: WiFi, HTTPClient, LiquidCrystal_I2C, ArduinoJson

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

// ---- Config ----
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Set to your laptop IP running voice_bridge.py
const char* BRIDGE_URL = "http://192.168.1.100:5000/reply";

LiquidCrystal_I2C lcd(0x27, 20, 4);

String lastYou;
String lastAgent;
unsigned long lastPoll = 0;
const unsigned long POLL_MS = 2000;

String clipLine(const String& s, int start, int len) {
  if (start >= s.length()) return "";
  return s.substring(start, min(start + len, (int)s.length()));
}

void showText(const String& you, const String& agent) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("YOU:");
  lcd.setCursor(0, 1);
  lcd.print(clipLine(you, 0, 20));

  lcd.setCursor(0, 2);
  lcd.print("AGENT:");
  lcd.setCursor(0, 3);
  lcd.print(clipLine(agent, 0, 20));
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi connected");
  delay(1000);
  lcd.clear();
}

void loop() {
  unsigned long now = millis();
  if (now - lastPoll < POLL_MS) return;
  lastPoll = now;

  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(BRIDGE_URL);
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, body);
    if (!err) {
      String you = doc["you"].as<String>();
      String agent = doc["agent"].as<String>();
      if (you != lastYou || agent != lastAgent) {
        lastYou = you;
        lastAgent = agent;
        showText(you, agent);
      }
    }
  }
  http.end();
}

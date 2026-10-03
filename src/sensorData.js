// ---------------------------------------------------------------------------
// Sensor data + classification.
//
// Data source is chosen at runtime by .env:
//   VITE_TS_CHANNEL + VITE_TS_READ_KEY set  -> ThingSpeak (real hardware)
//   otherwise                                -> mock random walk
//
// Field mapping (ESP32 sketch must match):
//   field1 = temperature (°C, from DHT11)
//   field2 = humidity    (%, from DHT11)
//   field3 = aqi         (0-500, mapped from MQ135)
// ---------------------------------------------------------------------------

export const DEFAULT_THRESHOLDS = {
  temperature: { comfort: [18, 28], alertAbove: 35, unit: '°C' },
  humidity:    { comfort: [30, 60], alertAbove: 80, unit: '%' },
  aqi:         { good: 50, moderate: 100, unit: 'AQI' },
}

export function classify(metric, value, thresholds = DEFAULT_THRESHOLDS) {
  if (metric === 'aqi') {
    if (value < thresholds.aqi.good) return 'good'
    if (value < thresholds.aqi.moderate) return 'moderate'
    return 'poor'
  }
  const t = thresholds[metric]
  const [lo, hi] = t.comfort
  if (value > t.alertAbove || value < lo - 10) return 'poor'
  if (value > hi || value < lo) return 'moderate'
  return 'good'
}

const RANK = { good: 0, moderate: 1, poor: 2 }
export function overallStatus(reading, thresholds = DEFAULT_THRESHOLDS) {
  return ['temperature', 'humidity', 'aqi']
    .map(m => classify(m, reading[m], thresholds))
    .reduce((worst, l) => (RANK[l] > RANK[worst] ? l : worst), 'good')
}

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// --- Mock source ------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
let last = { temperature: 24, humidity: 45, aqi: 35 }

export function nextReading() {
  last = {
    temperature: clamp(last.temperature + (Math.random() - 0.5) * 2, 15, 42),
    humidity:    clamp(last.humidity + (Math.random() - 0.5) * 4, 20, 90),
    aqi:         clamp(last.aqi + (Math.random() - 0.5) * 12, 10, 160),
  }
  return {
    temperature: Math.round(last.temperature * 10) / 10,
    humidity: Math.round(last.humidity),
    aqi: Math.round(last.aqi),
    time: nowLabel(),
    source: 'mock',
  }
}

export function seedReadings(n = 12) {
  return Array.from({ length: n }, () => nextReading())
}

// --- Real source (ThingSpeak) ----------------------------------------------
const CHANNEL = import.meta.env?.VITE_TS_CHANNEL
const READ_KEY = import.meta.env?.VITE_TS_READ_KEY
export const HARDWARE_MODE = Boolean(CHANNEL && READ_KEY)

let lastFetchedAt = null // ThingSpeak created_at, used to skip duplicate polls

async function fetchReading() {
  const url = `https://api.thingspeak.com/channels/${CHANNEL}/feeds/last.json?api_key=${READ_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ThingSpeak HTTP ${res.status}`)
  const d = await res.json()
  if (!d || d.created_at === lastFetchedAt) return null // no new data since last poll
  lastFetchedAt = d.created_at
  const r = {
    temperature: Number(d.field1),
    humidity: Number(d.field2),
    aqi: Number(d.field3),
    time: new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    source: 'thingspeak',
  }
  if (Number.isNaN(r.temperature) || Number.isNaN(r.humidity) || Number.isNaN(r.aqi)) {
    throw new Error('ThingSpeak returned non-numeric field (check field1/2/3 mapping)')
  }
  return r
}

// Dispatcher. Returns null when polling ThingSpeak with no new data (chart stays put).
// Falls back to mock on network error so demo keeps flowing.
// ponytail: silent fallback logs to console, upgrade to a UI toast if you need explicit alerting.
export async function getReading() {
  if (!HARDWARE_MODE) return nextReading()
  try {
    return await fetchReading()
  } catch (e) {
    console.warn('[sensorData] ThingSpeak fetch failed, using mock:', e.message)
    return { ...nextReading(), source: 'mock-fallback' }
  }
}

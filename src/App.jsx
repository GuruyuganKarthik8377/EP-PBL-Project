import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { classify, overallStatus, seedReadings, getReading, HARDWARE_MODE, DEFAULT_THRESHOLDS } from './sensorData'

const STATUS_STYLE = {
  good:     { label: 'Good',     text: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/40', dot: 'bg-emerald-400', glow: '' },
  moderate: { label: 'Moderate', text: 'text-amber-400',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/40',   dot: 'bg-amber-400',   glow: '' },
  poor:     { label: 'Poor',     text: 'text-rose-400',    bg: 'bg-rose-500/10',    ring: 'ring-rose-500/40',    dot: 'bg-rose-400',    glow: '' },
}

const METRICS = [
  { key: 'temperature', name: 'Temperature', unit: '°C',  color: '#fb923c' },
  { key: 'humidity',    name: 'Humidity',    unit: '%',   color: '#818cf8' },
  { key: 'aqi',         name: 'Air Quality', unit: 'AQI', color: '#c084fc' },
]

const STATUS_MESSAGE = {
  good: 'All readings within comfortable range.',
  moderate: 'Some readings outside the comfort range — monitor closely.',
  poor: 'Thresholds exceeded — ventilation or action recommended.',
}

const THRESHOLD_FIELDS = {
  temperature: [
    { label: 'Comfort min', key: 'comfort', idx: 0 },
    { label: 'Comfort max', key: 'comfort', idx: 1 },
    { label: 'Alert above', key: 'alertAbove' },
  ],
  humidity: [
    { label: 'Comfort min', key: 'comfort', idx: 0 },
    { label: 'Comfort max', key: 'comfort', idx: 1 },
    { label: 'Alert above', key: 'alertAbove' },
  ],
  aqi: [
    { label: 'Good below', key: 'good' },
    { label: 'Moderate below', key: 'moderate' },
  ],
}

const TABS = ['Overview', 'Trend', 'Readings', 'Recommend', 'Settings', 'About']

// Classroom-focused recommendations. Returns per-metric issue + actions.
// ponytail: static rule table, upgrade to CO2/PM2.5 mapping if MQ135 gets calibrated.
function getRecommendations(current, thresholds) {
  const items = []
  const t = classify('temperature', current.temperature, thresholds)
  const h = classify('humidity', current.humidity, thresholds)
  const a = classify('aqi', current.aqi, thresholds)

  if (t !== 'good') {
    const hot = current.temperature > thresholds.temperature.comfort[1]
    items.push({
      metric: 'Temperature', level: t,
      issue: hot ? `Room is too warm (${current.temperature}°C)` : `Room is too cool (${current.temperature}°C)`,
      actions: hot
        ? ['Turn on ceiling fans or AC', 'Open windows for cross-ventilation', 'Draw blinds to block sunlight']
        : ['Reduce AC intensity', 'Close windows on the windward side'],
    })
  }
  if (h !== 'good') {
    const humid = current.humidity > thresholds.humidity.comfort[1]
    items.push({
      metric: 'Humidity', level: h,
      issue: humid ? `Air is too humid (${current.humidity}%) — risk of drowsiness` : `Air is too dry (${current.humidity}%) — irritation risk`,
      actions: humid
        ? ['Increase ventilation immediately', 'Run dehumidifier if available', 'Avoid overcrowding the room']
        : ['Place a bowl of water near air intake', 'Reduce AC dryness'],
    })
  }
  if (a !== 'good') {
    items.push({
      metric: 'Air Quality', level: a,
      issue: `Elevated pollutants detected (${current.aqi} AQI) — affects concentration`,
      actions: a === 'poor'
        ? ['⚠ Evacuate students and ventilate for 15+ min', 'Check for indoor sources (chalk dust, cleaning agents)', 'Report to facilities immediately']
        : ['Open all windows and doors', 'Take a short break outdoors', 'Reduce activities that raise CO₂ (loud discussion)'],
    })
  }
  const overall = overallStatus(current, thresholds)
  return {
    safe: overall === 'good',
    level: overall,
    verdict: overall === 'good'
      ? 'Classroom environment is SAFE for learning.'
      : overall === 'moderate'
        ? 'Classroom conditions are ACCEPTABLE but should be improved.'
        : 'Classroom environment is UNSAFE — action required now.',
    items,
  }
}

const CARD = 'rounded-xl bg-neutral-950 border border-neutral-800'
const BTN = 'text-xs px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors'

function exportCSV(history) {
  const csv = [
    'time,temperature,humidity,aqi',
    ...history.map(r => `${r.time},${r.temperature},${r.humidity},${r.aqi}`),
  ].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `air-quality-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [history, setHistory] = useState(() => seedReadings(12))
  const [thresholds, setThresholds] = useState(() => structuredClone(DEFAULT_THRESHOLDS))
  const [tab, setTab] = useState('Overview')
  const [source, setSource] = useState(HARDWARE_MODE ? 'connecting' : 'mock')
  const current = history[history.length - 1]
  const status = overallStatus(current, thresholds)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const r = await getReading()
      if (cancelled || !r) return
      setSource(r.source)
      setHistory(h => [...h.slice(-19), r])
    }
    tick()
    // ThingSpeak free tier updates ~15s; 2s poll is fine (dedup handled by created_at).
    const id = setInterval(tick, HARDWARE_MODE ? 5000 : 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="min-h-screen bg-black text-neutral-100">
      <div className="max-w-6xl mx-auto p-6 sm:p-8">
        <Nav tab={tab} setTab={setTab} status={status} />
        <div className="mt-6">
          {tab === 'Overview' && <Overview current={current} status={status} thresholds={thresholds} history={history} source={source} onExport={() => exportCSV(history)} />}
          {tab === 'Trend' && <TrendTab history={history} />}
          {tab === 'Readings' && <ReadingsTab history={history} onExport={() => exportCSV(history)} />}
          {tab === 'Recommend' && <RecommendTab current={current} thresholds={thresholds} />}
          {tab === 'Settings' && <SettingsTab thresholds={thresholds} setThresholds={setThresholds} />}
          {tab === 'About' && <AboutTab />}
        </div>
      </div>
    </div>
  )
}

const SOURCE_LABEL = {
  thingspeak: { text: 'ESP32 Live', dot: 'bg-emerald-400' },
  'mock-fallback': { text: 'Fallback (Hardware Offline)', dot: 'bg-amber-400' },
  connecting: { text: 'Connecting…', dot: 'bg-amber-400' },
  mock: { text: 'Simulated Data', dot: 'bg-indigo-400' },
}

function Nav({ tab, setTab, status }) {
  const s = STATUS_STYLE[status]
  return (
    <div className={`${CARD} flex items-center justify-between px-4 py-3 flex-wrap gap-3`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-neutral-100 text-black flex items-center justify-center">
          <span className="text-sm font-bold tracking-tight">AQ</span>
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-medium tracking-tight">Air Quality Monitor</div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-[0.2em]">ESP32 · DHT11 · MQ135</div>
        </div>
      </div>

      <nav className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-md p-1">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-4 py-1.5 rounded transition-colors ${
              tab === t
                ? 'bg-neutral-100 text-black'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-md ${s.bg} ring-1 ${s.ring}`}>
        <span className={`w-2 h-2 rounded-full ${s.dot} animate-pulse`} />
        <span className={s.text}>{s.label}</span>
      </div>
    </div>
  )
}

function Overview({ current, status, thresholds, history, source, onExport }) {
  const s = STATUS_STYLE[status]
  const src = SOURCE_LABEL[source] || SOURCE_LABEL.mock
  return (
    <div className="space-y-4">
      <div className={`${CARD} flex items-center justify-between px-6 py-5 flex-wrap gap-3`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${s.dot} ${status !== 'good' ? 'animate-pulse' : ''}`} />
          <div>
            <div className={`font-semibold ${s.text}`}>Overall Status: {s.label}</div>
            <div className="text-slate-400 text-sm">{STATUS_MESSAGE[status]}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-400">
            <span className={`w-1.5 h-1.5 rounded-full ${src.dot} animate-pulse`} />
            {src.text}
          </div>
          <button onClick={onExport} className={BTN}>Export CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {METRICS.map(m => <StatCard key={m.key} metric={m} value={current[m.key]} thresholds={thresholds} />)}
      </div>

      <MiniTrend history={history} />
    </div>
  )
}

function StatCard({ metric, value, thresholds }) {
  const s = STATUS_STYLE[classify(metric.key, value, thresholds)]
  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-neutral-500 text-xs uppercase tracking-[0.2em]">{metric.name}</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${s.bg} ${s.text}`}>{s.label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-5xl font-serif tabular-nums tracking-tight" style={{ color: metric.color }}>{value}</span>
        <span className="text-neutral-500 text-base">{metric.unit}</span>
      </div>
    </div>
  )
}

function MiniTrend({ history }) {
  return (
    <div className={`${CARD} p-6`}>
      <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-4">Live Trend</h2>
      <div className="h-56"><ChartInner history={history} /></div>
    </div>
  )
}

function TrendTab({ history }) {
  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Full Trend Analysis</h2>
        <span className="text-xs text-slate-500">last {history.length} readings · 2s interval</span>
      </div>
      <div className="h-96"><ChartInner history={history} /></div>
    </div>
  )
}

function ChartInner({ history }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#737373' }} />
        <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
        <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #262626', borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {METRICS.map(m => (
          <Line key={m.key} type="monotone" dataKey={m.key} name={m.name} stroke={m.color} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function ReadingsTab({ history, onExport }) {
  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Raw Readings</h2>
        <button onClick={onExport} className={BTN}>Export CSV</button>
      </div>
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-900 text-neutral-500 text-xs uppercase tracking-[0.2em]">
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-right px-4 py-3 font-medium">Temperature (°C)</th>
              <th className="text-right px-4 py-3 font-medium">Humidity (%)</th>
              <th className="text-right px-4 py-3 font-medium">AQI</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((r, i) => (
              <tr key={i} className="border-t border-neutral-800 hover:bg-neutral-900">
                <td className="px-4 py-2.5 text-neutral-500 font-mono text-xs">{r.time}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-orange-300">{r.temperature}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-indigo-300">{r.humidity}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-violet-300">{r.aqi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SettingsTab({ thresholds, setThresholds }) {
  const update = (metric, key, idx, value) => {
    setThresholds(t => {
      const next = structuredClone(t)
      if (idx == null) next[metric][key] = Number(value)
      else next[metric][key][idx] = Number(value)
      return next
    })
  }
  return (
    <div className={`${CARD} p-6`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold">Threshold Settings</h2>
        <button className="text-xs text-neutral-500 hover:text-white underline" onClick={() => setThresholds(structuredClone(DEFAULT_THRESHOLDS))}>
          Reset to defaults
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {METRICS.map(m => (
          <div key={m.key} className="rounded-md bg-neutral-900 border border-neutral-800 p-4">
            <div className="text-sm font-medium mb-3" style={{ color: m.color }}>{m.name}</div>
            <div className="space-y-2">
              {THRESHOLD_FIELDS[m.key].map(f => {
                const val = f.idx == null ? thresholds[m.key][f.key] : thresholds[m.key][f.key][f.idx]
                return (
                  <label key={f.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-neutral-400">{f.label}</span>
                    <input
                      type="number" value={val} min={0}
                      onChange={e => update(m.key, f.key, f.idx ?? null, e.target.value)}
                      className="w-20 px-2 py-1 rounded bg-black border border-neutral-700 text-right tabular-nums text-neutral-100 focus:outline-none focus:border-neutral-400"
                    />
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecommendTab({ current, thresholds }) {
  const r = getRecommendations(current, thresholds)
  const s = STATUS_STYLE[r.level]
  return (
    <div className="space-y-4">
      <div className={`${CARD} p-6 ring-1 ${s.ring}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className={`w-3 h-3 rounded-full ${s.dot} ${!r.safe ? 'animate-pulse' : ''}`} />
          <span className="text-xs uppercase tracking-widest text-slate-500">Classroom Safety Verdict</span>
        </div>
        <div className={`text-2xl font-semibold ${s.text}`}>
          {r.safe ? '✓ SAFE' : r.level === 'moderate' ? '⚠ ACCEPTABLE' : '✕ UNSAFE'}
        </div>
        <p className="text-slate-400 text-sm mt-2">{r.verdict}</p>
      </div>

      {r.items.length === 0 ? (
        <div className={`${CARD} p-8 text-center`}>
          <div className="text-4xl mb-3">🌱</div>
          <div className="text-emerald-300 font-medium mb-1">Great breathing environment</div>
          <div className="text-slate-500 text-sm">Temperature, humidity, and air quality are all within comfortable ranges for learning.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {r.items.map((it, i) => {
            const st = STATUS_STYLE[it.level]
            return (
              <div key={i} className={`${CARD} p-6 ring-1 ${st.ring}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                    <span className="text-sm font-semibold">{it.metric}</span>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.bg} ${st.text} ring-1 ${st.ring} uppercase`}>{st.label}</span>
                </div>
                <p className="text-slate-300 text-sm mb-4">{it.issue}</p>
                <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">Recommended Actions</div>
                <ul className="space-y-1.5">
                  {it.actions.map((a, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-indigo-400 mt-0.5">→</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">Classroom Guidance</div>
        <p className="text-slate-400 text-sm leading-relaxed">
          Poor air quality reduces cognitive performance by up to 15% and increases student drowsiness.
          Aim for temperature 20–26°C, humidity 40–60%, AQI &lt; 50 for optimal learning conditions.
        </p>
      </div>
    </div>
  )
}

function AboutTab() {
  const modules = [
    { name: 'Sensing', text: 'DHT11 (temp/humidity) + MQ135 (air quality gases) feed raw analog/digital readings.' },
    { name: 'Processing', text: 'ESP32 microcontroller applies threshold logic and classifies status.' },
    { name: 'Alert', text: 'Green/Red LED + Buzzer trigger when thresholds are exceeded.' },
    { name: 'Communication', text: 'Built-in Wi-Fi transmits readings to the cloud every 2 seconds.' },
    { name: 'Cloud', text: 'ThingSpeak stores historical data; this dashboard visualizes it live.' },
    { name: 'Power', text: 'USB / 5V supply powers the ESP32 and connected sensors.' },
  ]
  return (
    <div className="space-y-4">
      <div className={`${CARD} p-6`}>
        <h2 className="text-sm font-semibold mb-2">About This Project</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          A real-time environmental monitoring dashboard for an ESP32-based IoT air quality station.
          The dashboard currently runs on simulated readings — swap <code className="text-indigo-300 bg-black/40 px-1 rounded">src/sensorData.js</code> with a ThingSpeak fetch to connect real hardware.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modules.map((m, i) => (
          <div key={m.name} className={`${CARD} p-5`}>
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-[10px] text-indigo-400 font-mono">M{i + 1}</span>
              <h3 className="text-sm font-semibold">{m.name} Module</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{m.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

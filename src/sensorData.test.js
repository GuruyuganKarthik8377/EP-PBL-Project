// Smallest check that fails if the threshold logic breaks. Run: node src/sensorData.test.js
import assert from 'node:assert'
import { classify, overallStatus, DEFAULT_THRESHOLDS } from './sensorData.js'

assert.equal(classify('aqi', 30), 'good')
assert.equal(classify('aqi', 75), 'moderate')
assert.equal(classify('aqi', 130), 'poor')
assert.equal(classify('temperature', 24), 'good')
assert.equal(classify('temperature', 30), 'moderate')
assert.equal(classify('temperature', 40), 'poor')
assert.equal(classify('humidity', 85), 'poor')
assert.equal(overallStatus({ temperature: 24, humidity: 45, aqi: 30 }), 'good')
assert.equal(overallStatus({ temperature: 24, humidity: 45, aqi: 130 }), 'poor')
assert.equal(overallStatus({ temperature: 30, humidity: 45, aqi: 30 }), 'moderate')

// custom thresholds are honored (config panel path)
const loose = { ...DEFAULT_THRESHOLDS, aqi: { good: 70, moderate: 120 } }
assert.equal(classify('aqi', 60, loose), 'good')      // would be 'moderate' under defaults
assert.equal(overallStatus({ temperature: 24, humidity: 45, aqi: 60 }, loose), 'good')

console.log('sensorData checks passed')

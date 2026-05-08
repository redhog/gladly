import { assert } from '@esm-bundle/chai'
import {
  registerAxisQuantityKind,
  getAxisQuantityKind,
  getRegisteredAxisQuantityKinds,
} from '../src/axes/AxisQuantityKindRegistry.js'

describe('AxisQuantityKindRegistry', () => {
  it('returns a default definition for an unregistered kind', () => {
    const def = getAxisQuantityKind('totally_unknown_xyz')
    assert.equal(def.label, 'totally_unknown_xyz')
    assert.equal(def.scale, 'linear')
  })

  it('registers and retrieves a quantity kind', () => {
    registerAxisQuantityKind('test_voltage_V', { label: 'Voltage (V)', scale: 'linear' })
    const def = getAxisQuantityKind('test_voltage_V')
    assert.equal(def.label, 'Voltage (V)')
    assert.equal(def.scale, 'linear')
  })

  it('registers a log-scale kind and retrieves it correctly', () => {
    registerAxisQuantityKind('test_freq_Hz', { label: 'Frequency (Hz)', scale: 'log' })
    const def = getAxisQuantityKind('test_freq_Hz')
    assert.equal(def.scale, 'log')
  })

  it('merges properties when the same kind is re-registered', () => {
    registerAxisQuantityKind('test_merge_qk', { label: 'Before' })
    registerAxisQuantityKind('test_merge_qk', { scale: 'log' })
    const def = getAxisQuantityKind('test_merge_qk')
    assert.equal(def.label, 'Before')
    assert.equal(def.scale, 'log')
  })

  it('appears in getRegisteredAxisQuantityKinds after registration', () => {
    registerAxisQuantityKind('test_listed_qk', { label: 'Listed' })
    assert.include(getRegisteredAxisQuantityKinds(), 'test_listed_qk')
  })
})

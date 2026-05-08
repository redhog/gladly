import { assert } from '@esm-bundle/chai'
import { Data, DataGroup, ArrayColumn } from '../src/index.js'

// ─── Simple format ─────────────────────────────────────────────────────────────

describe('Data.wrap — simple format', () => {
  it('returns a Data instance', () => {
    const d = Data.wrap({ x: new Float32Array([1, 2, 3]) })
    assert.instanceOf(d, Data)
  })

  it('columns() lists the top-level keys', () => {
    const d = Data.wrap({ x: new Float32Array([1]), y: new Float32Array([2]) })
    assert.deepEqual(d.columns().sort(), ['x', 'y'])
  })

  it('getData() returns an ArrayColumn with the correct values', () => {
    const arr = new Float32Array([1, 2, 3])
    const d = Data.wrap({ x: arr })
    const col = d.getData('x')
    assert.instanceOf(col, ArrayColumn)
    assert.deepEqual(Array.from(col.array), [1, 2, 3])
  })

  it('getQuantityKind() returns undefined for simple format', () => {
    const d = Data.wrap({ x: new Float32Array([1]) })
    assert.isUndefined(d.getQuantityKind('x'))
  })

  it('getDomain() auto-computes [min, max]', () => {
    const d = Data.wrap({ x: new Float32Array([3, 1, 4, 1, 5, 9]) })
    assert.deepEqual(d.getDomain('x'), [1, 9])
  })

  it('getData() returns null for an unknown column', () => {
    const d = Data.wrap({ x: new Float32Array([1]) })
    assert.isNull(d.getData('z'))
  })
})

// ─── Per-column rich format ────────────────────────────────────────────────────

describe('Data.wrap — per-column rich format', () => {
  let d
  before(() => {
    d = Data.wrap({
      depth: { data: new Float32Array([0, 10, 20]), quantity_kind: 'depth_m', domain: [0, 20] },
      vp:    { data: new Float32Array([1500, 2000, 2500]), quantity_kind: 'velocity_ms' },
    })
  })

  it('returns a Data instance', () => {
    assert.instanceOf(d, Data)
  })

  it('getData() exposes the correct array', () => {
    assert.deepEqual(Array.from(d.getData('depth').array), [0, 10, 20])
  })

  it('getQuantityKind() returns the provided quantity_kind', () => {
    assert.equal(d.getQuantityKind('depth'), 'depth_m')
    assert.equal(d.getQuantityKind('vp'), 'velocity_ms')
  })

  it('getDomain() returns the explicitly provided array domain', () => {
    assert.deepEqual(d.getDomain('depth'), [0, 20])
  })

  it('getDomain() auto-computes when domain is not provided', () => {
    assert.deepEqual(d.getDomain('vp'), [1500, 2500])
  })
})

// ─── Columnar format ───────────────────────────────────────────────────────────

describe('Data.wrap — columnar format', () => {
  let d
  before(() => {
    d = Data.wrap({
      data:           { x: new Float32Array([0, 1, 2]), y: new Float32Array([3, 4, 5]) },
      quantity_kinds: { x: 'distance_m', y: 'voltage_V' },
      domains:        { x: [0, 2], y: { min: 3, max: 5 } },
    })
  })

  it('returns a Data instance', () => {
    assert.instanceOf(d, Data)
  })

  it('columns() lists the sub-keys', () => {
    assert.deepEqual(d.columns().sort(), ['x', 'y'])
  })

  it('getQuantityKind() reads from quantity_kinds', () => {
    assert.equal(d.getQuantityKind('x'), 'distance_m')
    assert.equal(d.getQuantityKind('y'), 'voltage_V')
  })

  it('getDomain() reads an array-style domain', () => {
    assert.deepEqual(d.getDomain('x'), [0, 2])
  })

  it('getDomain() reads a {min, max} object domain', () => {
    assert.deepEqual(d.getDomain('y'), [3, 5])
  })
})

// ─── DataGroup ─────────────────────────────────────────────────────────────────

describe('DataGroup', () => {
  let g
  before(() => {
    g = Data.wrap({
      survey1: { x: new Float32Array([1, 2]), y: new Float32Array([3, 4]) },
      survey2: { x: new Float32Array([5, 6]), y: new Float32Array([7, 8]) },
    })
  })

  it('produces a DataGroup', () => {
    assert.instanceOf(g, DataGroup)
  })

  it('columns() returns dot-notation names for all children', () => {
    assert.deepEqual(g.columns().sort(), ['survey1.x', 'survey1.y', 'survey2.x', 'survey2.y'])
  })

  it('getData() resolves a dot-notation path to the correct ArrayColumn', () => {
    const col = g.getData('survey1.x')
    assert.instanceOf(col, ArrayColumn)
    assert.deepEqual(Array.from(col.array), [1, 2])
  })

  it('getDomain() resolves a dot-notation path', () => {
    assert.deepEqual(g.getDomain('survey2.y'), [7, 8])
  })

  it('listData() returns immediate Data children keyed by name', () => {
    const kids = g.listData()
    assert.hasAllKeys(kids, ['survey1', 'survey2'])
    assert.instanceOf(kids.survey1, Data)
  })

  it('getData() returns undefined for an unknown dotted path', () => {
    assert.isUndefined(g.getData('survey3.x'))
  })

  it('Data.wrap is idempotent — an already-wrapped instance is returned unchanged', () => {
    assert.strictEqual(Data.wrap(g), g)
  })
})

// ─── Multi-level nesting ───────────────────────────────────────────────────────

describe('DataGroup — multi-level nesting', () => {
  it('subgroups() returns nested DataGroup children', () => {
    const g = Data.wrap({
      region_a: {
        shallow: { depth: new Float32Array([1, 2]), vp: new Float32Array([3, 4]) },
        deep:    { depth: new Float32Array([5, 6]), vp: new Float32Array([7, 8]) },
      },
      region_b: { depth: new Float32Array([9, 10]), vp: new Float32Array([11, 12]) },
    })
    const subs = g.subgroups()
    assert.hasAllKeys(subs, ['region_a'])
    assert.instanceOf(subs.region_a, DataGroup)
    // region_b is a flat Data, not a DataGroup
    const direct = g.listData()
    assert.hasAllKeys(direct, ['region_b'])
  })

  it('columns() lists all leaf columns in dot-notation at any nesting depth', () => {
    const g = Data.wrap({
      run: {
        shallow: { x: new Float32Array([1]) },
        deep:    { x: new Float32Array([2]) },
      },
    })
    assert.deepEqual(g.columns().sort(), ['run.shallow.x', 'run.deep.x'].sort())
  })
})

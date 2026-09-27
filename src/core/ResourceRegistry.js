export class ResourceRegistry {
  constructor() {
    this._entries   = new Map()     // key → { resource, refCount }
    this._ownerKeys = new WeakMap() // owner → Set<key>
    this._fin = new FinalizationRegistry(keys => {
      for (const k of keys) this._releaseKey(k)
    })
  }

  acquire(key, createFn, owner = null) {
    if (!this._entries.has(key))
      this._entries.set(key, { resource: createFn(), refCount: 0 })
    this._entries.get(key).refCount++
    if (owner) {
      if (!this._ownerKeys.has(owner)) this._ownerKeys.set(owner, new Set())
      this._ownerKeys.get(owner).add(key)
      this._fin.register(owner, [key], owner)
    }
    return this._entries.get(key).resource
  }

  _releaseKey(key) {
    const entry = this._entries.get(key)
    if (!entry) return
    if (--entry.refCount <= 0) {
      entry.resource.destroy?.()
      this._entries.delete(key)
    }
  }

  // Call from Plot.destroy() for explicit, immediate release.
  releaseOwner(owner) {
    this._fin.unregister(owner)
    for (const k of this._ownerKeys.get(owner) ?? []) this._releaseKey(k)
    this._ownerKeys.delete(owner)
  }
}

export const globalResourceRegistry = new ResourceRegistry()

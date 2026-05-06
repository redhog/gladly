// ESM shim for geotiff — the UMD build sets globalThis.GeoTIFF via a classic script tag.
export const { fromUrl, fromArrayBuffer, fromBlob, writeArrayBuffer, Pool } = globalThis.GeoTIFF

// Consume the native response body before parsing a model. Keeping progress
// bookkeeping outside a replacement ReadableStream avoids fetch cancellation
// during concurrent model loading and avoids an extra copy of every GLB.
export async function loadGltf(loader, source, onProgress) {
  const url = new URL(loader.manager.resolveURL(source), globalThis.location?.href);
  const response = await fetch(url, {
    headers: loader.requestHeader,
    credentials: loader.withCredentials ? 'include' : 'same-origin',
    signal: loader.manager.abortController.signal,
  });
  if (!response.ok) throw new Error(`Model ${url.pathname}: HTTP ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  onProgress?.({ loaded: 0, total, lengthComputable: total > 0 });
  const data = await response.arrayBuffer();
  onProgress?.({ loaded: data.byteLength, total: data.byteLength, lengthComputable: true });
  return loader.parseAsync(data, new URL('.', response.url || url).href);
}

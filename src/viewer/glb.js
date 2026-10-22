import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Models come from the dataset's site copies: <model>.glb.gz next to each <model>.glb, the same
// model gzipped with the animation data that changes nothing taken out (the tracker's web-glb.js),
// a tenth of the size for the heroes. A model without one yet falls back to its .glb.

const loader = new GLTFLoader();

// Downloads by url: { promise (the file's bytes, still gzipped), loaded, total, listeners }.
// One download per model, whoever asks for it; a prefetched model is parsed only when shown
const downloads = new Map();
// Prefetched files kept for a while (the pointer rests on many heroes), the oldest dropped
const KEPT_DOWNLOADS = 40;

async function readWithProgress(res, entry) {
  entry.total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    entry.loaded += value.length;
    for (const listener of entry.listeners) listener({ loaded: entry.loaded, total: entry.total });
  }
  const bytes = new Uint8Array(entry.loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function download(url, onProgress) {
  let entry = downloads.get(url);
  if (!entry) {
    entry = { loaded: 0, total: 0, listeners: new Set() };
    entry.promise = (async () => {
      let res = await fetch(`${url}.gz`).catch(() => null);
      if (!res?.ok) {
        res = await fetch(url);
      }
      if (!res.ok) {
        throw new Error(`${url}: HTTP ${res.status}`);
      }
      return readWithProgress(res, entry);
    })();
    entry.promise.catch(() => downloads.delete(url));
    downloads.set(url, entry);
    while (downloads.size > KEPT_DOWNLOADS) {
      downloads.delete(downloads.keys().next().value);
    }
  }
  if (onProgress) {
    entry.listeners.add(onProgress);
    entry.promise.finally(() => entry.listeners.delete(onProgress)).catch(() => {});
  }
  return entry.promise;
}

async function gunzip(bytes) {
  // gzip's magic number; a .glb starts with "glTF"
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return bytes.buffer;
  }
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

// Starts downloading a model without parsing it, for one the pointer rests on
export function prefetchGlb(url) {
  download(url).catch(() => {});
}

// The parsed glTF of a model; onProgress({ loaded, total }) as its file comes in
export async function loadGlb(url, onProgress) {
  const bytes = await download(url, onProgress);
  // Parsed once (the callers keep the result), the file is not needed any more
  downloads.delete(url);
  return loader.parseAsync(await gunzip(bytes), url.slice(0, url.lastIndexOf("/") + 1));
}

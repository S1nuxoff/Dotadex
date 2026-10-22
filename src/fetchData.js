// The dataset's index and data files (a JSON at most one folder deep, such as exported.json or
// data/heroes.json, and the translations in data/i18n/) each have a gzipped copy next to them,
// <file>.json.gz (the tracker's hf.js): Hugging Face serves files uncompressed, and these are
// about 7 MB of what a page loads first. A Response of the file, from its copy where there is
// one, else the file itself
export async function fetchData(url, init) {
  const [file, query] = url.split("?");
  const res = await fetch(`${file}.gz${query ? `?${query}` : ""}`, init).catch(() => null);
  if (res?.ok && res.body) {
    return new Response(res.body.pipeThrough(new DecompressionStream("gzip")), { headers: { "content-type": "application/json" } });
  }
  return fetch(url, init);
}

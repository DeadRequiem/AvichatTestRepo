// Shared utils
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Jigsaw
  if (msg.type === 'CORS_PATCH_FETCH') {
    const url = msg.url;
    const ext_ = url.split('?')[0].split('.').pop().toLowerCase();
    const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                   png: 'image/png', webp: 'image/webp' }[ext_] || 'application/octet-stream';

    fetch(url)
      .then(r => r.arrayBuffer().then(buf => ({ buf, status: r.status })))
      .then(({ buf, status }) => {
        sendResponse({ base64: arrayBufferToBase64(buf), mime, status });
      })
      .catch(err => sendResponse({ error: err.message }));

    return true;
  }

  // Avichat Avatar Fetching
  if (msg.type === 'FETCH_AVATAR_BLOB') {
    (async () => {
      try {
        const url = String(msg.url || '');
        if (!url.startsWith('https://a1cdn.gaiaonline.com/dress-up/avatar/')) {
          throw new Error('Blocked non-avatar URL');
        }

        const res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const mimeType = res.headers.get('content-type') || 'image/png';
        const buffer = await res.arrayBuffer();
        sendResponse({ ok: true, mimeType, base64: arrayBufferToBase64(buffer) });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true;
  }
});
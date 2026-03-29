console.log('[AvichatFix] content script loaded');

const ext = globalThis.browser ?? globalThis.chrome;

const script = document.createElement('script');
script.src = ext.runtime.getURL('avichat/page-script.js');
script.onload = () => script.remove();
(document.documentElement || document.head || document.body).appendChild(script);

window.addEventListener('message', async event => {
  if (event.source !== window) return;

  const msg = event.data;
  if (!msg || msg.source !== 'AvichatFixPage') return;
  if (msg.type !== 'FETCH_AVATAR_BLOB') return;

  try {
    const response = await ext.runtime.sendMessage({ type: 'FETCH_AVATAR_BLOB', url: msg.url });

    window.postMessage({
      source: 'AvichatFixContent',
      type: 'FETCH_AVATAR_BLOB_RESULT',
      requestId: msg.requestId,
      ok: !!response?.ok,
      mimeType: response?.mimeType || 'image/png',
      base64: response?.base64 || null,
      error: response?.error || null
    }, '*');
  } catch (err) {
    window.postMessage({
      source: 'AvichatFixContent',
      type: 'FETCH_AVATAR_BLOB_RESULT',
      requestId: msg.requestId,
      ok: false,
      mimeType: 'image/png',
      base64: null,
      error: String(err)
    }, '*');
  }
});
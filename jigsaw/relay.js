// Isolated world relay; bridges MAIN world with background service worker
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.type !== 'CORS_PATCH_REQUEST') return;
  const { url, id } = e.data;

  chrome.runtime.sendMessage({ type: 'CORS_PATCH_FETCH', url }, response => {
    window.postMessage({ type: 'CORS_PATCH_RESPONSE', id, ...response }, '*');
  });
});
(() => {
  'use strict';

  const CORS_HOST = 'graphics.gaiaonline.com';

  const isCORSTarget = url => {
    try { return url && new URL(url).hostname === CORS_HOST; }
    catch { return false; }
  };

  const blobCache = new Map();

  function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const handler = e => {
        if (e.data?.type !== 'CORS_PATCH_RESPONSE' || e.data.id !== id) return;
        window.removeEventListener('message', handler);
        const d = e.data;
        if (d.error) return reject(new TypeError('[CORS Patch] ' + d.error));
        const bytes = atob(d.base64);
        const buf = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
        const blob = new Blob([buf], { type: d.mime });
        resolve(blob);
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'CORS_PATCH_REQUEST', url, id }, '*');
    });
  }

  async function getBlobUrl(url) {
    const key = url.split('?')[0];
    if (blobCache.has(key)) return blobCache.get(key);
    const p = fetchViaBackground(url).then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      blobCache.set(key, blobUrl);
      return blobUrl;
    });
    blobCache.set(key, p);
    return p;
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (!isCORSTarget(url)) return origFetch.apply(this, arguments);
    const blob = await fetchViaBackground(url);
    const mime = blob.type;
    return new Response(blob, { status: 200, headers: { 'Content-Type': mime } });
  };

  const imgProto = HTMLImageElement.prototype;
  const srcDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');

  function patchImgSrc(img) {
    if (img._corsPatchApplied) return;
    img._corsPatchApplied = true;
    Object.defineProperty(img, 'src', {
      set(val) {
        if (isCORSTarget(val)) {
          img.removeAttribute('crossorigin');
          getBlobUrl(val).then(blobUrl => {
            srcDesc.set.call(img, blobUrl);
          }).catch(() => {
            srcDesc.set.call(img, val);
          });
        } else {
          srcDesc.set.call(img, val);
        }
      },
      get() { return srcDesc.get.call(img); },
      configurable: true
    });
  }

  const origImage = window.Image;
  window.Image = function (w, h) {
    const img = new origImage(w, h);
    patchImgSrc(img);
    return img;
  };

  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tag, ...rest) {
    const el = origCreateElement(tag, ...rest);
    if (tag.toLowerCase() === 'img') patchImgSrc(el);
    return el;
  };

  const origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name.toLowerCase() === 'crossorigin' && this instanceof HTMLImageElement) {
      const src = this.getAttribute('src') || this.src || '';
      if (isCORSTarget(src)) return;
    }
    return origSetAttr.call(this, name, value);
  };

  const crossOriginDesc = Object.getOwnPropertyDescriptor(imgProto, 'crossOrigin');
  if (crossOriginDesc) {
    Object.defineProperty(imgProto, 'crossOrigin', {
      get() { return crossOriginDesc.get.call(this); },
      set(val) {
        if (isCORSTarget(this.src || this.getAttribute?.('src') || '')) return;
        crossOriginDesc.set.call(this, val);
      },
      configurable: true
    });
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLImageElement) patchImgSrc(node);
        if (node.querySelectorAll) node.querySelectorAll('img').forEach(patchImgSrc);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
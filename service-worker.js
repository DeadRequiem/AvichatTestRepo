function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
}

const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "FETCH_AVATAR_BLOB") return;

    (async () => {
        try {
            const url = String(message.url || "");
            if (!url.startsWith("https://a1cdn.gaiaonline.com/dress-up/avatar/")) {
                throw new Error("Blocked non-avatar URL");
            }

            const res = await fetch(url, {
                method: "GET",
                credentials: "omit",
                cache: "default"
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const mimeType = res.headers.get("content-type") || "image/png";
            const buffer = await res.arrayBuffer();
            const base64 = arrayBufferToBase64(buffer);

            sendResponse({
                ok: true,
                mimeType,
                base64
            });
        } catch (err) {
            sendResponse({
                ok: false,
                error: String(err)
            });
        }
    })();

    return true;
});
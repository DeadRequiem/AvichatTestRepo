(function () {
    "use strict";

    const log = (...args) => console.log("[AvichatFix]", ...args);

    const GITHUB_IMAGE_BASE = "https://raw.githubusercontent.com/DeadRequiem/AvichatTestRepo/main/images/";
    const AVATAR_HOST = "https://a1cdn.gaiaonline.com/dress-up/avatar/";

    let requestSeq = 1;
    const avatarRequestCache = new Map();

    function fileNameOf(url) {
        return String(url).split("/").pop().split("?")[0];
    }

    function isImageFile(name) {
        return /\.(png|jpg|jpeg|gif|webp)$/i.test(name);
    }

    function isAvatarUrl(url) {
        return typeof url === "string" && url.startsWith(AVATAR_HOST);
    }

    function rewriteStaticUrl(url) {
        if (typeof url !== "string") return url;

        const file = fileNameOf(url);

        if (url.includes("/images/avichat/") && isImageFile(file)) {
            const rewritten = GITHUB_IMAGE_BASE + file;
            log("Avichat image rewrite:", url, "->", rewritten);
            return rewritten;
        }

        if (isImageFile(file) && file !== url) {
            const looksRelevant =
                url.includes("graphics.gaiaonline.com") ||
                url.includes("gaiaonline.com/gaiagames/platformer/") ||
                url.includes("/tilemap/") ||
                url.includes("/avichat/");

            if (looksRelevant) {
                const rewritten = GITHUB_IMAGE_BASE + file;
                log("Image filename rewrite:", url, "->", rewritten);
                return rewritten;
            }
        }

        return url;
    }

    function base64ToBlob(base64, mimeType) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);

        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new Blob([bytes], { type: mimeType || "image/png" });
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    function requestAvatarBlob(url) {
        if (avatarRequestCache.has(url)) {
            return avatarRequestCache.get(url);
        }

        const promise = new Promise((resolve, reject) => {
            const requestId = "avatar-" + (requestSeq++);

            function onMessage(event) {
                if (event.source !== window) return;

                const msg = event.data;
                if (!msg || msg.source !== "AvichatFixContent") return;
                if (msg.type !== "FETCH_AVATAR_BLOB_RESULT") return;
                if (msg.requestId !== requestId) return;

                window.removeEventListener("message", onMessage);

                if (msg.ok && msg.base64) {
                    try {
                        resolve(base64ToBlob(msg.base64, msg.mimeType));
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error(msg.error || "Avatar fetch failed"));
                }
            }

            window.addEventListener("message", onMessage);

            window.postMessage({
                source: "AvichatFixPage",
                type: "FETCH_AVATAR_BLOB",
                requestId,
                url
            }, "*");
        });

        avatarRequestCache.set(url, promise);
        return promise;
    }

    function makeLoadEvent(xhr) {
        return {
            type: "load",
            target: xhr,
            currentTarget: xhr,
            srcElement: xhr,
            lengthComputable: false,
            loaded: 0,
            total: 0
        };
    }

    const NativeImage = window.Image;
    const srcDesc = Object.getOwnPropertyDescriptor(NativeImage.prototype, "src");

    function PatchedImage(...args) {
        const img = new NativeImage(...args);

        Object.defineProperty(img, "src", {
            configurable: true,
            enumerable: true,
            get() {
                return srcDesc.get.call(this);
            },
            set(value) {
                try {
                    if (isAvatarUrl(value)) {
                        log("Avatar image proxy:", value);
                        requestAvatarBlob(value)
                            .then((blob) => blobToDataUrl(blob))
                            .then((dataUrl) => {
                                log("Avatar image proxied:", value);
                                srcDesc.set.call(img, dataUrl);
                            })
                            .catch((err) => {
                                console.error("[AvichatFix] avatar image proxy failed:", value, err);
                                srcDesc.set.call(img, value);
                            });
                        return;
                    }

                    srcDesc.set.call(this, rewriteStaticUrl(value));
                } catch (err) {
                    console.error("[AvichatFix] Image.src patch error:", err);
                    srcDesc.set.call(this, value);
                }
            }
        });

        return img;
    }

    PatchedImage.prototype = NativeImage.prototype;
    window.Image = PatchedImage;

    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
        try {
            let url = "";
            if (typeof input === "string") url = input;
            else if (input instanceof Request) url = input.url;

            if (isAvatarUrl(url)) {
                log("Avatar fetch proxy:", url);
                const blob = await requestAvatarBlob(url);
                return new Response(blob, {
                    status: 200,
                    statusText: "OK",
                    headers: {
                        "Content-Type": blob.type || "image/png"
                    }
                });
            }

            if (typeof input === "string") {
                input = rewriteStaticUrl(input);
            } else if (input instanceof Request) {
                const rewritten = rewriteStaticUrl(input.url);
                if (rewritten !== input.url) {
                    input = new Request(rewritten, input);
                }
            }
        } catch (e) {
            log("fetch rewrite error:", e);
        }

        return origFetch.call(this, input, init);
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._avfix_method = method;
        this._avfix_url = url;
        this._avfix_rest = rest;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const originalUrl = this._avfix_url;

        if (isAvatarUrl(originalUrl)) {
            const xhr = this;

            requestAvatarBlob(originalUrl)
                .then((blob) => {
                    Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
                    Object.defineProperty(xhr, "status", { configurable: true, value: 200 });
                    Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
                    Object.defineProperty(xhr, "responseURL", { configurable: true, value: originalUrl });

                    const loadEvent = makeLoadEvent(xhr);

                    if (xhr.responseType === "blob") {
                        Object.defineProperty(xhr, "response", { configurable: true, value: blob });
                        xhr.onreadystatechange && xhr.onreadystatechange();
                        xhr.onload && xhr.onload(loadEvent);
                        return;
                    }

                    if (xhr.responseType === "arraybuffer") {
                        blob.arrayBuffer().then((buf) => {
                            Object.defineProperty(xhr, "response", { configurable: true, value: buf });
                            xhr.onreadystatechange && xhr.onreadystatechange();
                            xhr.onload && xhr.onload(loadEvent);
                        });
                        return;
                    }

                    blobToDataUrl(blob).then((result) => {
                        Object.defineProperty(xhr, "responseText", { configurable: true, value: result });
                        Object.defineProperty(xhr, "response", { configurable: true, value: result });
                        xhr.onreadystatechange && xhr.onreadystatechange();
                        xhr.onload && xhr.onload(loadEvent);
                    });
                })
                .catch((err) => {
                    console.error("[AvichatFix] avatar XHR proxy failed:", originalUrl, err);
                    xhr.onerror && xhr.onerror({
                        type: "error",
                        target: xhr,
                        currentTarget: xhr,
                        error: err
                    });
                });

            return;
        }

        try {
            const rewritten = rewriteStaticUrl(originalUrl);
            if (rewritten && rewritten !== originalUrl) {
                log("XHR rewrite:", originalUrl, "->", rewritten);
                origOpen.call(
                    this,
                    this._avfix_method || "GET",
                    rewritten,
                    ...(this._avfix_rest || [])
                );
            }
        } catch (e) {
            log("XHR redirect error:", e);
        }

        return origSend.apply(this, args);
    };

    log("XHR/send/image/fetch hooks active");

    function getGame() {
        try {
            const parentWin = window.parent || window.top;
            const iframe = parentWin.document.getElementById("game_container");
            if (iframe && iframe.contentWindow?.GameBundle?.game_manager?.game) {
                return iframe.contentWindow.GameBundle.game_manager.game;
            }
        } catch {}

        try {
            return window.GameBundle?.game_manager?.game || null;
        } catch {
            return null;
        }
    }

    function getGameScene(game) {
        try {
            return game?.scene?.scenes?.find((s) => s?.scene?.key === "GameScene") || null;
        } catch {
            return null;
        }
    }

    function applyTextureAliases(scene) {
        const textures = scene?.textures;
        if (!textures?.list) return false;

        let changed = false;

        Object.keys(textures.list).forEach((key) => {
            if (!key.startsWith("tiles_")) return;

            const stripped = key.replace(/^tiles_/, "");
            if (!textures.exists(stripped)) {
                textures.list[stripped] = textures.list[key];
                log("Added texture alias:", stripped, "->", key);
                changed = true;
            }
        });

        return changed;
    }

    function applyTilesetBinding(scene) {
        if (!scene?.map || !scene?.textures || !Array.isArray(scene.map.tilesets)) return false;

        let changed = false;

        scene.map.tilesets.forEach((ts) => {
            if (!ts || typeof ts.name !== "string") return;

            const name = ts.name;
            const possibleKeys = [
                name,
                "tiles_" + name,
                name.replace(/^tiles_/, "")
            ];

            for (const key of possibleKeys) {
                if (!scene.textures.exists(key)) continue;

                try {
                    ts.setImage(scene.textures.get(key).getSourceImage());
                    log("Bound tileset:", name, "->", key);
                    changed = true;
                    break;
                } catch (e) {
                    log("Bind failed for", name, "with", key, e);
                }
            }
        });

        return changed;
    }

    let doneAliases = false;
    let doneBinding = false;
    let stablePasses = 0;

    const interval = setInterval(() => {
        try {
            const game = getGame();
            if (!game) return;

            const scene = getGameScene(game);
            if (!scene) return;

            if (!doneAliases) {
                if (applyTextureAliases(scene)) {
                    log("Texture alias fix applied");
                }
                doneAliases = true;
            }

            if (scene.map && !doneBinding) {
                if (applyTilesetBinding(scene)) {
                    log("Tileset binding complete");
                }
                doneBinding = true;
            }

            if (doneAliases && doneBinding) {
                stablePasses += 1;
                if (stablePasses >= 5) {
                    clearInterval(interval);
                    log("All fixes complete");
                }
            }
        } catch (e) {
            log("Interval fix error:", e);
        }
    }, 100);
})();
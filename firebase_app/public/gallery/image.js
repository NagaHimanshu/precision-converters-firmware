/* Shrinks a picked photo to a JPEG on the phone before it is sent. Only one photo
   is ever decoded at a time (for every caller together), straight at the shrunk size
   where the phone can: a few big photos decoded at once can make older phones close
   the page. Memory is handed back after each. */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});
  const { GalleryError } = W.errors;

  const DATA_URL_COMMA = ",";      // a data: URL is "data:<type>;base64,<data>"

  let lane = Promise.resolve();    // decodes wait here for their turn

  function oneAtATime(work) {
    const turn = lane.then(work);
    lane = turn.catch(() => {});
    return turn;
  }

  // fn, but only the first call does anything.
  function once(fn) {
    let done = false;
    return () => {
      if (!done) {
        done = true;
        fn();
      }
    };
  }

  // The photo in an <img> (browsers turn it upright): { img, release() }.
  async function loadImg(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    const release = once(() => {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    });
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
    } catch (e) {
      release();
      throw new GalleryError("unsupported", "cannot decode");
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      release();
      throw new GalleryError("unsupported", "empty picture");
    }
    return { img, release };
  }

  // Width and height at most `maxEdge` on the longest side, never larger than they are.
  function fit(width, height, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
  }

  function bitmapPic(bitmap) {
    return { source: bitmap, width: bitmap.width, height: bitmap.height,
      release: once(() => bitmap.close && bitmap.close()) };
  }

  // Decoded straight at the shrunk size, which needs far less memory than the full photo.
  // The upright size comes from an <img> (reading it doesn't decode the pixels). null when
  // the phone can't do it, or the result isn't the size asked for (e.g. it rotated after
  // resizing): then the full decode is used instead.
  async function decodeSized(file, maxEdge) {
    let size;
    try {
      const { img, release } = await loadImg(file);
      size = { w: img.naturalWidth, h: img.naturalHeight };
      release();
    } catch (e) {
      return null;
    }
    const t = fit(size.w, size.h, maxEdge);
    if (t.w >= size.w) return null;                  // no shrinking needed
    let bitmap;
    try {
      bitmap = await self.createImageBitmap(file, {
        imageOrientation: "from-image", resizeWidth: t.w, resizeHeight: t.h, resizeQuality: "high",
      });
    } catch (e) {
      return null;
    }
    if (bitmap.width === t.w && bitmap.height === t.h) return bitmapPic(bitmap);
    if (bitmap.close) bitmap.close();
    return null;
  }

  // The photo as something drawable, upright: { source, width, height, release() }.
  async function decode(file, maxEdge) {
    const sized = await decodeSized(file, maxEdge);
    if (sized) return sized;
    try {
      return bitmapPic(await self.createImageBitmap(file, { imageOrientation: "from-image" }));
    } catch (e) {
      // Older phones: no createImageBitmap (or it can't read this photo). Use the <img>.
    }
    const { img, release } = await loadImg(file);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release };
  }

  // Draws `source` at most `maxEdge` on its longest side (never larger) and encodes it.
  async function encode(source, width, height, maxEdge, quality) {
    const { w, h } = fit(width, height, maxEdge);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      if (!g) throw new GalleryError("unsupported", "no canvas");
      g.imageSmoothingQuality = "high";
      g.drawImage(source, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new GalleryError("unsupported", "encode failed");
      return { blob, canvas, width: w, height: h };
    } catch (e) {
      canvas.width = 0;
      canvas.height = 0;
      throw e instanceof GalleryError ? e : new GalleryError("unsupported", String(e));
    }
  }

  function free(canvas) {
    if (!canvas) return;
    canvas.width = 0;            // hands the pixel memory back (matters on iPhones)
    canvas.height = 0;
  }

  // -> { blob, width, height } and, when previewPx is given, a small `preview` blob
  // made from the same decode.
  function toJpeg(file, { maxLongEdgePx, jpegQuality, previewPx }) {
    return oneAtATime(async () => {
      const pic = await decode(file, maxLongEdgePx);
      let big = null;
      let small = null;
      try {
        big = await encode(pic.source, pic.width, pic.height, maxLongEdgePx, jpegQuality);
        pic.release();
        const out = { blob: big.blob, width: big.width, height: big.height };
        if (previewPx) {
          small = await encode(big.canvas, big.width, big.height, previewPx, jpegQuality);
          out.preview = small.blob;
        }
        return out;
      } finally {
        pic.release();
        free(big && big.canvas);
        free(small && small.canvas);
      }
    });
  }

  // Base64 of the blob, without the "data:...;base64," prefix.
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result);
        resolve(s.slice(s.indexOf(DATA_URL_COMMA) + 1));
      };
      reader.onerror = () => reject(new GalleryError("unsupported", "cannot read"));
      reader.readAsDataURL(blob);
    });
  }

  W.image = { toJpeg, toBase64 };
})();

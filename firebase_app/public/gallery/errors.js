/* Gallery errors: one error type carrying a short code, and the guest-friendly
   sentence for each code (text comes from site-config.js). */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});

  class GalleryError extends Error {
    constructor(code, detail) {
      super(detail ? code + ": " + detail : code);
      this.name = "GalleryError";
      this.code = code;
    }
  }

  // Guests only ever see these sentences, never the code itself.
  function message(code) {
    const errors = self.SITE_CONFIG.text.gallery.errors;
    return errors[code] || errors.unavailable;
  }

  W.errors = { GalleryError, message };
})();

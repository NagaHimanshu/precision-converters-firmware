/* ==========================================================================
   SITE SETTINGS — the only file you need to edit (besides the Google Sheet).

   - Wedding content (program, rooms, venues, contacts, couple names, date)
     lives in the Google Sheet, so changing it needs NO redeploy.
   - Everything below changes rarely; after editing this file, redeploy.
   - Text values may use {placeholders}: {bride}, {groom}, {city}, {days}.
   - See docs/CONFIG.md for a description of every setting.
   ========================================================================== */

self.SITE_CONFIG = {

  /* ---------- Google Sheet (data source) ---------- */
  sheet: {
    // The long ID from the sheet URL:
    // https://docs.google.com/spreadsheets/d/<THIS PART>/edit
    id: "1MEXBdLLJq7gbCIpEdubQQ-DJOkBXsEsPMxGFsVrcEUQ",

    // How each tab is read. {id} and {tab} are filled in automatically.
    urlTemplate: "https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&headers=1&sheet={tab}",

    // Tab names exactly as they appear at the bottom of the Google Sheet.
    tabs: {
      settings: "Settings",
      program: "Program",
      accommodation: "Accommodation",
      locations: "Locations",
      contacts: "Contacts",
    },

    // Column headers (row 1) in each tab. Left side = what the site uses,
    // right side = the header text in your sheet (not case-sensitive).
    columns: {
      settings: { key: "key", value: "value" },
      program: { date: "date", time: "time", event: "event", venue: "venue", note: "note" },
      accommodation: { sno: "sno", name: "name", alias: "alias", hotel: "hotel", room: "room", note: "note" },
      locations: { name: "name", address: "address", mapLink: "map_link", note: "note" },
      contacts: { name: "name", role: "role", phone: "phone", whatsapp: "whatsapp" },
    },

    // Keys used in the Settings tab (column "key").
    settingKeys: {
      bride: "bride",
      groom: "groom",
      weddingDate: "wedding_date",
      city: "city",
      tagline: "tagline",
      galleryUploads: "gallery_uploads",   // "no" pauses guest uploads; blank = open
    },

    // Keys in the Settings tab that show or hide a section: value "yes" or "no".
    // If a key is missing or blank, the matching switch under "features" is used.
    showKeys: {
      program: "show_program",
      stay: "show_stay",
      venues: "show_venues",
      gallery: "show_gallery",
      contacts: "show_contacts",
    },

    // How dates in the sheet are written when they are not YYYY-MM-DD:
    // "DMY" = 11/12/2026 means 11 December; "MDY" = 11/12/2026 means 12 November.
    dateOrder: "DMY",
  },

  /* ---------- Images ---------- */
  images: {
    // Couple photo shown at the top of the home screen.
    // Replace the file (e.g. assets/couple.jpg) and update this path.
    hero: "assets/couple.jpg",
    appIcon: "assets/icons/icon-192.png",
  },

  /* ---------- Gallery (guest photo sharing) ---------- */
  gallery: {
    endpoint: "https://script.google.com/macros/s/AKfycbwteO3aU2rIHu0MPpr1wammPMLTrdRFmhwWbA6WhJV-RMqJmg8jjVVBkyxGJKcz6stX/exec", // Apps Script web app URL; "" = Gallery shows "coming soon"
    googleClientId: "478674070390-cfa6vf8vrtsv01egt0eusgsih8olbfe7.apps.googleusercontent.com", // Google OAuth client ID (public by design); "" = no sign-in shown
    googleScriptUrl: "https://accounts.google.com/gsi/client",  // Google sign-in script (loaded only when needed)
    maxPhotosPerUpload: 20,        // photos accepted in one go
    parallelUploads: 2,            // photos sent at the same time
    maxLongEdgePx: 2500,           // photos are shrunk so the longest side is at most this
    jpegQuality: 0.85,             // quality of the shrunk copy (0 to 1)
    maxUploadBytes: 8000000,       // largest single upload after shrinking
    requestTimeoutMs: 15000,       // give up on a normal request after this long
    uploadTimeoutMs: 90000,        // give up on one photo upload after this long
    scriptLoadTimeoutMs: 10000,    // give up loading the gallery files / Google script after this long
    retries: 2,                    // extra tries for a failed request
    retryBackoffMs: 1500,          // wait before the first retry (doubles each time)
    pageSize: 30,                  // photos fetched per page
    savedListSize: 60,             // photos kept on the phone for offline viewing
    thumbSizePx: 400,              // grid picture width
    thumbRetries: 3,               // a grid picture that didn't load is asked for again this many times (once per refresh)
    fullSizePx: 1600,              // full-screen picture width
    thumbUrl: "https://drive.google.com/thumbnail?id={id}&sz=w{size}",  // grid picture address
    fullUrl: "https://drive.google.com/thumbnail?id={id}&sz=w{size}",   // full-screen picture address
    refreshIntervalMs: 60000,      // how often new photos are looked for while the Gallery is open
    nameMaxLength: 40,             // longest name shown on a photo
    addButtonWidth: "76%",         // width of the "Add photos" button
    loadMoreAheadPx: 800,          // start fetching the next page this far before the end of the grid
    swipeMinPx: 50,                // sideways finger movement that counts as a swipe in the photo viewer
    preloadNeighbours: 1,          // photos fetched ahead on each side of the one being viewed
    previewSizePx: 320,            // small copy shown while choosing and uploading (longest side)
    progressTickMs: 500,           // how often the upload rings are redrawn
    progressEstimateMs: 8000,      // rough time to send one photo; the ring fills on this time scale
  },

  /* ---------- Locale ---------- */
  locale: "en-IN",                 // date formatting, e.g. "Friday, 11 December"
  whatsappCountryCode: "91",       // added to 10-digit phone numbers for WhatsApp/calls
  whatsappUrl: "https://wa.me/{number}",  // WhatsApp chat link; {number} = digits with country code

  /* ---------- Look & feel ---------- */
  theme: {
    colors: {
      background: "#FFF7F2",       // page background (soft blush-white)
      surface: "#FFFFFF",          // tiles and cards
      blush: "#F6DCDC",            // soft fills, borders
      rose: "#E8A0A8",             // accents, badges
      joiner: "#B5485D",           // the "weds" between the names (deep rose, readable)
      gold: "#C9A227",             // frames, lines, icons
      goldText: "#8C6A12",         // gold used for text (darker, readable)
      ink: "#3E2B30",              // main text colour
      inkSoft: "#6E5A5F",          // secondary text
    },
    fonts: {
      script: "Pinyon Script",     // couple names
      body: "Nunito Sans",         // everything else
      // Google Fonts stylesheet that loads the two fonts above.
      url: "https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700&family=Pinyon+Script&display=swap",
    },
  },

  /* ---------- Features (true = on, false = off) ---------- */
  features: {
    countdown: true,               // "X days to go" on the home screen
    nowNext: true,                 // "Happening now" / "Up next" in the program
    installHint: true,             // "Add to Home Screen" tip

    // Sections (home tile + screen). These are only the defaults: the Settings
    // tab in the Google Sheet overrides them (show_stay = yes, etc.), no redeploy.
    program: true,
    stay: false,
    venues: true,
    gallery: false,
    contacts: true,                // "Need help? Call us" strip + Contacts screen
  },

  // An event counts as "happening now" for at most this many hours
  // (or until the next event starts, whichever comes first).
  nowWindowHours: 3,

  /* ---------- All text shown on the site ---------- */
  text: {
    pageTitle: "{bride} weds {groom}",
    heroJoiner: "weds",
    heroPhotoAlt: "{bride} and {groom}",

    countdownMany: "{days} days to go",
    countdownOne: "1 day to go",
    countdownToday: "Today is the day!",
    countdownPast: "Thank you for celebrating with us",

    tiles: {
      program: "Program",
      stay: "Stay",
      venues: "Venues",
      gallery: "Gallery",
    },
    contactsStrip: "Need help? Call us",

    titles: {
      program: "Program",
      stay: "Where you're staying",
      venues: "Venues",
      gallery: "Gallery",
      contacts: "Contacts",
    },
    back: "Back",

    program: {
      happeningNow: "Happening now",
      upNext: "Up next",
      openMap: "Map",
      empty: "The program will be shared soon.",
    },

    stay: {
      searchLabel: "Find your name",
      searchPlaceholder: "Type your name",
      searchHint: "Or type what the bride calls you 😊",   // small line under the box; "" = none
      noHotel: "Other",             // heading for rows with no hotel
      room: "Room",
      resultsOne: "1 match",
      resultsMany: "{count} matches",
      noMatch: "No name matches. Try fewer letters, or ask a coordinator.",
      noMatchAction: "Call a coordinator",
      empty: "Room details will be shared soon.",
    },

    venues: {
      navigate: "Navigate",
      empty: "Venue details will be shared soon.",
    },

    gallery: {
      comingSoonTitle: "Coming soon",
      comingSoonBody: "Photos from the celebrations will appear here.",
      subtitle: "Candid moments shared by our guests · {count} photos",
      subtitleOne: "Candid moments shared by our guests · 1 photo",
      tabAll: "All photos",
      tabMine: "Photos by me",
      mineSubtitle: "Photos you've shared from this phone",
      addPhotos: "📷 Add photos",
      emptyTitle: "No photos yet",
      emptyBody: "Be the first to share a moment from the celebrations.",
      mineEmpty: "You haven't shared any photos from this phone yet.",
      errorTitle: "Just a moment",
      errorBody: "The photos aren't loading right now. Please try again in a little while.",
      offlineTitle: "You're offline",
      offlineBody: "Photos will appear when you're back online.",
      savedNotice: "Showing photos saved on this phone.",
      tryAgain: "Try again",
      pausedNote: "Photo sharing is paused for now.",                  // shown where Add photos was (keep it short)
      fullNote: "The album is full — thank you for sharing!",       // shown where Add photos was, next to fullAction (keep it short)
      fullAction: "Contact us",
      panelTitle: "Ready to share",
      panelMore: "More",
      panelRemove: "Don't share this photo",   // read aloud for the × on a chosen photo
      nameLabel: "Your name",
      nameOptional: "(optional)",
      nameHint: "Shown as \"By {name}\". We'll remember it on this phone.",
      uploadButton: "Upload",
      useGoogleName: "or use my Google name",
      tooMany: "We'll share the first {max} now — tap Add photos again for the rest.",
      uploading: "Uploading {done} of {total}… you can keep browsing",
      keepOpen: "Keep this page open until uploads finish",
      uploadFailed: "Couldn't upload — tap to try again",
      unsupported: "This photo can't be shared",
      by: "By {name}",
      today: "Today, {time}",
      yesterday: "Yesterday, {time}",
      dayTime: "{date}, {time}",    // photo time on other days, e.g. "11 December, 8:42 pm"
      loading: "Loading photos…",   // shown while the first photos are on their way
      counter: "{n} of {total}",
      heartLabel: "Like this photo",
      close: "Close",
      prev: "Previous photo",
      next: "Next photo",
      delete: "🗑 Delete",
      confirmTitle: "Remove this photo for everyone?",
      confirmRemove: "Remove",
      confirmKeep: "Keep",
      otherPhoneTitle: "Shared photos from another phone?",
      signedInAs: "Signed in as {name}",
      signedInNoName: "Signed in with Google",            // when the Google account has no name
      signOutFailed: "Couldn't sign out — please try again.",
      signOut: "Sign out",
      signInNote: "Your name will appear on photos you share.",
      signInUnavailable: "Sign-in isn't available here. You can still add photos.",
      errors: {
        offline: "You seem to be offline. Please check your internet and try again.",
        unavailable: "The gallery isn't available right now. Please try again in a little while.",
        busy: "Lots of guests are sharing right now. Please try again in a moment.",
        full: "The gallery is full, so new photos can't be added.",
        paused: "Adding photos is paused for now.",
        invalid: "This photo can't be shared. Please try a different one.",
        forbidden: "That isn't allowed from this phone.",
        too_large: "This photo is too large to share.",
        rate_limited: "That's a lot of photos at once. Please wait a moment and try again.",
        signin_failed: "Sign-in didn't work. You can still add photos without it.",
      },
    },

    contacts: {
      call: "Call",
      whatsapp: "WhatsApp",
      empty: "Contact details will be shared soon.",
    },

    install: {
      ios: "To keep this handy: tap the Share button, then \"Add to Home Screen\".",
      android: "Add this to your home screen for quick access.",
      androidButton: "Add",
      dismiss: "Close",
    },

    status: {
      loading: "Loading…",
      offline: "You're offline. Showing details saved on this phone.",
      failed: "Couldn't load the latest details. Check your internet and reopen.",
      dataUpdating: "This section is being updated. Please check back shortly.",
    },
  },
};

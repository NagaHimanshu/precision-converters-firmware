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
    // Leave empty ("") to run on the sample data in data/sample.json.
    id: "",

    // How each tab is read. {id} and {tab} are filled in automatically.
    urlTemplate: "https://docs.google.com/spreadsheets/d/1MEXBdLLJq7gbCIpEdubQQ-DJOkBXsEsPMxGFsVrcEUQ/gviz/tq?tqx=out:csv&headers=1&sheet={tab}",

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
      accommodation: { sno: "sno", name: "name", hotel: "hotel", room: "room", note: "note" },
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
    },

    // How dates in the sheet are written when they are not YYYY-MM-DD:
    // "DMY" = 11/12/2026 means 11 December; "MDY" = 11/12/2026 means 12 November.
    dateOrder: "DMY",
  },

  // Sample data used when sheet.id is empty.
  sampleDataPath: "data/sample.json",

  /* ---------- Images & links ---------- */
  images: {
    // Couple photo shown at the top of the home screen.
    // Replace the file (e.g. assets/couple.jpg) and update this path.
    hero: "assets/couple.jpg",
    appIcon: "assets/icons/icon-192.png",
  },

  links: {
    // Gallery (later): shared Google Drive folder and upload page.
    // While both are empty, the Gallery screen shows "coming soon".
    galleryAlbum: "",
    galleryUpload: "",
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
    contacts: true,                // Contacts strip on the home screen
    gallery: true,                 // Gallery tile
    installHint: true,             // "Add to Home Screen" tip
  },

  // An event counts as "happening now" for at most this many hours
  // (or until the next event starts, whichever comes first).
  nowWindowHours: 3,

  /* ---------- All text shown on the site ---------- */
  text: {
    pageTitle: "{bride} & {groom}",
    heroJoiner: "&",
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
      hotel: "Hotel",
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
      viewAlbum: "View photos",
      upload: "Upload your photos",
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

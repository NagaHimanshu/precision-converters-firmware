/* Gallery backend settings (Google Apps Script).

   Private: never copy into site-config.js. This file holds the owner's email and the
   IDs of the private Drive folder and data spreadsheet; site-config.js is downloaded by
   every guest's phone.

   The owner pastes Config.gs, Logic.gs and Code.gs (and appsscript.json) into the Apps
   Script editor of the wedding account. After changing a value here: save, then
   Deploy > Manage deployments > edit > New version, so the web app uses it.
   The hash secret is not here: setup() makes it once and keeps it in Script Properties. */

var CONFIG = {
  // Who gets the "storage nearly full" email. Never shown to guests.
  OWNER_EMAIL: "jahnavirishika6@gmail.com",
  // The public wedding Sheet (the same one the site reads); only its Settings tab is read.
  WEDDING_SHEET_ID: "1MEXBdLLJq7gbCIpEdubQQ-DJOkBXsEsPMxGFsVrcEUQ",
  // Tab in the wedding Sheet that holds key/value settings.
  SETTINGS_TAB: "Settings",
  // Settings key for the pause-uploads switch: "no" (or n/false/0/off/hide) pauses uploads.
  UPLOADS_KEY: "gallery_uploads",
  // Google sign-in OAuth client ID (the same value as gallery.googleClientId on the site).
  // Blank = Google sign-in is refused.
  GOOGLE_CLIENT_ID: "478674070390-cfa6vf8vrtsv01egt0eusgsih8olbfe7.apps.googleusercontent.com",
  // Google's address for checking a sign-in token (the token is sent in the request body).
  TOKENINFO_URL: "https://oauth2.googleapis.com/tokeninfo",
  // Name of the Drive folder setup() creates for the photos (shared: anyone with the link can view).
  FOLDER_NAME: "Wedding guest photos",
  // Name of the private spreadsheet setup() creates for photo records, hearts and devices.
  DATA_SHEET_NAME: "Wedding gallery data (private)",
  // The photos folder: paste its Drive link (https://drive.google.com/drive/folders/...) or just
  // the ID. Blank = the one setup() created.
  DRIVE_FOLDER_ID: "",
  // Private data spreadsheet ID. Blank = the one setup() created.
  DATA_SHEET_ID: "",
  // Used Drive storage (percent) at which the owner is emailed, at most once a day.
  STORAGE_WARN_PERCENT: 85,
  // Used Drive storage (percent) at which uploads stop ("album full").
  STORAGE_STOP_PERCENT: 98,
  // The "storage (nearly) full" email, sent at the warning level, at the stop level and when
  // Drive says it is full. {percent}, {used}, {limit} (GB; "?" if unknown) and {stop}
  // (percent) are filled in.
  WARN_MAIL_SUBJECT: "Wedding gallery: Google Drive is {percent}% full",
  WARN_MAIL_BODY: "The wedding account's Google Drive is {percent}% full ({used} GB of {limit} GB used).\n\n" +
    "At {stop}% adding photos to the gallery pauses by itself; viewing and hearts keep working. " +
    "To make room, empty the Drive trash or delete large files you don't need (or buy more " +
    "storage). Adding photos starts again by itself once there is room.\n\n" +
    "This email is sent at most once a day.",
  // Time zone for photo file names and for "once a day" (blank = the script's own time zone).
  TIME_ZONE: "Asia/Kolkata",
  // Largest photo accepted, in bytes (10 MB). The site resizes photos well below this.
  MAX_PHOTO_BYTES: 10485760,
  // Longest guest name kept, in characters; longer names are cut.
  NAME_MAX_LENGTH: 40,
  // Most photos returned by one list request, whatever the site asks for.
  PAGE_SIZE_MAX: 60,
  // Most uploads accepted from one phone in one hour.
  RATE_LIMIT_PER_HOUR: 100,
  // Seconds the Settings tab answer (pause switch) is remembered.
  SETTINGS_CACHE_SECONDS: 60,
  // Seconds the Drive storage check (album full / nearly full) is remembered, and how long
  // a "storage full" error from Drive keeps uploads stopped before Drive is asked again.
  STORAGE_CACHE_SECONDS: 60,
  // Seconds the photo / heart / device lists are remembered between requests.
  LIST_CACHE_SECONDS: 10,
  // Largest piece the remembered lists are cut into, in bytes (Google's limit is 100 KB).
  CACHE_CHUNK_BYTES: 90000,
  // How often photos deleted directly in Drive are removed from the gallery, in minutes.
  // Google allows only 1, 5, 10, 15 or 30; anything else means 15. Run setup() after changing.
  SYNC_MINUTES: 15,
  // Longest the sync may spend listing the photos folder, in seconds. If Drive is slower
  // than this, nothing is changed and the next run tries again (Apps Script stops any run
  // after 6 minutes).
  SYNC_MAX_SECONDS: 240,
  // How long a change (heart, upload, delete) waits for another one to finish, in ms,
  // before answering "busy" (the site then tries again a little later).
  LOCK_WAIT_MS: 10000,
};

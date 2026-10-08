/**
 * config.js — অ্যাপ কনফিগারেশন
 * TE & NTE Enterprise
 *
 * ── Google Sheet (Apps Script) চালু করতে ─────────────────────────────
 *  1) Apps Script এডিটরে Code.gs বসিয়ে Deploy → Web app (Anyone) করুন
 *  2) নিচের APPS_SCRIPT_URL এ সেই /exec URL বসান
 *  3) API_TOKEN এ Code.gs এর CONFIG.API_TOKEN এর হুবহু একই টোকেন বসান
 *
 *  APPS_SCRIPT_URL খালি ('') থাকলে অ্যাপ আগের মতোই চলে — সব ডেটা শুধু
 *  এই ব্রাউজারে (localStorage) থাকে।
 */
const APP_CONFIG = {
  /** উদাহরণ: 'https://script.google.com/macros/s/AKfycbz_TVyF8qUuk0h3PUOlZvmgKUmzntdoL1UjhsNDooBmwzarY5wrMrmVQo9_pwRMbEeM/exec' */
  APPS_SCRIPT_URL: '',

  /** Code.gs এর CONFIG.API_TOKEN এর সাথে মিলতে হবে */
  API_TOKEN: 'MSTE-17238487c260a9f644',

  /**
   * পেজ লোড হওয়ার সময় Sheet থেকে ডেটা নামানোর সর্বোচ্চ অপেক্ষা (মিলিসেকেন্ড)।
   * নেট ধীর হলে বাড়িয়ে দিন।
   */
  BOOT_TIMEOUT_MS: 45000,

  /** একসাথে কতগুলো লেখা জমে গেলে এক রিকোয়েস্টে পাঠানো হবে */
  PUSH_DEBOUNCE_MS: 600,

  /** স্ক্রিনের নিচে ডানদিকে sync স্ট্যাটাস দেখাবে কি না */
  SHOW_SYNC_BADGE: true,

  /** Cloud মোডে অ্যাপের নাম (sync ব্যাজে দেখায়) */
  APP_NAME: 'TE & NTE',
};

if (typeof window !== 'undefined') window.APP_CONFIG = APP_CONFIG;
if (typeof module !== 'undefined') module.exports = { APP_CONFIG };

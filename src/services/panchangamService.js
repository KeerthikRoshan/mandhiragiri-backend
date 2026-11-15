/**
 * Daily Panchangam Service - Mandhiragiri Jothidam
 * Provider: OneBhakthi API (https://www.onebhakthi.org)
 * Calculation System: DRIK_LAHIRI (Lahiri Ayanamsha / Drik Astronomical Calculation)
 * Location: Tiruppur, Tamil Nadu (Fixed Coordinates)
 * Timezone: Asia/Kolkata (Fixed)
 * Language: Tamil First (ta)
 * Storage: MySQL daily_panchangam temporary cache table with auto-expiry
 */

const { pool } = require('../config/database');

const TIRUPPUR_CONFIG = {
  regionCode: 'TIRUPPUR',
  nameTamil: 'திருப்பூர்',
  nameEnglish: 'Tiruppur',
  latitude: 11.1085,
  longitude: 77.3411,
  timezone: 'Asia/Kolkata'
};

const DEFAULT_BASE_URL = 'https://www.onebhakthi.org';
const DEFAULT_TIMEOUT_MS = 15000;
const CALCULATION_SYSTEM = 'DRIK_LAHIRI';
const PROVIDER_NAME = 'ONEBHAKTHI';

/**
 * Returns today's calendar date in Asia/Kolkata timezone (YYYY-MM-DD)
 * @param {Date} [d=new Date()]
 * @returns {string} YYYY-MM-DD
 */
const getTodayIndiaDate = (d = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
};

/**
 * Returns the next midnight timestamp for India timezone in YYYY-MM-DD HH:mm:ss format
 * @param {string} dateKey YYYY-MM-DD
 * @returns {string} MySQL datetime string
 */
const getNextMidnightIndiaDate = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  // Subtract 5 hours 30 mins to convert 00:00:00 IST to UTC for storage
  nextDay.setUTCHours(nextDay.getUTCHours() - 5, nextDay.getUTCMinutes() - 30);
  return nextDay.toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * Converts a 24-hr or ISO time string to readable 12-hour format with Tamil period prefix (காலை / மதியம் / மாலை / இரவு)
 * @param {string} value
 * @param {string} [timezone='Asia/Kolkata']
 * @returns {string|null}
 */
const formatTamilTime = (value, timezone = 'Asia/Kolkata') => {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  // Already formatted with Tamil
  if (str.includes('காலை') || str.includes('மாலை') || str.includes('மதியம்') || str.includes('இரவு')) {
    return str;
  }

  let dateObj = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    dateObj = new Date(str);
  } else if (/^\d{1,2}:\d{2}/.test(str)) {
    const today = getTodayIndiaDate();
    dateObj = new Date(`${today}T${str.length === 5 ? str + ':00' : str}`);
  }

  if (dateObj && !Number.isNaN(dateObj.getTime())) {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23'
      }).format(dateObj)
    );
    const time12 = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
      .format(dateObj)
      .replace(/\s*(AM|PM)/i, '');

    let prefix = 'காலை';
    if (hour >= 12 && hour < 16) {
      prefix = 'மதியம்';
    } else if (hour >= 16 && hour < 20) {
      prefix = 'மாலை';
    } else if (hour >= 20 || hour < 4) {
      prefix = 'இரவு';
    }

    return `${prefix} ${time12}`;
  }

  return str;
};

/**
 * Formats a time range { start, end } into Tamil readable range
 * @param {{ start?: string, end?: string }|string} period
 * @param {string} [timezone='Asia/Kolkata']
 * @returns {string|null}
 */
const formatTamilPeriodRange = (period, timezone = 'Asia/Kolkata') => {
  if (!period) return null;
  if (typeof period === 'string') return formatTamilTime(period, timezone);
  const start = formatTamilTime(period.start, timezone);
  const end = formatTamilTime(period.end, timezone);
  if (start && end) {
    // If both have same prefix (e.g. 'காலை 07:30' - 'காலை 09:00'), keep clean
    return `${start} – ${end}`;
  }
  return start || end || null;
};

/**
 * Computes validated Tamil Solar Month and Date for a Gregorian date
 * @param {string} dateKey YYYY-MM-DD
 * @returns {{ tamilMonth: string, tamilDate: number, tamilYear: string, tamilWeekday: string }}
 */
const getTamilSolarDateInfo = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const TAMIL_MONTHS = [
    'தை', 'மாசி', 'பங்குனி', 'சித்திரை', 'வைகாசி', 'ஆனி',
    'ஆடி', 'ஆவணி', 'புரட்டாசி', 'ஐப்பசி', 'கார்த்திகை', 'மார்கழி'
  ];
  const SOLAR_TRANSIT_DAYS = [14, 13, 14, 14, 15, 15, 16, 17, 17, 17, 16, 16];

  const gMonth = dateObj.getUTCMonth(); // 0 to 11
  const gDate = dateObj.getUTCDate();
  const transitDay = SOLAR_TRANSIT_DAYS[gMonth];

  let tMonthIndex = 0;
  let tDay = 1;

  if (gDate >= transitDay) {
    tMonthIndex = gMonth;
    tDay = gDate - transitDay + 1;
  } else {
    tMonthIndex = (gMonth + 11) % 12;
    const prevMonthDays = new Date(Date.UTC(year, gMonth, 0)).getUTCDate();
    const prevTransit = SOLAR_TRANSIT_DAYS[tMonthIndex];
    tDay = prevMonthDays - prevTransit + gDate + 1;
  }

  const TAMIL_WEEKDAYS = ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'];
  const weekday = TAMIL_WEEKDAYS[dateObj.getUTCDay()];

  return {
    tamilMonth: TAMIL_MONTHS[tMonthIndex],
    tamilDate: tDay,
    tamilWeekday: weekday
  };
};

/**
 * Cleans up expired daily panchangam records from MySQL
 * Deletes records whose date is earlier than today's India date
 * @param {string} todayDate YYYY-MM-DD
 * @returns {Promise<number>} number of deleted rows
 */
const cleanExpiredDailyPanchangam = async (todayDate = getTodayIndiaDate()) => {
  try {
    const [result] = await pool.query(
      `DELETE FROM daily_panchangam WHERE panchangam_date < ?;`,
      [todayDate]
    );
    const affected = result?.affectedRows || 0;
    if (affected > 0) {
      console.log(`[PanchangamService] Cleaned up ${affected} expired panchangam records before ${todayDate}.`);
    }
    return affected;
  } catch (err) {
    console.warn('[PanchangamService Warning] Failed to clean expired panchangam records:', err.message);
    return 0;
  }
};

/**
 * Retrieves cached daily Panchangam for Tiruppur and given date
 * @param {string} dateKey YYYY-MM-DD
 * @param {string} [regionCode='TIRUPPUR']
 * @returns {Promise<Object|null>}
 */
const getCachedDailyPanchangam = async (dateKey, regionCode = TIRUPPUR_CONFIG.regionCode) => {
  try {
    const [rows] = await pool.query(
      `SELECT panchangam_json, fetched_at, expires_at 
       FROM daily_panchangam 
       WHERE region_code = ? AND panchangam_date = ? 
       LIMIT 1;`,
      [regionCode, dateKey]
    );

    if (rows && rows.length > 0) {
      const rawJson = rows[0].panchangam_json;
      const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      return data;
    }
    return null;
  } catch (err) {
    console.warn('[PanchangamService Warning] Cache lookup failed:', err.message);
    return null;
  }
};

/**
 * Saves daily Panchangam to MySQL cache table
 * @param {string} dateKey YYYY-MM-DD
 * @param {Object} data
 * @param {string} [regionCode='TIRUPPUR']
 * @returns {Promise<void>}
 */
const saveCachedDailyPanchangam = async (dateKey, data, regionCode = TIRUPPUR_CONFIG.regionCode) => {
  try {
    const expiresAt = getNextMidnightIndiaDate(dateKey);
    const jsonStr = JSON.stringify(data);

    await pool.query(
      `INSERT INTO daily_panchangam (
         region_code, panchangam_date, provider_name, calculation_system,
         panchangam_json, fetched_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         panchangam_json = VALUES(panchangam_json),
         expires_at = VALUES(expires_at),
         updated_at = NOW();`,
      [regionCode, dateKey, PROVIDER_NAME, CALCULATION_SYSTEM, jsonStr, expiresAt]
    );
  } catch (err) {
    console.warn('[PanchangamService Warning] Failed to save panchangam to cache:', err.message);
  }
};

/**
 * Normalizes OneBhakthi raw API item into the standard Mandhiragiri daily Panchangam structure
 * @param {Object} item Raw OneBhakthi record
 * @param {string} todayDate YYYY-MM-DD
 * @returns {Object} Normalized Panchangam data
 */
const normalizeOneBhakthiResponse = (item, todayDate) => {
  const solar = getTamilSolarDateInfo(todayDate);

  const tithiRaw = item?.tithi || {};
  const nakshatraRaw = item?.nakshatra || {};
  const yogaRaw = item?.yoga || {};
  const karanaRaw = item?.karana || {};
  const periods = item?.periods || {};

  // Times
  const sunrise = formatTamilTime(item?.sunrise, TIRUPPUR_CONFIG.timezone);
  const sunset = formatTamilTime(item?.sunset, TIRUPPUR_CONFIG.timezone);

  // Tithi
  const tithiName = tithiRaw.name || tithiRaw.title || tithiRaw.titleTamil || null;
  const tithiStart = formatTamilTime(tithiRaw.start, TIRUPPUR_CONFIG.timezone);
  const tithiEnd = formatTamilTime(tithiRaw.end, TIRUPPUR_CONFIG.timezone);
  const tithiSummary = tithiName ? (tithiEnd ? `${tithiName} (${tithiEnd} வரை)` : tithiName) : null;

  // Nakshatra
  const nakshatraName = nakshatraRaw.name || nakshatraRaw.title || nakshatraRaw.titleTamil || null;
  const nakshatraStart = formatTamilTime(nakshatraRaw.start, TIRUPPUR_CONFIG.timezone);
  const nakshatraEnd = formatTamilTime(nakshatraRaw.end, TIRUPPUR_CONFIG.timezone);
  const nakshatraSummary = nakshatraName ? (nakshatraEnd ? `${nakshatraName} (${nakshatraEnd} வரை)` : nakshatraName) : null;

  // Yoga & Karana
  const yogaName = yogaRaw.name || yogaRaw.title || null;
  const yogaStart = formatTamilTime(yogaRaw.start, TIRUPPUR_CONFIG.timezone);
  const yogaEnd = formatTamilTime(yogaRaw.end, TIRUPPUR_CONFIG.timezone);

  const karanaName = karanaRaw.name || karanaRaw.title || null;
  const karanaStart = formatTamilTime(karanaRaw.start, TIRUPPUR_CONFIG.timezone);
  const karanaEnd = formatTamilTime(karanaRaw.end, TIRUPPUR_CONFIG.timezone);

  // Inauspicious & Auspicious Periods
  const rahuKalam = formatTamilPeriodRange(periods.rahu_kalam || periods.rahuKalam, TIRUPPUR_CONFIG.timezone);
  const yamagandam = formatTamilPeriodRange(periods.yamagandam, TIRUPPUR_CONFIG.timezone);
  const kuligai = formatTamilPeriodRange(periods.gulikai || periods.kuligai, TIRUPPUR_CONFIG.timezone);

  // Nalla Neram
  let nallaNeram = [];
  if (Array.isArray(periods.nalla_neram || periods.nallaNeram || periods.auspicious_timings)) {
    const list = periods.nalla_neram || periods.nallaNeram || periods.auspicious_timings;
    nallaNeram = list.map((p) => formatTamilPeriodRange(p, TIRUPPUR_CONFIG.timezone)).filter(Boolean);
  } else if (periods.nalla_neram || periods.nallaNeram) {
    const formatted = formatTamilPeriodRange(periods.nalla_neram || periods.nallaNeram, TIRUPPUR_CONFIG.timezone);
    if (formatted) nallaNeram.push(formatted);
  }

  // Gowri Panchangam
  const gowri = item?.gowri || periods.gowri || null;

  // Tamil month / date priority: provider > validated solar calculation
  const tamilMonth = item?.tamil_month || item?.tamilMonth || solar.tamilMonth;
  const tamilDate = item?.tamil_date || item?.tamilDate || solar.tamilDate;

  return {
    date: todayDate,
    location: TIRUPPUR_CONFIG.nameTamil,
    locationEnglish: TIRUPPUR_CONFIG.nameEnglish,
    provider: PROVIDER_NAME,
    calculationSystem: CALCULATION_SYSTEM,
    language: 'ta',
    tamilMonth,
    tamilDate,
    tamilWeekday: solar.tamilWeekday,
    sunrise,
    sunset,
    tithi: {
      name: tithiName,
      start: tithiStart,
      end: tithiEnd,
      summary: tithiSummary
    },
    nakshatra: {
      name: nakshatraName,
      start: nakshatraStart,
      end: nakshatraEnd,
      summary: nakshatraSummary
    },
    yoga: {
      name: yogaName,
      start: yogaStart,
      end: yogaEnd
    },
    karana: {
      name: karanaName,
      start: karanaStart,
      end: karanaEnd
    },
    rahuKalam,
    yamagandam,
    kuligai,
    nallaNeram,
    gowri
  };
};

/**
 * Fetches exactly 1 day Panchangam from OneBhakthi API
 * @param {string} todayDate YYYY-MM-DD
 * @param {Function} [fetchImpl=globalThis.fetch]
 * @param {string} [apiKeyOverride=null]
 * @returns {Promise<Object>}
 */
const fetchOneBhakthiDaily = async (todayDate, fetchImpl = globalThis.fetch, apiKeyOverride = null) => {
  const apiKey = apiKeyOverride || process.env.ONEBHAKTHI_API_KEY;
  if (!apiKey) {
    const error = new Error('ONEBHAKTHI_API_KEY is not configured in backend environment.');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  const baseUrl = process.env.ONEBHAKTHI_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = parseInt(process.env.ONEBHAKTHI_TIMEOUT, 10) || DEFAULT_TIMEOUT_MS;

  const url = new URL('/api/v1/astrology/panchang', baseUrl);
  url.search = new URLSearchParams({
    lat: String(TIRUPPUR_CONFIG.latitude),
    lon: String(TIRUPPUR_CONFIG.longitude),
    date: todayDate,
    days: '1',
    lang: 'ta',
    timezone: TIRUPPUR_CONFIG.timezone
  }).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const error = new Error(`OneBhakthi network error: ${err.message}`);
    error.code = 'NETWORK_ERROR';
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorBody = {};
    try {
      errorBody = await response.json();
    } catch (_) {}
    const error = new Error(
      errorBody?.error?.message || `OneBhakthi API returned HTTP ${response.status}`
    );
    error.code = errorBody?.error?.code || `HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
    ? payload.items
    : [payload];

  if (items.length === 0 || !items[0]) {
    throw new Error('OneBhakthi returned an empty Panchangam response.');
  }

  return normalizeOneBhakthiResponse(items[0], todayDate);
};

/**
 * Main Daily Panchangam retrieval handler
 * 1. Automatically calculates today's date in Asia/Kolkata
 * 2. Runs lightweight cleanup for expired dates
 * 3. Checks MySQL daily_panchangam cache
 * 4. Calls OneBhakthi if not cached
 * 5. Saves valid response to MySQL
 * 6. Returns normalized Daily Panchangam
 *
 * @param {Object} [options={}]
 * @param {Function} [options.fetchImpl] For testing
 * @returns {Promise<Object>}
 */
const getDailyPanchangam = async (options = {}) => {
  const todayDate = getTodayIndiaDate();

  // 1. Automatic cleanup of expired dates in India timezone
  await cleanExpiredDailyPanchangam(todayDate);

  // 2. Cache lookup
  const cached = await getCachedDailyPanchangam(todayDate);
  if (cached && cached.date === todayDate) {
    return {
      ...cached,
      _fromCache: true
    };
  }

  // 3. Provider Fetch
  try {
    const freshData = await fetchOneBhakthiDaily(todayDate, options.fetchImpl, options.apiKey);
    // 4. Save to MySQL
    await saveCachedDailyPanchangam(todayDate, freshData);
    return {
      ...freshData,
      _fromCache: false
    };
  } catch (err) {
    console.error(`[PanchangamService Error] Failed to fetch OneBhakthi Panchangam for ${todayDate}:`, err.message);

    // If cache has a valid record for today (e.g. from earlier), return it
    if (cached) {
      return {
        ...cached,
        _fromCache: true
      };
    }

    // Do not fabricate data. Re-throw clean ApiError
    const error = new Error('இன்றைய பஞ்சாங்கத் தகவல்களைப் பெற முடியவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.');
    error.statusCode = 503;
    error.code = err.code || 'PROVIDER_UNAVAILABLE';
    error.originalError = err.message;
    throw error;
  }
};

module.exports = {
  TIRUPPUR_CONFIG,
  CALCULATION_SYSTEM,
  PROVIDER_NAME,
  getTodayIndiaDate,
  getNextMidnightIndiaDate,
  formatTamilTime,
  formatTamilPeriodRange,
  getTamilSolarDateInfo,
  cleanExpiredDailyPanchangam,
  getCachedDailyPanchangam,
  saveCachedDailyPanchangam,
  normalizeOneBhakthiResponse,
  fetchOneBhakthiDaily,
  getDailyPanchangam
};

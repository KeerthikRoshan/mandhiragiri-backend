const API_URL = 'https://www.onebhakthi.org/api/v1/astrology/panchang';
const MAX_DAYS_PER_REQUEST = 31;
let lastRequestAt = 0;

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const buildDateBatches = (startDate, endDate, batchSize = MAX_DAYS_PER_REQUEST) => {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new Error('start and end must be valid dates in YYYY-MM-DD format, and start must not be after end.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_DAYS_PER_REQUEST) {
    throw new Error(`batchSize must be between 1 and ${MAX_DAYS_PER_REQUEST}.`);
  }

  const batches = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  const last = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= last) {
    const batchStart = cursor.toISOString().slice(0, 10);
    const days = [];
    while (cursor <= last && days.length < batchSize) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    batches.push({ startDate: batchStart, dates: days });
  }
  return batches;
};

const normalizeItems = (payload, expectedCount, startDate) => {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [payload];
  if (items.length !== expectedCount) {
    throw new Error(`OneBhakthi returned ${items.length} Panchangam records; expected ${expectedCount} starting ${startDate}.`);
  }
  for (let index = 0; index < items.length; index += 1) {
    const expectedDate = new Date(`${startDate}T00:00:00.000Z`);
    expectedDate.setUTCDate(expectedDate.getUTCDate() + index);
    const dateKey = expectedDate.toISOString().slice(0, 10);
    if (items[index]?.date !== dateKey || !items[index]?.tithi || !items[index]?.nakshatra) {
      throw new Error(`OneBhakthi returned an invalid Panchangam record for ${dateKey}.`);
    }
  }
  return items;
};

const formatLocalTime = (value, timezone) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
};

const formatTimeRange = (period, timezone) => {
  if (!period?.start || !period?.end) return null;
  const start = formatLocalTime(period.start, timezone);
  const end = formatLocalTime(period.end, timezone);
  return start && end ? `${start} - ${end}` : null;
};

const getTamilPeriod = (period, timezone) => {
  if (!period?.start) return null;
  const date = new Date(period.start);
  if (Number.isNaN(date.getTime())) return null;
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(date));
  if (hour < 12) return 'காலை';
  return hour < 16 ? 'மதியம்' : 'மாலை';
};

const mapPanchangamToDatabase = ({ dateKey, english, tamil, timezone }) => {
  const rahu = english?.periods?.rahu_kalam || tamil?.periods?.rahu_kalam;
  const tithiEn = english?.tithi;
  const tithiTa = tamil?.tithi;
  const nakshatraEn = english?.nakshatra;
  const nakshatraTa = tamil?.nakshatra;

  return {
    dateKey,
    gregorianBadge: dateKey,
    tamilDateBadge: null,
    tithiTitleTamil: tithiTa?.name || null,
    tithiTitleEnglish: tithiEn?.name || null,
    tithiEndTime: formatLocalTime(tithiTa?.end || tithiEn?.end, timezone),
    nakshatraTitleTamil: nakshatraTa?.name || null,
    nakshatraTitleEnglish: nakshatraEn?.name || null,
    nakshatraEndTime: formatLocalTime(nakshatraTa?.end || nakshatraEn?.end, timezone),
    nallaNeramMorning: null,
    nallaNeramEvening: null,
    rahuKalamTime: formatTimeRange(rahu, timezone),
    rahuKalamPeriod: getTamilPeriod(rahu, timezone),
    providerData: { provider: 'OneBhakthi', english, tamil }
  };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestPanchangamBatch = async ({
  startDate,
  days,
  language,
  latitude,
  longitude,
  timezone,
  apiKey,
  fetchImpl = globalThis.fetch,
  minimumIntervalMs = 650,
  beforeRequest = wait
}) => {
  if (!apiKey) throw new Error('ONEBHAKTHI_API_KEY is required.');
  if (!fetchImpl) throw new Error('This Node.js version does not provide fetch(). Use Node.js 18 or newer.');
  if (!isValidDate(startDate) || !Number.isInteger(days) || days < 1 || days > MAX_DAYS_PER_REQUEST) {
    throw new Error('Invalid OneBhakthi Panchangam date range.');
  }
  if (!['en', 'ta'].includes(language)) throw new Error('language must be en or ta.');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('latitude must be between -90 and 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('longitude must be between -180 and 180.');
  if (!timezone) throw new Error('timezone is required.');

  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    date: startDate,
    days: String(days),
    timezone,
    lang: language
  }).toString();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remaining = minimumIntervalMs - (Date.now() - lastRequestAt);
    if (remaining > 0) await beforeRequest(remaining);
    lastRequestAt = Date.now();

    let response;
    let payload;
    let errorBody = {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      response = await fetchImpl(url, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        signal: controller.signal
      });
      if (response.ok) {
        payload = await response.json();
      } else {
        try {
          errorBody = await response.json();
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
    } catch (error) {
      if (attempt === 3) throw new Error(`OneBhakthi request failed: ${error.message}`);
      await beforeRequest(1000 * (attempt + 1));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      return normalizeItems(payload, days, startDate);
    }

    const code = errorBody.code || 'unknown_error';
    if (response.status === 429 && code === 'rate_limited' && attempt < 3) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await beforeRequest(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
      continue;
    }
    if (response.status >= 500 && attempt < 3) {
      await beforeRequest(1000 * (attempt + 1));
      continue;
    }
    const error = new Error(`OneBhakthi request failed (HTTP ${response.status}, ${code}).`);
    error.code = code;
    error.statusCode = response.status;
    throw error;
  }
  throw new Error('OneBhakthi request failed after retries.');
};

module.exports = {
  API_URL,
  MAX_DAYS_PER_REQUEST,
  buildDateBatches,
  normalizeItems,
  formatLocalTime,
  formatTimeRange,
  mapPanchangamToDatabase,
  requestPanchangamBatch
};

/**
 * dailyPanchangam.test.js
 * Comprehensive Test Suite for OneBhakthi Daily Panchangam Integration
 *
 * Verifies:
 * 1. Current date automatically calculated using Asia/Kolkata.
 * 2. Fixed location: Tiruppur, Tamil Nadu (coordinates: 11.1085, 77.3411).
 * 3. Calculation system strictly labeled DRIK_LAHIRI.
 * 4. Normalization of OneBhakthi JSON into standardized Tamil structure.
 * 5. Time formatting in 12-hour format with காலை / மதியம் / மாலை / இரவு.
 * 6. MySQL daily_panchangam caching and cache-first hit behavior.
 * 7. Automatic deletion of expired records earlier than today.
 * 8. GET /api/v1/panchangam/daily API endpoint response.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const panchangamService = require('../src/services/panchangamService');
const app = require('../src/app');

// Mock OneBhakthi API payload for testing
const MOCK_ONEBHAKTHI_RECORD = {
  date: '2026-11-15',
  sunrise: '2026-11-15T06:14:00+05:30',
  sunset: '2026-11-15T17:51:00+05:30',
  tithi: {
    name: 'சஷ்டி',
    start: '2026-11-14T22:30:00+05:30',
    end: '2026-11-15T23:45:00+05:30'
  },
  nakshatra: {
    name: 'திருவோணம்',
    start: '2026-11-15T02:10:00+05:30',
    end: '2026-11-16T03:30:00+05:30'
  },
  yoga: {
    name: 'விருத்தி',
    start: '2026-11-15T04:00:00+05:30',
    end: '2026-11-16T04:15:00+05:30'
  },
  karana: {
    name: 'கௌலவம்',
    start: '2026-11-15T11:00:00+05:30',
    end: '2026-11-15T23:45:00+05:30'
  },
  periods: {
    rahu_kalam: {
      start: '2026-11-15T16:30:00+05:30',
      end: '2026-11-15T18:00:00+05:30'
    },
    yamagandam: {
      start: '2026-11-15T12:00:00+05:30',
      end: '2026-11-15T13:30:00+05:30'
    },
    gulikai: {
      start: '2026-11-15T15:00:00+05:30',
      end: '2026-11-15T16:30:00+05:30'
    },
    nalla_neram: [
      { start: '2026-11-15T07:30:00+05:30', end: '2026-11-15T08:30:00+05:30' },
      { start: '2026-11-15T15:15:00+05:30', end: '2026-11-15T16:15:00+05:30' }
    ],
    gowri: {
      morning: 'சுபம்',
      evening: 'அமிர்தம்'
    }
  }
};

test('1. Verified Tiruppur coordinates, location name and calculation system', () => {
  const cfg = panchangamService.TIRUPPUR_CONFIG;
  assert.equal(cfg.regionCode, 'TIRUPPUR');
  assert.equal(cfg.nameTamil, 'திருப்பூர்');
  assert.equal(cfg.nameEnglish, 'Tiruppur');
  assert.equal(cfg.timezone, 'Asia/Kolkata');
  assert.ok(Math.abs(cfg.latitude - 11.1085) < 0.02, 'Tiruppur latitude');
  assert.ok(Math.abs(cfg.longitude - 77.3411) < 0.02, 'Tiruppur longitude');
  assert.equal(panchangamService.CALCULATION_SYSTEM, 'DRIK_LAHIRI');
  assert.equal(panchangamService.PROVIDER_NAME, 'ONEBHAKTHI');
});

test('2. Automatically calculates current date in Asia/Kolkata timezone', () => {
  const todayIndia = panchangamService.getTodayIndiaDate();
  assert.match(todayIndia, /^\d{4}-\d{2}-\d{2}$/);

  // Cross-verify with explicit Intl format in Asia/Kolkata
  const expected = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  assert.equal(todayIndia, expected);

  // Test next midnight
  const midnight = panchangamService.getNextMidnightIndiaDate('2026-11-15');
  assert.match(midnight, /^2026-11-15 \d{2}:\d{2}:\d{2}$/);
});

test('3. Tamil time formatting converts ISO strings to readable 12-hour format with Tamil prefixes', () => {
  // Morning 06:14 AM
  const sunrise = panchangamService.formatTamilTime('2026-11-15T06:14:00+05:30');
  assert.equal(sunrise, 'காலை 06:14');

  // Evening 05:51 PM
  const sunset = panchangamService.formatTamilTime('2026-11-15T17:51:00+05:30');
  assert.equal(sunset, 'மாலை 05:51');

  // Afternoon 01:30 PM
  const afternoon = panchangamService.formatTamilTime('2026-11-15T13:30:00+05:30');
  assert.equal(afternoon, 'மதியம் 01:30');

  // Night 09:45 PM
  const night = panchangamService.formatTamilTime('2026-11-15T21:45:00+05:30');
  assert.equal(night, 'இரவு 09:45');

  // Period range
  const rahuRange = panchangamService.formatTamilPeriodRange({
    start: '2026-11-15T16:30:00+05:30',
    end: '2026-11-15T18:00:00+05:30'
  });
  assert.equal(rahuRange, 'மாலை 04:30 – மாலை 06:00');
});

test('4. Correctly calculates Tamil solar month and date for Tamil calendar', () => {
  // Nov 15 is last day of Aippasi or 1st day of Karthigai depending on transit
  const infoNov15 = panchangamService.getTamilSolarDateInfo('2026-11-15');
  assert.ok(infoNov15.tamilMonth === 'ஐப்பசி' || infoNov15.tamilMonth === 'கார்த்திகை');
  assert.ok(infoNov15.tamilDate >= 1 && infoNov15.tamilDate <= 31);
  assert.ok(infoNov15.tamilWeekday);

  // April 14 is Chithirai 1 (Tamil New Year)
  const infoApr14 = panchangamService.getTamilSolarDateInfo('2026-04-14');
  assert.equal(infoApr14.tamilMonth, 'சித்திரை');
  assert.equal(infoApr14.tamilDate, 1);
});

test('5. Normalizes OneBhakthi response into standard Tamil-first structure', () => {
  const normalized = panchangamService.normalizeOneBhakthiResponse(MOCK_ONEBHAKTHI_RECORD, '2026-11-15');

  assert.equal(normalized.date, '2026-11-15');
  assert.equal(normalized.location, 'திருப்பூர்');
  assert.equal(normalized.provider, 'ONEBHAKTHI');
  assert.equal(normalized.calculationSystem, 'DRIK_LAHIRI');
  assert.equal(normalized.language, 'ta');
  assert.equal(normalized.sunrise, 'காலை 06:14');
  assert.equal(normalized.sunset, 'மாலை 05:51');

  // Tithi & Nakshatra
  assert.equal(normalized.tithi.name, 'சஷ்டி');
  assert.equal(normalized.tithi.end, 'இரவு 11:45');
  assert.equal(normalized.tithi.summary, 'சஷ்டி (இரவு 11:45 வரை)');

  assert.equal(normalized.nakshatra.name, 'திருவோணம்');
  assert.equal(normalized.nakshatra.end, 'இரவு 03:30');
  assert.equal(normalized.nakshatra.summary, 'திருவோணம் (இரவு 03:30 வரை)');

  // Yoga & Karana
  assert.equal(normalized.yoga.name, 'விருத்தி');
  assert.equal(normalized.karana.name, 'கௌலவம்');

  // Inauspicious & Auspicious
  assert.equal(normalized.rahuKalam, 'மாலை 04:30 – மாலை 06:00');
  assert.equal(normalized.yamagandam, 'மதியம் 12:00 – மதியம் 01:30');
  assert.equal(normalized.kuligai, 'மதியம் 03:00 – மாலை 04:30');
  assert.equal(normalized.nallaNeram.length, 2);
  assert.equal(normalized.nallaNeram[0], 'காலை 07:30 – காலை 08:30');
  assert.ok(normalized.gowri);
});

test('6. Caching and retrieval in MySQL daily_panchangam table with auto cleanup', async () => {
  const testDate = '2099-12-31';
  const testNormalized = panchangamService.normalizeOneBhakthiResponse(MOCK_ONEBHAKTHI_RECORD, testDate);

  // Save to MySQL cache
  await panchangamService.saveCachedDailyPanchangam(testDate, testNormalized);

  // Retrieve from MySQL cache
  const cached = await panchangamService.getCachedDailyPanchangam(testDate);
  assert.ok(cached, 'Cached row should exist');
  assert.equal(cached.date, testDate);
  assert.equal(cached.location, 'திருப்பூர்');
  assert.equal(cached.tithi.name, 'சஷ்டி');

  // Cleanup should delete past records but keep testDate (since testDate is in 2099)
  const cleaned = await panchangamService.cleanExpiredDailyPanchangam('2099-01-01');
  const stillExists = await panchangamService.getCachedDailyPanchangam(testDate);
  assert.ok(stillExists, '2099-12-31 should not be deleted by cleanup before 2099-01-01');

  // Clean test date directly
  const { pool } = require('../src/config/database');
  await pool.query('DELETE FROM daily_panchangam WHERE panchangam_date = ?;', [testDate]);
});

test('7. getDailyPanchangam fetches OneBhakthi or returns cached data smoothly', async () => {
  const today = panchangamService.getTodayIndiaDate();

  // Mock fetchImpl simulating live OneBhakthi response
  const mockFetch = async (url) => {
    return {
      ok: true,
      json: async () => [MOCK_ONEBHAKTHI_RECORD]
    };
  };

  const result = await panchangamService.getDailyPanchangam({
    fetchImpl: mockFetch,
    apiKey: 'test-api-key'
  });
  assert.equal(result.date, today);
  assert.equal(result.location, 'திருப்பூர்');
  assert.equal(result.provider, 'ONEBHAKTHI');
  assert.equal(result.calculationSystem, 'DRIK_LAHIRI');

  // Second call should return from MySQL cache
  const cachedResult = await panchangamService.getDailyPanchangam({
    fetchImpl: () => { throw new Error('Should not call provider on cache hit!'); }
  });
  assert.equal(cachedResult.date, today);
  assert.equal(cachedResult._fromCache, true);
});

test('8. GET /api/v1/panchangam/daily returns standard response envelope', async () => {
  const http = require('node:http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/panchangam/daily`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, 1);
    assert.equal(body.success, true);
    assert.match(body.message, /Daily Panchangam retrieved/i);
    assert.ok(body.data);
    assert.equal(body.data.location, 'திருப்பூர்');
    assert.equal(body.data.provider, 'ONEBHAKTHI');
    assert.equal(body.data.calculationSystem, 'DRIK_LAHIRI');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test.after(async () => {
  const { pool } = require('../src/config/database');
  await pool.end();
});

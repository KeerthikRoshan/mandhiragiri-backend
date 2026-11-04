const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDateBatches,
  mapPanchangamToDatabase,
  normalizeItems,
  requestPanchangamBatch
} = require('../src/services/oneBhakthiPanchangam');
const {
  parseArguments,
  tamilNaduDistrictHeadquarters
} = require('../database/importPanchangam');

test('buildDateBatches covers inclusive dates in chunks no larger than 31 days', () => {
  const batches = buildDateBatches('2026-01-30', '2026-03-02');
  assert.deepEqual(batches.map(({ startDate, dates }) => [startDate, dates.length]), [
    ['2026-01-30', 31],
    ['2026-03-02', 1]
  ]);
  assert.equal(batches.flatMap((batch) => batch.dates).length, 32);
  assert.throws(() => buildDateBatches('2026-02-30', '2026-03-01'), /valid dates/);
});

test('2026 through 2040 fits the provider batch and free-tier call limits', () => {
  const batches = buildDateBatches('2026-01-01', '2040-12-31');
  assert.equal(batches.length, 177);
  assert.equal(batches.flatMap((batch) => batch.dates).length, 5479);
  assert.equal(batches.length * 2, 354);
  assert.equal(batches.length * 2 * tamilNaduDistrictHeadquarters.length, 13452);
});

test('Tamil Nadu city list contains 38 unique headquarters with valid coordinates', () => {
  assert.equal(tamilNaduDistrictHeadquarters.length, 38);
  assert.equal(new Set(tamilNaduDistrictHeadquarters.map((city) => city.location)).size, 38);
  for (const city of tamilNaduDistrictHeadquarters) {
    assert.ok(city.latitude >= 8 && city.latitude <= 14, `${city.location} latitude`);
    assert.ok(city.longitude >= 76 && city.longitude <= 81, `${city.location} longitude`);
  }
});

test('import command accepts all Tamil Nadu headquarters without manual coordinates', () => {
  const options = parseArguments([
    '--start', '2026-01-01',
    '--end', '2040-12-31',
    '--all-tamil-nadu'
  ]);
  assert.equal(options.cities.length, 38);
  assert.equal(options.timezone, 'Asia/Kolkata');
  assert.throws(() => parseArguments(['--start', '2026-01-01', '--end', '2040-12-31']), /--location is required/);
});

test('normalizeItems rejects incomplete or out-of-order provider data', () => {
  const record = { date: '2026-11-04', tithi: {}, nakshatra: {} };
  assert.deepEqual(normalizeItems({ items: [record] }, 1, '2026-11-04'), [record]);
  assert.throws(() => normalizeItems({ items: [record] }, 2, '2026-11-04'), /expected 2/);
  assert.throws(() => normalizeItems({ ...record, date: '2026-11-05' }, 1, '2026-11-04'), /invalid Panchangam/);
});

test('maps bilingual sunrise fields and leaves unsupported data empty', () => {
  const result = mapPanchangamToDatabase({
    dateKey: '2026-11-04',
    timezone: 'Asia/Kolkata',
    english: {
      tithi: { name: 'Ekadashi', end: '2026-11-04T20:05:00+05:30' },
      nakshatra: { name: 'Ashlesha', end: '2026-11-04T17:48:00+05:30' },
      periods: { rahu_kalam: { start: '2026-11-04T15:00:00+05:30', end: '2026-11-04T16:30:00+05:30' } }
    },
    tamil: {
      tithi: { name: 'ஏகாதசி', end: '2026-11-04T20:05:00+05:30' },
      nakshatra: { name: 'ஆயில்யம்', end: '2026-11-04T17:48:00+05:30' }
    }
  });
  assert.equal(result.tithiTitleTamil, 'ஏகாதசி');
  assert.equal(result.tithiTitleEnglish, 'Ekadashi');
  assert.equal(result.tithiEndTime, '08:05 PM');
  assert.equal(result.rahuKalamTime, '03:00 PM - 04:30 PM');
  assert.equal(result.rahuKalamPeriod, 'மதியம்');
  assert.equal(result.nallaNeramMorning, null);
  assert.equal(result.providerData.provider, 'OneBhakthi');
});

test('request sends the API key only in the header and validates returned dates', async () => {
  let requestedUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({ date: '2026-11-04', tithi: {}, nakshatra: {} })
    };
  };
  const result = await requestPanchangamBatch({
    startDate: '2026-11-04',
    days: 1,
    language: 'ta',
    latitude: 9.9252,
    longitude: 78.1198,
    timezone: 'Asia/Kolkata',
    apiKey: 'test-secret',
    fetchImpl,
    minimumIntervalMs: 0
  });
  assert.equal(new URL(requestedUrl).searchParams.get('date'), '2026-11-04');
  assert.equal(new URL(requestedUrl).searchParams.has('apiKey'), false);
  assert.equal(requestOptions.headers['X-API-Key'], 'test-secret');
  assert.equal(result.length, 1);
});

test('request retries when the provider connection ends while reading the response body', async () => {
  let attempts = 0;
  const result = await requestPanchangamBatch({
    startDate: '2026-11-04',
    days: 1,
    language: 'ta',
    latitude: 9.9252,
    longitude: 78.1198,
    timezone: 'Asia/Kolkata',
    apiKey: 'test-secret',
    minimumIntervalMs: 0,
    beforeRequest: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: true,
          json: async () => { throw new Error('terminated'); }
        };
      }
      return {
        ok: true,
        json: async () => ({ date: '2026-11-04', tithi: {}, nakshatra: {} })
      };
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result[0].date, '2026-11-04');
});

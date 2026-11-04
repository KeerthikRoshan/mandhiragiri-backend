const dotenv = require('dotenv');
const {
  buildDateBatches,
  mapPanchangamToDatabase,
  requestPanchangamBatch
} = require('../src/services/oneBhakthiPanchangam');
const tamilNaduDistrictHeadquarters = require('./tamilNaduDistrictHeadquarters');
const { pool } = require('../src/config/database');

dotenv.config();

const parseArguments = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const part = args[index];
    if (!part.startsWith('--')) throw new Error(`Unexpected argument: ${part}`);
    if (part === '--all-tamil-nadu') {
      options.allTamilNadu = true;
      continue;
    }
    const separator = part.indexOf('=');
    const key = part.slice(2, separator === -1 ? undefined : separator);
    const value = separator === -1 ? args[++index] : part.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
    if (!['start', 'end', 'location', 'lat', 'lon', 'timezone'].includes(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
    options[key] = value;
  }

  for (const key of ['start', 'end']) {
    if (!options[key]) throw new Error(`--${key} is required.`);
  }
  if (!options.allTamilNadu) {
    for (const key of ['location', 'lat', 'lon', 'timezone']) {
      if (!options[key]) throw new Error(`--${key} is required unless --all-tamil-nadu is used.`);
    }
    options.latitude = Number(options.lat);
    options.longitude = Number(options.lon);
    if (!Number.isFinite(options.latitude) || !Number.isFinite(options.longitude)) {
      throw new Error('--lat and --lon must be valid numbers.');
    }
    options.cities = [{ location: options.location, latitude: options.latitude, longitude: options.longitude }];
  } else {
    options.timezone = 'Asia/Kolkata';
    options.cities = tamilNaduDistrictHeadquarters.map((city) => ({ ...city }));
  }
  return options;
};

const savePanchangam = async (data, location) => {
  await pool.execute(`
    INSERT INTO panchangam_days (
      date_key, location, gregorian_badge, tamil_date_badge,
      tithi_title_tamil, tithi_title_english, tithi_end_time,
      nakshatra_title_tamil, nakshatra_title_english, nakshatra_end_time,
      nalla_neram_morning, nalla_neram_evening, rahu_kalam_time,
      rahu_kalam_period, provider_data, data_source, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OneBhakthi', NULL)
    ON DUPLICATE KEY UPDATE
      gregorian_badge = VALUES(gregorian_badge),
      tamil_date_badge = VALUES(tamil_date_badge),
      tithi_title_tamil = VALUES(tithi_title_tamil),
      tithi_title_english = VALUES(tithi_title_english),
      tithi_end_time = VALUES(tithi_end_time),
      nakshatra_title_tamil = VALUES(nakshatra_title_tamil),
      nakshatra_title_english = VALUES(nakshatra_title_english),
      nakshatra_end_time = VALUES(nakshatra_end_time),
      nalla_neram_morning = VALUES(nalla_neram_morning),
      nalla_neram_evening = VALUES(nalla_neram_evening),
      rahu_kalam_time = VALUES(rahu_kalam_time),
      rahu_kalam_period = VALUES(rahu_kalam_period),
      provider_data = VALUES(provider_data),
      data_source = 'OneBhakthi',
      updated_by = NULL;
  `, [
    data.dateKey, location, data.gregorianBadge, data.tamilDateBadge,
    data.tithiTitleTamil, data.tithiTitleEnglish, data.tithiEndTime,
    data.nakshatraTitleTamil, data.nakshatraTitleEnglish, data.nakshatraEndTime,
    data.nallaNeramMorning, data.nallaNeramEvening, data.rahuKalamTime,
    data.rahuKalamPeriod, JSON.stringify(data.providerData)
  ]);
};

const importPanchangam = async (options, { apiKey = process.env.ONEBHAKTHI_API_KEY, fetchImpl } = {}) => {
  if (!apiKey) throw new Error('Set ONEBHAKTHI_API_KEY in your local .env before importing.');
  const batches = buildDateBatches(options.start, options.end);
  const totalDays = batches.reduce((total, item) => total + item.dates.length, 0);
  let imported = 0;
  let skipped = 0;
  let stoppedForDailyLimit = false;

  for (const city of options.cities) {
    console.log(`Starting ${city.location} (${options.start} to ${options.end}).`);
    for (const batch of batches) {
      const [existingRows] = await pool.execute(`
        SELECT COUNT(*) AS count
        FROM panchangam_days
        WHERE location = ? AND date_key BETWEEN ? AND ? AND data_source = 'OneBhakthi';
      `, [city.location, batch.dates[0], batch.dates.at(-1)]);
      if (Number(existingRows[0].count) === batch.dates.length) {
        skipped += batch.dates.length;
        continue;
      }

      const requestOptions = {
        startDate: batch.startDate,
        days: batch.dates.length,
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: options.timezone || 'Asia/Kolkata',
        apiKey,
        ...(fetchImpl ? { fetchImpl } : {})
      };
      let englishItems;
      let tamilItems;
      try {
        englishItems = await requestPanchangamBatch({ ...requestOptions, language: 'en' });
        tamilItems = await requestPanchangamBatch({ ...requestOptions, language: 'ta' });
      } catch (error) {
        if (error.code === 'daily_limit') {
          stoppedForDailyLimit = true;
          console.error(`Daily provider quota reached while importing ${city.location}. Completed data is saved; rerun the same command after the quota resets.`);
          break;
        }
        throw new Error(`Import failed for ${city.location}, ${batch.startDate}: ${error.message}`);
      }

      for (let index = 0; index < batch.dates.length; index += 1) {
        const dateKey = batch.dates[index];
        const row = mapPanchangamToDatabase({
          dateKey,
          english: englishItems[index],
          tamil: tamilItems[index],
          timezone: options.timezone || 'Asia/Kolkata'
        });
        await savePanchangam(row, city.location);
        imported += 1;
      }
      console.log(`${city.location}: saved through ${batch.dates.at(-1)} (${imported} imported, ${skipped} previously complete).`);
    }
    if (stoppedForDailyLimit) break;
  }
  return { imported, skipped, stoppedForDailyLimit, totalDays: totalDays * options.cities.length };
};

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    importPanchangam(options)
      .then(async ({ imported, skipped, stoppedForDailyLimit, totalDays }) => {
        if (stoppedForDailyLimit) {
          console.error(`Partial import: ${imported} new, ${skipped} already complete; ${totalDays - imported - skipped} city-days remain.`);
          process.exitCode = 2;
        } else {
          console.log(`Completed: ${imported} Panchangam days saved (${skipped} previously complete; ${totalDays} city-days covered).`);
        }
        await pool.end();
      })
      .catch(async (error) => {
        console.error(`[Panchangam import failed] ${error.message}`);
        await pool.end();
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(`[Panchangam import failed] ${error.message}`);
    pool.end().finally(() => { process.exitCode = 1; });
  }
}

module.exports = { parseArguments, importPanchangam, tamilNaduDistrictHeadquarters };

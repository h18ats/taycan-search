// Exports the SQLite database to a static JSON file for Vercel deployment.
// Called after each scrape to update the static data that Vercel serves.
import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseJson(val) {
  try { return val ? JSON.parse(val) : []; } catch { return []; }
}

export function exportData() {
  const db = new Database(join(__dirname, 'porsche.db'));

  const listings = db.prepare(`
    SELECT *,
      CASE WHEN date(first_seen) = date('now') THEN 1 ELSE 0 END as is_new,
      CAST(julianday('now') - julianday(first_seen) AS INTEGER) as days_listed
    FROM listings WHERE removed = 0 ORDER BY price ASC
  `).all().map(r => {
    for (const f of ['equipment_highlights','equipment_exterior','equipment_wheels','equipment_interior','equipment_audio','equipment_emobility','equipment_lighting','equipment_assistance','equipment_transmission']) {
      r[f] = parseJson(r[f]);
    }
    return r;
  });

  const removed = db.prepare(`
    SELECT *,
      CAST(julianday('now') - julianday(last_seen) AS INTEGER) as days_since_seen,
      CAST(julianday(last_seen) - julianday(first_seen) AS INTEGER) as days_was_listed
    FROM listings WHERE removed = 1 ORDER BY last_seen DESC LIMIT 50
  `).all().map(r => {
    for (const f of ['equipment_highlights','equipment_exterior','equipment_wheels','equipment_interior','equipment_audio','equipment_emobility','equipment_lighting','equipment_assistance','equipment_transmission']) {
      r[f] = parseJson(r[f]);
    }
    return r;
  });

  const stats = {
    active: db.prepare('SELECT COUNT(*) as c FROM listings WHERE removed = 0').get().c,
    removed: db.prepare('SELECT COUNT(*) as c FROM listings WHERE removed = 1').get().c,
    avgPrice: db.prepare('SELECT AVG(price) as v FROM listings WHERE removed = 0 AND price IS NOT NULL').get().v,
    minPrice: db.prepare('SELECT MIN(price) as v FROM listings WHERE removed = 0 AND price IS NOT NULL').get().v,
    maxPrice: db.prepare('SELECT MAX(price) as v FROM listings WHERE removed = 0 AND price IS NOT NULL').get().v,
    totalSeen: db.prepare('SELECT COUNT(*) as c FROM listings').get().c,
    lastScrape: db.prepare('SELECT scraped_at FROM scrape_log ORDER BY scraped_at DESC LIMIT 1').get()?.scraped_at,
    totalScrapes: db.prepare('SELECT COUNT(*) as c FROM scrape_log').get().c,
    newToday: db.prepare("SELECT COUNT(*) as c FROM listings WHERE date(first_seen) = date('now')").get().c,
    avgMileage: db.prepare('SELECT AVG(mileage_miles) as v FROM listings WHERE removed = 0 AND mileage_miles IS NOT NULL').get().v,
    meets2022: db.prepare('SELECT COUNT(*) as c FROM listings WHERE removed = 0 AND registration_year >= 2022').get().c,
  };

  const log = db.prepare('SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 30').all();

  const priceHistory = db.prepare(`
    SELECT ph.listing_id, ph.price, ph.recorded_at, l.exterior_color, l.dealer
    FROM price_history ph JOIN listings l ON l.id = ph.listing_id ORDER BY ph.recorded_at ASC
  `).all();

  db.close();

  const data = { listings, removed, stats, log, priceHistory, exportedAt: new Date().toISOString() };
  const outPath = join(__dirname, 'static', 'data.json');
  writeFileSync(outPath, JSON.stringify(data));
  console.log(`📦 Exported data to ${outPath} (${(JSON.stringify(data).length / 1024).toFixed(1)} KB)`);
  return data;
}

// Run if called directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) exportData();

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './scraper.js';
import { scrape } from './scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

app.use('/static', express.static(join(__dirname, 'static')));

// Parse JSON equipment fields in listing rows
function parseListingEquipment(row) {
  const jsonFields = [
    'equipment_highlights', 'equipment_exterior', 'equipment_wheels',
    'equipment_interior', 'equipment_audio', 'equipment_emobility',
    'equipment_lighting', 'equipment_assistance', 'equipment_transmission'
  ];
  for (const field of jsonFields) {
    try { row[field] = row[field] ? JSON.parse(row[field]) : []; }
    catch { row[field] = []; }
  }
  return row;
}

app.get('/api/listings', (req, res) => {
  const db = initDb();
  const listings = db.prepare(`
    SELECT *,
      CASE WHEN date(first_seen) = date('now') THEN 1 ELSE 0 END as is_new,
      CAST(julianday('now') - julianday(first_seen) AS INTEGER) as days_listed
    FROM listings
    WHERE removed = 0
    ORDER BY price ASC
  `).all().map(parseListingEquipment);
  db.close();
  res.json(listings);
});

app.get('/api/removed', (req, res) => {
  const db = initDb();
  const listings = db.prepare(`
    SELECT *,
      CAST(julianday('now') - julianday(last_seen) AS INTEGER) as days_since_seen,
      CAST(julianday(last_seen) - julianday(first_seen) AS INTEGER) as days_was_listed
    FROM listings
    WHERE removed = 1
    ORDER BY last_seen DESC
    LIMIT 50
  `).all().map(parseListingEquipment);
  db.close();
  res.json(listings);
});

app.get('/api/price-history/:id', (req, res) => {
  const db = initDb();
  const history = db.prepare(`
    SELECT price, price_text, recorded_at
    FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC
  `).all(req.params.id);
  db.close();
  res.json(history);
});

app.get('/api/price-history', (req, res) => {
  const db = initDb();
  const history = db.prepare(`
    SELECT ph.listing_id, ph.price, ph.recorded_at, l.exterior_color, l.dealer
    FROM price_history ph JOIN listings l ON l.id = ph.listing_id ORDER BY ph.recorded_at ASC
  `).all();
  db.close();
  res.json(history);
});

app.get('/api/scrape-log', (req, res) => {
  const db = initDb();
  const log = db.prepare('SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 30').all();
  db.close();
  res.json(log);
});

app.get('/api/stats', (req, res) => {
  const db = initDb();
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
  db.close();
  res.json(stats);
});

app.post('/api/scrape', async (req, res) => {
  try {
    res.json({ status: 'started', message: 'Scrape initiated...' });
    scrape({ headed: true }).catch(err => console.error('Background scrape failed:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'static', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏎️  Porsche Finder Dashboard running at http://localhost:${PORT}\n`);
});

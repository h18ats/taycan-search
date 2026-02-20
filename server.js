import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './scraper.js';
import { scrape } from './scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files
app.use('/static', express.static(join(__dirname, 'static')));

// API: Get all active listings
app.get('/api/listings', (req, res) => {
  const db = initDb();
  const listings = db.prepare(`
    SELECT *,
      CASE WHEN date(first_seen) = date('now') THEN 1 ELSE 0 END as is_new,
      julianday('now') - julianday(first_seen) as days_listed
    FROM listings
    WHERE removed = 0
    ORDER BY price ASC
  `).all();
  db.close();
  res.json(listings);
});

// API: Get removed listings (recently disappeared)
app.get('/api/removed', (req, res) => {
  const db = initDb();
  const listings = db.prepare(`
    SELECT *, julianday('now') - julianday(last_seen) as days_since_seen
    FROM listings
    WHERE removed = 1
    ORDER BY last_seen DESC
    LIMIT 50
  `).all();
  db.close();
  res.json(listings);
});

// API: Get price history for a listing
app.get('/api/price-history/:id', (req, res) => {
  const db = initDb();
  const history = db.prepare(`
    SELECT price, price_text, recorded_at
    FROM price_history
    WHERE listing_id = ?
    ORDER BY recorded_at ASC
  `).all(req.params.id);
  db.close();
  res.json(history);
});

// API: Get all price histories (for chart)
app.get('/api/price-history', (req, res) => {
  const db = initDb();
  const history = db.prepare(`
    SELECT ph.listing_id, ph.price, ph.recorded_at, l.exterior_color, l.dealer
    FROM price_history ph
    JOIN listings l ON l.id = ph.listing_id
    ORDER BY ph.recorded_at ASC
  `).all();
  db.close();
  res.json(history);
});

// API: Get scrape log
app.get('/api/scrape-log', (req, res) => {
  const db = initDb();
  const log = db.prepare('SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 30').all();
  db.close();
  res.json(log);
});

// API: Get dashboard stats
app.get('/api/stats', (req, res) => {
  const db = initDb();
  const stats = {
    active: db.prepare('SELECT COUNT(*) as count FROM listings WHERE removed = 0').get().count,
    removed: db.prepare('SELECT COUNT(*) as count FROM listings WHERE removed = 1').get().count,
    avgPrice: db.prepare('SELECT AVG(price) as avg FROM listings WHERE removed = 0 AND price IS NOT NULL').get().avg,
    minPrice: db.prepare('SELECT MIN(price) as min FROM listings WHERE removed = 0 AND price IS NOT NULL').get().min,
    maxPrice: db.prepare('SELECT MAX(price) as max FROM listings WHERE removed = 0 AND price IS NOT NULL').get().max,
    totalSeen: db.prepare('SELECT COUNT(*) as count FROM listings').get().count,
    lastScrape: db.prepare('SELECT scraped_at FROM scrape_log ORDER BY scraped_at DESC LIMIT 1').get()?.scraped_at,
    totalScrapes: db.prepare('SELECT COUNT(*) as count FROM scrape_log').get().count,
    newToday: db.prepare("SELECT COUNT(*) as count FROM listings WHERE date(first_seen) = date('now')").get().count,
    priceChangesToday: db.prepare(`
      SELECT COUNT(DISTINCT listing_id) as count FROM price_history
      WHERE date(recorded_at) = date('now')
      AND listing_id IN (
        SELECT listing_id FROM price_history GROUP BY listing_id HAVING COUNT(*) > 1
      )
    `).get().count
  };
  db.close();
  res.json(stats);
});

// API: Trigger a manual scrape
app.post('/api/scrape', async (req, res) => {
  try {
    res.json({ status: 'started', message: 'Scrape initiated...' });
    // Run scrape in background (don't block response)
    scrape().catch(err => console.error('Background scrape failed:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'static', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏎️  Porsche Finder Dashboard running at http://localhost:${PORT}\n`);
});

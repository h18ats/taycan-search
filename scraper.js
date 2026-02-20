import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

chromium.use(StealthPlugin());

const SEARCH_URL = 'https://finder.porsche.com/gb/en-GB/search/taycan?model=taycan&maximum-price=60000&category=taycan-turbo-s&performance=sport-chrono-package&maximum-registratino-date=2023&minimum-registration-date=2020&e-performance=bigbattery&interior=2-plus-1-rear-seat&exterior=panoramic-roof&exterior=privacy-glazing&audio-communication=burmester-sound-system&interior-material=leather';

export function initDb() {
  const db = new Database(join(__dirname, 'porsche.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      title TEXT,
      price INTEGER,
      price_text TEXT,
      year INTEGER,
      mileage TEXT,
      mileage_km INTEGER,
      location TEXT,
      color TEXT,
      image_url TEXT,
      detail_url TEXT,
      specs TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      removed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT,
      price INTEGER,
      recorded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (listing_id) REFERENCES listings(id)
    );

    CREATE TABLE IF NOT EXISTS scrape_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scraped_at TEXT DEFAULT (datetime('now')),
      listings_found INTEGER,
      new_listings INTEGER,
      price_changes INTEGER,
      removed_listings INTEGER
    );
  `);

  return db;
}

export async function scrape({ headed = false } = {}) {
  console.log('🚗 Starting Porsche Finder scrape...');
  console.log(`📅 ${new Date().toISOString()}`);

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  });

  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  try {
    console.log('📡 Loading Porsche Finder...');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for potential challenge to resolve
    await page.waitForTimeout(5000);

    // Check if we're still on security checkpoint
    const title = await page.title();
    if (title.includes('Security Checkpoint') || title.includes('Vercel')) {
      console.log('⚠️  Vercel security checkpoint detected, waiting for resolution...');
      // Wait longer for the challenge to auto-resolve
      await page.waitForTimeout(10000);

      const newTitle = await page.title();
      if (newTitle.includes('Security') || newTitle.includes('Vercel')) {
        console.log('❌ Still blocked by security. Trying page reload...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
      }
    }

    // Try to accept cookie consent
    try {
      const cookieSelectors = [
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
        'button:has-text("Allow All")',
        '[data-testid="cookie-accept"]',
        '#onetrust-accept-btn-handler',
        '.cookie-accept',
        'button[id*="accept"]'
      ];
      for (const sel of cookieSelectors) {
        const btn = page.locator(sel);
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.first().click();
          console.log('🍪 Accepted cookies');
          await page.waitForTimeout(1000);
          break;
        }
      }
    } catch (e) {
      // No cookie banner
    }

    // Wait for listings
    console.log('⏳ Waiting for listings to load...');
    await page.waitForTimeout(3000);

    // Take debug screenshot
    await page.screenshot({ path: join(__dirname, 'debug-screenshot.png'), fullPage: false });

    // Log page state
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log('Page title:', pageTitle);
    console.log('Page URL:', pageUrl);

    // Discover page structure
    const discovery = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const classes = new Set();
      const tags = {};

      for (const el of allElements) {
        const tag = el.tagName.toLowerCase();
        tags[tag] = (tags[tag] || 0) + 1;
        for (const cls of el.classList) {
          const lower = cls.toLowerCase();
          if (lower.includes('vehicle') || lower.includes('car') || lower.includes('listing') ||
              lower.includes('card') || lower.includes('result') || lower.includes('search') ||
              lower.includes('price') || lower.includes('tile') || lower.includes('item') ||
              lower.includes('product') || lower.includes('offer')) {
            classes.add(cls);
          }
        }
      }

      // Check for links that might be car detail pages
      const carLinks = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && (href.includes('vehicle') || href.includes('taycan') || href.includes('detail') || href.includes('/car/'))) {
          carLinks.push({ href, text: a.textContent.trim().substring(0, 100) });
        }
      });

      // Check for images that might be car photos
      const carImages = [];
      document.querySelectorAll('img[src]').forEach(img => {
        const src = img.src;
        if (src && (src.includes('porsche') || src.includes('vehicle') || src.includes('car'))) {
          carImages.push(src.substring(0, 200));
        }
      });

      return {
        title: document.title,
        classes: [...classes],
        carLinks: carLinks.slice(0, 20),
        carImages: carImages.slice(0, 10),
        bodyText: document.body.innerText.substring(0, 3000),
        articleCount: document.querySelectorAll('article').length,
        linkCount: document.querySelectorAll('a').length,
        imgCount: document.querySelectorAll('img').length
      };
    });

    console.log('\n📋 Discovery results:');
    console.log('Title:', discovery.title);
    console.log('Relevant classes:', discovery.classes);
    console.log('Car links:', discovery.carLinks.length);
    if (discovery.carLinks.length > 0) {
      console.log('Sample links:', JSON.stringify(discovery.carLinks.slice(0, 5), null, 2));
    }
    console.log('Car images:', discovery.carImages.length);
    console.log('Articles:', discovery.articleCount);
    console.log('All links:', discovery.linkCount);
    console.log('All images:', discovery.imgCount);
    console.log('\nBody text (first 1500 chars):\n', discovery.bodyText.substring(0, 1500));

    await browser.close();
    return discovery;

  } catch (error) {
    console.error('❌ Scrape error:', error.message);
    await page.screenshot({ path: join(__dirname, 'error-screenshot.png'), fullPage: false }).catch(() => {});
    await browser.close();
    throw error;
  }
}

// Run if called directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const headed = process.argv.includes('--headed');
  scrape({ headed }).then(result => {
    console.log('\n✅ Scrape complete!');
  }).catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}

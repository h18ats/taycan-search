import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
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
      condition TEXT,
      price INTEGER,
      price_text TEXT,
      exterior_color TEXT,
      interior_color TEXT,
      interior_color_full TEXT,
      fuel_type TEXT,
      mileage TEXT,
      mileage_miles INTEGER,
      registration_date TEXT,
      registration_year INTEGER,
      previous_owners INTEGER,
      power TEXT,
      drivetrain TEXT,
      range_wltp TEXT,
      image_url TEXT,
      detail_url TEXT,
      dealer TEXT,
      dealer_address TEXT,
      consumption TEXT,
      vin TEXT,
      stock_number TEXT,
      description TEXT,
      service_history TEXT,
      latest_maintenance TEXT,
      warranty TEXT,
      battery_warranty TEXT,
      equipment_highlights TEXT,
      equipment_exterior TEXT,
      equipment_wheels TEXT,
      equipment_interior TEXT,
      equipment_audio TEXT,
      equipment_emobility TEXT,
      equipment_lighting TEXT,
      equipment_assistance TEXT,
      equipment_transmission TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      removed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT,
      price INTEGER,
      price_text TEXT,
      recorded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (listing_id) REFERENCES listings(id)
    );

    CREATE TABLE IF NOT EXISTS scrape_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scraped_at TEXT DEFAULT (datetime('now')),
      listings_found INTEGER,
      new_listings INTEGER,
      price_changes INTEGER,
      removed_listings INTEGER,
      status TEXT DEFAULT 'success'
    );
  `);

  // Add columns if they don't exist (for DB migration)
  const cols = db.prepare("PRAGMA table_info(listings)").all().map(c => c.name);
  const newCols = [
    ['interior_color_full', 'TEXT'], ['registration_year', 'INTEGER'], ['dealer_address', 'TEXT'],
    ['vin', 'TEXT'], ['stock_number', 'TEXT'], ['description', 'TEXT'],
    ['service_history', 'TEXT'], ['latest_maintenance', 'TEXT'], ['warranty', 'TEXT'],
    ['battery_warranty', 'TEXT'], ['equipment_highlights', 'TEXT'], ['equipment_exterior', 'TEXT'],
    ['equipment_wheels', 'TEXT'], ['equipment_interior', 'TEXT'], ['equipment_audio', 'TEXT'],
    ['equipment_emobility', 'TEXT'], ['equipment_lighting', 'TEXT'], ['equipment_assistance', 'TEXT'],
    ['equipment_transmission', 'TEXT']
  ];
  for (const [col, type] of newCols) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE listings ADD COLUMN ${col} ${type}`);
    }
  }

  return db;
}

// Parse a detail page's text content into structured equipment data
function parseDetailPage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const data = {};

  // VIN & Stock Number
  const vinIdx = lines.findIndex(l => l === 'VIN:');
  if (vinIdx >= 0 && lines[vinIdx + 1]) data.vin = lines[vinIdx + 1];
  const stockIdx = lines.findIndex(l => l === 'Stock Number:');
  if (stockIdx >= 0 && lines[stockIdx + 1]) data.stockNumber = lines[stockIdx + 1];

  // Full interior color description
  const intColorIdx = lines.findIndex(l => l === 'Interior colour');
  if (intColorIdx >= 0 && lines[intColorIdx + 1]) data.interiorColorFull = lines[intColorIdx + 1];

  // Dealer address
  const dealerIdx = lines.findIndex(l => l.startsWith('Porsche Centre'));
  if (dealerIdx >= 0) {
    const addrParts = [];
    for (let i = dealerIdx + 1; i < Math.min(dealerIdx + 4, lines.length); i++) {
      if (lines[i] === 'Go to website' || lines[i].startsWith('Stock')) break;
      addrParts.push(lines[i]);
    }
    data.dealerAddress = addrParts.join(', ');
  }

  // Description
  const descIdx = lines.findIndex(l => l === 'Description');
  if (descIdx >= 0) {
    const descParts = [];
    for (let i = descIdx + 1; i < lines.length; i++) {
      if (lines[i] === 'E-Performance' || lines[i] === 'Vehicle Equipment') break;
      descParts.push(lines[i]);
    }
    data.description = descParts.join('\n').trim();
  }

  // Service history
  const fshIdx = lines.findIndex(l => l === 'Full Service History');
  if (fshIdx >= 0 && lines[fshIdx + 1]) data.serviceHistory = lines[fshIdx + 1];

  // Latest maintenance
  const maintIdx = lines.findIndex(l => l === 'Latest Maintenance');
  if (maintIdx >= 0 && lines[maintIdx + 1]) data.latestMaintenance = lines[maintIdx + 1];

  // Warranty
  data.warranty = '24 months Porsche Approved';
  data.batteryWarranty = '8 years or up to 100,000 mi';

  // Equipment sections
  const equipStart = lines.findIndex(l => l === 'Equipment Highlights');
  if (equipStart >= 0) {
    // Equipment Highlights - items between "Equipment Highlights" and "Included Options"
    const inclOptIdx = lines.findIndex((l, i) => i > equipStart && l === 'Included Options');
    if (inclOptIdx >= 0) {
      data.equipmentHighlights = lines.slice(equipStart + 1, inclOptIdx);
    }

    // Parse Included Options by category
    const categories = {
      'Exterior': 'equipmentExterior',
      'Transmission / Chassis': 'equipmentTransmission',
      'Wheels': 'equipmentWheels',
      'Interior': 'equipmentInterior',
      'Audio / Comm.': 'equipmentAudio',
      'E-Mobility': 'equipmentEmobility',
      'Lighting and vision': 'equipmentLighting',
      'Comfort and assistance systems': 'equipmentAssistance'
    };

    const stopWords = ['Standard Equipment', 'Warranty', 'Condition and History', 'Technical Data'];

    for (const [catName, catKey] of Object.entries(categories)) {
      const catIdx = lines.findIndex((l, i) => i > (inclOptIdx || equipStart) && l === catName);
      if (catIdx >= 0) {
        const items = [];
        for (let i = catIdx + 1; i < lines.length; i++) {
          const line = lines[i];
          // Stop if we hit another category or a stop section
          if (Object.keys(categories).includes(line) || stopWords.includes(line)) break;
          if (line.length > 3 && !line.startsWith('More about')) {
            items.push(line);
          }
        }
        data[catKey] = items;
      }
    }
  }

  return data;
}

export async function scrape({ headed = false } = {}) {
  const startTime = Date.now();
  console.log(`🚗 Starting Porsche Finder scrape... [${new Date().toISOString()}]`);

  const storageStatePath = join(__dirname, 'storage-state.json');
  const hasStorageState = existsSync(storageStatePath);

  if (!hasStorageState && !headed) {
    console.log('⚠️  No saved session found. Run with --headed first to bypass security.');
    console.log('   Usage: node scraper.js --headed');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  };

  if (hasStorageState) {
    contextOptions.storageState = storageStatePath;
    console.log('🍪 Using saved session');
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('📡 Loading Porsche Finder...');
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check for security checkpoint
    const title = await page.title();
    if (title.includes('Security') || title.includes('Vercel')) {
      if (headed) {
        console.log('⚠️  Security checkpoint detected. Solve it in the browser window...');
        await page.waitForFunction(() => !document.title.includes('Security') && !document.title.includes('Vercel'), { timeout: 120000 });
        console.log('✅ Security challenge passed!');
        await page.waitForTimeout(3000);
        await context.storageState({ path: storageStatePath });
        console.log('💾 Session saved for future use');
      } else {
        console.log('❌ Blocked by security. Session may have expired.');
        console.log('   Run with --headed to refresh: node scraper.js --headed');
        await browser.close();
        return { listings: [], error: 'security_blocked' };
      }
    }

    // Accept cookies if needed
    try {
      for (const sel of ['button:has-text("Accept All")', '#onetrust-accept-btn-handler', 'button:has-text("Allow All")']) {
        const btn = page.locator(sel);
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.first().click();
          await page.waitForTimeout(1000);
          break;
        }
      }
    } catch (e) {}

    console.log('⏳ Extracting listings from search page...');
    await page.waitForTimeout(2000);

    // Extract basic listing data from search page
    const listings = await page.evaluate(() => {
      const results = [];
      const detailLinks = document.querySelectorAll('a[href*="/details/"]');
      const processedSlugs = new Set();

      for (const link of detailLinks) {
        const href = link.getAttribute('href');
        if (!href) continue;
        const detailPath = href.split('/details/')[1];
        if (!detailPath) continue;
        const slug = detailPath.split('?')[0];
        if (processedSlugs.has(slug)) continue;
        processedSlugs.add(slug);

        let card = link;
        for (let i = 0; i < 15; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          if (card.textContent.includes('£') && card.textContent.length > 200 && card.textContent.length < 8000) break;
        }

        const text = card.innerText || card.textContent;
        if (!text.includes('£')) continue;

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const priceMatch = text.match(/£([\d,]+)/);

        let mileage = null, mileageMiles = null;
        for (const line of lines) {
          const m = line.match(/^([\d,]+)\s*mi$/);
          if (m) { mileage = line; mileageMiles = parseInt(m[1].replace(/,/g, '')); break; }
        }

        const dateMatch = text.match(/(\d{2}\/\d{4})/);
        let previousOwners = null;
        for (const line of lines) {
          const m = line.match(/^(\d+)\s*previous\s*owner/i);
          if (m) { previousOwners = parseInt(m[1]); break; }
        }

        const powerMatch = text.match(/(\d+\s*kW\s*\/\s*\d+\s*hp)/);
        const rangeMatch = text.match(/Range[^:]*:\s*([\d,]+\s*mi)/i);
        const consumptionMatch = text.match(/consumption[^:]*:\s*([\d.]+\s*kWh\/100\s*km)/i);

        let imageUrl = null;
        for (const img of card.querySelectorAll('img')) {
          const src = img.src || img.dataset.src || img.getAttribute('srcset')?.split(' ')[0] || '';
          if (src && src.length > 50 && !src.includes('logo') && !src.includes('icon') && !src.includes('svg')) { imageUrl = src; break; }
        }
        if (!imageUrl) {
          for (const source of card.querySelectorAll('source[srcset]')) {
            const srcset = source.getAttribute('srcset');
            if (srcset && srcset.length > 50) { imageUrl = srcset.split(' ')[0].split(',')[0].trim(); break; }
          }
        }

        const colorPatterns = [
          'Jet Black Metallic', 'Volcano Grey Metallic', 'Carrara White Metallic',
          'Gentian Blue Metallic', 'Cherry Metallic', 'Frozen Blue Metallic',
          'Mahogany Metallic', 'Dolomite Silver Metallic', 'Mamba Green Metallic',
          'Neptune Blue Metallic', 'Night Blue Metallic', 'Taycan Blue Metallic',
          'Ice Grey Metallic', 'Chalk', 'White', 'Black'
        ];
        const interiorColorPatterns = ['Black', 'Beige', 'Red', 'Bordeaux Red', 'Chalk',
          'Truffle Brown', 'Atacama Beige', 'Slate Grey', 'Graphite Blue', 'Basalt Black'];

        let exteriorColor = null, interiorColor = null;
        for (const c of colorPatterns) { if (text.includes(c)) { exteriorColor = c; break; } }
        if (exteriorColor) {
          for (const c of interiorColorPatterns) {
            for (const line of lines) {
              if ((line === c || line.startsWith(c)) && text.indexOf(line) > text.indexOf(exteriorColor)) {
                interiorColor = c; break;
              }
            }
            if (interiorColor) break;
          }
        }

        const condition = text.includes('Pre-Owned') ? 'Porsche Approved Pre-Owned' :
                         text.includes('New car') ? 'New' : 'Used';
        const dealerMatch = text.match(/Porsche Centre\s+([\w\s]+?)(?:\n|Electrical|$)/i);

        // Parse registration year
        const regYear = dateMatch ? parseInt(dateMatch[1].split('/')[1]) : null;

        results.push({
          id: slug,
          title: 'Porsche Taycan Turbo S',
          condition,
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
          priceText: priceMatch ? `£${priceMatch[1]}` : null,
          exteriorColor, interiorColor, fuelType: 'Electric',
          mileage, mileageMiles,
          registrationDate: dateMatch ? dateMatch[1] : null,
          registrationYear: regYear,
          previousOwners,
          power: powerMatch ? powerMatch[1] : null,
          drivetrain: text.includes('All-wheel') ? 'All-wheel-drive' : null,
          rangeWltp: rangeMatch ? rangeMatch[1] : null,
          imageUrl,
          detailUrl: `https://finder.porsche.com/gb/en-GB/details/${slug}`,
          dealer: dealerMatch ? `Porsche Centre ${dealerMatch[1].trim()}` : null,
          consumption: consumptionMatch ? consumptionMatch[1] : null
        });
      }
      return results;
    });

    console.log(`🚗 Found ${listings.length} listings on search page`);
    listings.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.exteriorColor || 'Unknown'} - ${l.priceText} - ${l.mileage} - ${l.dealer}`);
    });

    // Now visit each detail page to get full equipment data
    console.log('\n📋 Fetching detail pages for equipment data...');
    for (const listing of listings) {
      try {
        console.log(`  → Loading ${listing.id}...`);
        await page.goto(listing.detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const pageText = await page.evaluate(() => document.body.innerText);
        const detailData = parseDetailPage(pageText);

        // Merge detail data into listing
        listing.vin = detailData.vin || null;
        listing.stockNumber = detailData.stockNumber || null;
        listing.interiorColorFull = detailData.interiorColorFull || null;
        listing.dealerAddress = detailData.dealerAddress || null;
        listing.description = detailData.description || null;
        listing.serviceHistory = detailData.serviceHistory || null;
        listing.latestMaintenance = detailData.latestMaintenance || null;
        listing.warranty = detailData.warranty || null;
        listing.batteryWarranty = detailData.batteryWarranty || null;
        listing.equipmentHighlights = detailData.equipmentHighlights || [];
        listing.equipmentExterior = detailData.equipmentExterior || [];
        listing.equipmentWheels = detailData.equipmentWheels || [];
        listing.equipmentInterior = detailData.equipmentInterior || [];
        listing.equipmentAudio = detailData.equipmentAudio || [];
        listing.equipmentEmobility = detailData.equipmentEmobility || [];
        listing.equipmentLighting = detailData.equipmentLighting || [];
        listing.equipmentAssistance = detailData.equipmentAssistance || [];
        listing.equipmentTransmission = detailData.equipmentTransmission || [];

        console.log(`    ✅ ${detailData.equipmentHighlights?.length || 0} highlights, ${Object.values(detailData).filter(v => Array.isArray(v)).reduce((a, v) => a + v.length, 0)} total options`);
      } catch (err) {
        console.log(`    ⚠️  Failed to load detail: ${err.message}`);
      }
    }

    // Save to database
    const db = initDb();
    let newCount = 0;
    let priceChangeCount = 0;

    const insertListing = db.prepare(`
      INSERT INTO listings (id, title, condition, price, price_text, exterior_color, interior_color,
        interior_color_full, fuel_type, mileage, mileage_miles, registration_date, registration_year,
        previous_owners, power, drivetrain, range_wltp, image_url, detail_url, dealer, dealer_address,
        consumption, vin, stock_number, description, service_history, latest_maintenance, warranty,
        battery_warranty, equipment_highlights, equipment_exterior, equipment_wheels, equipment_interior,
        equipment_audio, equipment_emobility, equipment_lighting, equipment_assistance, equipment_transmission)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        price = excluded.price,
        price_text = excluded.price_text,
        mileage = excluded.mileage,
        mileage_miles = excluded.mileage_miles,
        previous_owners = excluded.previous_owners,
        last_seen = datetime('now'),
        removed = 0,
        vin = COALESCE(excluded.vin, listings.vin),
        stock_number = COALESCE(excluded.stock_number, listings.stock_number),
        description = COALESCE(excluded.description, listings.description),
        service_history = COALESCE(excluded.service_history, listings.service_history),
        latest_maintenance = COALESCE(excluded.latest_maintenance, listings.latest_maintenance),
        equipment_highlights = COALESCE(excluded.equipment_highlights, listings.equipment_highlights),
        equipment_exterior = COALESCE(excluded.equipment_exterior, listings.equipment_exterior),
        equipment_wheels = COALESCE(excluded.equipment_wheels, listings.equipment_wheels),
        equipment_interior = COALESCE(excluded.equipment_interior, listings.equipment_interior),
        equipment_audio = COALESCE(excluded.equipment_audio, listings.equipment_audio),
        equipment_emobility = COALESCE(excluded.equipment_emobility, listings.equipment_emobility),
        equipment_lighting = COALESCE(excluded.equipment_lighting, listings.equipment_lighting),
        equipment_assistance = COALESCE(excluded.equipment_assistance, listings.equipment_assistance),
        equipment_transmission = COALESCE(excluded.equipment_transmission, listings.equipment_transmission)
    `);

    const getExisting = db.prepare('SELECT id, price FROM listings WHERE id = ?');
    const insertPrice = db.prepare('INSERT INTO price_history (listing_id, price, price_text) VALUES (?, ?, ?)');

    const toJson = (arr) => arr && arr.length > 0 ? JSON.stringify(arr) : null;

    const transaction = db.transaction((items) => {
      for (const l of items) {
        const existing = getExisting.get(l.id);
        if (!existing) newCount++;
        else if (existing.price !== l.price) priceChangeCount++;

        insertListing.run(
          l.id, l.title, l.condition, l.price, l.priceText, l.exteriorColor, l.interiorColor,
          l.interiorColorFull, l.fuelType, l.mileage, l.mileageMiles, l.registrationDate, l.registrationYear,
          l.previousOwners, l.power, l.drivetrain, l.rangeWltp, l.imageUrl, l.detailUrl, l.dealer,
          l.dealerAddress, l.consumption, l.vin, l.stockNumber, l.description, l.serviceHistory,
          l.latestMaintenance, l.warranty, l.batteryWarranty,
          toJson(l.equipmentHighlights), toJson(l.equipmentExterior), toJson(l.equipmentWheels),
          toJson(l.equipmentInterior), toJson(l.equipmentAudio), toJson(l.equipmentEmobility),
          toJson(l.equipmentLighting), toJson(l.equipmentAssistance), toJson(l.equipmentTransmission)
        );

        insertPrice.run(l.id, l.price, l.priceText);
      }
    });

    transaction(listings);

    // Mark removed listings
    const currentIds = listings.map(l => `'${l.id}'`).join(',');
    const removedCount = currentIds
      ? db.prepare(`UPDATE listings SET removed = 1 WHERE removed = 0 AND id NOT IN (${currentIds})`).run().changes
      : 0;

    db.prepare('INSERT INTO scrape_log (listings_found, new_listings, price_changes, removed_listings) VALUES (?, ?, ?, ?)')
      .run(listings.length, newCount, priceChangeCount, removedCount);

    console.log(`\n📊 Summary: ${newCount} new, ${priceChangeCount} price changes, ${removedCount} removed`);

    await context.storageState({ path: join(__dirname, 'storage-state.json') });
    db.close();
    await browser.close();

    // Export static JSON and deploy to Vercel
    try {
      const { exportData } = await import('./export-data.js');
      exportData();

      const { execSync } = await import('child_process');

      // Push data to GitHub
      try {
        execSync('git add static/data.json && git commit -m "Update listing data [auto]" && git push', {
          cwd: __dirname, stdio: 'pipe', timeout: 30000
        });
        console.log('📤 Pushed to GitHub');
      } catch (gitErr) {
        console.log(`⚠️  Git push skipped: ${gitErr.message?.substring(0, 80)}`);
      }

      // Deploy to Vercel
      try {
        execSync('vercel --prod --yes 2>&1', {
          cwd: __dirname, stdio: 'pipe', timeout: 60000,
          env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }
        });
        console.log('🚀 Deployed to Vercel');
      } catch (vErr) {
        console.log(`⚠️  Vercel deploy skipped: ${vErr.message?.substring(0, 80)}`);
      }
    } catch (exportErr) {
      console.log(`⚠️  Export skipped: ${exportErr.message}`);
    }

    // Email notification if new listings found
    if (newCount > 0) {
      try {
        const { execSync } = await import('child_process');
        const newListings = listings.filter(l => {
          const db2 = new Database(join(__dirname, 'porsche.db'));
          const row = db2.prepare('SELECT first_seen FROM listings WHERE id = ?').get(l.id);
          db2.close();
          return row && row.first_seen && (Date.now() - new Date(row.first_seen + 'Z').getTime()) < 60 * 60 * 1000;
        });

        const carSummaries = (newListings.length > 0 ? newListings : listings.slice(0, newCount)).map(l => {
          const premium = [
            ...(l.equipmentTransmission || []),
            ...(l.equipmentAssistance || [])
          ].filter(e => e.match(/PCCB|InnoDrive|Head-Up|Carbon SportDesign/i));

          return [
            `${l.exteriorColor || 'Unknown'} / ${l.interiorColor || 'Unknown'} interior`,
            `Price: ${l.priceText}`,
            `Mileage: ${l.mileage || 'N/A'}`,
            `Registered: ${l.registrationDate || 'N/A'}${l.registrationYear >= 2022 ? ' ✅ MEETS 2022+ TARGET' : ''}`,
            `Owners: ${l.previousOwners != null ? l.previousOwners : 'N/A'}`,
            `Dealer: ${l.dealer || 'Unknown'}`,
            premium.length > 0 ? `Premium options: ${premium.join(', ')}` : null,
            `View: ${l.detailUrl}`,
          ].filter(Boolean).join('\n');
        }).join('\n\n---\n\n');

        const subject = `🚗 ${newCount} new Taycan Turbo S listing${newCount > 1 ? 's' : ''} found!`;
        const body = [
          `${newCount} new Porsche Taycan Turbo S listing${newCount > 1 ? 's' : ''} matching your spec just appeared on Porsche Finder.\n`,
          carSummaries,
          `\n---\nDashboard: https://porsche-finder-rho.vercel.app`,
          `Porsche Finder: https://finder.porsche.com/gb/en-GB/search/taycan?model=taycan&maximum-price=60000&category=taycan-turbo-s`,
        ].join('\n');

        execSync(`python3 /Users/andy/gmail-tool/gmail.py send --to "andy.batty@hotmail.com" --subject "${subject.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
          stdio: 'pipe', timeout: 15000
        });
        console.log('📧 Email notification sent to andy.batty@hotmail.com');
      } catch (emailErr) {
        console.log(`⚠️  Email failed: ${emailErr.message?.substring(0, 100)}`);
      }
    } else {
      console.log('📧 No new listings — skipping email');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Scrape complete in ${elapsed}s`);

    return { listings, newCount, priceChangeCount, removedCount };

  } catch (error) {
    console.error('❌ Scrape error:', error.message);
    await page.screenshot({ path: join(__dirname, 'error-screenshot.png') }).catch(() => {});
    await browser.close();
    throw error;
  }
}

// CLI entry point
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const headed = process.argv.includes('--headed');
  scrape({ headed }).then(result => {
    if (result.error) process.exit(1);
  }).catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}

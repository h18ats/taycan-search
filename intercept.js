// Run with headed browser to intercept API calls and discover the data endpoint
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

chromium.use(StealthPlugin());

const SEARCH_URL = 'https://finder.porsche.com/gb/en-GB/search/taycan?model=taycan&maximum-price=60000&category=taycan-turbo-s&performance=sport-chrono-package&maximum-registratino-date=2023&minimum-registration-date=2020&e-performance=bigbattery&interior=2-plus-1-rear-seat&exterior=panoramic-roof&exterior=privacy-glazing&audio-communication=burmester-sound-system&interior-material=leather';

async function intercept() {
  console.log('🔍 Launching headed browser to intercept API calls...');
  console.log('👆 You may need to solve a CAPTCHA/challenge in the browser window.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  });

  const page = await context.newPage();
  const apiCalls = [];

  // Intercept all network requests
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    if (contentType.includes('json') && status === 200) {
      try {
        const body = await response.text();
        const size = body.length;

        // Log significant JSON responses
        if (size > 500) {
          console.log(`\n📦 JSON Response [${size} bytes]: ${url.substring(0, 150)}`);

          // Check if it contains car/vehicle data
          const lower = body.toLowerCase();
          if (lower.includes('taycan') || lower.includes('vehicle') || lower.includes('price') ||
              lower.includes('mileage') || lower.includes('listing')) {
            console.log('  🚗 LIKELY CAR DATA!');
            const filename = `api-response-${apiCalls.length}.json`;
            writeFileSync(join(__dirname, filename), body);
            console.log(`  💾 Saved to ${filename}`);

            apiCalls.push({
              url,
              method: response.request().method(),
              headers: response.request().headers(),
              size,
              filename
            });
          }
        }
      } catch (e) {
        // Response body unavailable
      }
    }
  });

  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  console.log('\n⏳ Waiting 60 seconds for page to load and API calls to complete...');
  console.log('   If you see a challenge in the browser, solve it now.\n');

  // Wait for user to solve challenge + page to load
  await page.waitForTimeout(60000);

  // Scroll to trigger more data loading
  console.log('📜 Scrolling page...');
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(5000);

  // Save cookies for future use
  const cookies = await context.cookies();
  writeFileSync(join(__dirname, 'cookies.json'), JSON.stringify(cookies, null, 2));
  console.log(`\n🍪 Saved ${cookies.length} cookies to cookies.json`);

  // Save storage state for reuse
  await context.storageState({ path: join(__dirname, 'storage-state.json') });
  console.log('💾 Saved storage state to storage-state.json');

  console.log(`\n📊 Summary: Found ${apiCalls.length} car-related API responses`);
  apiCalls.forEach((call, i) => {
    console.log(`  ${i + 1}. ${call.method} ${call.url.substring(0, 120)}`);
  });

  // Also extract whatever is on the page now
  const pageData = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.substring(0, 5000)
    };
  });
  console.log('\nPage title:', pageData.title);
  console.log('Page text preview:\n', pageData.bodyText.substring(0, 2000));

  await page.screenshot({ path: join(__dirname, 'headed-screenshot.png'), fullPage: true });

  await browser.close();
  return apiCalls;
}

intercept().then(calls => {
  console.log('\n✅ Done! Check the api-response-*.json files for car data.');
}).catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});

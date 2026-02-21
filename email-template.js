// Generates a beautiful HTML email for new Taycan Turbo S listings

const PREMIUM_KEYWORDS = [
  'PCCB', 'Ceramic Composite Brake',
  'InnoDrive', 'Adaptive Cruise',
  'Head-Up Display',
  'Carbon SportDesign',
  'Lane Change Assist',
  '3D Surround View', 'Active Parking Support',
  'HomeLink',
  'carbon aeroblades', 'Carbon',
  'Race-Tex',
  'Matrix LED', 'Glacier Ice', 'PDLS', 'Dynamic Light',
];

function isPremium(item) {
  return PREMIUM_KEYWORDS.some(k => item.includes(k));
}

function buildCarBlock(car) {
  const parse = (field) => {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    try { return JSON.parse(field); } catch { return []; }
  };

  const highlights = parse(car.equipment_highlights);
  const allEquip = [
    ...parse(car.equipment_exterior),
    ...parse(car.equipment_transmission),
    ...parse(car.equipment_wheels),
    ...parse(car.equipment_interior),
    ...parse(car.equipment_audio),
    ...parse(car.equipment_emobility),
    ...parse(car.equipment_lighting),
    ...parse(car.equipment_assistance),
  ];

  const premiumItems = allEquip.filter(isPremium);
  const owners = car.previous_owners != null ? car.previous_owners : 'N/A';
  const yearFlag = car.registration_year >= 2022;
  const regDate = car.registration_date || 'N/A';
  const regYear = car.registration_year || 'N/A';

  // Calculate age
  const ageYears = car.registration_year ? (new Date().getFullYear() - car.registration_year) : null;

  // Image - try to get a higher res version
  const imageUrl = car.image_url ? car.image_url.replace('/320.', '/640.').replace('/320/', '/640/') : null;

  const equipmentCategories = [
    { name: 'Exterior', items: parse(car.equipment_exterior) },
    { name: 'Brakes & Chassis', items: parse(car.equipment_transmission) },
    { name: 'Wheels', items: parse(car.equipment_wheels) },
    { name: 'Interior', items: parse(car.equipment_interior) },
    { name: 'Audio & Comms', items: parse(car.equipment_audio) },
    { name: 'Charging', items: parse(car.equipment_emobility) },
    { name: 'Lighting', items: parse(car.equipment_lighting) },
    { name: 'Assistance', items: parse(car.equipment_assistance) },
  ].filter(c => c.items.length > 0);

  return `
    <!-- Car Card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #333;">
      <tr>
        <td>
          ${imageUrl ? `
          <div style="position:relative;">
            <img src="${imageUrl}" alt="${car.exterior_color} Taycan Turbo S" style="width:100%;height:auto;display:block;max-height:400px;object-fit:cover;" />
            ${yearFlag ? `<div style="position:absolute;top:12px;right:12px;background:#00B451;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;">2022+ TARGET</div>` : ''}
          </div>` : ''}
        </td>
      </tr>

      <!-- Key Stats Row -->
      <tr>
        <td style="padding:0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="25%" style="background:#C4A862;padding:16px 12px;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#000;opacity:0.7;">Price</div>
                <div style="font-size:22px;font-weight:700;color:#000;">${car.price_text || 'N/A'}</div>
              </td>
              <td width="25%" style="background:#222;padding:16px 12px;text-align:center;border-right:1px solid #333;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;">Mileage</div>
                <div style="font-size:18px;font-weight:700;color:#E8E8E8;">${car.mileage || 'N/A'}</div>
              </td>
              <td width="25%" style="background:#222;padding:16px 12px;text-align:center;border-right:1px solid #333;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;">Age</div>
                <div style="font-size:18px;font-weight:700;color:${yearFlag ? '#00B451' : '#F5A623'};">${ageYears != null ? ageYears + ' yrs' : 'N/A'}</div>
                <div style="font-size:11px;color:#888;">${regDate}</div>
              </td>
              <td width="25%" style="background:#222;padding:16px 12px;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;">Owners</div>
                <div style="font-size:18px;font-weight:700;color:#E8E8E8;">${owners}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Colour & Dealer -->
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #333;">
          <div style="font-size:16px;font-weight:700;color:#E8E8E8;margin-bottom:6px;">
            ${car.exterior_color || 'Unknown colour'}
          </div>
          <div style="font-size:13px;color:#888;margin-bottom:4px;">
            Interior: ${car.interior_color_full || car.interior_color || 'Unknown'}
          </div>
          <div style="font-size:13px;color:#888;">
            ${car.power || ''} &bull; ${car.drivetrain || 'AWD'} &bull; Range: ${car.range_wltp || 'N/A'} WLTP
          </div>
        </td>
      </tr>

      <!-- Dealer -->
      <tr>
        <td style="padding:12px 20px;border-bottom:1px solid #333;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:2px;">Dealer</div>
          <div style="font-size:14px;color:#E8E8E8;font-weight:600;">${car.dealer || 'Unknown'}</div>
          ${car.dealer_address ? `<div style="font-size:12px;color:#888;">${car.dealer_address}</div>` : ''}
        </td>
      </tr>

      <!-- Equipment Highlights -->
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #333;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Equipment Highlights</div>
          <div style="margin-bottom:8px;">
            ${highlights.map(h => {
              const prem = isPremium(h);
              return `<span style="display:inline-block;padding:4px 10px;margin:2px 4px 2px 0;border-radius:4px;font-size:12px;${prem ? 'background:rgba(196,168,98,0.15);color:#C4A862;border:1px solid #C4A862;' : 'background:#2a2a2a;color:#ccc;border:1px solid #444;'}">${h}</span>`;
            }).join('')}
          </div>
        </td>
      </tr>

      ${premiumItems.length > 0 ? `
      <!-- Premium Options -->
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #333;background:rgba(196,168,98,0.05);">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#C4A862;margin-bottom:8px;">&#11088; Premium / Standout Options</div>
          ${premiumItems.map(item => `
            <div style="font-size:13px;color:#C4A862;padding:3px 0;">&#8226; ${item}</div>
          `).join('')}
        </td>
      </tr>` : ''}

      <!-- Full Equipment -->
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:10px;">Full Specification</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${equipmentCategories.map((cat, i) => {
                // Two columns
                if (i % 2 === 0) return `${i > 0 ? '</tr><tr>' : ''}<td width="50%" valign="top" style="padding-right:10px;padding-bottom:12px;">
                  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:4px;font-weight:600;">${cat.name}</div>
                  ${cat.items.map(item => `<div style="font-size:12px;color:${isPremium(item) ? '#C4A862' : '#aaa'};padding:1px 0;">${isPremium(item) ? '&#9733; ' : ''}${item}</div>`).join('')}
                </td>`;
                return `<td width="50%" valign="top" style="padding-left:10px;padding-bottom:12px;">
                  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:4px;font-weight:600;">${cat.name}</div>
                  ${cat.items.map(item => `<div style="font-size:12px;color:${isPremium(item) ? '#C4A862' : '#aaa'};padding:1px 0;">${isPremium(item) ? '&#9733; ' : ''}${item}</div>`).join('')}
                </td>`;
              }).join('')}
            </tr>
          </table>
        </td>
      </tr>

      ${car.service_history || car.latest_maintenance ? `
      <tr>
        <td style="padding:12px 20px;border-top:1px solid #333;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:4px;">History</div>
          ${car.service_history ? `<div style="font-size:12px;color:#aaa;">Service: ${car.service_history}</div>` : ''}
          ${car.latest_maintenance ? `<div style="font-size:12px;color:#aaa;">Last maintained: ${car.latest_maintenance}</div>` : ''}
        </td>
      </tr>` : ''}

      <!-- CTA -->
      <tr>
        <td style="padding:16px 20px;">
          <a href="${car.detail_url}" style="display:inline-block;background:#D5001C;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.5px;">
            View on Porsche Finder &rarr;
          </a>
        </td>
      </tr>
    </table>`;
}

export function buildEmailHtml(newCars, stats) {
  const carCount = newCars.length;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;">
    <tr><td align="center" style="padding:20px;">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="padding:24px 0 16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#E8E8E8;letter-spacing:0.5px;">
              Taycan Turbo S <span style="color:#D5001C;">Finder</span>
            </div>
            <div style="font-size:13px;color:#888;margin-top:4px;">
              ${carCount} new listing${carCount > 1 ? 's' : ''} matching your spec
            </div>
          </td>
        </tr>

        <!-- Alert Banner -->
        <tr>
          <td style="padding-bottom:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#00B451;border-radius:8px;">
              <tr>
                <td style="padding:14px 20px;">
                  <div style="font-size:16px;font-weight:700;color:#fff;">
                    &#127951; ${carCount} new Taycan Turbo S just listed!
                  </div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">
                    Porsche Approved Pre-Owned &bull; Under &pound;60,000 &bull; Full spec match
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Car Cards -->
        <tr>
          <td>
            ${newCars.map(buildCarBlock).join('')}
          </td>
        </tr>

        <!-- Dashboard Link -->
        <tr>
          <td style="padding:16px 0;text-align:center;">
            <a href="https://taycan-search.vercel.app" style="display:inline-block;background:#222;color:#E8E8E8;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #444;">
              Open Dashboard
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 0;text-align:center;border-top:1px solid #333;">
            <div style="font-size:11px;color:#666;">
              Taycan Turbo S Finder &bull; Daily automated scan of
              <a href="https://finder.porsche.com" style="color:#888;">Porsche Finder UK</a>
            </div>
            <div style="font-size:11px;color:#555;margin-top:4px;">
              Filters: Turbo S &bull; &pound;60k max &bull; 2020-2023 &bull; Sport Chrono &bull; Pano Roof &bull; Burmester &bull; Privacy Glass &bull; 4+1 Seats &bull; Leather
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

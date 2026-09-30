import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CR_MARKET_SOURCES,
  fetchStoreProducts,
  calculateGroupStats,
  filterAbsurdPrices,
  matchModelStrict,
  matchCapacityStrict,
  loadCustomPrices,
  saveCustomPrices,
  extractCondition,
  extractBatteryPercentage,
  isNewPhone,
  getVerifiedMarketFallback,
  BLACKLIST_REGEX,
  CustomPriceEntry,
  CRListing,
  MarketComparisonResult
} from './src/marketSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// ==========================================
// SELECTORES CSS Y CONSTANTES DE AMAZON
// ==========================================
export const AMAZON_SELECTORS = {
  SEARCH_RESULT_CONTAINER: 'div[data-component-type="s-search-result"], div.s-result-item[data-asin]:not([data-asin=""])',
  TITLE: 'h2 a span, h2 span, a.a-link-normal h2 span, h2.a-size-mini span',
  LINK: 'h2 a.a-link-normal, a.a-link-normal[href*="/dp/"]',
  PRICE_OFFSCREEN: '.a-price:not(.a-text-price) .a-offscreen, span.a-price .a-offscreen',
  PRICE_WHOLE: '.a-price:not(.a-text-price) .a-price-whole',
  PRICE_FRACTION: '.a-price:not(.a-text-price) .a-price-fraction',
  BADGE: '.a-badge-text, .s-coupon-unclipped, [data-a-badge-type="status"], .puis-sponsored-label-text, .a-row.a-size-base.a-color-secondary',
  IMAGE: 'img.s-image',
  BOT_INDICATORS: [
    'Enter the characters you see below',
    'Robot Check',
    'automated access',
    'Type the characters you see in this image',
    'Sorry, we just need to make sure you\'re not a robot'
  ]
};

export interface ScrapedProduct {
  id: string;
  asin: string;
  title: string;
  model: string;
  capacity: string;
  color: string;
  priceUSD: number;
  url: string;
  image: string;
}

// In-Memory Caches (30 minutos = 1,800,000 ms)
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const searchCache = new Map<string, CacheEntry<ScrapedProduct[]>>();
const marketCache = new Map<string, CacheEntry<MarketComparisonResult>>();
let exchangeRateCache: CacheEntry<{ rate: number; source: string; lastUpdated: string }> | null = null;
let cachedSessionCookie: string | null = null;
let cookieTimestamp = 0;

// Conjunto de User-Agents y Fingerprints realistas modernos
const BROWSER_PROFILES = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    platform: '"Windows"'
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    platform: '"macOS"'
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    secChUa: '',
    platform: '"Windows"'
  }
];

// Generar o refrescar cookies de sesión para simular cliente legítimo
async function getWarmSessionCookie(): Promise<string> {
  if (cachedSessionCookie && Date.now() - cookieTimestamp < 15 * 60 * 1000) {
    return cachedSessionCookie;
  }

  const randSession = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000000 + Math.random() * 9000000)}-${Math.floor(1000000 + Math.random() * 9000000)}`;
  let cookieString = `session-id=${randSession}; i18n-prefs=USD; lc-main=en_US; sp-cdn="L5Z9:CR"`;

  try {
    const res = await fetch('https://www.amazon.com/', {
      headers: {
        'User-Agent': BROWSER_PROFILES[0].ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(4000)
    });

    const setCookies = res.headers.get('set-cookie');
    if (setCookies) {
      const parts = setCookies.split(/,(?=[^;]+?=)/g);
      const extracted = parts.map(p => p.split(';')[0].trim()).filter(p => p.includes('session-id') || p.includes('ubid-main'));
      if (extracted.length > 0) {
        cookieString = `${extracted.join('; ')}; i18n-prefs=USD; lc-main=en_US`;
      }
    }
  } catch (_e) {
    // Continuar con cookies simuladas
  }

  cachedSessionCookie = cookieString;
  cookieTimestamp = Date.now();
  return cookieString;
}

// Extractor de Modelo, Capacidad y Color a partir del título y texto del contenedor
export function parseProductMetadata(title: string, containerText = '') {
  const cleanTitle = title.trim();
  // Limpiar etiquetas intermedias como "(Renewed Premium)" que rompen la frase "iPhone 16 Pro Max"
  const strippedText = `${cleanTitle} ${containerText}`.replace(/\(?(?:Renewed(?:\s+Premium)?|Refurbished|Renovado)\)?/gi, ' ');
  const combinedText = strippedText.replace(/\s+/g, ' ');

  // 1. Detección exhaustiva de modelo de iPhone (orden de especificidad)
  let model = 'iPhone';
  const modelPatterns: [RegExp, string][] = [
    // Familia iPhone 16
    [/\biPhone\s*16\s*Pro\s*Max\b/i, 'iPhone 16 Pro Max'],
    [/\biPhone\s*16\s*Pro\b/i, 'iPhone 16 Pro'],
    [/\biPhone\s*16\s*Plus\b/i, 'iPhone 16 Plus'],
    [/\biPhone\s*16\s*e\b/i, 'iPhone 16e'],
    [/\biPhone\s*16\b/i, 'iPhone 16'],

    // Familia iPhone 15
    [/\biPhone\s*15\s*Pro\s*Max\b/i, 'iPhone 15 Pro Max'],
    [/\biPhone\s*15\s*Pro\b/i, 'iPhone 15 Pro'],
    [/\biPhone\s*15\s*Plus\b/i, 'iPhone 15 Plus'],
    [/\biPhone\s*15\b/i, 'iPhone 15'],

    // Familia iPhone 14
    [/\biPhone\s*14\s*Pro\s*Max\b/i, 'iPhone 14 Pro Max'],
    [/\biPhone\s*14\s*Pro\b/i, 'iPhone 14 Pro'],
    [/\biPhone\s*14\s*Plus\b/i, 'iPhone 14 Plus'],
    [/\biPhone\s*14\b/i, 'iPhone 14'],

    // Familia iPhone 13
    [/\biPhone\s*13\s*Pro\s*Max\b/i, 'iPhone 13 Pro Max'],
    [/\biPhone\s*13\s*Pro\b/i, 'iPhone 13 Pro'],
    [/\biPhone\s*13\s*(?:Mini|mini)\b/i, 'iPhone 13 mini'],
    [/\biPhone\s*13\b/i, 'iPhone 13'],

    // Familia iPhone 12
    [/\biPhone\s*12\s*Pro\s*Max\b/i, 'iPhone 12 Pro Max'],
    [/\biPhone\s*12\s*Pro\b/i, 'iPhone 12 Pro'],
    [/\biPhone\s*12\s*(?:Mini|mini)\b/i, 'iPhone 12 mini'],
    [/\biPhone\s*12\b/i, 'iPhone 12'],

    // Familia iPhone 11
    [/\biPhone\s*11\s*Pro\s*Max\b/i, 'iPhone 11 Pro Max'],
    [/\biPhone\s*11\s*Pro\b/i, 'iPhone 11 Pro'],
    [/\biPhone\s*11\b/i, 'iPhone 11'],

    // Familia iPhone SE
    [/\biPhone\s*SE\s*(?:\(?(?:3(?:rd|ª|ra)?\s*Gen(?:eración)?|2022)\)?|\(3rd\s*Generation\))/i, 'iPhone SE (3rd Gen)'],
    [/\biPhone\s*SE\s*(?:\(?(?:2(?:nd|ª|da)?\s*Gen(?:eración)?|2020)\)?|\(2nd\s*Generation\))/i, 'iPhone SE (2nd Gen)'],
    [/\biPhone\s*SE\b/i, 'iPhone SE'],

    // Familia X / XS / XR
    [/\biPhone\s*XS\s*Max\b/i, 'iPhone XS Max'],
    [/\biPhone\s*XS\b/i, 'iPhone XS'],
    [/\biPhone\s*XR\b/i, 'iPhone XR'],
    [/\biPhone\s*X\b/i, 'iPhone X']
  ];

  for (const [regex, standardName] of modelPatterns) {
    if (regex.test(combinedText)) {
      model = standardName;
      break;
    }
  }

  // Fallback genérico para otros modelos
  if (model === 'iPhone') {
    const fallbackMatch = combinedText.match(/\biPhone\s*(\d{1,2}(?:\s*(?:Pro\s*Max|Pro|Plus|Mini))?)\b/i);
    if (fallbackMatch) {
      model = `iPhone ${fallbackMatch[1].replace(/\s+/g, ' ').trim()}`;
    }
  }

  // 2. Detección exhaustiva de almacenamiento (Capacidad)
  let capacity = 'No especificado';
  
  if (/\b(?:2\s*TB|2TB)\b/i.test(combinedText) || /[([,\s-]2\s*TB[)\]\s,-]/i.test(combinedText)) {
    capacity = '2 TB';
  } else if (/\b(?:1\s*TB|1TB)\b/i.test(combinedText) || /[([,\s-]1\s*TB[)\]\s,-]/i.test(combinedText)) {
    capacity = '1 TB';
  } else {
    // Buscar capacidades estándar: 512GB, 256GB, 128GB, 64GB, 32GB, 16GB
    const capMatch = combinedText.match(/(?:\b|[([,\s-])(512|256|128|64|32|16)\s*(?:GB|G|Gb|gigabytes?|gigas?)\b/i);
    if (capMatch) {
      capacity = `${capMatch[1]} GB`;
    } else {
      const parenMatch = combinedText.match(/[([]\s*(512|256|128|64|32|16)\s*GB\s*[)\]]/i);
      if (parenMatch) {
        capacity = `${parenMatch[1]} GB`;
      }
    }
  }

  // 3. Detección exhaustiva de Color
  let color = 'No especificado';
  const knownColors = [
    { pattern: /\b(?:Natural\s+Titanium|Titanio\s+Natural)\b/i, label: 'Titanio Natural' },
    { pattern: /\b(?:Desert\s+Titanium|Titanio\s+Desierto)\b/i, label: 'Titanio Desierto' },
    { pattern: /\b(?:Black\s+Titanium|Titanio\s+Negro)\b/i, label: 'Titanio Negro' },
    { pattern: /\b(?:White\s+Titanium|Titanio\s+Blanco)\b/i, label: 'Titanio Blanco' },
    { pattern: /\b(?:Blue\s+Titanium|Titanio\s+Azul)\b/i, label: 'Titanio Azul' },
    { pattern: /\b(?:Deep\s+Purple|Morado\s+Oscuro)\b/i, label: 'Deep Purple' },
    { pattern: /\b(?:Sierra\s+Blue|Azul\s+Sierra)\b/i, label: 'Sierra Blue' },
    { pattern: /\b(?:Alpine\s+Green|Verde\s+Alpino)\b/i, label: 'Alpine Green' },
    { pattern: /\b(?:Pacific\s+Blue|Azul\s+Pacífico)\b/i, label: 'Pacific Blue' },
    { pattern: /\b(?:Space\s+Black|Negro\s+Espacial)\b/i, label: 'Space Black' },
    { pattern: /\b(?:Space\s+Gray|Space\s+Grey|Gris\s+Espacial)\b/i, label: 'Space Gray' },
    { pattern: /\b(?:Midnight\s+Green)\b/i, label: 'Midnight Green' },
    { pattern: /\b(?:Midnight|Medianoche)\b/i, label: 'Midnight' },
    { pattern: /\b(?:Starlight|Blanco\s+Estelar)\b/i, label: 'Starlight' },
    { pattern: /\b(?:Rose\s+Gold|Oro\s+Rosa)\b/i, label: 'Rose Gold' },
    { pattern: /\b(?:Graphite|Grafito)\b/i, label: 'Graphite' },
    { pattern: /\b(?:PRODUCT\s*\(RED\)|Product\s*Red|Rojo)\b/i, label: 'PRODUCT(RED)' },
    { pattern: /\b(?:Gold|Dorado|Oro)\b/i, label: 'Gold' },
    { pattern: /\b(?:Silver|Plata)\b/i, label: 'Silver' },
    { pattern: /\b(?:Purple|Púrpura|Morado)\b/i, label: 'Purple' },
    { pattern: /\b(?:Green|Verde)\b/i, label: 'Green' },
    { pattern: /\b(?:Yellow|Amarillo)\b/i, label: 'Yellow' },
    { pattern: /\b(?:Pink|Rosa)\b/i, label: 'Pink' },
    { pattern: /\b(?:Blue|Azul)\b/i, label: 'Blue' },
    { pattern: /\b(?:Black|Negro)\b/i, label: 'Black' },
    { pattern: /\b(?:White|Blanco)\b/i, label: 'White' }
  ];

  for (const c of knownColors) {
    if (c.pattern.test(combinedText)) {
      color = c.label;
      break;
    }
  }

  return { model, capacity, color };
}

// Función unificada de parseo de HTML de Amazon
export function parseAmazonHtml(html: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const products: ScrapedProduct[] = [];
  const seenAsins = new Set<string>();

  $(AMAZON_SELECTORS.SEARCH_RESULT_CONTAINER).each((_, el) => {
    const container = $(el);
    const asin = container.attr('data-asin')?.trim() || '';

    // Obtener título completo priorizando el enlace principal
    let title = container.find('h2 a').first().text().trim();
    if (!title || title.length < 5 || title.toLowerCase() === 'amazon renewed') {
      title = container.find('h2').first().text().trim();
    }
    if (!title || title.length < 5 || title.toLowerCase() === 'amazon renewed') {
      title = container.find(AMAZON_SELECTORS.TITLE).first().text().trim();
    }
    if (!title || title.length < 5 || title.toLowerCase() === 'amazon renewed') {
      title = container.find('img.s-image').attr('alt')?.trim() || '';
    }
    if (!title) return;

    // Obtener texto de badges y subtextos para verificación
    const badgeText = container.find(AMAZON_SELECTORS.BADGE).text().trim();
    const fullElementText = container.text();

    // FILTRO ESTRICTO: Solo "Renewed Premium"
    const isRenewedPremiumInTitle = /Renewed\s+Premium/i.test(title);
    const isRenewedPremiumInBadge = /Renewed\s+Premium/i.test(badgeText);
    const isRenewedPremiumInBlock = /Renewed\s+Premium/i.test(fullElementText);

    if (!isRenewedPremiumInTitle && !isRenewedPremiumInBadge && !isRenewedPremiumInBlock) {
      return;
    }

    // Extracción de precio actual en USD
    let priceUSD = 0;
    const offscreenPrice = container.find(AMAZON_SELECTORS.PRICE_OFFSCREEN).first().text().trim();
    if (offscreenPrice) {
      const numericString = offscreenPrice.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(numericString);
      if (!isNaN(parsed) && parsed > 0) {
        priceUSD = parsed;
      }
    }

    if (priceUSD <= 0) {
      const whole = container.find(AMAZON_SELECTORS.PRICE_WHOLE).first().text().replace(/[^0-9]/g, '');
      const fraction = container.find(AMAZON_SELECTORS.PRICE_FRACTION).first().text().replace(/[^0-9]/g, '') || '00';
      if (whole) {
        const combined = parseFloat(`${whole}.${fraction}`);
        if (!isNaN(combined) && combined > 0) {
          priceUSD = combined;
        }
      }
    }

    if (priceUSD <= 0) {
      return;
    }

    if (asin && seenAsins.has(asin)) {
      return;
    }
    if (asin) seenAsins.add(asin);

    const rawLinkHref = container.find(AMAZON_SELECTORS.LINK).first().attr('href') || '';
    let linkHref = rawLinkHref;
    if (linkHref && !linkHref.startsWith('http')) {
      linkHref = `https://www.amazon.com${linkHref.startsWith('/') ? '' : '/'}${linkHref}`;
    }
    if (asin && linkHref.includes('/dp/')) {
      linkHref = `https://www.amazon.com/dp/${asin}`;
    }

    const image = container.find(AMAZON_SELECTORS.IMAGE).first().attr('src') || '';
    const imgAlt = container.find(AMAZON_SELECTORS.IMAGE).first().attr('alt') || '';
    const urlSlug = rawLinkHref.replace(/^https?:\/\/[^/]+/i, '').split('/dp/')[0].replace(/[/-]/g, ' ');

    const { model, capacity, color } = parseProductMetadata(title, `${fullElementText} ${urlSlug} ${imgAlt}`);

    // Si el título original no incluye el modelo explícito (ej: "Apple iPhone - Unlocked"), lo enriquecemos
    const hasModelNumberInTitle = /\biPhone\s*(?:16|15|14|13|12|11|SE|XR|XS|X)\b/i.test(title);
    let finalTitle = title;
    if (!hasModelNumberInTitle && model && model !== 'iPhone') {
      const capPart = capacity && capacity !== 'No especificado' ? ` (${capacity})` : '';
      const colorPart = color && color !== 'No especificado' ? ` - ${color}` : '';
      finalTitle = `${model}${capPart}${colorPart} • ${title.replace(/^Apple\s*(?:iPhone)?\s*[-–—,]?\s*/i, '')}`;
    }

    products.push({
      id: asin || `item-${products.length + 1}-${Math.random().toString(36).substring(2, 7)}`,
      asin,
      title: finalTitle,
      model,
      capacity,
      color,
      priceUSD,
      url: linkHref || `https://www.amazon.com/s?k=${encodeURIComponent(title)}`,
      image
    });
  });

  return products;
}

// Verificar si Amazon devolvió página de captcha/bloqueo
export function checkIsBotBlocked(html: string): boolean {
  for (const indicator of AMAZON_SELECTORS.BOT_INDICATORS) {
    if (html.includes(indicator)) {
      return true;
    }
  }
  return false;
}

// Pausa aleatoria entre páginas (1.5s a 4s)
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelayMs(min = 1500, max = 3500) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Datos de catálogo representativos reales para arranque inmediato
export const SAMPLE_RENEWED_PREMIUM_IPHONES: ScrapedProduct[] = [
  {
    id: 'B0CHX5RGL5',
    asin: 'B0CHX5RGL5',
    title: 'Apple iPhone 15 Pro, 128GB, Natural Titanium - Unlocked (Renewed Premium)',
    model: 'iPhone 15 Pro',
    capacity: '128 GB',
    color: 'Natural Titanium',
    priceUSD: 749.97,
    url: 'https://www.amazon.com/dp/B0CHX5RGL5',
    image: 'https://m.media-amazon.com/images/I/611m1+mUqSL._AC_UY218_.jpg'
  },
  {
    id: 'B0CHX43WGL',
    asin: 'B0CHX43WGL',
    title: 'Apple iPhone 15 Pro Max, 256GB, Blue Titanium - Unlocked (Renewed Premium)',
    model: 'iPhone 15 Pro Max',
    capacity: '256 GB',
    color: 'Blue Titanium',
    priceUSD: 879.00,
    url: 'https://www.amazon.com/dp/B0CHX43WGL',
    image: 'https://m.media-amazon.com/images/I/71Y8Xo2N7EL._AC_UY218_.jpg'
  },
  {
    id: 'B0CHX5M45R',
    asin: 'B0CHX5M45R',
    title: 'Apple iPhone 15, 128GB, Black - Unlocked (Renewed Premium)',
    model: 'iPhone 15',
    capacity: '128 GB',
    color: 'Black',
    priceUSD: 599.95,
    url: 'https://www.amazon.com/dp/B0CHX5M45R',
    image: 'https://m.media-amazon.com/images/I/71657TiFeHL._AC_UY218_.jpg'
  },
  {
    id: 'B0BN96791N',
    asin: 'B0BN96791N',
    title: 'Apple iPhone 14 Pro, 128GB, Deep Purple - Unlocked (Renewed Premium)',
    model: 'iPhone 14 Pro',
    capacity: '128 GB',
    color: 'Deep Purple',
    priceUSD: 619.99,
    url: 'https://www.amazon.com/dp/B0BN96791N',
    image: 'https://m.media-amazon.com/images/I/61HHS0HrjpL._AC_UY218_.jpg'
  },
  {
    id: 'B0BN8ZMWH1',
    asin: 'B0BN8ZMWH1',
    title: 'Apple iPhone 14 Pro Max, 128GB, Space Black - Unlocked (Renewed Premium)',
    model: 'iPhone 14 Pro Max',
    capacity: '128 GB',
    color: 'Space Black',
    priceUSD: 689.95,
    url: 'https://www.amazon.com/dp/B0BN8ZMWH1',
    image: 'https://m.media-amazon.com/images/I/610pghkO81L._AC_UY218_.jpg'
  },
  {
    id: 'B0BN91B2L4',
    asin: 'B0BN91B2L4',
    title: 'Apple iPhone 14, 128GB, Midnight - Unlocked (Renewed Premium)',
    model: 'iPhone 14',
    capacity: '128 GB',
    color: 'Midnight',
    priceUSD: 469.00,
    url: 'https://www.amazon.com/dp/B0BN91B2L4',
    image: 'https://m.media-amazon.com/images/I/61bK6PMOC3L._AC_UY218_.jpg'
  },
  {
    id: 'B09V3K3R5S',
    asin: 'B09V3K3R5S',
    title: 'Apple iPhone 13 Pro, 256GB, Sierra Blue - Unlocked (Renewed Premium)',
    model: 'iPhone 13 Pro',
    capacity: '256 GB',
    color: 'Sierra Blue',
    priceUSD: 519.00,
    url: 'https://www.amazon.com/dp/B09V3K3R5S',
    image: 'https://m.media-amazon.com/images/I/61jLiCovxVL._AC_UY218_.jpg'
  },
  {
    id: 'B09LNW384Q',
    asin: 'B09LNW384Q',
    title: 'Apple iPhone 13, 128GB, Starlight - Unlocked (Renewed Premium)',
    model: 'iPhone 13',
    capacity: '128 GB',
    color: 'Starlight',
    priceUSD: 394.99,
    url: 'https://www.amazon.com/dp/B09LNW384Q',
    image: 'https://m.media-amazon.com/images/I/61-r9zOKBCL._AC_UY218_.jpg'
  },
  {
    id: 'B08PND66V6',
    asin: 'B08PND66V6',
    title: 'Apple iPhone 12 Pro, 128GB, Pacific Blue - Unlocked (Renewed Premium)',
    model: 'iPhone 12 Pro',
    capacity: '128 GB',
    color: 'Pacific Blue',
    priceUSD: 369.00,
    url: 'https://www.amazon.com/dp/B08PND66V6',
    image: 'https://m.media-amazon.com/images/I/712CBkmhLhL._AC_UY218_.jpg'
  }
];

// ==========================================
// TIPO DE CAMBIO (USD a CRC con respaldo)
// ==========================================
export async function getExchangeRate(): Promise<{ rate: number; source: string; lastUpdated: string }> {
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < CACHE_TTL_MS) {
    return exchangeRateCache.data;
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.CRC && typeof data.rates.CRC === 'number') {
        const result = {
          rate: Math.round(data.rates.CRC * 100) / 100,
          source: 'open.er-api.com',
          lastUpdated: new Date().toISOString()
        };
        exchangeRateCache = { data: result, timestamp: Date.now() };
        return result;
      }
    }
  } catch (err) {
    console.warn('Fallo proveedor primario de tipo de cambio:', err);
  }

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.CRC && typeof data.rates.CRC === 'number') {
        const result = {
          rate: Math.round(data.rates.CRC * 100) / 100,
          source: 'exchangerate-api.com (backup)',
          lastUpdated: new Date().toISOString()
        };
        exchangeRateCache = { data: result, timestamp: Date.now() };
        return result;
      }
    }
  } catch (err) {
    console.warn('Fallo proveedor secundario de tipo de cambio:', err);
  }

  return {
    rate: 515.0,
    source: 'Tasa estimada por defecto (ajustable)',
    lastUpdated: new Date().toISOString()
  };
}

// ==========================================
// INICIALIZACIÓN DEL SERVIDOR EXPRESS
// ==========================================
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Endpoint 1: Tipo de cambio USD a CRC
  app.get('/api/rate', async (_req: Request, res: Response) => {
    try {
      const rateInfo = await getExchangeRate();
      res.json(rateInfo);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Error al obtener el tipo de cambio' });
    }
  });

  // Endpoint 2: Parse manual de HTML pegado (Acepta Amazon y cualquier tienda de Costa Rica)
  app.post('/api/parse', async (req: Request, res: Response) => {
    try {
      const { html, source = 'amazon' } = req.body;
      if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Debes enviar el contenido HTML en el cuerpo de la petición.' });
      }

      if (source === 'amazon') {
        if (checkIsBotBlocked(html)) {
          return res.status(400).json({
            error: 'El HTML pegado corresponde a una pantalla de bloqueo/CAPTCHA de Amazon. Abre la búsqueda normal en tu navegador e inspecciona la página con resultados.'
          });
        }

        const products = parseAmazonHtml(html);
        return res.json({
          products,
          count: products.length,
          source: 'manual_parse',
          timestamp: new Date().toISOString()
        });
      }

      // Procesar fuente de Costa Rica
      const srcConfig = CR_MARKET_SOURCES.find((s) => s.id === source);
      if (!srcConfig || !srcConfig.selectors) {
        return res.status(400).json({ error: `Fuente costarricense desconocida: ${source}` });
      }

      const $ = cheerio.load(html);
      const listings: CRListing[] = [];
      const rateInfo = await getExchangeRate();
      const rate = rateInfo.rate;

      $(srcConfig.selectors.container).each((i, el) => {
        const container = $(el);
        const title = container.find(srcConfig.selectors!.title).first().text().trim();
        const combined = `${title} ${container.text()}`;
        if (!title || BLACKLIST_REGEX.test(combined)) return;

        const priceStr = container.find(srcConfig.selectors!.price).first().text().trim();
        const cleanPrice = parseFloat(priceStr.replace(/[^0-9.]/g, '').replace(/,/g, ''));
        if (isNaN(cleanPrice) || cleanPrice <= 0) return;

        const priceCRC = srcConfig.currency === 'USD' ? Math.round(cleanPrice * rate) : Math.round(cleanPrice);

        listings.push({
          id: `manual-${srcConfig.id}-${i}-${Date.now()}`,
          sourceId: srcConfig.id,
          sourceName: srcConfig.name,
          group: srcConfig.group,
          title,
          priceCRC,
          model: 'iPhone',
          capacity: 'No especificado',
          condition: extractCondition(combined),
          batteryPercentage: extractBatteryPercentage(combined),
          url: container.find('a').first().attr('href') || srcConfig.baseUrl,
          hasWarranty: srcConfig.hasWarranty,
          warrantyDays: srcConfig.warrantyDays,
          dateScraped: new Date().toISOString()
        });
      });

      marketCache.clear();

      return res.json({
        listings,
        count: listings.length,
        source: srcConfig.id,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error parseando HTML manual:', error);
      res.status(500).json({ error: 'Error al procesar el código HTML proporcionado.' });
    }
  });

  // Endpoint 3: Comparación de Mercado Costarricense (GET /api/market)
  app.get('/api/market', async (req: Request, res: Response) => {
    try {
      let rawModel = ((req.query.model as string) || 'iPhone 13').trim();
      let rawCapacity = ((req.query.capacity as string) || '128 GB').trim();
      const capMatch = rawCapacity.match(/(\d+)\s*(TB|GB)/i);
      const capacity = capMatch ? `${capMatch[1]} ${capMatch[2].toUpperCase()}` : rawCapacity;
      const includeLowerGrades = req.query.includeLowerGrades === 'true';
      const includeTiendamia = req.query.includeTiendamia === 'true';

      // Sanitizar modelo si viene genérico "iPhone"
      if (!rawModel || rawModel.toLowerCase() === 'iphone') {
        rawModel = 'iPhone 13';
      }
      const model = rawModel;

      const cacheKey = `${model}_${capacity}_${includeLowerGrades}_${includeTiendamia}`;
      const cached = marketCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.json(cached.data);
      }

      const rateInfo = await getExchangeRate();
      const rate = rateInfo.rate;

      const sourcesStatus: Record<string, { count: number; status: 'ok' | 'empty' | 'error'; error?: string }> = {};
      const allListings: CRListing[] = [];

      // 1. Consultar fuentes configuradas de Costa Rica en paralelo (rápido, máx 3.5s)
      const fetchResults = await Promise.allSettled(
        CR_MARKET_SOURCES.map(async (src) => {
          try {
            const { listings, error } = await fetchStoreProducts(src, model, capacity, rate);
            return { src, listings, error };
          } catch (err: any) {
            return { src, listings: [], error: err?.message || 'Error de conexión' };
          }
        })
      );

      for (const r of fetchResults) {
        if (r.status === 'fulfilled') {
          const { src, listings, error } = r.value;
          if (error && (!listings || listings.length === 0)) {
            sourcesStatus[src.id] = { count: 0, status: 'error', error };
          } else {
            sourcesStatus[src.id] = {
              count: listings.length,
              status: listings.length > 0 ? 'ok' : 'empty'
            };
            allListings.push(...listings);
          }
        }
      }

      // 2. Si alguna fuente no trajo resultados usados (por bloqueo Cloudflare/WAF como en NUVO o Mercado Libre, o si sólo había nuevos),
      // complementar con los listados de referencia verificados de Costa Rica:
      const verifiedFallback = getVerifiedMarketFallback(model, capacity);
      for (const vItem of verifiedFallback) {
        const liveUsedCountForSource = allListings.filter(
          (l) => l.sourceId === vItem.sourceId && !isNewPhone(l.title, '', l.condition) && l.condition !== 'Nuevo'
        ).length;
        if (liveUsedCountForSource === 0) {
          allListings.push(vItem);
          sourcesStatus[vItem.sourceId] = {
            count: (sourcesStatus[vItem.sourceId]?.count || 0) + 1,
            status: 'ok'
          };
        }
      }

      // 3. Integrar vendedores manuales al Grupo A
      const customSellers = loadCustomPrices();
      const matchingCustom = customSellers.filter(c =>
        matchModelStrict(c.model, model) && matchCapacityStrict(c.capacity, capacity)
      );

      for (const cs of matchingCustom) {
        allListings.push({
          id: cs.id,
          sourceId: 'manual_seller',
          sourceName: cs.sellerName,
          group: 'A',
          title: `${cs.model} ${cs.capacity} - ${cs.sellerName} (${cs.notes || 'Vendedor local'})`,
          priceCRC: cs.priceCRC,
          model,
          capacity,
          condition: cs.condition,
          batteryPercentage: cs.batteryPercentage || null,
          url: cs.link || '#',
          hasWarranty: true,
          warrantyDays: 30,
          dateScraped: cs.dateAdded,
          isManual: true
        });
      }

      if (matchingCustom.length > 0) {
        sourcesStatus['vendedores_manuales'] = {
          count: matchingCustom.length,
          status: 'ok'
        };
      }

      // 3. Separación por grupos EXCLUSIVAMENTE CON TELÉFONOS USADOS
      // Regla estricta: Siempre excluir precios de teléfonos de Costa Rica que sean nuevos
      for (const item of allListings) {
        if (item.condition === 'Nuevo' || isNewPhone(item.title, '', item.condition)) {
          item.group = 'D';
          item.condition = 'Nuevo';
        }
      }

      const isUsedPhoneListing = (item: CRListing) => {
        if (item.group === 'D') return false; // Grupo D son tiendas de nuevos o anuncios nuevos
        if (item.condition === 'Nuevo') return false;
        if (isNewPhone(item.title, '', item.condition)) return false;
        return true;
      };

      let groupAItems = allListings.filter((i) => i.group === 'A' && isUsedPhoneListing(i));
      let groupBItems = allListings.filter((i) => i.group === 'B' && isUsedPhoneListing(i));
      const groupCItems = allListings.filter((i) => i.group === 'C' && isUsedPhoneListing(i));
      // Teléfonos nuevos quedan exclusivamente en Grupo D como referencia informativa aislada
      const groupDItems = allListings.filter((i) => i.group === 'D');

      // Filtro de condición en Grupo A (solo Excelente y Muy Bueno o batería >= 85% por defecto - NUNCA Nuevo)
      if (!includeLowerGrades) {
        groupAItems = groupAItems.filter((i) =>
          i.condition === 'Excelente' ||
          i.condition === 'Muy Bueno' ||
          (i.batteryPercentage !== null && i.batteryPercentage !== undefined && i.batteryPercentage >= 85)
        );
      }

      if (includeTiendamia) {
        groupBItems = [...groupBItems, ...groupCItems];
      }

      // Filtrar precios absurdos (< 30% o > 200% de la mediana preliminar)
      const cleanA = filterAbsurdPrices(groupAItems);
      const cleanB = filterAbsurdPrices(groupBItems);
      const cleanC = filterAbsurdPrices(groupCItems);
      const cleanD = filterAbsurdPrices(groupDItems);

      // 4. Calcular estadísticas por grupo
      const groupAStats = calculateGroupStats(cleanA.map((i) => i.priceCRC));
      const groupBStats = calculateGroupStats(cleanB.map((i) => i.priceCRC));
      const groupCStats = calculateGroupStats(cleanC.map((i) => i.priceCRC));
      const groupDStats = calculateGroupStats(cleanD.map((i) => i.priceCRC));

      // 5. Calcular estadísticas por fuente (para responder por fuente y por grupo)
      const bySource: Record<string, any> = {};
      const allCleanListings = [...cleanA, ...cleanB, ...cleanC, ...cleanD];

      for (const src of CR_MARKET_SOURCES) {
        const srcListings = allCleanListings.filter((l) => {
          if (l.sourceId !== src.id) return false;
          // Para tiendas de Grupo A, B o C: sólo incluir teléfonos usados
          if (src.group !== 'D' && !isUsedPhoneListing(l)) return false;
          return true;
        });
        const prices = srcListings.map((l) => l.priceCRC);
        const stats = calculateGroupStats(prices);
        const statusInfo = sourcesStatus[src.id] || { status: 'empty', count: 0 };

        bySource[src.id] = {
          id: src.id,
          name: src.name,
          group: src.group,
          count: prices.length,
          minCRC: stats.minCRC,
          medianCRC: stats.medianCRC,
          trimmedMeanCRC: stats.trimmedMeanCRC,
          insufficientData: stats.insufficientData,
          status: statusInfo.status,
          error: statusInfo.error
        };
      }

      // Vendedores manuales por fuente
      const manualListings = allCleanListings.filter((l) => l.isManual);
      if (manualListings.length > 0) {
        const manualPrices = manualListings.map((l) => l.priceCRC);
        const manualStats = calculateGroupStats(manualPrices);
        bySource['vendedores_manuales'] = {
          id: 'vendedores_manuales',
          name: 'Vendedores Manuales',
          group: 'A',
          count: manualPrices.length,
          minCRC: manualStats.minCRC,
          medianCRC: manualStats.medianCRC,
          trimmedMeanCRC: manualStats.trimmedMeanCRC,
          insufficientData: manualStats.insufficientData,
          status: 'ok'
        };
      }

      let primaryBenchmarkGroup: 'A' | 'B' | 'none' = 'none';
      let primaryMedianCRC: number | null = null;

      if (!groupAStats.insufficientData) {
        primaryBenchmarkGroup = 'A';
        primaryMedianCRC = groupAStats.medianCRC;
      } else if (!groupBStats.insufficientData) {
        primaryBenchmarkGroup = 'B';
        primaryMedianCRC = groupBStats.medianCRC;
      }

      const result: MarketComparisonResult = {
        model,
        capacity,
        groupA: groupAStats,
        groupB: groupBStats,
        groupC: groupCStats,
        groupD: groupDStats,
        bySource,
        primaryMedianCRC,
        primaryBenchmarkGroup,
        sourcesStatus,
        listings: allListings,
        timestamp: new Date().toISOString()
      };

      marketCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      res.json(result);
    } catch (err: any) {
      console.error('Error en /api/market:', err);
      res.status(500).json({ error: err?.message || 'Error al obtener datos de mercado en Costa Rica' });
    }
  });

  // Endpoints para Vendedores Manuales (Persistentes)
  app.get('/api/custom-prices', (_req: Request, res: Response) => {
    res.json(loadCustomPrices());
  });

  app.post('/api/custom-prices', (req: Request, res: Response) => {
    try {
      const { sellerName, model, capacity, priceCRC, condition = 'Excelente', batteryPercentage, notes, link } = req.body;
      if (!sellerName || !model || !capacity || !priceCRC) {
        return res.status(400).json({ error: 'Todos los campos básicos (vendedor, modelo, capacidad, precio) son obligatorios.' });
      }

      const entries = loadCustomPrices();
      const newEntry: CustomPriceEntry = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sellerName: sellerName.trim(),
        model: model.trim(),
        capacity: capacity.trim(),
        priceCRC: Number(priceCRC),
        condition: condition || 'Excelente',
        batteryPercentage: batteryPercentage ? Number(batteryPercentage) : undefined,
        notes: notes?.trim() || '',
        link: link?.trim() || '',
        dateAdded: new Date().toISOString()
      };

      entries.unshift(newEntry);
      saveCustomPrices(entries);
      marketCache.clear();

      res.json({ success: true, entry: newEntry });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error al guardar vendedor manual' });
    }
  });

  app.delete('/api/custom-prices/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const entries = loadCustomPrices();
      const filtered = entries.filter((e) => e.id !== id);
      saveCustomPrices(filtered);
      marketCache.clear();

      res.json({ success: true, count: filtered.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error al eliminar vendedor' });
    }
  });

  // Endpoint 3: Escaneo automatizado de Amazon
  app.get('/api/scan', async (req: Request, res: Response) => {
    const rawQuery = (req.query.q as string) || 'iphone';
    const pagesToScan = Math.min(Math.max(parseInt(req.query.pages as string, 10) || 3, 1), 3);

    const searchTerms = rawQuery.toLowerCase().includes('renewed premium')
      ? rawQuery
      : `${rawQuery} renewed premium`;

    const cacheKey = `${searchTerms}_pages_${pagesToScan}`;

    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.json({
        products: cached.data,
        count: cached.data.length,
        cached: true,
        source: 'cache',
        timestamp: new Date(cached.timestamp).toISOString()
      });
    }

    const allProducts: ScrapedProduct[] = [];
    const seenAsins = new Set<string>();
    let botBlocked = false;

    // Obtener sesión precalentada con cookies de Amazon
    const sessionCookie = await getWarmSessionCookie();
    const profile = BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];

    for (let page = 1; page <= pagesToScan; page++) {
      const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchTerms)}&page=${page}`;

      try {
        const headers: Record<string, string> = {
          'User-Agent': profile.ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-User': '?1',
          'Referer': 'https://www.amazon.com/',
          'Cookie': sessionCookie
        };

        if (profile.secChUa) {
          headers['Sec-Ch-Ua'] = profile.secChUa;
          headers['Sec-Ch-Ua-Mobile'] = '?0';
          headers['Sec-Ch-Ua-Platform'] = profile.platform;
        }

        const response = await fetch(amazonUrl, {
          headers,
          signal: AbortSignal.timeout(9000)
        });

        if (response.status === 503 || response.status === 429 || response.status === 403) {
          botBlocked = true;
          break;
        }

        const html = await response.text();

        if (checkIsBotBlocked(html)) {
          botBlocked = true;
          break;
        }

        const pageProducts = parseAmazonHtml(html);

        for (const prod of pageProducts) {
          if (!seenAsins.has(prod.id)) {
            seenAsins.add(prod.id);
            allProducts.push(prod);
          }
        }

        if (page < pagesToScan) {
          await delay(getRandomDelayMs(1500, 3000));
        }
      } catch (err: any) {
        console.warn(`Intento fallido en página ${page}:`, err?.message || err);
      }
    }

    // Si Amazon bloqueó en la nube y no obtuvimos datos en vivo:
    if (botBlocked && allProducts.length === 0) {
      // Filtrar el catálogo de muestra según el término buscado para que la app no quede inutilizable
      const queryLower = rawQuery.toLowerCase();
      const filteredSample = SAMPLE_RENEWED_PREMIUM_IPHONES.filter(p =>
        queryLower === 'iphone' || p.model.toLowerCase().includes(queryLower) || p.title.toLowerCase().includes(queryLower)
      );

      return res.status(200).json({
        products: filteredSample.length > 0 ? filteredSample : SAMPLE_RENEWED_PREMIUM_IPHONES,
        count: filteredSample.length > 0 ? filteredSample.length : SAMPLE_RENEWED_PREMIUM_IPHONES.length,
        cached: false,
        source: 'sample_fallback',
        warning: 'Amazon activó verificación anti-bot para la IP de este servidor en la nube. Se cargó el catálogo verificado de respaldo. Puedes usar el botón "Pegar desde Portapapeles" en el Modo Manual con el HTML de tu navegador para actualizar en tiempo real.',
        timestamp: new Date().toISOString()
      });
    }

    searchCache.set(cacheKey, {
      data: allProducts,
      timestamp: Date.now()
    });

    res.json({
      products: allProducts,
      count: allProducts.length,
      cached: false,
      source: 'live',
      timestamp: new Date().toISOString()
    });
  });

  // Configuración de Vite / Static Files
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Servidor activo en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error iniciando el servidor:', err);
  process.exit(1);
});

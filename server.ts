import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import type {
  AuditVerdict,
  AutopilotConfig,
  AutopilotQualityFilter,
  AutopilotRegion,
  BusinessLead,
  GroundedLink,
  SearchSource,
  WebsiteAudit,
} from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const AUTOPILOT_FILE = path.join(DATA_DIR, 'autopilot.json');

const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const DEFAULT_AUTOPILOT: AutopilotConfig = {
  enabled: false,
  intervalMinutes: 5,
  region: 'world',
  customCities: '',
  niches: 'стоматологии, автосервисы, юридические услуги, ремонт квартир, салоны красоты',
  qualityFilter: 'weak_only',
  autoEnrich: true,
  visitedCities: [],
  isRunning: false,
};

interface CityTarget {
  city: string;
  country: string;
  regionCode: string;
}

const REGION_ALLOWED_COUNTRIES: Record<
  Exclude<AutopilotRegion, 'world' | 'custom'>,
  Set<string>
> = {
  cis: new Set(['RU', 'KZ', 'AM', 'TJ', 'UZ', 'BY', 'KG', 'AZ', 'MD']),
  europe: new Set([
    'PT', 'ES', 'DE', 'PL', 'CZ', 'AT', 'NL', 'IT', 'HU', 'RS',
    'LV', 'EE', 'LT', 'BG', 'GR', 'FR', 'GB', 'CH', 'SK', 'RO', 'HR',
  ]),
  americas: new Set(['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'CL', 'PE']),
};

const REGION_CITY_PROFILES: Record<Exclude<AutopilotRegion, 'custom'>, CityTarget[]> = {
  cis: [
    { city: 'Алматы', country: 'Казахстан', regionCode: 'KZ' },
    { city: 'Астана', country: 'Казахстан', regionCode: 'KZ' },
    { city: 'Шымкент', country: 'Казахстан', regionCode: 'KZ' },
    { city: 'Караганда', country: 'Казахстан', regionCode: 'KZ' },
    { city: 'Москва', country: 'Россия', regionCode: 'RU' },
    { city: 'Санкт-Петербург', country: 'Россия', regionCode: 'RU' },
    { city: 'Казань', country: 'Россия', regionCode: 'RU' },
    { city: 'Екатеринбург', country: 'Россия', regionCode: 'RU' },
    { city: 'Новосибирск', country: 'Россия', regionCode: 'RU' },
    { city: 'Краснодар', country: 'Россия', regionCode: 'RU' },
    { city: 'Ереван', country: 'Армения', regionCode: 'AM' },
    { city: 'Гюмри', country: 'Армения', regionCode: 'AM' },
    { city: 'Душанбе', country: 'Таджикистан', regionCode: 'TJ' },
    { city: 'Худжанд', country: 'Таджикистан', regionCode: 'TJ' },
    { city: 'Ташкент', country: 'Узбекистан', regionCode: 'UZ' },
    { city: 'Самарканд', country: 'Узбекистан', regionCode: 'UZ' },
    { city: 'Минск', country: 'Беларусь', regionCode: 'BY' },
    { city: 'Гомель', country: 'Беларусь', regionCode: 'BY' },
    { city: 'Бишкек', country: 'Кыргызстан', regionCode: 'KG' },
    { city: 'Ош', country: 'Кыргызстан', regionCode: 'KG' },
    { city: 'Баку', country: 'Азербайджан', regionCode: 'AZ' },
    { city: 'Кишинёв', country: 'Молдова', regionCode: 'MD' },
  ],
  europe: [
    { city: 'Лиссабон', country: 'Португалия', regionCode: 'PT' },
    { city: 'Порту', country: 'Португалия', regionCode: 'PT' },
    { city: 'Барселона', country: 'Испания', regionCode: 'ES' },
    { city: 'Мадрид', country: 'Испания', regionCode: 'ES' },
    { city: 'Валенсия', country: 'Испания', regionCode: 'ES' },
    { city: 'Берлин', country: 'Германия', regionCode: 'DE' },
    { city: 'Мюнхен', country: 'Германия', regionCode: 'DE' },
    { city: 'Варшава', country: 'Польша', regionCode: 'PL' },
    { city: 'Краков', country: 'Польша', regionCode: 'PL' },
    { city: 'Прага', country: 'Чехия', regionCode: 'CZ' },
    { city: 'Вена', country: 'Австрия', regionCode: 'AT' },
    { city: 'Амстердам', country: 'Нидерланды', regionCode: 'NL' },
    { city: 'Милан', country: 'Италия', regionCode: 'IT' },
    { city: 'Будапешт', country: 'Венгрия', regionCode: 'HU' },
    { city: 'Белград', country: 'Сербия', regionCode: 'RS' },
    { city: 'Рига', country: 'Латвия', regionCode: 'LV' },
    { city: 'Таллин', country: 'Эстония', regionCode: 'EE' },
    { city: 'София', country: 'Болгария', regionCode: 'BG' },
  ],
  americas: [
    { city: 'Нью-Йорк', country: 'США', regionCode: 'US' },
    { city: 'Майами', country: 'США', regionCode: 'US' },
    { city: 'Остин', country: 'США', regionCode: 'US' },
    { city: 'Лос-Анджелес', country: 'США', regionCode: 'US' },
    { city: 'Чикаго', country: 'США', regionCode: 'US' },
    { city: 'Денвер', country: 'США', regionCode: 'US' },
    { city: 'Сиэтл', country: 'США', regionCode: 'US' },
    { city: 'Торонто', country: 'Канада', regionCode: 'CA' },
    { city: 'Ванкувер', country: 'Канада', regionCode: 'CA' },
    { city: 'Монреаль', country: 'Канада', regionCode: 'CA' },
    { city: 'Мехико', country: 'Мексика', regionCode: 'MX' },
    { city: 'Сан-Паулу', country: 'Бразилия', regionCode: 'BR' },
    { city: 'Буэнос-Айрес', country: 'Аргентина', regionCode: 'AR' },
    { city: 'Богота', country: 'Колумбия', regionCode: 'CO' },
  ],
  world: [
    { city: 'Токио', country: 'Япония', regionCode: 'JP' },
    { city: 'Лондон', country: 'Великобритания', regionCode: 'GB' },
    { city: 'Дубай', country: 'ОАЭ', regionCode: 'AE' },
    { city: 'Стамбул', country: 'Турция', regionCode: 'TR' },
    { city: 'Берлин', country: 'Германия', regionCode: 'DE' },
    { city: 'Бангкок', country: 'Таиланд', regionCode: 'TH' },
    { city: 'Сеул', country: 'Южная Корея', regionCode: 'KR' },
    { city: 'Лиссабон', country: 'Португалия', regionCode: 'PT' },
    { city: 'Барселона', country: 'Испания', regionCode: 'ES' },
    { city: 'Торонто', country: 'Канада', regionCode: 'CA' },
    { city: 'Сингапур', country: 'Сингапур', regionCode: 'SG' },
    { city: 'Мехико', country: 'Мексика', regionCode: 'MX' },
    { city: 'Варшава', country: 'Польша', regionCode: 'PL' },
    { city: 'Прага', country: 'Чехия', regionCode: 'CZ' },
    { city: 'Алматы', country: 'Казахстан', regionCode: 'KZ' },
    { city: 'Белград', country: 'Сербия', regionCode: 'RS' },
    { city: 'Вена', country: 'Австрия', regionCode: 'AT' },
    { city: 'Милан', country: 'Италия', regionCode: 'IT' },
    { city: 'Остин', country: 'США', regionCode: 'US' },
    { city: 'Анталья', country: 'Турция', regionCode: 'TR' },
    { city: 'Ташкент', country: 'Узбекистан', regionCode: 'UZ' },
    { city: 'Ереван', country: 'Армения', regionCode: 'AM' },
    { city: 'Душанбе', country: 'Таджикистан', regionCode: 'TJ' },
  ],
};

const FALLBACK_NICHES = [
  'стоматологии',
  'автосервисы',
  'юридические услуги',
  'ремонт квартир',
  'салоны красоты',
  'ветеринарные клиники',
  'частные школы',
  'мебельные мастерские',
];

function getMapsApiKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function isGeminiQuotaError(err: unknown): boolean {
  const msg = extractRawErrorMessage(err);
  const status = (err as { status?: unknown; code?: unknown })?.status ??
    (err as { code?: unknown })?.code;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    /exceeded your current quota|rate[- ]?limit/i.test(msg)
  );
}

function isGeminiAuthError(err: unknown): boolean {
  const msg = extractRawErrorMessage(err);
  const status = (err as { status?: unknown; code?: unknown })?.status ??
    (err as { code?: unknown })?.code;
  return (
    status === 403 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    /api key not valid/i.test(msg)
  );
}

function isGeminiTransientError(err: unknown): boolean {
  const msg = extractRawErrorMessage(err);
  const status = (err as { status?: unknown; code?: unknown })?.status ??
    (err as { code?: unknown })?.code;
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /\b(500|502|503|504)\b/.test(msg) ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    /high demand|overloaded|temporarily unavailable|try again later|timed out|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
      msg
    )
  );
}

function isRetryableGeminiError(err: unknown): boolean {
  return isGeminiQuotaError(err) || isGeminiTransientError(err);
}

function getGeminiErrorStatus(err: unknown): number {
  if (isGeminiQuotaError(err)) return 429;
  if (isGeminiAuthError(err)) return 403;
  if (isGeminiTransientError(err)) return 503;
  return 500;
}

function parseGeminiJsonError(raw: string): { code?: number; status?: string; message?: string } | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start)) as {
      error?: { code?: number; status?: string; message?: string };
    };
    if (parsed && parsed.error) return parsed.error;
  } catch {
    // ignore parse failure
  }
  return null;
}

function formatGeminiError(err: unknown): string {
  const raw = extractRawErrorMessage(err).trim();
  const parsed = parseGeminiJsonError(raw);
  console.error('[Gemini API Error]', parsed ?? raw);

  if (isGeminiQuotaError(err)) {
    return 'Превышен лимит запросов к Gemini API (429 RESOURCE_EXHAUSTED). Подождите 30–60 секунд и повторите сканирование либо выберите API-ключ с биллингом в Settings > Secrets.';
  }
  if (isGeminiAuthError(err)) {
    return 'Ошибка доступа к Gemini API. Проверьте GEMINI_API_KEY в панели Settings > Secrets.';
  }
  if (isGeminiTransientError(err)) {
    return 'Сервер ИИ сейчас перегружен (503 UNAVAILABLE). Повторите попытку через 10–20 секунд.';
  }
  if (parsed?.message) {
    const codeTag = parsed.code ? ` (${parsed.code}${parsed.status ? ` ${parsed.status}` : ''})` : '';
    return `Ошибка Gemini API${codeTag}: ${parsed.message.slice(0, 220)}`;
  }
  if (!raw || raw.startsWith('{')) {
    return 'Не удалось выполнить запрос к Gemini API. Попробуйте повторить через несколько секунд.';
  }
  return raw.slice(0, 260);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: GenerateContentParameters['contents'];
    tools?: Array<Record<string, unknown>>;
    responseMimeType?: string;
    preferLite?: boolean;
  }
): Promise<GenerateContentResponse> {
  const hasMapsTool = Boolean(params.tools?.some((t) => 'googleMaps' in t));
  const buildConfig = (
    model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
    tools?: Array<Record<string, unknown>>
  ): GenerateContentParameters['config'] => {
    const config: Record<string, unknown> = {
      thinkingConfig: {
        thinkingLevel:
          model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
      },
    };
    if (tools && tools.length > 0) {
      config.tools = tools;
    }
    if (params.responseMimeType && !hasMapsTool) {
      config.responseMimeType = params.responseMimeType;
    }
    return config as GenerateContentParameters['config'];
  };

  const callModel = (
    model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
    tools?: Array<Record<string, unknown>>
  ) =>
    withTimeout(
      ai.models.generateContent({
        model,
        contents: params.contents,
        config: buildConfig(model, tools),
      }),
      28000,
      `Gemini ${model}`
    );

  const primaryModel = params.preferLite ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

  try {
    return await callModel(primaryModel, params.tools);
  } catch (err1) {
    if (!isRetryableGeminiError(err1)) {
      throw err1;
    }

    // If primary was gemini-4-hydrogen and hit 503/high-demand/timeout, switch immediately to gemini-3.1-flash-lite
    if (primaryModel === 'gemini-4-hydrogen' && isGeminiTransientError(err1)) {
      await sleep(600);
      try {
        return await callModel('gemini-3.1-flash-lite', params.tools);
      } catch (errLite1) {
        const msgLite1 = extractRawErrorMessage(errLite1);
        const hadUrlContext = Boolean(params.tools?.some((t) => 'urlContext' in t));
        if (hadUrlContext && (/400|INVALID_ARGUMENT|urlContext/i.test(msgLite1) || isGeminiTransientError(errLite1))) {
          await sleep(800);
          return await callModel('gemini-3.1-flash-lite', [{ googleSearch: {} }]);
        }
        if (isRetryableGeminiError(errLite1)) {
          await sleep(1800);
          return await callModel('gemini-3.1-flash-lite', params.tools);
        }
        throw errLite1;
      }
    }

    // Backoff on 429 quota or flash-lite transient error
    await sleep(isGeminiQuotaError(err1) ? 2500 : 1200);

    try {
      return await callModel(primaryModel, params.tools);
    } catch (err2) {
      if (!isRetryableGeminiError(err2) || primaryModel === 'gemini-3.1-flash-lite') {
        throw err2;
      }

      // Fallback attempt on lighter gemini-3.1-flash-lite
      await sleep(1200);
      try {
        return await callModel('gemini-3.1-flash-lite', params.tools);
      } catch (err3) {
        const msg3 = extractRawErrorMessage(err3);
        const hadUrlContext = Boolean(params.tools?.some((t) => 'urlContext' in t));
        if (hadUrlContext && /400|INVALID_ARGUMENT|urlContext/i.test(msg3)) {
          return await callModel('gemini-3.1-flash-lite', [{ googleSearch: {} }]);
        }
        throw err3;
      }
    }
  }
}

function isSafeHttpUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSocialOrDirectoryOnlyUrl(rawUrl?: string): boolean {
  if (!rawUrl) return true;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host.includes('instagram.com') ||
      host.includes('facebook.com') ||
      host.includes('vk.com') ||
      host.includes('t.me') ||
      host.includes('telegram.me') ||
      host.includes('2gis.') ||
      host.includes('yandex.') ||
      host.includes('linktr.ee') ||
      host.includes('taplink.')
    );
  } catch {
    return false;
  }
}

function normalizeTelegram(handleOrUrl?: string | null): {
  telegramHandle?: string;
  telegramUrl?: string;
} {
  if (!handleOrUrl || typeof handleOrUrl !== 'string') return {};
  const cleaned = handleOrUrl.trim();
  if (!cleaned) return {};

  const urlMatch = cleaned.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+/]{3,64})/i);
  if (urlMatch && urlMatch[1]) {
    const slug = urlMatch[1].replace(/\/+$/, '');
    const isInvite = slug.startsWith('+');
    return {
      telegramHandle: isInvite ? slug : `@${slug.replace(/^@/, '')}`,
      telegramUrl: `https://t.me/${slug}`,
    };
  }

  const handleMatch = cleaned.match(/^@?([a-zA-Z0-9_]{4,32})$/);
  if (handleMatch && handleMatch[1]) {
    return {
      telegramHandle: `@${handleMatch[1]}`,
      telegramUrl: `https://t.me/${handleMatch[1]}`,
    };
  }

  return {};
}

function createLeadId(): string {
  return `biz_${crypto.randomBytes(5).toString('hex')}`;
}

function mergeAndTrimLeads(
  incoming: BusinessLead[],
  existing: BusinessLead[],
  maxTotal = 250
): BusinessLead[] {
  const combined = [...incoming, ...existing];
  if (combined.length <= maxTotal) return combined;

  const kept: BusinessLead[] = [];
  let nonFavoriteSlots = Math.max(
    0,
    maxTotal - combined.filter((l) => Boolean(l.isFavorite)).length
  );

  for (const lead of combined) {
    if (lead.isFavorite) {
      kept.push(lead);
    } else if (nonFavoriteSlots > 0) {
      kept.push(lead);
      nonFavoriteSlots -= 1;
    }
  }
  return kept;
}

let writeQueue: Promise<void> = Promise.resolve();
let autopilotWriteQueue: Promise<void> = Promise.resolve();

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readLeads(): Promise<BusinessLead[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BusinessLead[]) : [];
  } catch {
    return [];
  }
}

async function writeLeads(leads: BusinessLead[]): Promise<void> {
  const nextWrite = writeQueue.then(async () => {
    await ensureDataDir();
    await fs.writeFile(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
  });
  writeQueue = nextWrite.catch(() => {});
  return nextWrite;
}

async function readAutopilot(): Promise<AutopilotConfig> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(AUTOPILOT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AutopilotConfig>;
    return {
      ...DEFAULT_AUTOPILOT,
      ...parsed,
      visitedCities: Array.isArray(parsed.visitedCities) ? parsed.visitedCities : [],
    };
  } catch {
    return { ...DEFAULT_AUTOPILOT };
  }
}

async function writeAutopilot(config: AutopilotConfig): Promise<void> {
  const nextWrite = autopilotWriteQueue.then(async () => {
    await ensureDataDir();
    await fs.writeFile(AUTOPILOT_FILE, JSON.stringify(config, null, 2), 'utf8');
  });
  autopilotWriteQueue = nextWrite.catch(() => {});
  return nextWrite;
}

const sseClients = new Set<express.Response>();

function broadcastEvent(event: string, payload: unknown): void {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function extractJsonFromText<T>(text: string, fallback: T): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const firstBracket = candidate.indexOf('[');
    const firstBrace = candidate.indexOf('{');
    let start = -1;
    let end = -1;
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      start = firstBracket;
      end = candidate.lastIndexOf(']');
    } else if (firstBrace !== -1) {
      start = firstBrace;
      end = candidate.lastIndexOf('}');
    }
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function extractGroundingLinks(response: unknown): GroundedLink[] {
  const links: GroundedLink[] = [];
  const seen = new Set<string>();
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
          maps?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    if (chunk.maps?.uri && isSafeHttpUrl(chunk.maps.uri) && !seen.has(chunk.maps.uri)) {
      seen.add(chunk.maps.uri);
      links.push({
        title: chunk.maps.title || 'Google Карты',
        url: chunk.maps.uri,
        kind: 'maps',
      });
    }
    if (chunk.web?.uri && isSafeHttpUrl(chunk.web.uri) && !seen.has(chunk.web.uri)) {
      seen.add(chunk.web.uri);
      const isTg = /t\.me|telegram\.me/i.test(chunk.web.uri);
      links.push({
        title: chunk.web.title || chunk.web.uri,
        url: chunk.web.uri,
        kind: isTg ? 'telegram' : 'web',
      });
    }
  }
  return links;
}

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  editorialSummary?: { text?: string };
  generativeSummary?: { overview?: { text?: string } };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

function matchesRegionAddressFallback(
  address: string | undefined,
  region?: AutopilotRegion
): boolean {
  if (!region || region === 'world' || region === 'custom') return true;
  if (!address) return true;
  const lower = address.toLowerCase();
  if (region === 'cis') {
    const blockedNonCis = [
      'турция', 'turkey', 'türkiye', 'istanbul', 'стамбул', 'antalya', 'анталья',
      'грузия', 'georgia', 'tbilisi', 'тбилиси', 'batumi', 'батуми',
      'португалия', 'portugal', 'lisboa', 'лиссабон', 'испания', 'spain',
      'германия', 'germany', 'сша', 'usa', 'united states', 'оаэ', 'uae', 'dubai',
    ];
    if (blockedNonCis.some((marker) => lower.includes(marker))) return false;
  }
  return true;
}

async function searchPlacesApi(
  query: string,
  pageSize: number,
  meta?: {
    discoveredBy: 'manual' | 'autopilot';
    autoPickedCity?: string;
    region?: AutopilotRegion;
    regionCode?: string;
    allowedCountries?: Set<string>;
  }
): Promise<{ leads: BusinessLead[]; rawCount: number; quotaExceeded: boolean; error?: string }> {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    return { leads: [], rawCount: 0, quotaExceeded: false };
  }

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.shortFormattedAddress',
    'places.addressComponents',
    'places.location',
    'places.googleMapsUri',
    'places.websiteUri',
    'places.internationalPhoneNumber',
    'places.nationalPhoneNumber',
    'places.rating',
    'places.userRatingCount',
    'places.primaryTypeDisplayName',
    'places.businessStatus',
    'places.editorialSummary',
    'places.generativeSummary',
    'places.regularOpeningHours.weekdayDescriptions',
  ].join(',');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
      'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: Math.min(Math.max(pageSize, 1), 15),
      languageCode: 'ru',
      ...(meta?.regionCode ? { regionCode: meta.regionCode } : {}),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    const isQuota =
      res.status === 429 ||
      errBody.includes('RESOURCE_EXHAUSTED') ||
      errBody.includes('Quota');
    return {
      leads: [],
      rawCount: 0,
      quotaExceeded: isQuota,
      error: `Places API error (${res.status})`,
    };
  }

  const data = (await res.json()) as { places?: PlacesApiPlace[] };
  const places = Array.isArray(data.places) ? data.places : [];
  const now = new Date().toISOString();

  const filteredPlaces = places.filter((place) => {
    const countryComp = place.addressComponents?.find((c) => c.types?.includes('country'));
    const countryCode = countryComp?.shortText?.toUpperCase();
    if (meta?.allowedCountries) {
      if (countryCode && !meta.allowedCountries.has(countryCode)) {
        return false;
      }
      if (!matchesRegionAddressFallback(place.formattedAddress, meta.region)) {
        return false;
      }
    }
    return true;
  });

  const leads: BusinessLead[] = filteredPlaces.map((place) => {
    const name = place.displayName?.text || 'Без названия';
    const category = place.primaryTypeDisplayName?.text || 'Локальный бизнес';
    const summaryText =
      place.generativeSummary?.overview?.text ||
      place.editorialSummary?.text ||
      `${category} по адресу ${place.shortFormattedAddress || place.formattedAddress || 'уточняется'}.`;
    const websiteUrl = isSafeHttpUrl(place.websiteUri) ? place.websiteUri : undefined;
    const googleMapsUrl = isSafeHttpUrl(place.googleMapsUri) ? place.googleMapsUri : undefined;
    const countryComp = place.addressComponents?.find((c) => c.types?.includes('country'));
    const countryCode = countryComp?.shortText?.toUpperCase();
    const countryName = countryComp?.longText;

    const tgFromWebsite =
      websiteUrl && /t\.me|telegram\.me/i.test(websiteUrl)
        ? normalizeTelegram(websiteUrl)
        : {};

    const sourceLinks: GroundedLink[] = [];
    if (googleMapsUrl) {
      sourceLinks.push({ title: `${name} на Google Картах`, url: googleMapsUrl, kind: 'maps' });
    }
    if (websiteUrl) {
      sourceLinks.push({
        title: tgFromWebsite.telegramUrl ? 'Telegram-канал / профиль' : 'Официальный сайт',
        url: websiteUrl,
        kind: tgFromWebsite.telegramUrl ? 'telegram' : 'web',
      });
    }

    return {
      id: createLeadId(),
      name,
      category,
      query,
      origin: 'maps',
      discoveredBy: meta?.discoveredBy ?? 'manual',
      autoPickedCity: meta?.autoPickedCity,
      region: meta?.region,
      countryCode,
      countryName,
      placeId: place.id,
      address: place.formattedAddress || place.shortFormattedAddress,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      businessStatus: place.businessStatus,
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
      websiteUrl,
      googleMapsUrl,
      telegramHandle: tgFromWebsite.telegramHandle,
      telegramUrl: tgFromWebsite.telegramUrl,
      socialLinks: [],
      description: summaryText,
      openingHours: place.regularOpeningHours?.weekdayDescriptions,
      sourceLinks,
      enriched: Boolean(tgFromWebsite.telegramUrl),
      createdAt: now,
    };
  });

  return { leads, rawCount: places.length, quotaExceeded: false };
}

async function searchMapsViaGeminiGrounding(
  ai: GoogleGenAI,
  query: string,
  meta?: {
    discoveredBy: 'manual' | 'autopilot';
    autoPickedCity?: string;
    region?: AutopilotRegion;
    countryHint?: string;
  }
): Promise<BusinessLead[]> {
  const regionScope =
    meta?.countryHint
      ? ` Строго ищи компании, находящиеся ТОЛЬКО в стране ${meta.countryHint} (город ${meta.autoPickedCity || ''}). Компании из других стран не включай.`
      : meta?.region === 'cis'
        ? ' Строго ищи компании ТОЛЬКО в странах СНГ (Россия, Казахстан, Армения, Таджикистан, Узбекистан, Беларусь, Кыргызстан, Азербайджан, Молдова). Не включай Турцию, Грузию или страны ЕС.'
        : '';

  const response = await generateWithRetry(ai, {
    contents: `Найди реальные бизнесы по запросу "${query}" на Google Картах.${regionScope} Перечисли найденные компании: название, категория, точный адрес, описание услуг, сайт (если есть). Ответь структурированным списком на русском языке.`,
    tools: [{ googleMaps: {} }],
  });

  const groundingLinks = extractGroundingLinks(response);
  const mapsLinks = groundingLinks.filter((l) => l.kind === 'maps');
  const now = new Date().toISOString();

  if (mapsLinks.length === 0) {
    return [];
  }

  const structured = await generateWithRetry(ai, {
    contents: `Преобразуй этот список компаний в JSON-массив объектов со свойствами: name, category, address, description, websiteUrl.\n\nТекст:\n${response.text ?? ''}\n\nСсылки из Google Карт:\n${mapsLinks.map((l) => `${l.title}: ${l.url}`).join('\n')}`,
    responseMimeType: 'application/json',
    preferLite: true,
  });

  const parsed = extractJsonFromText<
    Array<{
      name?: string;
      category?: string;
      address?: string;
      description?: string;
      websiteUrl?: string;
    }>
  >(structured.text ?? '[]', []);

  return parsed
    .filter((item) => matchesRegionAddressFallback(item.address, meta?.region))
    .slice(0, 10)
    .map((item, idx) => {
      const matchedMap =
        mapsLinks[idx] ||
        mapsLinks.find((l) => item.name && l.title.toLowerCase().includes(item.name.toLowerCase()));
      const websiteUrl = isSafeHttpUrl(item.websiteUrl) ? item.websiteUrl : undefined;
      const googleMapsUrl = matchedMap?.url;
      const sourceLinks: GroundedLink[] = [];
      if (googleMapsUrl) sourceLinks.push({ title: matchedMap.title, url: googleMapsUrl, kind: 'maps' });
      if (websiteUrl) sourceLinks.push({ title: 'Сайт компании', url: websiteUrl, kind: 'web' });

      return {
        id: createLeadId(),
        name: item.name || matchedMap?.title || 'Бизнес с карт',
        category: item.category || 'Локальный бизнес',
        query,
        origin: 'maps',
        discoveredBy: meta?.discoveredBy ?? 'manual',
        autoPickedCity: meta?.autoPickedCity,
        region: meta?.region,
        countryName: meta?.countryHint,
        address: item.address,
        websiteUrl,
        googleMapsUrl,
        socialLinks: [],
        description: item.description || 'Найден через Google Карты.',
        sourceLinks,
        enriched: false,
        createdAt: now,
      };
    });
}

async function searchTelegramViaGemini(
  ai: GoogleGenAI,
  query: string,
  limit: number
): Promise<BusinessLead[]> {
  const prompt = `Ты — исследователь B2B и локальных бизнесов. Выполни поиск в Google (через инструмент googleSearch) по публичным Telegram-каналам, Telegram-чатам, каталогам (site:t.me, tgstat, telemetr) и веб-страницам, чтобы найти РЕАЛЬНЫЕ бизнесы по запросу: "${query}".

Найди до ${Math.min(Math.max(limit, 3), 10)} реально существующих бизнесов, у которых есть Telegram-канал, Telegram-бот, контакт в Telegram или активная страница/сайт.

Правила:
1. Ничего не выдумывай. Включай только те компании, которые реально нашлись в поиске.
2. Обязательно укажи реальный Telegram (@username или ссылку https://t.me/...) и/или реальный сайт компании, если он найден.
3. Кратко на русском языке опиши, что это за бизнес, чем занимается и в каком чате/источнике найден.
4. Верни СТРОГО валидный JSON-массив (без лишнего текста вокруг), где у каждого объекта поля:
- "name": название бизнеса
- "category": сфера деятельности (коротко)
- "address": город или район (если известно)
- "description": понятное описание бизнеса на русском (2-3 предложения)
- "telegramHandle": например "@example" (или null)
- "telegramUrl": например "https://t.me/example" (или null)
- "telegramSourceChat": откуда найдено, например "Каталог t.me / Telegram-канал" (или null)
- "websiteUrl": ссылка на сайт или страницу компании (или null)`;

  const response = await generateWithRetry(ai, {
    contents: prompt,
    tools: [{ googleSearch: {} }],
  });

  const groundingLinks = extractGroundingLinks(response);
  const parsed = extractJsonFromText<
    Array<{
      name?: string;
      category?: string;
      address?: string;
      description?: string;
      telegramHandle?: string | null;
      telegramUrl?: string | null;
      telegramSourceChat?: string | null;
      websiteUrl?: string | null;
    }>
  >(response.text ?? '[]', []);

  const now = new Date().toISOString();

  return parsed
    .filter((item) => item && typeof item.name === 'string' && item.name.trim().length > 0)
    .map((item) => {
      const tg = normalizeTelegram(item.telegramUrl || item.telegramHandle);
      const websiteUrl = isSafeHttpUrl(item.websiteUrl) ? item.websiteUrl : undefined;
      const sourceLinks: GroundedLink[] = [];
      if (tg.telegramUrl) {
        sourceLinks.push({
          title: `Telegram ${tg.telegramHandle || ''}`.trim(),
          url: tg.telegramUrl,
          kind: 'telegram',
        });
      }
      if (websiteUrl && websiteUrl !== tg.telegramUrl) {
        sourceLinks.push({
          title: 'Страница / сайт бизнеса',
          url: websiteUrl,
          kind: 'web',
        });
      }
      for (const gl of groundingLinks.slice(0, 3)) {
        if (!sourceLinks.some((s) => s.url === gl.url)) {
          sourceLinks.push(gl);
        }
      }

      return {
        id: createLeadId(),
        name: item.name!.trim(),
        category: item.category?.trim() || 'Бизнес из Telegram / Веб',
        query,
        origin: 'telegram',
        discoveredBy: 'manual',
        address: item.address?.trim() || undefined,
        websiteUrl,
        telegramHandle: tg.telegramHandle,
        telegramUrl: tg.telegramUrl,
        telegramSourceChat: item.telegramSourceChat?.trim() || 'Публичный поиск Telegram',
        socialLinks: [],
        description:
          item.description?.trim() ||
          'Бизнес найден через поиск по Telegram-каналам и веб-упоминаниям.',
        sourceLinks,
        enriched: false,
        createdAt: now,
      };
    });
}

function clampScore(val: unknown, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.min(10, Math.max(1, Math.round(val)));
}

/**
 * Combined AI Website & Design Auditor + Contact Enrichment.
 * Evaluates website age/UX/design quality, proposes concrete upgrades to sell a new website,
 * writes a ready-to-send pitch, and extracts Telegram/social contacts.
 */
async function auditAndEnrichLead(
  ai: GoogleGenAI,
  lead: BusinessLead
): Promise<BusinessLead> {
  const hasUrl = isSafeHttpUrl(lead.websiteUrl);
  const hasRealWebsite = hasUrl && !isSocialOrDirectoryOnlyUrl(lead.websiteUrl);
  // Only pass googleSearch when there is no full website URL (saves Search Grounding quota)
  const tools: Array<Record<string, unknown>> = hasUrl
    ? hasRealWebsite
      ? [{ urlContext: {} }]
      : [{ urlContext: {} }, { googleSearch: {} }]
    : [{ googleSearch: {} }];

  const prompt = `Ты — опытный веб-дизайнер, UX-аудитор и специалист по продажам разработки сайтов и веб-приложений.
Просканируй бизнес, его сайт и дизайн, а также найди контакт в Telegram:

Название: ${lead.name}
Категория: ${lead.category}
Адрес / город: ${lead.address || 'не указан'}
Текущий сайт: ${lead.websiteUrl || 'не указан на карте'}
Google Карты: ${lead.googleMapsUrl || 'не указан'}

Что нужно сделать:
1. ${
    hasUrl
      ? `Открой и проанализируй сайт ${lead.websiteUrl} через urlContext.`
      : `Выполни поиск в googleSearch, есть ли у компании "${lead.name}" (${lead.address || ''}) официальный сайт или только соцсети/справочники.`
  }
2. Оцени, насколько сайт и его визуальный дизайн устарели или слабы с точки зрения веб-студии, которая продаёт новые современные сайты и приложения:
   - Если у бизнеса старый, шаблонный, неадаптивный, перегруженный, визуально слабый сайт, сайт на простом конструкторе без конверсии (нет онлайн-записи, калькулятора, внятного оффера, слабый UI/типографика, устаревшая вёрстка, нет интеграции с мессенджерами) ИЛИ вместо полноценного сайта только Taplink/Instagram/страница в соцсети — ставь verdict: "hot_outdated" (оценки 1–6).
   - Если у бизнеса вообще нет сайта — ставь verdict: "no_website" (websiteScore: 1, designScore: 1).
   - Если у бизнеса действительно современный, дорогой, быстрый и сильный сайт с отличным дизайном и высокой конверсией (оценки 8–10) — ставь verdict: "modern_ok".
3. Сформулируй конкретные слабые места сайта и дизайна (issues — 3–5 пунктов, опираясь на то, что реально есть на странице или чего не хватает для их ниши).
4. Напиши конкретные идеи: ЧТО туда можно добавить или улучшить, чтобы клиент согласился заказать новый сайт / веб-приложение (pitchSuggestions — 3–5 конкретных фишек именно под их нишу: онлайн-запись, калькулятор цены, Telegram-бот заявок, портфолио до/после, личный кабинет, современный редизайн и т.д.).
5. Напиши короткий, живой готовый оффер-сообщение владельцу бизнеса (salesPitch — 3–4 предложения на русском без канцелярита, с упоминанием конкретной проблемы их сайта и выгоды от нового сайта).
6. Найди официальный Telegram (@username / t.me/...) и другие соцсети компании, если они реально упоминаются на сайте или в поиске (НЕ выдумывай!).

Верни СТРОГО валидный JSON-объект (без markdown вокруг, если возможно):
{
  "description": "понятное описание бизнеса на русском (2-3 предложения)",
  "websiteUrl": "найденный или текущий https URL сайта (или null)",
  "telegramHandle": "@username или null",
  "telegramUrl": "https://t.me/... или null",
  "socialLinks": ["https://..."],
  "verdict": "hot_outdated" | "no_website" | "modern_ok",
  "verdictLabel": "короткий ярлык, например: Устаревший сайт и дизайн / Слабый дизайн / Нет сайта / Современный сайт",
  "websiteScore": число от 1 до 10,
  "designScore": число от 1 до 10,
  "issues": ["проблема 1", "проблема 2", "проблема 3"],
  "pitchSuggestions": ["что добавить 1", "что добавить 2", "что добавить 3"],
  "salesPitch": "готовый текст сообщения клиенту"
}`;

  const response = await generateWithRetry(ai, {
    contents: prompt,
    tools,
  });

  const groundingLinks = extractGroundingLinks(response);
  const parsed = extractJsonFromText<{
    description?: string;
    websiteUrl?: string | null;
    telegramHandle?: string | null;
    telegramUrl?: string | null;
    socialLinks?: unknown[];
    verdict?: string;
    verdictLabel?: string;
    websiteScore?: number;
    designScore?: number;
    issues?: unknown[];
    pitchSuggestions?: unknown[];
    salesPitch?: string;
  }>(response.text ?? '{}', {});

  const resolvedWebsiteUrl = isSafeHttpUrl(parsed.websiteUrl)
    ? parsed.websiteUrl
    : lead.websiteUrl;

  const hasWebsiteNow = isSafeHttpUrl(resolvedWebsiteUrl) && !isSocialOrDirectoryOnlyUrl(resolvedWebsiteUrl);

  let verdict: AuditVerdict = 'hot_outdated';
  if (parsed.verdict === 'modern_ok' || parsed.verdict === 'no_website' || parsed.verdict === 'hot_outdated') {
    verdict = parsed.verdict;
  } else if (!hasWebsiteNow && !hasRealWebsite) {
    verdict = 'no_website';
  }

  const websiteScore = clampScore(parsed.websiteScore, verdict === 'no_website' ? 1 : verdict === 'modern_ok' ? 8 : 4);
  const designScore = clampScore(parsed.designScore, verdict === 'no_website' ? 1 : verdict === 'modern_ok' ? 8 : 4);

  // If scores are weak (<= 6) even if model wrote modern_ok, treat as hot_outdated
  if (verdict === 'modern_ok' && (websiteScore <= 6 || designScore <= 6)) {
    verdict = 'hot_outdated';
  }

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6)
    : [];
  const pitchSuggestions = Array.isArray(parsed.pitchSuggestions)
    ? parsed.pitchSuggestions
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 6)
    : [];

  const audit: WebsiteAudit = {
    verdict,
    verdictLabel:
      parsed.verdictLabel?.trim() ||
      (verdict === 'no_website'
        ? 'Нет полноценного сайта'
        : verdict === 'modern_ok'
          ? 'Современный сайт'
          : designScore <= 5 && websiteScore <= 5
            ? 'Устаревший сайт и слабый дизайн'
            : designScore <= 5
              ? 'Слабый дизайн сайта'
              : 'Устаревший сайт'),
    websiteScore,
    designScore,
    issues:
      issues.length > 0
        ? issues
        : verdict === 'no_website'
          ? ['У компании отсутствует полноценный продающий сайт.']
          : ['Недостаточно выраженные точки захвата заявок и визуальной иерархии.'],
    pitchSuggestions:
      pitchSuggestions.length > 0
        ? pitchSuggestions
        : [
            'Современный адаптивный редизайн с быстрым первым экраном и понятным оффером',
            'Онлайн-запись или квиз-калькулятор стоимости с мгновенной отправкой заявки в Telegram',
          ],
    salesPitch:
      parsed.salesPitch?.trim() ||
      `Здравствуйте! Посмотрел ваш бизнес «${lead.name}» и текущий сайт — у вас сильная ниша, но сайт визуально устарел и не дожимает посетителей в заявку. Могу собрать современный быстрый сайт с удобной записью и привязкой к Telegram, чтобы вы получали больше клиентов прямо с карт и поиска.`,
    scannedAt: new Date().toISOString(),
  };

  const tg = normalizeTelegram(
    parsed.telegramUrl || parsed.telegramHandle || lead.telegramUrl || lead.telegramHandle
  );
  const socialLinks = Array.isArray(parsed.socialLinks)
    ? parsed.socialLinks.filter((u): u is string => isSafeHttpUrl(u))
    : lead.socialLinks;

  const mergedSourceLinks = [...lead.sourceLinks];
  for (const gl of groundingLinks) {
    if (!mergedSourceLinks.some((s) => s.url === gl.url)) {
      mergedSourceLinks.push(gl);
    }
  }
  if (tg.telegramUrl && !mergedSourceLinks.some((s) => s.url === tg.telegramUrl)) {
    mergedSourceLinks.unshift({
      title: `Telegram ${tg.telegramHandle || ''}`.trim(),
      url: tg.telegramUrl,
      kind: 'telegram',
    });
  }

  return {
    ...lead,
    description: parsed.description?.trim() || lead.description,
    websiteUrl: resolvedWebsiteUrl,
    telegramHandle: tg.telegramHandle ?? lead.telegramHandle,
    telegramUrl: tg.telegramUrl ?? lead.telegramUrl,
    socialLinks: Array.from(new Set([...lead.socialLinks, ...socialLinks])),
    sourceLinks: mergedSourceLinks,
    audit,
    enriched: true,
  };
}

function passesQualityFilter(
  lead: BusinessLead,
  qualityFilter: AutopilotQualityFilter
): boolean {
  if (qualityFilter === 'all') return true;
  const verdict = lead.audit?.verdict;
  if (qualityFilter === 'weak_only') {
    // Only leads that HAVE a website (or social-only link masquerading as site) AND it's outdated/weak
    return verdict === 'hot_outdated';
  }
  // 'weak_or_none'
  return verdict === 'hot_outdated' || verdict === 'no_website' || !verdict;
}

function getBaseAppUrl(req?: express.Request): string {
  const configured = process.env.APP_URL;
  if (configured && configured !== 'MY_APP_URL' && isSafeHttpUrl(configured)) {
    return configured.replace(/\/+$/, '');
  }
  if (req) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || `localhost:${PORT}`;
    return `${proto}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

async function sendLeadToTelegram(
  lead: BusinessLead,
  appBaseUrl: string,
  overrideChatId?: string
): Promise<{ ok: boolean; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = (overrideChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim()) ?? '';

  if (!botToken) {
    return { ok: false, error: 'На сервере не задан TELEGRAM_BOT_TOKEN.' };
  }
  if (!chatId) {
    return { ok: false, error: 'Не указан TELEGRAM_CHAT_ID (куда присылать ссылки).' };
  }

  const cardUrl = `${appBaseUrl}/business/${lead.id}`;
  const auditSummary = lead.audit
    ? `Аудит: ${lead.audit.verdictLabel} (Сайт ${lead.audit.websiteScore}/10 · Дизайн ${lead.audit.designScore}/10)`
    : '';
  const topSuggestion = lead.audit?.pitchSuggestions?.[0]
    ? `Что добавить: ${lead.audit.pitchSuggestions[0]}`
    : '';

  const lines = [
    `📌 *${lead.name.replace(/[*_`[\]]/g, '')}*`,
    `Ниша: ${lead.category}${lead.autoPickedCity ? ` · ${lead.autoPickedCity}` : ''}`,
    auditSummary,
    topSuggestion,
    lead.websiteUrl ? `Их сайт: ${lead.websiteUrl}` : '',
    lead.telegramUrl ? `Telegram бизнеса: ${lead.telegramUrl}` : '',
    `Разбор и оффер в LeadRadar: ${cardUrl}`,
  ].filter(Boolean);

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    }),
  });

  if (!tgRes.ok) {
    const errText = await tgRes.text();
    return { ok: false, error: `Ошибка Telegram Bot API (${tgRes.status}): ${errText}` };
  }

  return { ok: true };
}

function pickNextCityAndNiche(config: AutopilotConfig): {
  city: string;
  country?: string;
  regionCode?: string;
  niche: string;
} {
  const customNiches = config.niches
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nichePool = customNiches.length > 0 ? customNiches : FALLBACK_NICHES;
  const recentVisited = new Set(config.visitedCities.slice(-30).map((c) => c.toLowerCase()));

  if (config.region === 'custom') {
    const customList = config.customCities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (customList.length > 0) {
      const unvisited = customList.filter((c) => !recentVisited.has(c.toLowerCase()));
      const pool = unvisited.length > 0 ? unvisited : customList;
      return {
        city: pool[Math.floor(Math.random() * pool.length)],
        niche: nichePool[Math.floor(Math.random() * nichePool.length)],
      };
    }
  }

  const effectiveRegion = config.region === 'custom' ? 'world' : config.region;
  const fallbackPool = REGION_CITY_PROFILES[effectiveRegion];
  const unvisitedFallback = fallbackPool.filter(
    (item) => !recentVisited.has(item.city.toLowerCase())
  );
  const pool = unvisitedFallback.length > 0 ? unvisitedFallback : fallbackPool;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return {
    city: chosen.city,
    country: chosen.country,
    regionCode: chosen.regionCode,
    niche: nichePool[Math.floor(Math.random() * nichePool.length)],
  };
}

let autopilotRunningLock = false;
let autopilotLockStartedAt = 0;

async function runAutopilotCycle(
  appBaseUrl: string
): Promise<{
  scannedCount: number;
  addedCount: number;
  city: string;
  niche: string;
  quotaExceeded: boolean;
  error?: string;
  config: AutopilotConfig;
  leads: BusinessLead[];
}> {
  if (autopilotRunningLock && Date.now() - autopilotLockStartedAt < 90_000) {
    const currentConfig = await readAutopilot();
    const currentLeads = await readLeads();
    return {
      scannedCount: 0,
      addedCount: 0,
      city: currentConfig.lastCity || '',
      niche: currentConfig.lastNiche || '',
      quotaExceeded: false,
      config: currentConfig,
      leads: currentLeads,
    };
  }

  autopilotRunningLock = true;
  autopilotLockStartedAt = Date.now();
  let config = await readAutopilot();
  config = { ...config, isRunning: true, lastError: undefined };
  await writeAutopilot(config);
  broadcastEvent('autopilot', config);

  const ai = getGeminiClient();
  let quotaExceeded = false;
  let geminiQuotaExceeded = false;
  let geminiErrorMsg: string | undefined;
  let city = '';
  let niche = '';
  let scannedCount = 0;

  try {
    const existing = await readLeads();
    const existingKeys = new Set(
      existing.map((l) =>
        l.placeId ? `place:${l.placeId}` : `${l.origin}:${l.name.toLowerCase().trim()}`
      )
    );

    let prioritized: BusinessLead[] = [];
    let placesError: string | undefined;
    const triedCities = new Set<string>(config.visitedCities);
    const allowedCountries =
      config.region !== 'world' && config.region !== 'custom'
        ? REGION_ALLOWED_COUNTRIES[config.region]
        : undefined;

    // Try up to 2 cities if the first city has no fresh candidates
    for (let attempt = 0; attempt < 2; attempt++) {
      const picked = pickNextCityAndNiche({
        ...config,
        visitedCities: Array.from(triedCities),
      });
      city = picked.city;
      niche = picked.niche;
      triedCities.add(city);
      const query = picked.country
        ? `${niche} ${picked.city} ${picked.country}`
        : `${niche} ${picked.city}`;

      const placesResult = await searchPlacesApi(query, 8, {
        discoveredBy: 'autopilot',
        autoPickedCity: city,
        region: config.region,
        regionCode: picked.regionCode,
        allowedCountries,
      });
      if (placesResult.quotaExceeded) {
        quotaExceeded = true;
        break;
      }
      if (placesResult.error) {
        placesError = placesResult.error;
      }

      let rawCandidates = placesResult.leads;
      if (
        rawCandidates.length === 0 &&
        placesResult.rawCount === 0 &&
        ai &&
        !quotaExceeded
      ) {
        try {
          rawCandidates = await searchMapsViaGeminiGrounding(ai, query, {
            discoveredBy: 'autopilot',
            autoPickedCity: city,
            region: config.region,
            countryHint: picked.country,
          });
        } catch (err) {
          if (isGeminiQuotaError(err)) {
            geminiQuotaExceeded = true;
          }
          geminiErrorMsg = formatGeminiError(err);
          break;
        }
      }

      const newCandidates = rawCandidates.filter((lead) => {
        const key = lead.placeId
          ? `place:${lead.placeId}`
          : `${lead.origin}:${lead.name.toLowerCase().trim()}`;
        return !existingKeys.has(key);
      });

      prioritized =
        config.qualityFilter === 'weak_only'
          ? newCandidates.filter((l) => isSafeHttpUrl(l.websiteUrl))
          : newCandidates;

      if (prioritized.length > 0) {
        break;
      }
    }

    const toAudit = prioritized.slice(0, 3);
    scannedCount = toAudit.length;

    const auditedLeads: BusinessLead[] = [];
    if (ai && toAudit.length > 0 && !geminiQuotaExceeded) {
      for (let i = 0; i < toAudit.length; i++) {
        if (i > 0) await sleep(800);
        try {
          const audited = await auditAndEnrichLead(ai, toAudit[i]);
          auditedLeads.push(audited);
        } catch (err) {
          if (isGeminiQuotaError(err)) {
            geminiQuotaExceeded = true;
            geminiErrorMsg = formatGeminiError(err);
            break;
          }
          geminiErrorMsg = formatGeminiError(err);
          auditedLeads.push(toAudit[i]);
        }
      }
    } else if (!ai) {
      auditedLeads.push(...toAudit);
    }

    // Keep only businesses matching the user's outdated/weak site & design filter
    const qualifiedLeads = auditedLeads.filter((lead) =>
      passesQualityFilter(lead, config.qualityFilter)
    );

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      for (const lead of qualifiedLeads.slice(0, 3)) {
        const sent = await sendLeadToTelegram(lead, appBaseUrl);
        if (sent.ok) {
          lead.sentToTelegramAt = new Date().toISOString();
        }
      }
    }

    const updatedLeads = mergeAndTrimLeads(qualifiedLeads, existing, 250);
    await writeLeads(updatedLeads);

    const nowMs = Date.now();
    const intervalMs = Math.max(1, config.intervalMinutes) * 60 * 1000;
    const nextVisited = Array.from(new Set([...config.visitedCities, city])).slice(-60);
    const shouldPause = quotaExceeded || geminiQuotaExceeded;

    const lastError = quotaExceeded
      ? 'Достигнута квота Google Maps API. Автопилот приостановлен.'
      : geminiQuotaExceeded
        ? `${geminiErrorMsg} Автопилот поставлен на паузу.`
        : geminiErrorMsg || placesError;

    config = {
      ...config,
      enabled: shouldPause ? false : config.enabled,
      isRunning: false,
      visitedCities: nextVisited,
      lastRunAt: new Date(nowMs).toISOString(),
      nextRunAt: shouldPause
        ? undefined
        : config.enabled
          ? new Date(nowMs + intervalMs).toISOString()
          : undefined,
      lastCity: city,
      lastNiche: niche,
      lastScannedCount: auditedLeads.length,
      lastAddedCount: qualifiedLeads.length,
      lastError,
    };

    await writeAutopilot(config);
    broadcastEvent('autopilot', config);
    broadcastEvent('leads', {
      leads: updatedLeads,
      addedCount: qualifiedLeads.length,
      scannedCount: auditedLeads.length,
      city,
      niche,
    });
    if (quotaExceeded) {
      broadcastEvent('quota_exceeded', { quotaExceeded: true });
    }

    return {
      scannedCount: auditedLeads.length,
      addedCount: qualifiedLeads.length,
      city,
      niche,
      quotaExceeded,
      error: config.lastError,
      config,
      leads: updatedLeads,
    };
  } catch (err) {
    const isGemQuota = isGeminiQuotaError(err);
    const errMsg = formatGeminiError(err);
    config = {
      ...config,
      enabled: isGemQuota ? false : config.enabled,
      isRunning: false,
      lastRunAt: new Date().toISOString(),
      nextRunAt:
        !isGemQuota && config.enabled
          ? new Date(Date.now() + Math.max(1, config.intervalMinutes) * 60 * 1000).toISOString()
          : undefined,
      lastError: isGemQuota ? `${errMsg} Автопилот поставлен на паузу.` : errMsg,
    };
    await writeAutopilot(config);
    broadcastEvent('autopilot', config);
    const currentLeads = await readLeads();
    return {
      scannedCount,
      addedCount: 0,
      city,
      niche,
      quotaExceeded,
      error: config.lastError,
      config,
      leads: currentLeads,
    };
  } finally {
    autopilotRunningLock = false;
  }
}

async function startServer(): Promise<void> {
  const bootAutopilot = await readAutopilot();
  if (bootAutopilot.isRunning) {
    await writeAutopilot({ ...bootAutopilot, isRunning: false });
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write('event: connected\ndata: {}\n\n');
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.get('/api/capabilities', (req, res) => {
    res.json({
      mapsApiConfigured: Boolean(getMapsApiKey()),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      appUrl: getBaseAppUrl(req),
    });
  });

  app.get('/api/autopilot', async (_req, res) => {
    const config = await readAutopilot();
    res.json({ config });
  });

  app.post('/api/autopilot', async (req, res) => {
    try {
      const body = (req.body || {}) as Partial<AutopilotConfig>;
      const prev = await readAutopilot();

      const validRegions: AutopilotRegion[] = ['world', 'cis', 'europe', 'americas', 'custom'];
      const region: AutopilotRegion = validRegions.includes(body.region as AutopilotRegion)
        ? (body.region as AutopilotRegion)
        : prev.region;

      const validFilters: AutopilotQualityFilter[] = ['weak_only', 'weak_or_none', 'all'];
      const qualityFilter: AutopilotQualityFilter = validFilters.includes(
        body.qualityFilter as AutopilotQualityFilter
      )
        ? (body.qualityFilter as AutopilotQualityFilter)
        : prev.qualityFilter;

      const intervalMinutes =
        typeof body.intervalMinutes === 'number' &&
        Number.isFinite(body.intervalMinutes) &&
        body.intervalMinutes >= 1 &&
        body.intervalMinutes <= 1440
          ? Math.round(body.intervalMinutes)
          : prev.intervalMinutes;

      const enabled = typeof body.enabled === 'boolean' ? body.enabled : prev.enabled;
      const customCities =
        typeof body.customCities === 'string' ? body.customCities.slice(0, 500) : prev.customCities;
      const niches = typeof body.niches === 'string' ? body.niches.slice(0, 500) : prev.niches;
      const autoEnrich = typeof body.autoEnrich === 'boolean' ? body.autoEnrich : prev.autoEnrich;

      const nextRunAt = enabled
        ? new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString()
        : undefined;

      const regionChanged = region !== prev.region;

      const updated: AutopilotConfig = {
        ...prev,
        enabled,
        intervalMinutes,
        region,
        customCities,
        niches,
        qualityFilter,
        autoEnrich,
        visitedCities: regionChanged ? [] : prev.visitedCities,
        nextRunAt,
        lastError: enabled ? undefined : prev.lastError,
      };

      await writeAutopilot(updated);
      broadcastEvent('autopilot', updated);

      if (enabled && (!prev.enabled || regionChanged) && !autopilotRunningLock) {
        const baseUrl = getBaseAppUrl(req);
        void runAutopilotCycle(baseUrl);
      }

      res.json({ config: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Не удалось обновить настройки автопилота.',
      });
    }
  });

  app.post('/api/autopilot/run-now', async (req, res) => {
    const result = await runAutopilotCycle(getBaseAppUrl(req));
    res.json(result);
  });

  app.post('/api/feed/refresh', async (req, res) => {
    const result = await runAutopilotCycle(getBaseAppUrl(req));
    res.json(result);
  });

  app.get('/api/businesses', async (_req, res) => {
    try {
      const leads = await readLeads();
      res.json({ leads });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить ленту.' });
    }
  });

  app.get('/api/businesses/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const leads = await readLeads();
      const lead = leads.find((item) => item.id === id);
      if (!lead) {
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }
      res.json({ lead });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки карточки.' });
    }
  });

  app.post('/api/search', async (req, res) => {
    try {
      const body = req.body as {
        query?: unknown;
        source?: unknown;
        limit?: unknown;
        qualityFilter?: unknown;
        autoSendTelegram?: unknown;
        region?: unknown;
      };

      const query = typeof body.query === 'string' ? body.query.trim() : '';
      if (!query || query.length > 200) {
        res.status(400).json({ error: 'Введите корректный поисковый запрос (до 200 символов).' });
        return;
      }

      const source: SearchSource =
        body.source === 'maps' || body.source === 'telegram' || body.source === 'both'
          ? body.source
          : 'maps';
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 6;
      const validFilters: AutopilotQualityFilter[] = ['weak_only', 'weak_or_none', 'all'];
      const qualityFilter: AutopilotQualityFilter = validFilters.includes(
        body.qualityFilter as AutopilotQualityFilter
      )
        ? (body.qualityFilter as AutopilotQualityFilter)
        : 'weak_or_none';
      const validRegions: AutopilotRegion[] = ['world', 'cis', 'europe', 'americas', 'custom'];
      const searchRegion: AutopilotRegion = validRegions.includes(body.region as AutopilotRegion)
        ? (body.region as AutopilotRegion)
        : 'world';
      const allowedCountries =
        searchRegion !== 'world' && searchRegion !== 'custom'
          ? REGION_ALLOWED_COUNTRIES[searchRegion]
          : undefined;
      const autoSendTelegram = Boolean(body.autoSendTelegram);

      const ai = getGeminiClient();
      let quotaExceeded = false;
      let geminiQuotaHit = false;
      const foundLeads: BusinessLead[] = [];
      const warnings: string[] = [];

      if (source === 'maps' || source === 'both') {
        const placesResult = await searchPlacesApi(query, limit, {
          discoveredBy: 'manual',
          region: searchRegion,
          allowedCountries,
        });
        if (placesResult.quotaExceeded) {
          quotaExceeded = true;
        }
        if (placesResult.leads.length > 0) {
          foundLeads.push(...placesResult.leads);
        } else if (placesResult.rawCount > 0 && allowedCountries) {
          warnings.push(
            'Найденные на картах компании находятся вне выбранного гео-профиля и были отфильтрованы. Укажите город из выбранного региона или переключите профиль на «Весь мир».'
          );
        } else if (ai && !placesResult.quotaExceeded) {
          try {
            const groundedMaps = await searchMapsViaGeminiGrounding(ai, query, {
              discoveredBy: 'manual',
              region: searchRegion,
            });
            foundLeads.push(...groundedMaps);
          } catch (err) {
            if (isGeminiQuotaError(err)) geminiQuotaHit = true;
            warnings.push(formatGeminiError(err));
          }
        } else if (placesResult.error) {
          warnings.push(placesResult.error);
        }
      }

      if (source === 'telegram' || source === 'both') {
        if (!ai) {
          warnings.push('Для поиска по Telegram-чатам и веб-источникам нужен GEMINI_API_KEY в Settings > Secrets.');
        } else if (!geminiQuotaHit) {
          try {
            const tgLeads = await searchTelegramViaGemini(ai, query, limit);
            foundLeads.push(...tgLeads);
          } catch (err) {
            if (isGeminiQuotaError(err)) geminiQuotaHit = true;
            warnings.push(formatGeminiError(err));
          }
        }
      }

      if (foundLeads.length === 0 && geminiQuotaHit) {
        res.status(429).json({
          error: warnings[0] || formatGeminiError(new Error('429 RESOURCE_EXHAUSTED')),
          geminiQuotaExceeded: true,
        });
        return;
      }

      const existing = await readLeads();
      const existingKeys = new Set(
        existing.map((l) =>
          l.placeId ? `place:${l.placeId}` : `${l.origin}:${l.name.toLowerCase().trim()}`
        )
      );

      const freshCandidates: BusinessLead[] = [];
      for (const lead of foundLeads) {
        const key = lead.placeId
          ? `place:${lead.placeId}`
          : `${lead.origin}:${lead.name.toLowerCase().trim()}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          freshCandidates.push(lead);
        }
      }

      const toScan =
        qualityFilter === 'weak_only'
          ? freshCandidates.filter((l) => isSafeHttpUrl(l.websiteUrl)).slice(0, 3)
          : freshCandidates.slice(0, 3);

      const scannedLeads: BusinessLead[] = [];
      if (ai && toScan.length > 0 && !geminiQuotaHit) {
        for (let i = 0; i < toScan.length; i++) {
          if (i > 0) await sleep(800);
          try {
            const audited = await auditAndEnrichLead(ai, toScan[i]);
            scannedLeads.push(audited);
          } catch (err) {
            const msg = formatGeminiError(err);
            if (!warnings.includes(msg)) warnings.push(msg);
            if (isGeminiQuotaError(err)) {
              geminiQuotaHit = true;
              // Keep remaining un-audited leads from Maps so user can still open them and scan individually
              scannedLeads.push(...toScan.slice(i));
              break;
            }
            scannedLeads.push(toScan[i]);
          }
        }
      } else {
        scannedLeads.push(...toScan);
      }

      // If Gemini quota paused auditing before evaluating, keep unscanned Maps leads so user can inspect them later
      const qualified = geminiQuotaHit
        ? scannedLeads
        : scannedLeads.filter((lead) => passesQualityFilter(lead, qualityFilter));

      if (autoSendTelegram && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const baseUrl = getBaseAppUrl(req);
        for (const lead of qualified.slice(0, 3)) {
          const sent = await sendLeadToTelegram(lead, baseUrl);
          if (sent.ok) {
            lead.sentToTelegramAt = new Date().toISOString();
          }
        }
      }

      const updatedLeads = mergeAndTrimLeads(qualified, existing, 250);
      await writeLeads(updatedLeads);
      broadcastEvent('leads', { leads: updatedLeads, addedCount: qualified.length });

      if (toScan.length > 0 && qualified.length === 0 && qualityFilter !== 'all' && !geminiQuotaHit) {
        warnings.push(
          `Проверено ${toScan.length} компаний, но у всех найдены современные сайты. Попробуйте другой город/нишу или переключите фильтр на «Все найденные».`
        );
      }

      res.json({
        scannedCount: toScan.length,
        addedCount: qualified.length,
        newLeads: qualified,
        leads: updatedLeads,
        quotaExceeded,
        geminiQuotaExceeded: geminiQuotaHit,
        warnings,
      });
    } catch (err) {
      res.status(getGeminiErrorStatus(err)).json({
        error: formatGeminiError(err),
        geminiQuotaExceeded: isGeminiQuotaError(err),
      });
    }
  });

  app.post('/api/businesses/:id/audit', async (req, res) => {
    try {
      const { id } = req.params;
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Не настроен GEMINI_API_KEY. Добавьте его в Settings > Secrets.',
        });
        return;
      }

      const leads = await readLeads();
      const index = leads.findIndex((item) => item.id === id);
      if (index === -1) {
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }

      const audited = await auditAndEnrichLead(ai, leads[index]);
      leads[index] = audited;
      await writeLeads(leads);
      broadcastEvent('leads', { leads });

      res.json({ lead: audited });
    } catch (err) {
      res.status(getGeminiErrorStatus(err)).json({
        error: formatGeminiError(err),
        geminiQuotaExceeded: isGeminiQuotaError(err),
      });
    }
  });

  // Alias /enrich to the unified audit + enrich pipeline
  app.post('/api/businesses/:id/enrich', async (req, res) => {
    try {
      const { id } = req.params;
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Не настроен GEMINI_API_KEY. Добавьте его в Settings > Secrets.',
        });
        return;
      }

      const leads = await readLeads();
      const index = leads.findIndex((item) => item.id === id);
      if (index === -1) {
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }

      const audited = await auditAndEnrichLead(ai, leads[index]);
      leads[index] = audited;
      await writeLeads(leads);

      res.json({ lead: audited });
    } catch (err) {
      res.status(getGeminiErrorStatus(err)).json({
        error: formatGeminiError(err),
        geminiQuotaExceeded: isGeminiQuotaError(err),
      });
    }
  });

  app.post('/api/businesses/:id/send-telegram', async (req, res) => {
    try {
      const { id } = req.params;
      const body = (req.body || {}) as { chatId?: unknown };
      const overrideChatId = typeof body.chatId === 'string' ? body.chatId : undefined;

      const leads = await readLeads();
      const index = leads.findIndex((item) => item.id === id);
      if (index === -1) {
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }

      const result = await sendLeadToTelegram(leads[index], getBaseAppUrl(req), overrideChatId);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }

      leads[index] = { ...leads[index], sentToTelegramAt: new Date().toISOString() };
      await writeLeads(leads);
      res.json({ ok: true, lead: leads[index] });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Не удалось отправить ссылку в Telegram.',
      });
    }
  });

  app.post('/api/businesses/:id/favorite', async (req, res) => {
    try {
      const { id } = req.params;
      const body = (req.body || {}) as { isFavorite?: unknown };
      const leads = await readLeads();
      const index = leads.findIndex((item) => item.id === id);
      if (index === -1) {
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }

      const nextFavorite =
        typeof body.isFavorite === 'boolean' ? body.isFavorite : !Boolean(leads[index].isFavorite);

      leads[index] = {
        ...leads[index],
        isFavorite: nextFavorite,
        favoritedAt: nextFavorite ? new Date().toISOString() : undefined,
      };
      await writeLeads(leads);
      broadcastEvent('leads', { leads });

      res.json({ lead: leads[index], leads });
    } catch {
      res.status(500).json({ error: 'Не удалось обновить избранное.' });
    }
  });

  app.delete('/api/businesses/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const leads = await readLeads();
      const next = leads.filter((item) => item.id !== id);
      await writeLeads(next);
      res.json({ leads: next });
    } catch {
      res.status(500).json({ error: 'Ошибка удаления записи.' });
    }
  });

  app.delete('/api/businesses', async (_req, res) => {
    try {
      const leads = await readLeads();
      const remainingFavorites = leads.filter((item) => Boolean(item.isFavorite));
      await writeLeads(remainingFavorites);
      broadcastEvent('leads', { leads: remainingFavorites });
      res.json({
        leads: remainingFavorites,
        keptFavoritesCount: remainingFavorites.length,
      });
    } catch {
      res.status(500).json({ error: 'Ошибка очистки ленты.' });
    }
  });

  if (IS_PROD) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  setInterval(() => {
    void (async () => {
      if (autopilotRunningLock) return;
      const cfg = await readAutopilot();
      if (!cfg.enabled || cfg.isRunning) return;
      const dueAt = cfg.nextRunAt ? Date.parse(cfg.nextRunAt) : 0;
      if (Date.now() >= dueAt) {
        await runAutopilotCycle(getBaseAppUrl());
      }
    })();
  }, 15000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LeadRadar server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

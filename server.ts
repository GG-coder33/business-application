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
  SiteTechnicalSignals,
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
  const summary = parsed?.message
    ? `${parsed.code ?? ''} ${parsed.status ?? ''}: ${parsed.message.slice(0, 180)}`.trim()
    : raw.slice(0, 200);

  if (isGeminiQuotaError(err)) {
    console.warn(`[Gemini API] 429 rate-limit: ${summary}`);
    return 'Превышен лимит запросов к Gemini API (429 RESOURCE_EXHAUSTED). Подождите 30–60 секунд и повторите сканирование либо выберите API-ключ с биллингом в Settings > Secrets.';
  }
  if (isGeminiAuthError(err)) {
    console.error(`[Gemini API] auth error: ${summary}`);
    return 'Ошибка доступа к Gemini API. Проверьте GEMINI_API_KEY в панели Settings > Secrets.';
  }
  if (isGeminiTransientError(err)) {
    console.warn(`[Gemini API] transient 503/timeout: ${summary}`);
    return 'Сервер ИИ сейчас перегружен (503 UNAVAILABLE). Повторите попытку через 10–20 секунд.';
  }

  console.error('[Gemini API] unexpected error:', summary);
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
    allowNoToolsFallback?: boolean;
  }
): Promise<GenerateContentResponse> {
  const hasMapsTool = Boolean(params.tools?.some((t) => 'googleMaps' in t));
  const hasSearchTool = Boolean(params.tools?.some((t) => 'googleSearch' in t));
  const hasUrlContext = Boolean(params.tools?.some((t) => 'urlContext' in t));
  const allowNoToolsFallback =
    params.allowNoToolsFallback ?? (!hasMapsTool && (hasSearchTool || hasUrlContext));

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
    if (params.responseMimeType && !tools?.some((t) => 'googleMaps' in t)) {
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
      22000,
      `Gemini ${model}`
    );

  const primaryModel = params.preferLite ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

  let lastErr: unknown;
  try {
    return await callModel(primaryModel, params.tools);
  } catch (err1) {
    lastErr = err1;
    const msg1 = extractRawErrorMessage(err1);
    const isInvalidToolArg = !isGeminiAuthError(err1) && /400|INVALID_ARGUMENT|urlContext/i.test(msg1);
    if (!isRetryableGeminiError(err1) && !isInvalidToolArg) {
      throw err1;
    }

    // Immediate cross-model fallback from gemini-4-hydrogen to gemini-3.1-flash-lite on BOTH 503 and 429
    if (primaryModel === 'gemini-4-hydrogen') {
      await sleep(isGeminiQuotaError(err1) ? 700 : 500);
      try {
        return await callModel('gemini-3.1-flash-lite', params.tools);
      } catch (errLite) {
        lastErr = errLite;
      }
    }

    // If urlContext + googleSearch failed because of urlContext 400 or googleSearch 429, try narrowing tools on flash-lite
    if (!hasMapsTool && hasUrlContext && hasSearchTool) {
      const liteMsg = extractRawErrorMessage(lastErr);
      const tryTools = isGeminiQuotaError(lastErr)
        ? [{ urlContext: {} }]
        : /400|INVALID_ARGUMENT|urlContext/i.test(liteMsg)
          ? [{ googleSearch: {} }]
          : null;
      if (tryTools) {
        await sleep(600);
        try {
          return await callModel('gemini-3.1-flash-lite', tryTools);
        } catch (errNarrow) {
          lastErr = errNarrow;
        }
      }
    }

    // Drop search/url tools as a last resort when rich business metadata is already in prompt
    if (allowNoToolsFallback && params.tools && params.tools.length > 0 && !isGeminiAuthError(lastErr)) {
      await sleep(700);
      try {
        return await callModel('gemini-3.1-flash-lite', undefined);
      } catch (errNoTools) {
        lastErr = errNoTools;
      }
    }

    // One final backoff retry on gemini-3.1-flash-lite if transient 503 persists
    if (isGeminiTransientError(lastErr)) {
      await sleep(1400);
      return await callModel(
        'gemini-3.1-flash-lite',
        allowNoToolsFallback ? undefined : params.tools
      );
    }

    throw lastErr;
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
    allowNoToolsFallback: false,
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

interface DetailedSiteInspection {
  signals: SiteTechnicalSignals;
  title?: string;
  metaDescription?: string;
  headings: string[];
  textSnippet: string;
  textLength: number;
  extractedTelegram?: { telegramHandle?: string; telegramUrl?: string };
  extractedSocials: string[];
}

const GENERIC_FONT_TOKENS = new Set([
  'inherit',
  'initial',
  'unset',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'roboto',
  'helvetica',
  'helvetica neue',
  'arial',
  'times new roman',
  'tahoma',
  'verdana',
  'georgia',
  'courier new',
  'consolas',
  'monaco',
  'menlo',
  'liberation mono',
  'sfmono-regular',
  'apple color emoji',
  'segoe ui emoji',
  'noto color emoji',
  'eicons',
  'fontawesome',
  'font awesome',
  'dashicons',
  'simple-line-icons',
  'vcpb-plugin-icons',
  'icomoon',
  'slick',
  'swiper-icons',
]);

async function inspectWebsiteSignals(rawUrl: string): Promise<DetailedSiteInspection> {
  const emptyResult = (reason: string, botProtected = false): DetailedSiteInspection => ({
    signals: {
      reachable: false,
      botProtected,
      finalUrl: rawUrl,
      usesHttps: rawUrl.startsWith('https://'),
      hasViewportMeta: false,
      stack: [],
      fonts: [],
      layoutFeatures: [],
      widgets: [],
      redFlags: botProtected ? [] : [reason],
      modernIndex: botProtected ? 6 : 3,
    },
    headings: [],
    textSnippet: '',
    textLength: 0,
    extractedSocials: [],
  });

  try {
    const res = await fetch(rawUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(6500),
    });

    if (!res.ok) {
      const isBotBlock = res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503;
      return emptyResult(`Сервер сайта вернул ошибку HTTP ${res.status}`, isBotBlock);
    }

    const finalUrl = res.url || rawUrl;
    const usesHttps = finalUrl.startsWith('https://');
    const html = (await res.text()).slice(0, 700_000);

    // Fetch up to 3 external stylesheets to inspect real CSS layout & typography
    const cssUrls = Array.from(
      html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)
    )
      .map((m) => {
        try {
          return new URL(m[1], finalUrl).href;
        } catch {
          return null;
        }
      })
      .filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u)))
      .slice(0, 3);

    const cssBodies = await Promise.all(
      cssUrls.map(async (cu) => {
        try {
          const cr = await fetch(cu, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(3500),
          });
          if (!cr.ok) return '';
          return (await cr.text()).slice(0, 70_000);
        } catch {
          return '';
        }
      })
    );

    const combinedCssAndHtml = `${html}\n${cssBodies.join('\n')}`;
    const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html);
    const hasOgImage = /property=["']og:image["']/i.test(html);
    const hasStructuredData = /application\/ld\+json/i.test(html);

    // Detect tech stack & builders
    const stack: string[] = [];
    if (/_next\/static|__NEXT_DATA__/i.test(html)) stack.push('Next.js');
    else if (/__NUXT__|_nuxt\//i.test(html)) stack.push('Nuxt');
    else if (/astro-island|data-astro/i.test(html)) stack.push('Astro');

    if (/webflow\.js|data-wf-site|w-nav/i.test(html)) stack.push('Webflow');
    if (/framerusercontent|data-framer/i.test(html)) stack.push('Framer');
    if (/tildacdn|tilda-blocks/i.test(html)) {
      stack.push(/t396|t-records/i.test(html) ? 'Tilda (Zero Block)' : 'Tilda');
    }
    if (/wix\.com|wixstatic/i.test(html)) stack.push('Wix');
    if (/cdn\.shopify\.com/i.test(html)) stack.push('Shopify');
    if (/elementor/i.test(html)) stack.push('Elementor');
    if (/wpbakery|vc_row|js_composer/i.test(combinedCssAndHtml)) stack.push('WPBakery');
    if (/wp-content|wp-includes/i.test(html) && !stack.includes('Elementor') && !stack.includes('WPBakery')) {
      stack.push('WordPress');
    }
    if (/\/bitrix\//i.test(html)) stack.push('1C-Битрикс');
    if (/tailwind/i.test(combinedCssAndHtml)) stack.push('Tailwind CSS');

    // Detect custom web fonts (excluding icon & generic system fonts)
    const fontSet = new Set<string>();
    const googleFontMatches = html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&]+)/gi);
    for (const m of googleFontMatches) {
      const families = decodeURIComponent(m[1]).split('|');
      for (const fam of families) {
        const clean = fam.split(':')[0].replace(/\+/g, ' ').trim();
        if (clean && !GENERIC_FONT_TOKENS.has(clean.toLowerCase())) {
          fontSet.add(clean);
        }
      }
    }
    const fontFamilyMatches = combinedCssAndHtml.matchAll(/font-family\s*:\s*([^;}{]{2,80})/gi);
    for (const m of fontFamilyMatches) {
      const parts = m[1].split(',');
      for (const rawPart of parts) {
        const clean = rawPart
          .replace(/!important/gi, '')
          .replace(/["']/g, '')
          .trim();
        if (
          clean &&
          clean.length >= 3 &&
          clean.length <= 32 &&
          !/^var\(/i.test(clean) &&
          !/^wf_/i.test(clean) &&
          !/^--/.test(clean) &&
          !/icon|emoji|mono|fallback|inherit/i.test(clean) &&
          !GENERIC_FONT_TOKENS.has(clean.toLowerCase())
        ) {
          fontSet.add(clean);
        }
      }
      if (fontSet.size >= 5) break;
    }
    const fonts = Array.from(fontSet).slice(0, 4);

    // Modern CSS & visual media features
    const usesCssFlex = /display\s*:\s*flex/i.test(combinedCssAndHtml);
    const usesCssGrid = /display\s*:\s*grid/i.test(combinedCssAndHtml);
    const usesCssVars = /--[a-z0-9-]{2,}\s*:/i.test(combinedCssAndHtml);
    const usesClamp = /clamp\(/i.test(combinedCssAndHtml);
    const hasMediaQueries = /@media\s*\(/i.test(combinedCssAndHtml);
    const hasModernMotion = /gsap|framer-motion|aos\.css|swiper|lenis|locomotive|lottie|@keyframes/i.test(
      combinedCssAndHtml
    );

    const imgCount = (html.match(/<img\b/gi) || []).length;
    const inlineSvgCount = (html.match(/<svg\b/gi) || []).length;
    const webpCount = (html.match(/\.webp|\.avif|<picture\b/gi) || []).length;
    const videoCount = (html.match(/<video\b|youtube\.com|vimeo\.com/gi) || []).length;

    const layoutFeatures: string[] = [];
    if (usesCssGrid) layoutFeatures.push('CSS Grid');
    if (usesCssFlex) layoutFeatures.push('Flexbox');
    if (usesCssVars) layoutFeatures.push('CSS-переменные');
    if (usesClamp) layoutFeatures.push('Адаптивная типографика clamp()');
    if (webpCount > 0) layoutFeatures.push('WebP/AVIF медиа');
    if (inlineSvgCount >= 10) layoutFeatures.push(`${inlineSvgCount} SVG-иконок`);
    if (videoCount > 0) layoutFeatures.push('Видео-контент');
    if (hasModernMotion) layoutFeatures.push('Современные анимации/слайдеры');
    if (hasOgImage) layoutFeatures.push('OpenGraph');
    if (hasStructuredData) layoutFeatures.push('Schema.org');

    // Widgets & real contact links scraped directly from HTML
    const widgets: string[] = [];
    if (/wa\.me\/|api\.whatsapp\.com|whatsapp/i.test(html)) widgets.push('WhatsApp');
    if (/t\.me\/|telegram\.me\//i.test(html)) widgets.push('Telegram');
    if (/yclients|altegio|calendly|dikidi|medflex|prodoctorov/i.test(html)) {
      widgets.push('Онлайн-запись');
    }
    if (/marquiz|envybox|quiz/i.test(html)) widgets.push('Квиз/калькулятор');
    if (/jivosite|jivo|bitrix24|amocrm|carrotquest|intercom|crisp/i.test(html)) {
      widgets.push('CRM/Онлайн-чат');
    }
    const formCount = (html.match(/<form\b/gi) || []).length;
    if (formCount > 0) widgets.push(`Формы (${formCount})`);
    if (/href=["']tel:/i.test(html)) widgets.push('Клик-звонок tel:');

    // Extract actual Telegram & Social links from HTML
    let extractedTelegram: { telegramHandle?: string; telegramUrl?: string } | undefined;
    const tgHrefMatch = html.match(
      /href=["'](https?:\/\/(?:t\.me|telegram\.me)\/(?!share\b)[a-zA-Z0-9_+/]{3,64})["']/i
    );
    if (tgHrefMatch?.[1]) {
      const norm = normalizeTelegram(tgHrefMatch[1]);
      if (norm.telegramUrl) extractedTelegram = norm;
    }

    const socialSet = new Set<string>();
    for (const sm of html.matchAll(
      /href=["'](https?:\/\/(?:www\.)?(?:instagram\.com|vk\.com|youtube\.com|tiktok\.com|facebook\.com)\/[^"'\s<>]{2,80})["']/gi
    )) {
      if (isSafeHttpUrl(sm[1])) socialSet.add(sm[1]);
      if (socialSet.size >= 4) break;
    }

    // Legacy / Red Flags detection
    const redFlags: string[] = [];
    if (!usesHttps) redFlags.push('Сайт работает по HTTP без SSL-шифрования');
    if (!hasViewportMeta) redFlags.push('Отсутствует meta viewport (нет мобильной адаптации)');

    const tableCount = (html.match(/<table\b/gi) || []).length;
    if (tableCount > 3 && !usesCssGrid) {
      redFlags.push(`Табличная вёрстка (${tableCount} <table>)`);
    }
    if (/<frameset|<marquee|<font\b/i.test(html)) {
      redFlags.push('Устаревшие HTML4-теги (<font>/<marquee>/<frameset>)');
    }
    const hasModernBuilder = stack.some((s) =>
      ['Tilda (Zero Block)', 'Tilda', 'Webflow', 'Framer', 'Next.js', 'Nuxt', 'Shopify'].includes(s)
    );
    if (/jquery[.-]?1\.[0-9.]+/i.test(html) && !hasModernBuilder) {
      redFlags.push('Устаревший jQuery 1.x');
    }
    if (/col-xs-|navbar-default|panel-default/i.test(combinedCssAndHtml)) {
      redFlags.push('Устаревший Bootstrap 2/3');
    }
    if (stack.includes('WPBakery')) {
      redFlags.push('Устаревший конструктор WPBakery');
    }
    if (!usesCssGrid && !usesCssFlex && !usesCssVars && cssBodies.length > 0) {
      redFlags.push('Отсутствуют современные CSS-сетки (Flexbox/Grid)');
    }
    if (fonts.length === 0 && cssBodies.length > 0) {
      redFlags.push('Не обнаружены кастомные веб-шрифты');
    }
    if (imgCount < 3 && inlineSvgCount < 3) {
      redFlags.push('Крайне мало визуального контента и графики');
    }
    const yearMatch = html.match(/©\s*(?:20\d{2}|19\d{2})(?:\s*[-–—]\s*(20\d{2}))?/i);
    const latestYear = yearMatch ? Number(yearMatch[1] || yearMatch[0].match(/\d{4}/)?.[0]) : undefined;
    if (latestYear && latestYear <= 2021) {
      redFlags.push(`Копирайт в футере устарел (${latestYear})`);
    }

    // Compute objective modernIndex (1..10)
    let score = 4;
    if (usesHttps) score += 1;
    if (hasViewportMeta) score += 1;
    if (usesCssGrid && usesCssVars) score += 1;
    else if (usesCssFlex && hasMediaQueries) score += 0.5;
    if (usesClamp || hasModernMotion) score += 0.5;
    if (fonts.length > 0) score += 1;
    if (webpCount > 0 || inlineSvgCount >= 15 || videoCount > 0) score += 1;
    if (
      stack.some((s) =>
        ['Next.js', 'Nuxt', 'Astro', 'Webflow', 'Framer', 'Tilda (Zero Block)', 'Tailwind CSS', 'Shopify'].includes(s)
      )
    ) {
      score += 1;
    }
    if (widgets.length >= 2) score += 0.5;
    if (latestYear && latestYear >= 2024) score += 0.5;

    // Penalize verified red flags
    score -= redFlags.length * 1.1;
    const modernIndex = Math.min(10, Math.max(1, Math.round(score)));

    // Extract readable headings & visible text digest for Gemini
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    const metaDescription = html
      .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?.trim();

    const stripTags = (s: string) =>
      s
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();

    const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
      .map((m) => stripTags(m[1]))
      .filter((h) => h.length > 2 && h.length < 140)
      .slice(0, 10);

    const bodyOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
    const cleanText = stripTags(bodyOnly);
    const textSnippet = cleanText.slice(0, 1800);

    return {
      signals: {
        reachable: true,
        finalUrl,
        usesHttps,
        hasViewportMeta,
        stack,
        fonts,
        layoutFeatures,
        widgets,
        redFlags,
        modernIndex,
      },
      title,
      metaDescription,
      headings,
      textSnippet,
      textLength: cleanText.length,
      extractedTelegram,
      extractedSocials: Array.from(socialSet),
    };
  } catch (err) {
    return emptyResult(
      `Сайт не отвечает или блокирует загрузку (${err instanceof Error ? err.message : 'таймаут'})`
    );
  }
}

function isClearlyModernSite(signals?: SiteTechnicalSignals): boolean {
  if (!signals) return false;
  return Boolean(
    signals.reachable &&
      !signals.botProtected &&
      ((signals.modernIndex >= 7 && signals.redFlags.length === 0) ||
        (signals.modernIndex >= 8 && signals.redFlags.length <= 1))
  );
}

interface CandidateInspectionPair {
  lead: BusinessLead;
  inspection?: DetailedSiteInspection;
}

async function preInspectCandidates(
  candidates: BusinessLead[],
  qualityFilter: AutopilotQualityFilter
): Promise<{
  selected: CandidateInspectionPair[];
  skippedModernCount: number;
}> {
  const seenDomains = new Set<string>();
  const deduped: BusinessLead[] = [];
  for (const lead of candidates) {
    if (isSafeHttpUrl(lead.websiteUrl) && !isSocialOrDirectoryOnlyUrl(lead.websiteUrl)) {
      try {
        const u = new URL(lead.websiteUrl);
        const siteKey = `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
        if (seenDomains.has(siteKey)) continue;
        seenDomains.add(siteKey);
      } catch {
        // ignore invalid URL
      }
    }
    deduped.push(lead);
  }
  const capped = deduped.slice(0, 8);
  const inspected = await Promise.all(
    capped.map(async (lead): Promise<CandidateInspectionPair> => {
      const hasUrl = isSafeHttpUrl(lead.websiteUrl);
      const hasRealWebsite = hasUrl && !isSocialOrDirectoryOnlyUrl(lead.websiteUrl);
      if (!hasRealWebsite || !lead.websiteUrl) {
        return { lead };
      }

      const inspection = await inspectWebsiteSignals(lead.websiteUrl);
      const tg = !lead.telegramUrl && inspection.extractedTelegram
        ? inspection.extractedTelegram
        : undefined;
      const mergedSocials =
        inspection.extractedSocials.length > 0
          ? Array.from(new Set([...lead.socialLinks, ...inspection.extractedSocials]))
          : lead.socialLinks;

      return {
        lead: {
          ...lead,
          techSignals: inspection.signals,
          telegramHandle: lead.telegramHandle ?? tg?.telegramHandle,
          telegramUrl: lead.telegramUrl ?? tg?.telegramUrl,
          socialLinks: mergedSocials,
        },
        inspection,
      };
    })
  );

  let skippedModernCount = 0;
  const filtered: CandidateInspectionPair[] = [];
  for (const pair of inspected) {
    if (qualityFilter !== 'all' && isClearlyModernSite(pair.inspection?.signals)) {
      skippedModernCount += 1;
      continue;
    }
    filtered.push(pair);
  }

  // Prioritize candidates with the weakest/red-flagged technical signals first
  filtered.sort((a, b) => {
    const scoreA = a.inspection?.signals.modernIndex ?? (isSafeHttpUrl(a.lead.websiteUrl) ? 5 : 2);
    const scoreB = b.inspection?.signals.modernIndex ?? (isSafeHttpUrl(b.lead.websiteUrl) ? 5 : 2);
    const flagsA = a.inspection?.signals.redFlags.length ?? 0;
    const flagsB = b.inspection?.signals.redFlags.length ?? 0;
    if (flagsB !== flagsA) return flagsB - flagsA;
    return scoreA - scoreB;
  });

  return { selected: filtered, skippedModernCount };
}

/**
 * Combined AI Website & Design Auditor + Contact Enrichment.
 * Inspects live HTML/CSS/typography/widget telemetry first, then combines it
 * with Gemini evaluation so premium sites are accurately distinguished from outdated ones.
 */
async function auditAndEnrichLead(
  ai: GoogleGenAI,
  lead: BusinessLead,
  options?: { preferLite?: boolean; precomputedInspection?: DetailedSiteInspection }
): Promise<BusinessLead> {
  const hasUrl = isSafeHttpUrl(lead.websiteUrl);
  const hasRealWebsite = hasUrl && !isSocialOrDirectoryOnlyUrl(lead.websiteUrl);

  const inspection =
    options?.precomputedInspection ??
    (hasRealWebsite && lead.websiteUrl
      ? await inspectWebsiteSignals(lead.websiteUrl)
      : undefined);

  const needUrlContext = Boolean(
    hasUrl && (!inspection || !inspection.signals.reachable || inspection.textLength < 400)
  );
  const tools: Array<Record<string, unknown>> = hasUrl
    ? hasRealWebsite
      ? inspection?.signals.botProtected
        ? [{ googleSearch: {} }]
        : needUrlContext
          ? [{ urlContext: {} }]
          : []
      : [{ urlContext: {} }, { googleSearch: {} }]
    : [{ googleSearch: {} }];

  const signalsBlock = inspection
    ? inspection.signals.botProtected
      ? `\nОБЪЕКТИВНЫЕ СИГНАЛЫ САЙТА:
- Доступ к прямому HTML ограничен защитой от ботов/WAF (Cloudflare/403) по адресу ${inspection.signals.finalUrl || lead.websiteUrl}.
- ВАЖНО: Защита от ботов (403) НЕ означает, что сайт устарел или сломан! Многие дорогие бренды, архитектурные и дизайн-студии используют Cloudflare/WAF. Проверь сайт через urlContext/googleSearch, оцени репутацию и уровень студии, и НЕ ставь заниженную оценку за сам факт блокировки.\n`
      : `\nОБЪЕКТИВНЫЕ ТЕХНИЧЕСКИЕ И ВИЗУАЛЬНЫЕ СИГНАЛЫ САЙТА (извлечены напрямую из живого HTML/CSS):
- Доступность: ${inspection.signals.reachable ? `Да (${inspection.signals.finalUrl})` : 'Нет / таймаут'}
- HTTPS / SSL: ${inspection.signals.usesHttps ? 'Да' : 'НЕТ (HTTP)'}
- Мобильный viewport: ${inspection.signals.hasViewportMeta ? 'Да' : 'НЕТ'}
- Определённый стек: ${inspection.signals.stack.length > 0 ? inspection.signals.stack.join(', ') : 'Кастомная вёрстка'}
- Кастомные веб-шрифты: ${inspection.signals.fonts.length > 0 ? inspection.signals.fonts.join(', ') : 'Только системные/не найдены'}
- Современные фичи вёрстки/медиа: ${inspection.signals.layoutFeatures.length > 0 ? inspection.signals.layoutFeatures.join(', ') : 'Не обнаружены'}
- Найденные виджеты/конверсия: ${inspection.signals.widgets.length > 0 ? inspection.signals.widgets.join(', ') : 'Не найдены'}
- Зафиксированные проблемы кода/дизайна: ${inspection.signals.redFlags.length > 0 ? inspection.signals.redFlags.join('; ') : 'Критичных устаревших паттернов не обнаружено'}
- Объективный технический индекс (1-10): ${inspection.signals.modernIndex}/10
- Title: ${inspection.title || '—'}
- Заголовки H1-H3: ${inspection.headings.join(' | ') || '—'}
- Фрагмент текста страницы:\n${inspection.textSnippet || '—'}\n`
    : '';

  const prompt = `Ты — ведущий арт-директор, UX-аудитор и техлид веб-студии. Твоя главная задача — ТОЧНО отличать действительно премиальные и современные сайты от устаревших, шаблонных или слабых сайтов.

Проанализируй бизнес и его сайт:
Название: ${lead.name}
Категория: ${lead.category}
Адрес / город: ${lead.address || 'не указан'}
Текущий сайт: ${lead.websiteUrl || 'не указан на карте'}
Google Карты: ${lead.googleMapsUrl || 'не указан'}
${signalsBlock}
Строгие правила калибровки оценки (НЕ занижай хорошие сайты!):
1. ${
    hasRealWebsite
      ? 'Опирайся на реальные технические/визуальные сигналы и контент страницы выше.'
      : hasUrl
        ? `У бизнеса указана не полноценная веб-платформа, а соцсеть/справочник (${lead.websiteUrl}). Проверь через поиск, есть ли полноценный сайт.`
        : `Выполни поиск в googleSearch, есть ли у компании "${lead.name}" (${lead.address || ''}) официальный сайт.`
  }
2. ШКАЛА ВЕРДИКТОВ И ОЦЕНОК:
   - "modern_ok" (оценки 8–10 — Премиальный / современный сайт): чистый актуальный сайт с HTTPS, адаптивом, современной CSS-вёрсткой (Grid/Flex/переменные), кастомной типографикой (Manrope, Outfit, Onest, Inter, Playfair и др.), качественными медиа (WebP/SVG/видео), современным стеком (Next.js/Webflow/Framer/Tilda Zero Block/качественный кастом) и понятным путём к заявке (формы/WhatsApp/Telegram).
     ВАЖНО: Премиальные бренды и клиники часто сознательно делают минималистичный сайт без калькулятора цен и без Telegram-бота. НИКОГДА не ставь такому сайту "hot_outdated" и НЕ выдумывай "выглядит как шаблон 2010-х", если технические сигналы показывают современную вёрстку и шрифты!
   - "modern_ok" (оценки 6–7 — Хороший рабочий сайт): крепкий, аккуратный, адаптивный сайт, где дизайн нормальный/современный, пусть и без сложных интерактивных фишек (может быть на аккуратном WordPress/Elementor/Tilda).
   - "hot_outdated" (оценки 1–5 — Устаревший / слабый сайт): РЕАЛЬНО слабый, морально устаревший или кривой сайт (табличная вёрстка, старый Bootstrap 2/3, WPBakery, древний Bitrix/Joomla шаблон 2010-х, нет HTTPS, нет мобильного viewport, системные шрифты Arial/Times, перегруженная стена текста, битый/неработающий сайт, ИЛИ вместо сайта только Taplink/Instagram/2GIS).
   - "no_website" (оценка 1/1): сайта нет вообще.
3. ЗАПРЕТ НА ВЫДУМКИ: Не пиши «нет мобильной адаптации», «нет SSL» или «дизайн 2010-х», если сигналы выше прямо подтверждают обратное (HTTPS=Да, viewport=Да, CSS Grid, современные шрифты, high modernIndex). Указывай только реальные точки роста!
4. Для "issues" (2–4 пункта): назови честные наблюдения (если сайт премиальный — точечные UX/конверсионные точки роста, не оскорбляя дизайн; если устаревший — реальные дефекты).
5. Для "pitchSuggestions" (3–4 пункта): что можно предложить владельцу под их нишу (если сайт уже сильный — доработки автоматизации: CRM-запись, AI-ассистент/Telegram-бот, личный кабинет; если слабый — полноценный редизайн, структура, квиз, скорость, запись).
6. Для "salesPitch" (3–4 живых предложения): уважительный оффер без шаблонных фраз, соответствующий реальному уровню их сайта.
7. Найди официальный Telegram (@username / t.me/...) и соцсети компании, если реально встречаются (НЕ выдумывай).

Верни СТРОГО валидный JSON-объект:
{
  "description": "понятное описание бизнеса на русском (2-3 предложения)",
  "websiteUrl": "найденный или текущий https URL сайта (или null)",
  "telegramHandle": "@username или null",
  "telegramUrl": "https://t.me/... или null",
  "socialLinks": ["https://..."],
  "verdict": "hot_outdated" | "no_website" | "modern_ok",
  "verdictLabel": "например: Премиальный современный сайт / Современный рабочий сайт / Устаревший сайт и дизайн / Слабый шаблонный сайт / Нет сайта",
  "websiteScore": число от 1 до 10,
  "designScore": число от 1 до 10,
  "issues": ["пункт 1", "пункт 2"],
  "pitchSuggestions": ["идея 1", "идея 2", "идея 3"],
  "salesPitch": "готовый текст сообщения клиенту"
}`;

  const response = await generateWithRetry(ai, {
    contents: prompt,
    ...(tools.length > 0 ? { tools } : {}),
    preferLite: options?.preferLite,
    allowNoToolsFallback: true,
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
    : inspection?.signals.finalUrl || lead.websiteUrl;

  const hasWebsiteNow = isSafeHttpUrl(resolvedWebsiteUrl) && !isSocialOrDirectoryOnlyUrl(resolvedWebsiteUrl);

  let verdict: AuditVerdict = 'hot_outdated';
  if (parsed.verdict === 'modern_ok' || parsed.verdict === 'no_website' || parsed.verdict === 'hot_outdated') {
    verdict = parsed.verdict;
  } else if (!hasWebsiteNow && !hasRealWebsite) {
    verdict = 'no_website';
  }

  let websiteScore = clampScore(
    parsed.websiteScore,
    verdict === 'no_website' ? 1 : verdict === 'modern_ok' ? 8 : 4
  );
  let designScore = clampScore(
    parsed.designScore,
    verdict === 'no_website' ? 1 : verdict === 'modern_ok' ? 8 : 4
  );

  // Server-side calibration guardrail backed by real DOM/CSS/typography telemetry
  if (!hasWebsiteNow && !hasRealWebsite) {
    verdict = 'no_website';
    websiteScore = 1;
    designScore = 1;
  } else if (inspection?.signals.reachable) {
    const idx = inspection.signals.modernIndex;
    const redFlagCount = inspection.signals.redFlags.length;

    // Prevent false "hot_outdated" classification on verified modern/premium stacks
    if (idx >= 8 && redFlagCount === 0) {
      websiteScore = Math.max(websiteScore, 8);
      designScore = Math.max(designScore, 7);
      verdict = 'modern_ok';
    } else if (idx >= 7 && redFlagCount === 0 && websiteScore <= 5 && designScore <= 5) {
      websiteScore = Math.max(websiteScore, 7);
      designScore = Math.max(designScore, 7);
      verdict = 'modern_ok';
    } else if (redFlagCount >= 2 || idx <= 4) {
      websiteScore = Math.min(websiteScore, 5);
      designScore = Math.min(designScore, 5);
      verdict = 'hot_outdated';
    }
  }

  // Keep verdict and numeric scores consistent
  if (websiteScore <= 5 || designScore <= 5) {
    if (verdict !== 'no_website') verdict = 'hot_outdated';
  } else if (websiteScore >= 7 && designScore >= 7) {
    verdict = 'modern_ok';
  } else if (verdict === 'modern_ok' && (websiteScore <= 5 || designScore <= 5)) {
    verdict = 'hot_outdated';
  }

  const defaultVerdictLabel =
    verdict === 'no_website'
      ? 'Нет полноценного сайта'
      : verdict === 'modern_ok'
        ? websiteScore >= 8 && designScore >= 8
          ? 'Премиальный современный сайт'
          : 'Современный рабочий сайт'
        : designScore <= 4 && websiteScore <= 4
          ? 'Устаревший сайт и слабый дизайн'
          : designScore <= 5
            ? 'Слабый устаревший дизайн'
            : 'Устаревший сайт';

  // Override misleading verdictLabel if guardrail flipped verdict
  let verdictLabel = parsed.verdictLabel?.trim() || defaultVerdictLabel;
  if (verdict === 'modern_ok' && /устарев|слаб/i.test(verdictLabel)) {
    verdictLabel = defaultVerdictLabel;
  } else if (verdict === 'hot_outdated' && /премиальн|современ/i.test(verdictLabel)) {
    verdictLabel = defaultVerdictLabel;
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
    verdictLabel,
    websiteScore,
    designScore,
    issues:
      issues.length > 0
        ? issues
        : verdict === 'no_website'
          ? ['У компании отсутствует полноценный продающий сайт.']
          : verdict === 'modern_ok'
            ? ['Визуальная часть на хорошем уровне — основные точки роста лежат в автоматизации заявок и CRM.']
            : ['Недостаточно выраженные точки захвата заявок и устаревшая визуальная иерархия.'],
    pitchSuggestions:
      pitchSuggestions.length > 0
        ? pitchSuggestions
        : verdict === 'modern_ok'
          ? [
              'Telegram-бот для мгновенной записи и автоматических напоминаний клиентам',
              'Интеграция веб-аналитики и личного кабинета клиента поверх существующего сайта',
            ]
          : [
              'Современный адаптивный редизайн с быстрым первым экраном и понятным оффером',
              'Онлайн-запись или квиз-калькулятор стоимости с мгновенной отправкой заявки в Telegram',
            ],
    salesPitch:
      parsed.salesPitch?.trim() ||
      (verdict === 'modern_ok'
        ? `Здравствуйте! Посмотрел сайт «${lead.name}» — у вас сильный и аккуратный ресурс. Могу помочь усилить конверсию и разгрузить администраторов: подключить удобного Telegram-бота для записи и синхронизацию с CRM, чтобы клиенты бронировали визит в пару кликов.`
        : `Здравствуйте! Посмотрел ваш бизнес «${lead.name}» и текущий сайт — у вас сильная ниша, но сайт визуально устарел и теряет часть заявок с мобильных устройств. Могу собрать современный быстрый сайт с удобной записью и привязкой к Telegram, чтобы вы получали больше клиентов прямо с карт и поиска.`),
    techSignals: inspection?.signals,
    scannedAt: new Date().toISOString(),
  };

  const tg = normalizeTelegram(
    parsed.telegramUrl ||
      parsed.telegramHandle ||
      inspection?.extractedTelegram?.telegramUrl ||
      lead.telegramUrl ||
      lead.telegramHandle
  );
  const parsedSocials = Array.isArray(parsed.socialLinks)
    ? parsed.socialLinks.filter((u): u is string => isSafeHttpUrl(u))
    : [];
  const socialLinks = Array.from(
    new Set([...lead.socialLinks, ...parsedSocials, ...(inspection?.extractedSocials ?? [])])
  );

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
    socialLinks,
    sourceLinks: mergedSourceLinks,
    techSignals: inspection?.signals ?? lead.techSignals,
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
  // Never keep confirmed good/modern sites in the lead feed
  if (verdict === 'modern_ok') return false;
  if (qualityFilter === 'weak_only') {
    if (verdict) return verdict === 'hot_outdated';
    // Unscanned fallback (only kept when AI is temporarily unavailable and site isn't modern)
    return isSafeHttpUrl(lead.websiteUrl) && !isClearlyModernSite(lead.techSignals);
  }
  // 'weak_or_none'
  if (verdict) return verdict === 'hot_outdated' || verdict === 'no_website';
  return !isClearlyModernSite(lead.techSignals);
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

    let rawCandidates: BusinessLead[] = [];
    let candidatePairs: CandidateInspectionPair[] = [];
    let skippedModernCount = 0;
    let placesError: string | undefined;
    const triedCities = new Set<string>(config.visitedCities);
    const allowedCountries =
      config.region !== 'world' && config.region !== 'custom'
        ? REGION_ALLOWED_COUNTRIES[config.region]
        : undefined;

    // Try up to 2 cities if the first city has no fresh weak-site candidates
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

      const placesResult = await searchPlacesApi(query, 10, {
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

      rawCandidates = placesResult.leads;
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

      const basePool =
        config.qualityFilter === 'weak_only'
          ? newCandidates.filter((l) => isSafeHttpUrl(l.websiteUrl))
          : newCandidates;

      if (basePool.length > 0) {
        const pre = await preInspectCandidates(basePool, config.qualityFilter);
        skippedModernCount += pre.skippedModernCount;
        if (pre.selected.length > 0) {
          candidatePairs = pre.selected;
          break;
        }
      }
    }

    const toAudit = candidatePairs.slice(0, 3);
    scannedCount = toAudit.length + skippedModernCount;

    const auditedLeads: BusinessLead[] = [];
    let geminiTransientFailed = false;
    if (ai && toAudit.length > 0 && !geminiQuotaExceeded) {
      for (let i = 0; i < toAudit.length; i++) {
        if (i > 0) await sleep(1200);
        try {
          const audited = await auditAndEnrichLead(ai, toAudit[i].lead, {
            preferLite: true,
            precomputedInspection: toAudit[i].inspection,
          });
          auditedLeads.push(audited);
        } catch (err) {
          geminiErrorMsg = formatGeminiError(err);
          if (isGeminiQuotaError(err)) {
            geminiQuotaExceeded = true;
            auditedLeads.push(...toAudit.slice(i).map((p) => p.lead));
            break;
          }
          if (isGeminiTransientError(err)) {
            geminiTransientFailed = true;
            auditedLeads.push(...toAudit.slice(i).map((p) => p.lead));
            break;
          }
          auditedLeads.push(toAudit[i].lead);
        }
      }
    } else {
      auditedLeads.push(...toAudit.map((p) => p.lead));
    }

    // Never keep non-favorite good/modern sites in the feed; if Gemini succeeded, exclude modern_ok.
    // If Gemini was temporarily overloaded/quota-limited, keep pre-filtered weak Maps candidates without faking AI audit.
    const qualifiedLeads = auditedLeads.filter((lead) =>
      lead.audit
        ? passesQualityFilter(lead, config.qualityFilter)
        : (geminiQuotaExceeded || geminiTransientFailed || !ai) &&
          !isClearlyModernSite(lead.techSignals)
    );

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      for (const lead of qualifiedLeads.slice(0, 3)) {
        const sent = await sendLeadToTelegram(lead, appBaseUrl);
        if (sent.ok) {
          lead.sentToTelegramAt = new Date().toISOString();
        }
      }
    }

    const cleanedExisting = existing.filter(
      (lead) => Boolean(lead.isFavorite) || lead.audit?.verdict !== 'modern_ok'
    );
    const updatedLeads = mergeAndTrimLeads(qualifiedLeads, cleanedExisting, 250);
    await writeLeads(updatedLeads);

    const nowMs = Date.now();
    const intervalMs = Math.max(1, config.intervalMinutes) * 60 * 1000;
    const nextVisited = Array.from(new Set([...config.visitedCities, city])).slice(-60);
    const shouldPause = quotaExceeded || geminiQuotaExceeded;

    const lastError = quotaExceeded
      ? 'Достигнута квота Google Maps API. Автопилот приостановлен.'
      : geminiQuotaExceeded
        ? `${geminiErrorMsg} Автопилот поставлен на паузу.`
        : geminiTransientFailed && qualifiedLeads.length > 0
          ? `Найдено ${qualifiedLeads.length} компаний с признаками слабого сайта, но ИИ-аудит Gemini сейчас перегружен (503) — карточки добавлены в ленту, проверьте их чуть позже.`
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
  const bootLeads = await readLeads();
  const prunedBootLeads = bootLeads.filter(
    (lead) => Boolean(lead.isFavorite) || lead.audit?.verdict !== 'modern_ok'
  );
  if (prunedBootLeads.length !== bootLeads.length) {
    await writeLeads(prunedBootLeads);
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

      const baseCandidates =
        qualityFilter === 'weak_only'
          ? freshCandidates.filter((l) => isSafeHttpUrl(l.websiteUrl))
          : freshCandidates;

      const pre = await preInspectCandidates(baseCandidates, qualityFilter);
      const toScan = pre.selected.slice(0, 3);

      const scannedLeads: BusinessLead[] = [];
      let geminiTransientHit = false;
      if (ai && toScan.length > 0 && !geminiQuotaHit) {
        for (let i = 0; i < toScan.length; i++) {
          if (i > 0) await sleep(1100);
          try {
            const audited = await auditAndEnrichLead(ai, toScan[i].lead, {
              precomputedInspection: toScan[i].inspection,
            });
            scannedLeads.push(audited);
          } catch (err) {
            const msg = formatGeminiError(err);
            if (!warnings.includes(msg)) warnings.push(msg);
            if (isGeminiQuotaError(err) || isGeminiTransientError(err)) {
              if (isGeminiQuotaError(err)) geminiQuotaHit = true;
              else geminiTransientHit = true;
              // Keep remaining un-audited non-modern leads from Maps so user can still open them and scan individually
              scannedLeads.push(...toScan.slice(i).map((p) => p.lead));
              break;
            }
            scannedLeads.push(toScan[i].lead);
          }
        }
      } else {
        scannedLeads.push(...toScan.map((p) => p.lead));
      }

      const geminiUnavailable = geminiQuotaHit || geminiTransientHit || !ai;
      // Keep weak/outdated leads; if Gemini was unavailable, keep pre-filtered non-modern Maps leads instead of returning 0 results
      const qualified = scannedLeads.filter((lead) =>
        lead.audit
          ? passesQualityFilter(lead, qualityFilter)
          : geminiUnavailable && !isClearlyModernSite(lead.techSignals)
      );

      if (autoSendTelegram && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const baseUrl = getBaseAppUrl(req);
        for (const lead of qualified.slice(0, 3)) {
          const sent = await sendLeadToTelegram(lead, baseUrl);
          if (sent.ok) {
            lead.sentToTelegramAt = new Date().toISOString();
          }
        }
      }

      const cleanedExisting = existing.filter(
        (lead) => Boolean(lead.isFavorite) || lead.audit?.verdict !== 'modern_ok'
      );
      const updatedLeads = mergeAndTrimLeads(qualified, cleanedExisting, 250);
      await writeLeads(updatedLeads);
      broadcastEvent('leads', { leads: updatedLeads, addedCount: qualified.length });

      if (
        (toScan.length > 0 || pre.skippedModernCount > 0) &&
        qualified.length === 0 &&
        qualityFilter !== 'all' &&
        !geminiQuotaHit &&
        !geminiTransientHit
      ) {
        warnings.push(
          `Проверено ${toScan.length + pre.skippedModernCount} компаний, но у всех найдены хорошие современные сайты — в ленту они не добавлялись. Попробуйте другой город или нишу.`
        );
      } else if (geminiUnavailable && qualified.length > 0) {
        warnings.push(
          `Найдено ${qualified.length} компаний из Google Карт (современные сайты отсеяны по техсигналам), но ИИ-аудит Gemini сейчас временно перегружен — откройте карточку чуть позже для генерации оффера.`
        );
      }

      res.json({
        scannedCount: toScan.length + pre.skippedModernCount,
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
      const removedFromFeed =
        audited.audit?.verdict === 'modern_ok' && !Boolean(audited.isFavorite);
      const nextLeads = removedFromFeed
        ? leads.filter((item) => item.id !== id)
        : leads.map((item, i) => (i === index ? audited : item));

      await writeLeads(nextLeads);
      broadcastEvent('leads', { leads: nextLeads });

      res.json({ lead: audited, removedFromFeed });
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
      const removedFromFeed =
        audited.audit?.verdict === 'modern_ok' && !Boolean(audited.isFavorite);
      const nextLeads = removedFromFeed
        ? leads.filter((item) => item.id !== id)
        : leads.map((item, i) => (i === index ? audited : item));

      await writeLeads(nextLeads);
      broadcastEvent('leads', { leads: nextLeads });

      res.json({ lead: audited, removedFromFeed });
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
      const body = (req.body || {}) as { isFavorite?: unknown; lead?: BusinessLead };
      const leads = await readLeads();
      const index = leads.findIndex((item) => item.id === id);

      if (index === -1) {
        if (body.lead && body.lead.id === id) {
          const favLead: BusinessLead = {
            ...body.lead,
            isFavorite: true,
            favoritedAt: new Date().toISOString(),
          };
          const next = [favLead, ...leads];
          await writeLeads(next);
          broadcastEvent('leads', { leads: next });
          res.json({ lead: favLead, leads: next });
          return;
        }
        res.status(404).json({ error: 'Бизнес не найден.' });
        return;
      }

      const nextFavorite =
        typeof body.isFavorite === 'boolean' ? body.isFavorite : !Boolean(leads[index].isFavorite);

      const updatedLead: BusinessLead = {
        ...leads[index],
        isFavorite: nextFavorite,
        favoritedAt: nextFavorite ? new Date().toISOString() : undefined,
      };
      const shouldDropGoodSite = !nextFavorite && updatedLead.audit?.verdict === 'modern_ok';
      const nextLeads = shouldDropGoodSite
        ? leads.filter((item) => item.id !== id)
        : leads.map((item, i) => (i === index ? updatedLead : item));

      await writeLeads(nextLeads);
      broadcastEvent('leads', { leads: nextLeads });

      res.json({ lead: updatedLead, leads: nextLeads });
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

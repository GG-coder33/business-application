import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe,
  Heart,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { AutopilotPanel } from './AutopilotPanel.tsx';
import { BusinessMap } from './BusinessMap.tsx';
import type {
  AutopilotConfig,
  AutopilotQualityFilter,
  BusinessLead,
  SearchSource,
  SystemCapabilities,
} from '../types.ts';

interface InboxPageProps {
  leads: BusinessLead[];
  autopilot: AutopilotConfig;
  capabilities: SystemCapabilities;
  mapsAvailable: boolean;
  isSearching: boolean;
  isRefreshingFeed: boolean;
  filterTab: FilterTab;
  onChangeFilterTab: (tab: FilterTab) => void;
  searchError: string | null;
  warnings: string[];
  onSearch: (
    query: string,
    source: SearchSource,
    qualityFilter: AutopilotQualityFilter,
    autoSendTelegram: boolean
  ) => Promise<void>;
  onUpdateAutopilot: (patch: Partial<AutopilotConfig>) => Promise<void>;
  onRunAutopilotNow: () => Promise<void>;
  onRefreshFeed: () => Promise<{
    ok: boolean;
    addedCount?: number;
    scannedCount?: number;
    city?: string;
    niche?: string;
    error?: string;
  }>;
  onOpenBusiness: (id: string) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  onDeleteLead: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onSendTelegram: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenSetup: () => void;
}

const PRESET_QUERIES: Array<{ label: string; query: string; source: SearchSource }> = [
  { label: 'Стоматологии · Москва', query: 'стоматология Москва', source: 'maps' },
  { label: 'Автосервисы · Алматы', query: 'автосервис детейлинг Алматы', source: 'maps' },
  { label: 'Юристы · Варшава', query: 'юридические услуги Варшава', source: 'maps' },
  { label: 'Ремонт квартир · Тбилиси', query: 'ремонт квартир дизайн интерьера Тбилиси', source: 'maps' },
];

type FilterTab = 'all' | 'favorites' | 'weak' | 'autopilot' | 'with_tg';
type ControlMode = 'autopilot' | 'manual';

const CIS_COUNTRIES = new Set(['RU', 'KZ', 'AM', 'TJ', 'UZ', 'BY', 'KG', 'AZ', 'MD']);
const EUROPE_COUNTRIES = new Set([
  'PT', 'ES', 'DE', 'PL', 'CZ', 'AT', 'NL', 'IT', 'HU', 'RS',
  'LV', 'EE', 'LT', 'BG', 'GR', 'FR', 'GB', 'CH', 'SK', 'RO', 'HR',
]);
const AMERICAS_COUNTRIES = new Set(['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'CL', 'PE']);

const CIS_MARKERS = [
  'россия', 'russia', 'москва', 'санкт-петербург', 'казань', 'екатеринбург', 'новосибирск', 'краснодар', 'сочи', 'самара', 'нижний новгород', 'ростов-на-дону',
  'казахстан', 'kazakhstan', 'алматы', 'астана', 'шымкент', 'караганда',
  'армения', 'armenia', 'ереван', 'гюмри',
  'таджикистан', 'tajikistan', 'душанбе', 'худжанд',
  'узбекистан', 'uzbekistan', 'ташкент', 'самарканд', 'бухара',
  'беларусь', 'belarus', 'минск', 'гомель', 'брест',
  'кыргызстан', 'kyrgyzstan', 'киргизия', 'бишкек', 'ош',
  'азербайджан', 'azerbaijan', 'баку', 'гянджа',
  'молдова', 'moldova', 'кишинёв', 'кишинев',
];

const EUROPE_MARKERS = [
  'португалия', 'portugal', 'лиссабон', 'lisboa', 'порту',
  'испания', 'spain', 'барселона', 'мадрид', 'валенсия',
  'германия', 'germany', 'берлин', 'мюнхен',
  'польша', 'poland', 'варшава', 'краков',
  'чехия', 'czech', 'прага', 'австрия', 'austria', 'вена',
  'нидерланды', 'netherlands', 'амстердам', 'италия', 'italy', 'милан',
  'венгрия', 'hungary', 'будапешт', 'сербия', 'serbia', 'белград',
  'латвия', 'рига', 'эстония', 'таллин', 'болгария', 'софия',
];

const AMERICAS_MARKERS = [
  'сша', 'usa', 'united states', 'нью-йорк', 'майами', 'остин', 'лос-анджелес', 'чикаго', 'денвер', 'сиэтл',
  'канада', 'canada', 'торонто', 'ванкувер', 'монреаль',
  'мексика', 'mexico', 'мехико', 'бразилия', 'brazil', 'сан-паулу',
  'аргентина', 'argentina', 'буэнос-айрес', 'колумбия', 'богота',
];

function leadMatchesRegionProfile(
  lead: BusinessLead,
  region: AutopilotConfig['region'],
  customCities: string
): boolean {
  if (region === 'world') return true;
  if (region === 'custom') {
    const customList = customCities
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (customList.length === 0) return true;
    const hay = `${lead.autoPickedCity || ''} ${lead.address || ''} ${lead.query || ''}`.toLowerCase();
    return customList.some((c) => hay.includes(c));
  }

  if (lead.countryCode) {
    if (region === 'cis') return CIS_COUNTRIES.has(lead.countryCode);
    if (region === 'europe') return EUROPE_COUNTRIES.has(lead.countryCode);
    if (region === 'americas') return AMERICAS_COUNTRIES.has(lead.countryCode);
  }

  const hay = `${lead.countryName || ''} ${lead.autoPickedCity || ''} ${lead.address || ''} ${lead.query || ''}`.toLowerCase();
  if (region === 'cis') {
    if (/турция|turkey|türkiye|стамбул|istanbul|анталья|antalya|грузия|georgia|тбилиси|батуми|португалия|portugal|лиссабон|lisboa/.test(hay)) {
      return false;
    }
    return CIS_MARKERS.some((m) => hay.includes(m));
  }
  if (region === 'europe') {
    return EUROPE_MARKERS.some((m) => hay.includes(m));
  }
  if (region === 'americas') {
    return AMERICAS_MARKERS.some((m) => hay.includes(m));
  }
  return true;
}

export function InboxPage({
  leads,
  autopilot,
  capabilities,
  mapsAvailable,
  isSearching,
  isRefreshingFeed,
  filterTab,
  onChangeFilterTab,
  searchError,
  warnings,
  onSearch,
  onUpdateAutopilot,
  onRunAutopilotNow,
  onRefreshFeed,
  onOpenBusiness,
  onToggleFavorite,
  onDeleteLead,
  onClearAll,
  onSendTelegram,
  onOpenSetup,
}: InboxPageProps) {
  const [controlMode, setControlMode] = useState<ControlMode>('autopilot');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('maps');
  const [manualFilter, setManualFilter] = useState<AutopilotQualityFilter>('weak_only');
  const [autoSendTelegram, setAutoSendTelegram] = useState(false);
  const [onlyActiveRegion, setOnlyActiveRegion] = useState(true);
  const [textFilter, setTextFilter] = useState('');
  const [showMap, setShowMap] = useState(true);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const regionScopedLeads = useMemo(() => {
    if (!onlyActiveRegion || autopilot.region === 'world') return leads;
    return leads.filter((lead) =>
      leadMatchesRegionProfile(lead, autopilot.region, autopilot.customCities)
    );
  }, [leads, onlyActiveRegion, autopilot.region, autopilot.customCities]);

  const filteredLeads = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    const baseLeads = filterTab === 'favorites' ? leads : regionScopedLeads;
    return baseLeads.filter((lead) => {
      if (filterTab === 'favorites' && !lead.isFavorite) {
        return false;
      }
      if (
        filterTab === 'weak' &&
        lead.audit?.verdict !== 'hot_outdated' &&
        lead.audit?.verdict !== 'no_website'
      ) {
        return false;
      }
      if (filterTab === 'autopilot' && lead.discoveredBy !== 'autopilot') return false;
      if (filterTab === 'with_tg' && !lead.telegramUrl && !lead.telegramHandle) return false;
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.category.toLowerCase().includes(q) ||
        (lead.autoPickedCity && lead.autoPickedCity.toLowerCase().includes(q)) ||
        (lead.address && lead.address.toLowerCase().includes(q)) ||
        (lead.websiteUrl && lead.websiteUrl.toLowerCase().includes(q)) ||
        (lead.telegramHandle && lead.telegramHandle.toLowerCase().includes(q))
      );
    });
  }, [leads, regionScopedLeads, filterTab, textFilter]);

  const mappableLeads = useMemo(
    () => filteredLeads.filter((l) => typeof l.lat === 'number' && typeof l.lng === 'number'),
    [filteredLeads]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    await onSearch(query.trim(), source, manualFilter, autoSendTelegram);
  };

  const handlePreset = async (presetQuery: string, presetSource: SearchSource) => {
    setQuery(presetQuery);
    setSource(presetSource);
    await onSearch(presetQuery, presetSource, manualFilter, autoSendTelegram);
  };

  const copyBusinessLink = async (id: string) => {
    const fullUrl = `${window.location.origin}/business/${id}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      setToastMsg('Не удалось скопировать ссылку');
    }
  };

  const handleSendTg = async (lead: BusinessLead) => {
    if (!capabilities.telegramBotConfigured) {
      onOpenSetup();
      return;
    }
    setSendingId(lead.id);
    const res = await onSendTelegram(lead.id);
    setSendingId(null);
    if (res.ok) {
      setToastMsg(`Ссылка на «${lead.name}» отправлена в ваш Telegram`);
      setTimeout(() => setToastMsg(null), 3000);
    } else if (res.error) {
      setToastMsg(res.error);
      setTimeout(() => setToastMsg(null), 4000);
    }
  };

  const handleRefreshClick = async () => {
    setToastMsg(null);
    const res = await onRefreshFeed();
    if (!res.ok) {
      setToastMsg(res.error || 'Не удалось обновить ленту.');
      setTimeout(() => setToastMsg(null), 5000);
      return;
    }
    const loc = res.city ? ` (${res.city}${res.niche ? ` · ${res.niche}` : ''})` : '';
    if ((res.addedCount ?? 0) > 0) {
      setToastMsg(`Лента обновлена: добавлено ${res.addedCount} новых бизнесов${loc}.`);
    } else if (res.error) {
      setToastMsg(res.error);
    } else if ((res.scannedCount ?? 0) > 0) {
      setToastMsg(
        `Проверено ${res.scannedCount} новых компаний${loc} — у всех уже современные сайты. Нажмите «Обновить ленту» ещё раз для поиска в следующем городе.`
      );
    } else {
      setToastMsg(`Новых компаний по текущему фильтру${loc} не нашлось — нажмите ещё раз для следующего города.`);
    }
    setTimeout(() => setToastMsg(null), 6000);
  };

  const weakCount = regionScopedLeads.filter(
    (l) => l.audit?.verdict === 'hot_outdated' || l.audit?.verdict === 'no_website'
  ).length;
  const favoritesCount = leads.filter((l) => Boolean(l.isFavorite)).length;

  return (
    <div className="space-y-6">
      {/* Control Card: AI Autopilot or Manual Search */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Лента лидов со слабыми сайтами и дизайном
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              ИИ ищет бизнесы в разных городах на Google Картах, сканирует их сайт и дизайн и
              присылает сюда клиентов, которым можно предложить новый сайт и доработки.
            </p>
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg shrink-0 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => setControlMode('autopilot')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                controlMode === 'autopilot'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Автопилот ИИ
            </button>
            <button
              type="button"
              onClick={() => setControlMode('manual')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                controlMode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ручной поиск
            </button>
          </div>
        </div>

        {controlMode === 'autopilot' ? (
          <AutopilotPanel
            config={autopilot}
            onUpdateConfig={onUpdateAutopilot}
            onRunNow={onRunAutopilotNow}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ниша и город (например: стоматология Алматы, автосервис Варшава)"
                  className="w-full h-11 pl-10 pr-4 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 transition-colors"
                  disabled={isSearching}
                />
              </div>

              <select
                value={manualFilter}
                onChange={(e) => setManualFilter(e.target.value as AutopilotQualityFilter)}
                className="h-11 px-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:bg-white focus:border-blue-600"
                aria-label="Фильтр качества сайтов"
              >
                <option value="weak_only">Только слабый / старый сайт</option>
                <option value="weak_or_none">Слабый сайт или без сайта</option>
                <option value="all">Показывать все сайты</option>
              </select>

              <div
                className="inline-flex items-center p-1 bg-slate-100 rounded-lg shrink-0"
                role="group"
                aria-label="Источник поиска"
              >
                {(
                  [
                    { id: 'maps', label: 'Google Карты' },
                    { id: 'both', label: 'Везде' },
                    { id: 'telegram', label: 'Telegram' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSource(opt.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      source === opt.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="h-11 px-5 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Сканируем сайты...</span>
                  </>
                ) : (
                  <span>Найти и проверить</span>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Быстрый запуск:</span>
                {PRESET_QUERIES.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={isSearching}
                    onClick={() => handlePreset(preset.query, preset.source)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoSendTelegram}
                  onChange={(e) => setAutoSendTelegram(e.target.checked)}
                  disabled={!capabilities.telegramBotConfigured}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600 disabled:opacity-50"
                />
                <span>
                  Дублировать в мой Telegram
                  {!capabilities.telegramBotConfigured && (
                    <button
                      type="button"
                      onClick={onOpenSetup}
                      className="ml-1.5 text-blue-700 hover:underline font-medium cursor-pointer"
                    >
                      (как подключить)
                    </button>
                  )}
                </span>
              </label>
            </div>
          </form>
        )}

        {searchError && (
          <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {searchError}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
            {warnings.map((w, idx) => (
              <p key={idx}>{w}</p>
            ))}
          </div>
        )}

        {toastMsg && (
          <div className="px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
            {toastMsg}
          </div>
        )}
      </section>

      {/* Toolbar & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center p-1 bg-slate-200/70 rounded-lg">
            {(
              [
                { id: 'all', label: `Все (${regionScopedLeads.length})` },
                { id: 'favorites', label: `Избранное (${favoritesCount})` },
                { id: 'weak', label: `Слабый сайт/дизайн (${weakCount})` },
                {
                  id: 'autopilot',
                  label: `От ИИ (${regionScopedLeads.filter((l) => l.discoveredBy === 'autopilot').length})`,
                },
                { id: 'with_tg', label: 'Есть Telegram' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeFilterTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            placeholder="Фильтр по названию, городу или сайту..."
            className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 w-60"
          />

          {autopilot.region !== 'world' && filterTab !== 'favorites' && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none px-2">
              <input
                type="checkbox"
                checked={onlyActiveRegion}
                onChange={(e) => setOnlyActiveRegion(e.target.checked)}
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="whitespace-nowrap">Только выбранный профиль</span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isRefreshingFeed || autopilot.isRunning || isSearching}
            onClick={() => void handleRefreshClick()}
            className="h-9 px-3.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshingFeed || autopilot.isRunning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>
              {isRefreshingFeed || autopilot.isRunning ? 'Ищем новые бизнесы...' : 'Обновить ленту'}
            </span>
          </button>

          {mapsAvailable && mappableLeads.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="h-9 px-3 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>{showMap ? 'Скрыть карту' : 'Показать карту'}</span>
            </button>
          )}
          {leads.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              title="Очистить ленту (избранные сайты сохранятся)"
              className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Очистить ленту
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Grid */}
      {(isSearching || autopilot.isRunning) && leads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="p-4 flex items-center justify-between gap-4 animate-pulse">
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
              <div className="h-8 bg-slate-100 rounded w-28" />
            </div>
          ))}
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <div>
            <p className="font-display text-base font-semibold text-slate-900">
              {leads.length === 0
                ? 'Лента входящих ссылок пока пуста'
                : filterTab === 'favorites'
                  ? 'В избранном пока нет сохранённых сайтов'
                  : autopilot.region !== 'world' && onlyActiveRegion && regionScopedLeads.length === 0
                    ? 'По выбранному профилю региона пока нет бизнесов'
                    : 'По выбранному фильтру ничего не найдено'}
            </p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              {leads.length === 0
                ? 'Нажмите «Включить автопилот ИИ» или «Найти и просканировать сейчас» — ИИ выберет город на Картах, проверит сайты и дизайн компаний и пришлёт сюда только подходящих клиентов.'
                : filterTab === 'favorites'
                  ? 'Нажмите на иконку сердечка рядом с любым бизнесом — сайт сохранится здесь и не пропадёт даже после обновления ленты.'
                  : autopilot.region !== 'world' && onlyActiveRegion && regionScopedLeads.length === 0
                    ? 'Нажмите «Обновить ленту», чтобы найти компании строго в выбранных странах (другие регионы скрыты фильтром профиля).'
                    : 'Попробуйте сбросить фильтр или выбрать другую вкладку.'}
            </p>
          </div>
          {(leads.length === 0 ||
            (filterTab !== 'favorites' &&
              autopilot.region !== 'world' &&
              onlyActiveRegion &&
              regionScopedLeads.length === 0)) && (
            <button
              type="button"
              disabled={isRefreshingFeed || autopilot.isRunning}
              onClick={() => void handleRefreshClick()}
              className="h-10 px-5 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <span>
                {autopilot.region === 'cis'
                  ? 'Найти бизнесы в СНГ сейчас'
                  : 'Найти бизнесы по профилю сейчас'}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 gap-6 ${
            mapsAvailable && showMap && mappableLeads.length > 0 ? 'lg:grid-cols-12' : ''
          }`}
        >
          {/* Incoming Business Links Stream */}
          <div
            className={
              mapsAvailable && showMap && mappableLeads.length > 0
                ? 'lg:col-span-7'
                : 'col-span-1'
            }
          >
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Входящие ссылки для предложения нового сайта</span>
                <span className="tabular-nums">{filteredLeads.length} шт.</span>
              </div>

              <div className="divide-y divide-slate-100">
                {filteredLeads.map((lead) => {
                  const internalPath = `/business/${lead.id}`;
                  const isCopied = copiedId === lead.id;
                  const audit = lead.audit;
                  const verdictColor =
                    audit?.verdict === 'hot_outdated' || audit?.verdict === 'no_website'
                      ? 'text-amber-700 font-semibold'
                      : audit?.verdict === 'modern_ok'
                        ? 'text-emerald-700 font-medium'
                        : 'text-slate-500';

                  return (
                    <div
                      key={lead.id}
                      onMouseEnter={() => {
                        if (typeof lead.lat === 'number') setSelectedMapId(lead.id);
                      }}
                      className={`px-4 py-4 transition-colors hover:bg-slate-50/80 ${
                        selectedMapId === lead.id ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-baseline gap-2.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => onOpenBusiness(lead.id)}
                              className="text-left font-display text-base font-semibold text-slate-900 hover:text-blue-700 transition-colors cursor-pointer"
                            >
                              {lead.name}
                            </button>
                            <a
                              href={internalPath}
                              onClick={(e) => {
                                e.preventDefault();
                                onOpenBusiness(lead.id);
                              }}
                              className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:underline truncate max-w-xs"
                              title="Перейти на карточку разбора и оффера"
                            >
                              <span>{internalPath}</span>
                              <ArrowUpRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                            </a>
                          </div>

                          {/* Unboxed Audit & Source Metadata */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                            {audit && (
                              <>
                                <span className={verdictColor}>{audit.verdictLabel}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-slate-700">
                                  Сайт {audit.websiteScore}/10 · Дизайн {audit.designScore}/10
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            {lead.discoveredBy === 'autopilot' && (
                              <>
                                <span className="text-blue-700 font-medium">Прислал ИИ</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            {lead.autoPickedCity && (
                              <>
                                <span className="text-slate-700 font-medium">
                                  {lead.autoPickedCity}
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>{lead.category}</span>
                            {lead.websiteUrl && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-slate-600 truncate max-w-[180px]">
                                  <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">
                                    {lead.websiteUrl.replace(/^https?:\/\/(www\.)?/, '')}
                                  </span>
                                </span>
                              </>
                            )}
                            {lead.telegramHandle && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-sky-700 font-medium">
                                  {lead.telegramHandle}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Teaser of what to upgrade so client agrees */}
                          {audit && (audit.pitchSuggestions[0] || audit.issues[0]) && (
                            <p className="text-xs text-slate-600 line-clamp-1">
                              {audit.pitchSuggestions[0]
                                ? `Что предложить: ${audit.pitchSuggestions[0]}`
                                : `Проблема: ${audit.issues[0]}`}
                            </p>
                          )}
                        </div>

                        {/* Row Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void onToggleFavorite(lead.id)}
                            title={lead.isFavorite ? 'Убрать из избранного' : 'Сохранить в избранное'}
                            aria-label={
                              lead.isFavorite
                                ? `Убрать ${lead.name} из избранного`
                                : `Добавить ${lead.name} в избранное`
                            }
                            aria-pressed={Boolean(lead.isFavorite)}
                            className={`h-8 w-8 rounded-md border inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                              lead.isFavorite
                                ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                                : 'bg-white border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50/60'
                            }`}
                          >
                            <Heart
                              className={`w-3.5 h-3.5 ${lead.isFavorite ? 'fill-rose-500 text-rose-500' : ''}`}
                              aria-hidden="true"
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() => copyBusinessLink(lead.id)}
                            title="Скопировать ссылку на разбор"
                            className="h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                                <span>Скопировано</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Ссылка</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSendTg(lead)}
                            disabled={sendingId === lead.id}
                            title="Отправить ссылку в мой Telegram"
                            className="h-8 px-2.5 text-xs font-medium text-sky-700 hover:text-sky-800 bg-white border border-slate-200 hover:bg-sky-50 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            {sendingId === lead.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Send className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{lead.sentToTelegramAt ? 'Отправлено' : 'В TG'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenBusiness(lead.id)}
                            className="h-8 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Разбор
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteLead(lead.id)}
                            title="Удалить из ленты"
                            aria-label={`Удалить ${lead.name}`}
                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Interactive Google Map Pane */}
          {mapsAvailable && showMap && mappableLeads.length > 0 && (
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-6 space-y-2">
                <BusinessMap
                  leads={mappableLeads}
                  selectedId={selectedMapId}
                  onSelectLead={setSelectedMapId}
                  onOpenLead={onOpenBusiness}
                  heightClass="h-[460px]"
                />
                <p className="text-xs text-slate-500">
                  Нажмите на маркер на карте, чтобы просмотреть бизнес или открыть разбор его сайта.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

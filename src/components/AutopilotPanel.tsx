import { useEffect, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw } from 'lucide-react';
import type {
  AutopilotConfig,
  AutopilotQualityFilter,
  AutopilotRegion,
} from '../types.ts';

interface AutopilotPanelProps {
  config: AutopilotConfig;
  onUpdateConfig: (patch: Partial<AutopilotConfig>) => Promise<void>;
  onRunNow: () => Promise<void>;
}

function formatCountdown(nextRunAt?: string): string | null {
  if (!nextRunAt) return null;
  const diffSec = Math.max(0, Math.floor((Date.parse(nextRunAt) - Date.now()) / 1000));
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function AutopilotPanel({
  config,
  onUpdateConfig,
  onRunNow,
}: AutopilotPanelProps) {
  const [niches, setNiches] = useState(config.niches);
  const [region, setRegion] = useState<AutopilotRegion>(config.region);
  const [customCities, setCustomCities] = useState(config.customCities);
  const [intervalMinutes, setIntervalMinutes] = useState(config.intervalMinutes);
  const [qualityFilter, setQualityFilter] = useState<AutopilotQualityFilter>(
    config.qualityFilter === 'all' ? 'weak_only' : config.qualityFilter
  );
  const [saving, setSaving] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(() =>
    formatCountdown(config.nextRunAt)
  );

  useEffect(() => {
    setNiches(config.niches);
    setRegion(config.region);
    setCustomCities(config.customCities);
    setIntervalMinutes(config.intervalMinutes);
    setQualityFilter(config.qualityFilter === 'all' ? 'weak_only' : config.qualityFilter);
  }, [
    config.niches,
    config.region,
    config.customCities,
    config.intervalMinutes,
    config.qualityFilter,
  ]);

  useEffect(() => {
    if (!config.enabled || !config.nextRunAt) {
      setCountdown(null);
      return;
    }
    setCountdown(formatCountdown(config.nextRunAt));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(config.nextRunAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [config.enabled, config.nextRunAt]);

  const commitSettings = async (overrideEnabled?: boolean) => {
    setSaving(true);
    try {
      await onUpdateConfig({
        enabled: overrideEnabled ?? config.enabled,
        region,
        customCities,
        niches,
        intervalMinutes,
        qualityFilter,
        autoEnrich: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setSaving(true);
    try {
      await onUpdateConfig({
        region,
        customCities,
        niches,
        intervalMinutes,
        qualityFilter,
        autoEnrich: true,
      });
      await onRunNow();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Какие бизнесы искать (через запятую)
          </label>
          <input
            type="text"
            value={niches}
            onChange={(e) => setNiches(e.target.value)}
            onBlur={() => {
              if (niches !== config.niches) void commitSettings();
            }}
            placeholder="стоматологии, автосервисы, ремонт, юристы"
            className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
          />
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Города для поиска
          </label>
          <select
            value={region}
            onChange={(e) => {
              const nextRegion = e.target.value as AutopilotRegion;
              setRegion(nextRegion);
              void onUpdateConfig({ region: nextRegion });
            }}
            className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
          >
            <option value="world">Любые города мира</option>
            <option value="cis">Города СНГ</option>
            <option value="europe">Города Европы</option>
            <option value="americas">США, Канада и Америка</option>
            <option value="custom">Свой список городов</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Отбор по сайту и дизайну
          </label>
          <select
            value={qualityFilter}
            onChange={(e) => {
              const nextFilter = e.target.value as AutopilotQualityFilter;
              setQualityFilter(nextFilter);
              void onUpdateConfig({ qualityFilter: nextFilter });
            }}
            className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
          >
            <option value="weak_only">Только слабый / старый сайт</option>
            <option value="weak_or_none">Слабый сайт или без сайта</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Интервал
          </label>
          <select
            value={intervalMinutes}
            onChange={(e) => {
              const nextVal = Number(e.target.value);
              setIntervalMinutes(nextVal);
              void onUpdateConfig({ intervalMinutes: nextVal });
            }}
            className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-600"
          >
            <option value={1}>1 мин</option>
            <option value={5}>5 мин</option>
            <option value={15}>15 мин</option>
            <option value={60}>1 час</option>
          </select>
        </div>
      </div>

      {region === 'custom' && (
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Список городов (через запятую)
          </label>
          <input
            type="text"
            value={customCities}
            onChange={(e) => setCustomCities(e.target.value)}
            onBlur={() => {
              if (customCities !== config.customCities) void commitSettings();
            }}
            placeholder="Например: Москва, Алматы, Тбилиси, Дубай, Варшава, Лиссабон"
            className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
          />
        </div>
      )}

      {region !== 'world' && (
        <p className="text-xs text-blue-800 bg-blue-50/70 border border-blue-200/80 rounded-lg px-3 py-2">
          {region === 'cis'
            ? 'Профиль Google Карт: строго страны СНГ — Казахстан, Россия, Армения, Таджикистан, Узбекистан, Беларусь, Кыргызстан, Азербайджан, Молдова.'
            : region === 'europe'
              ? 'Профиль Google Карт: строго города стран Европы.'
              : region === 'americas'
                ? 'Профиль Google Карт: строго США, Канада и страны Америки.'
                : 'Профиль Google Карт: только указанные вами города.'}
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <p className="text-xs text-slate-500">
          ИИ-агент сканирует сайт и дизайн каждой компании, отсеивает современные сайты и присылает
          сюда только тех, кому можно продать новый сайт с готовыми идеями доработок.
        </p>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={saving || config.isRunning}
            onClick={handleRunNow}
            className="h-10 px-4 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {config.isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" aria-hidden="true" />
                <span>ИИ сканирует сайты...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span>Найти и просканировать сейчас</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void commitSettings(!config.enabled)}
            className={`h-10 px-4 text-xs font-medium rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
              config.enabled
                ? 'bg-slate-900 hover:bg-slate-800 text-white'
                : 'bg-blue-700 hover:bg-blue-800 text-white'
            }`}
          >
            {config.enabled ? (
              <>
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Остановить автопилот</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Включить автопилот ИИ</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Status Strip */}
      <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 tabular-nums">
        <span className={config.enabled ? 'text-emerald-700 font-medium' : 'text-slate-600 font-medium'}>
          Автопилот: {config.enabled ? 'включён' : 'остановлен'}
        </span>
        {config.enabled && countdown && !config.isRunning && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-700">Следующий цикл через {countdown}</span>
          </>
        )}
        {config.isRunning && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-blue-700 font-medium">
              Идёт поиск на Картах и аудит сайтов/дизайна...
            </span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>Пройдено городов: {config.visitedCities.length}</span>
        {config.lastCity && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Последний: {config.lastCity} ({config.lastNiche || 'бизнесы'})
              {typeof config.lastScannedCount === 'number'
                ? ` · проверено ${config.lastScannedCount}, подошло ${config.lastAddedCount ?? 0}`
                : ''}
            </span>
          </>
        )}
      </div>

      {config.lastError && (
        <div className="px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          {config.lastError}
        </div>
      )}
    </div>
  );
}

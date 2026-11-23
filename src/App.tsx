import { useCallback, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { BusinessDetailPage } from './components/BusinessDetailPage.tsx';
import { InboxPage } from './components/InboxPage.tsx';
import { SetupGuideModal } from './components/SetupGuideModal.tsx';
import type {
  AutopilotConfig,
  AutopilotQualityFilter,
  BusinessLead,
  SearchSource,
  SystemCapabilities,
} from './types.ts';

function getBusinessIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/business\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

const INITIAL_AUTOPILOT: AutopilotConfig = {
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

export default function App() {
  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [leads, setLeads] = useState<BusinessLead[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotConfig>(INITIAL_AUTOPILOT);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);
  const [filterTab, setFilterTab] = useState<
    'all' | 'favorites' | 'weak' | 'autopilot' | 'with_tg'
  >('all');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(() =>
    getBusinessIdFromPath(window.location.pathname)
  );
  const [directLead, setDirectLead] = useState<BusinessLead | null>(null);
  const [directLeadError, setDirectLeadError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<SystemCapabilities>({
    mapsApiConfigured: Boolean(mapsApiKey),
    geminiConfigured: true,
    telegramBotConfigured: false,
    appUrl: window.location.origin,
  });

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveBusinessId(getBusinessIdFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadInitialData = useCallback(async () => {
    setIsLoadingLeads(true);
    try {
      const [bizRes, capRes, autoRes] = await Promise.all([
        fetch('/api/businesses'),
        fetch('/api/capabilities'),
        fetch('/api/autopilot'),
      ]);
      if (bizRes.ok) {
        const data = (await bizRes.json()) as { leads?: BusinessLead[] };
        setLeads(Array.isArray(data.leads) ? data.leads : []);
      }
      if (capRes.ok) {
        const caps = (await capRes.json()) as SystemCapabilities;
        setCapabilities(caps);
      }
      if (autoRes.ok) {
        const autoData = (await autoRes.json()) as { config?: AutopilotConfig };
        if (autoData.config) setAutopilot(autoData.config);
      }
    } catch {
      // keep empty state on network failure
    } finally {
      setIsLoadingLeads(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    const events = new EventSource('/api/events');

    events.addEventListener('autopilot', (evt) => {
      try {
        const nextConfig = JSON.parse((evt as MessageEvent).data) as AutopilotConfig;
        setAutopilot(nextConfig);
      } catch {
        // ignore parse errors
      }
    });

    events.addEventListener('leads', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as {
          leads?: BusinessLead[];
        };
        if (Array.isArray(payload.leads)) {
          setLeads(payload.leads);
        }
      } catch {
        // ignore parse errors
      }
    });

    events.addEventListener('quota_exceeded', () => {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    });

    return () => {
      events.close();
    };
  }, []);

  useEffect(() => {
    if (!activeBusinessId) {
      setDirectLead(null);
      setDirectLeadError(null);
      return;
    }

    const fromList = leads.find((l) => l.id === activeBusinessId);
    if (fromList) {
      setDirectLead(fromList);
      setDirectLeadError(null);
      return;
    }

    if (!isLoadingLeads) {
      let cancelled = false;
      fetch(`/api/businesses/${encodeURIComponent(activeBusinessId)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error('Карточка бизнеса не найдена или была удалена.');
          return (await res.json()) as { lead: BusinessLead };
        })
        .then((data) => {
          if (!cancelled) {
            setDirectLead(data.lead);
            setDirectLeadError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setDirectLeadError(err instanceof Error ? err.message : 'Бизнес не найден.');
          }
        });
      return () => {
        cancelled = true;
      };
    }
  }, [activeBusinessId, leads, isLoadingLeads]);

  const navigateTo = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setActiveBusinessId(getBusinessIdFromPath(path));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateAutopilot = async (patch: Partial<AutopilotConfig>) => {
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = (await res.json()) as { config?: AutopilotConfig };
        if (data.config) setAutopilot(data.config);
      }
    } catch {
      // ignore network failure
    }
  };

  const handleRunAutopilotNow = async () => {
    try {
      const res = await fetch('/api/autopilot/run-now', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as {
          config?: AutopilotConfig;
          leads?: BusinessLead[];
          quotaExceeded?: boolean;
        };
        if (data.quotaExceeded) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (data.config) setAutopilot(data.config);
        if (Array.isArray(data.leads)) setLeads(data.leads);
      }
    } catch {
      // ignore
    }
  };

  const handleRefreshFeed = async (): Promise<{
    ok: boolean;
    addedCount?: number;
    scannedCount?: number;
    city?: string;
    niche?: string;
    error?: string;
  }> => {
    setIsRefreshingFeed(true);
    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST' });
      const data = (await res.json()) as {
        config?: AutopilotConfig;
        leads?: BusinessLead[];
        addedCount?: number;
        scannedCount?: number;
        city?: string;
        niche?: string;
        quotaExceeded?: boolean;
        error?: string;
      };
      if (data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      if (data.config) setAutopilot(data.config);
      if (Array.isArray(data.leads)) setLeads(data.leads);
      if (!res.ok) {
        return { ok: false, error: data.error || 'Не удалось обновить ленту.' };
      }
      return {
        ok: true,
        addedCount: data.addedCount ?? 0,
        scannedCount: data.scannedCount ?? 0,
        city: data.city,
        niche: data.niche,
        error: data.error,
      };
    } catch {
      return { ok: false, error: 'Ошибка сети при обновлении ленты.' };
    } finally {
      setIsRefreshingFeed(false);
    }
  };

  const handleSearch = async (
    query: string,
    source: SearchSource,
    qualityFilter: AutopilotQualityFilter,
    autoSendTelegram: boolean
  ) => {
    setIsSearching(true);
    setSearchError(null);
    setWarnings([]);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          source,
          qualityFilter,
          autoSendTelegram,
          region: autopilot.region,
        }),
      });

      const data = (await res.json()) as {
        leads?: BusinessLead[];
        quotaExceeded?: boolean;
        warnings?: string[];
        error?: string;
      };

      if (data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }

      if (!res.ok) {
        setSearchError(data.error || 'Не удалось выполнить поиск.');
        return;
      }

      if (Array.isArray(data.leads)) {
        setLeads(data.leads);
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      }
    } catch {
      setSearchError('Ошибка сети при обращении к серверу поиска.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAudit = async (
    id: string
  ): Promise<{ ok: boolean; error?: string; removedFromFeed?: boolean }> => {
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(id)}/audit`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        lead?: BusinessLead;
        removedFromFeed?: boolean;
        error?: string;
      };
      if (!res.ok || !data.lead) {
        return { ok: false, error: data.error || 'Ошибка аудита.' };
      }
      if (data.removedFromFeed) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
      } else {
        setLeads((prev) => prev.map((l) => (l.id === id ? data.lead! : l)));
      }
      setDirectLead(data.lead);
      return { ok: true, removedFromFeed: Boolean(data.removedFromFeed) };
    } catch {
      return { ok: false, error: 'Ошибка сети при сканировании сайта.' };
    }
  };

  const handleSendTelegram = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(id)}/send-telegram`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok?: boolean; lead?: BusinessLead; error?: string };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Ошибка отправки в Telegram.' };
      }
      if (data.lead) {
        setLeads((prev) => prev.map((l) => (l.id === id ? data.lead! : l)));
        setDirectLead(data.lead);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Ошибка сети при отправке в Telegram.' };
    }
  };

  const handleToggleFavorite = async (id: string) => {
    const target = leads.find((l) => l.id === id) || (directLead?.id === id ? directLead : null);
    const nextFavorite = !Boolean(target?.isFavorite);

    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, isFavorite: nextFavorite } : l))
    );
    if (directLead?.id === id) {
      setDirectLead((prev) => (prev ? { ...prev, isFavorite: nextFavorite } : prev));
    }

    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(id)}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isFavorite: nextFavorite,
          ...(nextFavorite && target ? { lead: target } : {}),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { lead?: BusinessLead; leads?: BusinessLead[] };
        if (Array.isArray(data.leads)) {
          setLeads(data.leads);
        }
        if (data.lead && directLead?.id === id) {
          setDirectLead(data.lead);
        }
      }
    } catch {
      // revert on network failure
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, isFavorite: !nextFavorite } : l))
      );
      if (directLead?.id === id) {
        setDirectLead((prev) => (prev ? { ...prev, isFavorite: !nextFavorite } : prev));
      }
    }
  };

  const handleDeleteLead = async (id: string) => {
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as { leads?: BusinessLead[] };
        if (Array.isArray(data.leads)) setLeads(data.leads);
      }
    } catch {
      // ignore
    }
  };

  const handleClearAll = async () => {
    try {
      const res = await fetch('/api/businesses', { method: 'DELETE' });
      if (res.ok) {
        const data = (await res.json()) as { leads?: BusinessLead[] };
        setLeads(Array.isArray(data.leads) ? data.leads : []);
      }
    } catch {
      // ignore
    }
  };

  const favoritesCount = leads.filter((l) => Boolean(l.isFavorite)).length;

  const activeLead = activeBusinessId
    ? leads.find((l) => l.id === activeBusinessId) || directLead
    : null;

  const pageContent = (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Bar Contract */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            LeadRadar
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                setFilterTab('all');
                navigateTo('/');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                !activeBusinessId && filterTab !== 'favorites'
                  ? 'text-slate-900 underline underline-offset-4'
                  : ''
              }`}
            >
              Лента ссылок
            </a>
            <button
              type="button"
              onClick={() => {
                setFilterTab('favorites');
                navigateTo('/');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                !activeBusinessId && filterTab === 'favorites'
                  ? 'text-slate-900 underline underline-offset-4'
                  : ''
              }`}
            >
              Избранное ({favoritesCount})
            </button>
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Telegram-бот
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (activeBusinessId) {
                  navigateTo('/');
                } else {
                  setSetupOpen(true);
                }
              }}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {activeBusinessId ? 'К ленте ссылок' : 'Подключение'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeBusinessId ? (
          activeLead ? (
            <BusinessDetailPage
              lead={activeLead}
              capabilities={capabilities}
              mapsAvailable={Boolean(mapsApiKey) && !quotaExceeded}
              onBack={() => navigateTo('/')}
              onAudit={handleAudit}
              onToggleFavorite={handleToggleFavorite}
              onSendTelegram={handleSendTelegram}
              onOpenSetup={() => setSetupOpen(true)}
            />
          ) : directLeadError ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <p className="font-display text-base font-semibold text-slate-900">
                {directLeadError}
              </p>
              <button
                type="button"
                onClick={() => navigateTo('/')}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                Вернуться в ленту ссылок
              </button>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              Загружаем карточку бизнеса...
            </div>
          )
        ) : (
          <InboxPage
            leads={leads}
            autopilot={autopilot}
            capabilities={capabilities}
            mapsAvailable={Boolean(mapsApiKey) && !quotaExceeded}
            isSearching={isSearching}
            isRefreshingFeed={isRefreshingFeed}
            filterTab={filterTab}
            onChangeFilterTab={setFilterTab}
            searchError={searchError}
            warnings={warnings}
            onSearch={handleSearch}
            onUpdateAutopilot={handleUpdateAutopilot}
            onRunAutopilotNow={handleRunAutopilotNow}
            onRefreshFeed={handleRefreshFeed}
            onOpenBusiness={(id) => navigateTo(`/business/${id}`)}
            onToggleFavorite={handleToggleFavorite}
            onDeleteLead={handleDeleteLead}
            onClearAll={handleClearAll}
            onSendTelegram={handleSendTelegram}
            onOpenSetup={() => setSetupOpen(true)}
          />
        )}
      </main>

      <SetupGuideModal
        open={setupOpen}
        capabilities={capabilities}
        onClose={() => setSetupOpen(false)}
      />
    </div>
  );

  if (!mapsApiKey) {
    return pageContent;
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['marker']}
      language="ru"
    >
      {pageContent}
    </APIProvider>
  );
}

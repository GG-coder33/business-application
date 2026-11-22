import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Heart,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Send,
} from 'lucide-react';
import { BusinessMap } from './BusinessMap.tsx';
import type { BusinessLead, SystemCapabilities } from '../types.ts';

interface BusinessDetailPageProps {
  lead: BusinessLead;
  capabilities: SystemCapabilities;
  mapsAvailable: boolean;
  onBack: () => void;
  onAudit: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onToggleFavorite: (id: string) => Promise<void>;
  onSendTelegram: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenSetup: () => void;
}

function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function BusinessDetailPage({
  lead,
  capabilities,
  mapsAvailable,
  onBack,
  onAudit,
  onToggleFavorite,
  onSendTelegram,
  onOpenSetup,
}: BusinessDetailPageProps) {
  const [isAuditing, setIsAuditing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const safeTgUrl = safeHref(lead.telegramUrl);
  const safeWebUrl = safeHref(lead.websiteUrl);
  const safeMapsUrl = safeHref(lead.googleMapsUrl);
  const pageUrl = `${window.location.origin}/business/${lead.id}`;
  const audit = lead.audit;

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      setStatusMessage({ type: 'err', text: 'Не удалось скопировать в буфер обмена.' });
    }
  };

  const handleRunAudit = async () => {
    setIsAuditing(true);
    setStatusMessage(null);
    const res = await onAudit(lead.id);
    setIsAuditing(false);
    if (res.ok) {
      setStatusMessage({
        type: 'ok',
        text: 'Аудит сайта, дизайна, идей для продажи и контактов обновлён.',
      });
    } else {
      setStatusMessage({
        type: 'err',
        text: res.error || 'Не удалось просканировать сайт.',
      });
    }
  };

  const handleSendTg = async () => {
    if (!capabilities.telegramBotConfigured) {
      onOpenSetup();
      return;
    }
    setIsSending(true);
    setStatusMessage(null);
    const res = await onSendTelegram(lead.id);
    setIsSending(false);
    if (res.ok) {
      setStatusMessage({
        type: 'ok',
        text: 'Разбор бизнеса и ссылки отправлены в ваш Telegram.',
      });
    } else {
      setStatusMessage({
        type: 'err',
        text: res.error || 'Не удалось отправить сообщение в Telegram.',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Back */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Назад к ленте</span>
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <span className="truncate">
              {lead.autoPickedCity || (lead.origin === 'maps' ? 'Google Карты' : 'Telegram-чат')}
            </span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-900 font-medium truncate">{lead.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void onToggleFavorite(lead.id)}
            aria-pressed={Boolean(lead.isFavorite)}
            className={`h-9 px-3 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lead.isFavorite
                ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${lead.isFavorite ? 'fill-rose-500 text-rose-500' : 'text-slate-500'}`}
              aria-hidden="true"
            />
            <span>{lead.isFavorite ? 'В избранном' : 'В избранное'}</span>
          </button>

          <button
            type="button"
            onClick={() => copyText('page', pageUrl)}
            className="h-9 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedKey === 'page' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>Ссылка скопирована</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Копировать ссылку на разбор</span>
              </>
            )}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs ${
            statusMessage.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Audit, Upsell Ideas, Pitch & Business Overview */}
        <div className="lg:col-span-7 space-y-6">
          {/* Business Header & Overview */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                {lead.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 tabular-nums">
                <span className="font-medium text-slate-700">{lead.category}</span>
                {lead.autoPickedCity && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Город: {lead.autoPickedCity}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>Источник: {lead.origin === 'maps' ? 'Google Карты' : 'Telegram / Веб'}</span>
                {typeof lead.rating === 'number' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-800 font-medium">
                      Рейтинг {lead.rating.toFixed(1)}
                      {lead.userRatingCount ? ` (${lead.userRatingCount} отзывов)` : ''}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              <h2 className="font-display text-sm font-semibold text-slate-900 mb-2">
                Что это за бизнес
              </h2>
              <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                {lead.description}
              </p>
            </div>

            {(lead.address || lead.phone || lead.telegramSourceChat) && (
              <div className="border-t border-slate-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {lead.address && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Адрес / локация</p>
                    <p className="text-slate-800 flex items-start gap-1.5">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{lead.address}</span>
                    </p>
                  </div>
                )}
                {lead.phone && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Телефон</p>
                    <p className="text-slate-800 font-mono tabular-nums flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                      <span>{lead.phone}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Website & Design Audit + Sales Recommendations */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Аудит сайта и дизайна
                </h2>
                {audit ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums">
                    <span
                      className={
                        audit.verdict === 'hot_outdated' || audit.verdict === 'no_website'
                          ? 'text-amber-700 font-semibold'
                          : 'text-emerald-700 font-semibold'
                      }
                    >
                      {audit.verdictLabel}
                    </span>
                    <span className="text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-800">
                      Сайт: {audit.websiteScore}/10
                    </span>
                    <span className="text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-800">
                      Дизайн: {audit.designScore}/10
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">
                    Аудит сайта ещё не проводился — запустите сканирование ниже.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleRunAudit}
                disabled={isAuditing}
                className="h-9 px-3.5 text-xs font-medium text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {isAuditing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Сканируем сайт и дизайн...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{audit ? 'Перепроверить сайт и дизайн' : 'Просканировать сайт и дизайн'}</span>
                  </>
                )}
              </button>
            </div>

            {audit && (
              <>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-semibold text-slate-900 mb-2">
                    Что слабо на текущем сайте и в дизайне
                  </h3>
                  <ul className="space-y-1.5 text-sm text-slate-700 list-disc list-inside">
                    {audit.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-semibold text-slate-900 mb-2">
                    Что добавить на новый сайт, чтобы клиент согласился на разработку
                  </h3>
                  <ol className="space-y-1.5 text-sm text-slate-800 list-decimal list-inside">
                    {audit.pitchSuggestions.map((idea, idx) => (
                      <li key={idx}>{idea}</li>
                    ))}
                  </ol>
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Готовый текст предложения клиенту
                    </h3>
                    <button
                      type="button"
                      onClick={() => copyText('pitch', audit.salesPitch)}
                      className="h-7 px-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedKey === 'pitch' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                          <span>Скопировано</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" aria-hidden="true" />
                          <span>Копировать оффер</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                    {audit.salesPitch}
                  </p>
                </div>
              </>
            )}
          </section>

          {/* Verified Sources */}
          {lead.sourceLinks.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="font-display text-sm font-semibold text-slate-900 mb-3">
                Проверенные ссылки и источники
              </h2>
              <ul className="divide-y divide-slate-100">
                {lead.sourceLinks.map((src, idx) => {
                  const href = safeHref(src.url);
                  if (!href) return null;
                  return (
                    <li key={idx} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{src.title}</p>
                        <p className="text-xs font-mono text-slate-500 truncate">{href}</p>
                      </div>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded-md inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                      >
                        <span>Перейти</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Right column: Telegram, Current Website & Map */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Контакты и текущий сайт клиента
            </h2>

            {safeTgUrl ? (
              <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-sky-900">Telegram бизнеса</span>
                  {lead.telegramHandle && (
                    <button
                      type="button"
                      onClick={() => copyText('tg', lead.telegramHandle!)}
                      className="text-xs font-mono font-medium text-sky-800 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>{lead.telegramHandle}</span>
                      {copiedKey === 'tg' ? (
                        <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3 h-3" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
                <p className="text-xs font-mono text-sky-800 break-all">{safeTgUrl}</p>
                <a
                  href={safeTgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-10 px-4 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>Написать в Telegram</span>
                </a>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <p className="text-xs text-slate-600">
                  Прямой Telegram-аккаунт не найден на их сайте или картах. Вы можете связаться по
                  телефону или через форму на сайте, либо перепроверить поиск.
                </p>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              {safeWebUrl && (
                <a
                  href={safeWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-10 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 text-sm font-medium rounded-lg inline-flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <Globe className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">Открыть текущий сайт клиента</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                </a>
              )}

              {safeMapsUrl && (
                <a
                  href={safeMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-10 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 text-sm font-medium rounded-lg inline-flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <MapPin className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">Открыть в Google Картах</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                </a>
              )}

              {lead.socialLinks.map((socialUrl, idx) => {
                const href = safeHref(socialUrl);
                if (!href || href === safeTgUrl || href === safeWebUrl) return null;
                return (
                  <a
                    key={idx}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full h-9 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg inline-flex items-center justify-between gap-2 transition-colors"
                  >
                    <span className="truncate font-mono">{href}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                  </a>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleSendTg}
                disabled={isSending}
                className="w-full h-10 px-4 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Отправляем...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {capabilities.telegramBotConfigured
                        ? 'Прислать разбор мне в Telegram'
                        : 'Как получать разборы в Telegram'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </section>

          {mapsAvailable && typeof lead.lat === 'number' && typeof lead.lng === 'number' && (
            <section className="space-y-2">
              <BusinessMap leads={[lead]} selectedId={lead.id} heightClass="h-[280px]" />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

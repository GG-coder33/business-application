import { X } from 'lucide-react';
import type { SystemCapabilities } from '../types.ts';

interface SetupGuideModalProps {
  open: boolean;
  capabilities: SystemCapabilities;
  onClose: () => void;
}

export function SetupGuideModal({ open, capabilities, onClose }: SetupGuideModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-guide-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="setup-guide-title" className="font-display text-lg font-bold text-slate-900">
              Подключение Telegram и источников поиска
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Что уже работает сейчас и что нужно от вас для полной автоматизации
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="h-8 w-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="font-medium text-slate-800">Поиск на Google Картах</span>
            <span className={capabilities.mapsApiConfigured ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
              {capabilities.mapsApiConfigured ? 'Подключено' : 'Через поиск Gemini'}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="font-medium text-slate-800">Поиск по публичным Telegram-чатам и вебу</span>
            <span className={capabilities.geminiConfigured ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
              {capabilities.geminiConfigured ? 'Подключено' : 'Требуется GEMINI_API_KEY'}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="font-medium text-slate-800">Отправка ссылок в ваш Telegram</span>
            <span className={capabilities.telegramBotConfigured ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
              {capabilities.telegramBotConfigured ? 'Бот настроен' : 'Не настроен (опционально)'}
            </span>
          </div>
        </div>

        <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
          <div>
            <p className="font-semibold text-slate-900 mb-1">
              1. Чтобы приложение само присылало вам ссылки в Telegram:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600">
              <li>Создайте бота у <span className="font-mono text-slate-800">@BotFather</span> и получите токен.</li>
              <li>Узнайте свой <span className="font-mono text-slate-800">Chat ID</span> (например, через <span className="font-mono text-slate-800">@userinfobot</span>) и напишите боту <span className="font-mono text-slate-800">/start</span>.</li>
              <li>Добавьте в панель <strong>Settings → Secrets</strong> переменные <span className="font-mono text-slate-800">TELEGRAM_BOT_TOKEN</span> и <span className="font-mono text-slate-800">TELEGRAM_CHAT_ID</span>.</li>
            </ol>
          </div>

          <div>
            <p className="font-semibold text-slate-900 mb-1">
              2. Если нужен парсинг закрытых или конкретных Telegram-чатов:
            </p>
            <p className="text-slate-600">
              Сейчас поиск ищет по проиндексированным публичным каналам, каталогам <span className="font-mono text-slate-800">t.me</span> и сайтам.
              Чтобы в реальном времени читать сообщения внутри закрытых чатов, от вас потребуются: список ссылок/ID чатов и API-ключи Telegram-клиента (<span className="font-mono text-slate-800">api_id</span> и <span className="font-mono text-slate-800">api_hash</span> с <span className="font-mono text-slate-800">my.telegram.org</span>) либо добавление вашего бота в эти чаты.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

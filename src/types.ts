export type SearchSource = 'maps' | 'telegram' | 'both';

export type LeadOrigin = 'maps' | 'telegram';

export type AutopilotRegion = 'world' | 'cis' | 'europe' | 'americas' | 'custom';

export type AutopilotQualityFilter = 'weak_only' | 'weak_or_none' | 'all';

export type AuditVerdict = 'hot_outdated' | 'no_website' | 'modern_ok' | 'unscanned';

export interface SiteTechnicalSignals {
  reachable: boolean;
  botProtected?: boolean;
  finalUrl?: string;
  usesHttps: boolean;
  hasViewportMeta: boolean;
  stack: string[];
  fonts: string[];
  layoutFeatures: string[];
  widgets: string[];
  redFlags: string[];
  modernIndex: number;
}

export interface WebsiteAudit {
  verdict: AuditVerdict;
  verdictLabel: string;
  websiteScore: number;
  designScore: number;
  issues: string[];
  pitchSuggestions: string[];
  salesPitch: string;
  techSignals?: SiteTechnicalSignals;
  scannedAt: string;
}

export interface GroundedLink {
  title: string;
  url: string;
  kind: 'maps' | 'web' | 'telegram';
}

export interface BusinessLead {
  id: string;
  name: string;
  category: string;
  query: string;
  origin: LeadOrigin;
  discoveredBy?: 'manual' | 'autopilot';
  autoPickedCity?: string;
  region?: AutopilotRegion;
  countryCode?: string;
  countryName?: string;
  placeId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  phone?: string;
  websiteUrl?: string;
  googleMapsUrl?: string;
  telegramHandle?: string;
  telegramUrl?: string;
  telegramSourceChat?: string;
  socialLinks: string[];
  description: string;
  openingHours?: string[];
  sourceLinks: GroundedLink[];
  audit?: WebsiteAudit;
  enriched: boolean;
  isFavorite?: boolean;
  favoritedAt?: string;
  sentToTelegramAt?: string;
  createdAt: string;
}

export interface AutopilotConfig {
  enabled: boolean;
  intervalMinutes: number;
  region: AutopilotRegion;
  customCities: string;
  niches: string;
  qualityFilter: AutopilotQualityFilter;
  autoEnrich: boolean;
  visitedCities: string[];
  isRunning: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastCity?: string;
  lastNiche?: string;
  lastScannedCount?: number;
  lastAddedCount?: number;
  lastError?: string;
}

export interface SystemCapabilities {
  mapsApiConfigured: boolean;
  geminiConfigured: boolean;
  telegramBotConfigured: boolean;
  appUrl: string;
}

import { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps';
import type { BusinessLead } from '../types.ts';

interface BusinessMapProps {
  leads: BusinessLead[];
  selectedId?: string | null;
  onSelectLead?: (id: string) => void;
  onOpenLead?: (id: string) => void;
  heightClass?: string;
}

function MapBoundsController({
  markers,
  selectedId,
}: {
  markers: Array<{ id: string; lat: number; lng: number }>;
  selectedId?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || markers.length === 0) return;

    if (selectedId) {
      const target = markers.find((m) => m.id === selectedId);
      if (target) {
        map.panTo({ lat: target.lat, lng: target.lng });
        const currentZoom = map.getZoom() ?? 12;
        if (currentZoom < 14) {
          map.setZoom(14);
        }
        return;
      }
    }

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(14);
      return;
    }

    const g = (
      window as unknown as {
        google?: {
          maps?: {
            LatLngBounds: new () => {
              extend: (latLng: { lat: number; lng: number }) => void;
            };
          };
        };
      }
    ).google;
    if (!g?.maps?.LatLngBounds) return;

    const bounds = new g.maps.LatLngBounds();
    for (const m of markers) {
      bounds.extend({ lat: m.lat, lng: m.lng });
    }
    map.fitBounds(bounds as unknown as Parameters<typeof map.fitBounds>[0], 48);
  }, [map, markers, selectedId]);

  return null;
}

function LeadMarker({
  lead,
  isSelected,
  onSelect,
  onOpen,
}: {
  lead: BusinessLead;
  isSelected: boolean;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isSelected) {
      setOpen(true);
    }
  }, [isSelected]);

  if (typeof lead.lat !== 'number' || typeof lead.lng !== 'number') {
    return null;
  }

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: lead.lat, lng: lead.lng }}
        title={lead.name}
        onClick={() => {
          setOpen(true);
          onSelect?.(lead.id);
        }}
      >
        <Pin
          background={isSelected ? '#1D4ED8' : '#0F172A'}
          borderColor={isSelected ? '#1E3A8A' : '#334155'}
          glyphColor="#FFFFFF"
          scale={isSelected ? 1.15 : 1}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={260}
          onCloseClick={() => setOpen(false)}
        >
          <div className="p-1 text-slate-900">
            <p className="font-semibold text-sm leading-snug">{lead.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{lead.category}</p>
            {lead.address && (
              <p className="text-xs text-slate-600 mt-1 line-clamp-2">{lead.address}</p>
            )}
            {lead.telegramHandle && (
              <p className="text-xs font-mono text-sky-700 mt-1">{lead.telegramHandle}</p>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={() => onOpen(lead.id)}
                className="mt-2 inline-flex items-center text-xs font-medium text-blue-700 hover:text-blue-800 underline cursor-pointer"
              >
                Открыть карточку
              </button>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function BusinessMap({
  leads,
  selectedId,
  onSelectLead,
  onOpenLead,
  heightClass = 'h-[460px]',
}: BusinessMapProps) {
  const mappable = leads.filter(
    (l): l is BusinessLead & { lat: number; lng: number } =>
      typeof l.lat === 'number' && typeof l.lng === 'number'
  );

  const defaultCenter =
    mappable.length > 0
      ? { lat: mappable[0].lat, lng: mappable[0].lng }
      : { lat: 55.7558, lng: 37.6173 };

  return (
    <div className={`w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-slate-100`}>
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={defaultCenter}
        defaultZoom={mappable.length === 1 ? 14 : 11}
        gestureHandling="greedy"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapBoundsController
          markers={mappable.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng }))}
          selectedId={selectedId}
        />
        {mappable.map((lead) => (
          <LeadMarker
            key={lead.id}
            lead={lead}
            isSelected={selectedId === lead.id}
            onSelect={onSelectLead}
            onOpen={onOpenLead}
          />
        ))}
      </GoogleMap>
    </div>
  );
}

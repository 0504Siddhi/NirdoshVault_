import React, { useEffect, useRef, useState } from 'react';
import NeedOfflineHelp from '../components/NeedOfflineHelp';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client';
import {
  MapPin, Navigation, Search, Loader2, ExternalLink,
  Building2, CreditCard, Scale, Landmark, ChevronDown, Compass
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Centre {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  lat: number;
  lng: number;
  phone?: string;
  timing?: string;
  distance?: string;
  mapsUrl: string;
}

export interface TileLayerProps {
  url?: string;
  attribution?: string;
}

export function TileLayer(_props: TileLayerProps) {
  return null;
}

const centreIcon = (active: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${active ? 34 : 28}px;height:${active ? 34 : 28}px;background:${active ? '#ea580c' : '#7c3aed'};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`,
    iconSize: [active ? 34 : 28, active ? 34 : 28],
    iconAnchor: [active ? 17 : 14, active ? 34 : 28],
  });

const userIcon = L.divIcon({
  className: '',
  html: `<div style="width:20px;height:20px;background:#3b82f6;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(59,130,246,0.4)"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export interface MapContainerProps {
  centres: Centre[];
  selectedCentreId: string | null;
  onSelectCentre: (id: string) => void;
  userLocation: { lat: number; lng: number } | null;
  activeCity?: string;
  onLiveLocationUpdate?: (lat: number, lng: number) => void;
  children?: React.ReactNode;
}

export function MapContainer({
  centres,
  selectedCentreId,
  onSelectCentre,
  userLocation,
  onLiveLocationUpdate,
  children,
}: MapContainerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const userMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastGeocodeRef = useRef(0);

  const [isTracking, setIsTracking] = useState(false);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [liveAreaName, setLiveAreaName] = useState('');
  const [trackError, setTrackError] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center = userLocation || { lat: 18.5314, lng: 73.8446 };
    const map = L.map(containerRef.current, { zoomControl: true }).setView([center.lat, center.lng], 13);

    let tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    let tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    React.Children.forEach(children, (child) => {
      if (React.isValidElement<TileLayerProps>(child)) {
        if (child.props.url) tileUrl = child.props.url;
        if (child.props.attribution) tileAttribution = child.props.attribution;
      }
    });

    L.tileLayer(tileUrl, {
      attribution: tileAttribution,
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    centres.forEach(centre => {
      const active = centre.id === selectedCentreId;
      const marker = L.marker([centre.lat, centre.lng], { icon: centreIcon(active) }).addTo(map);
      marker.bindPopup(
        `<strong>${centre.name}</strong><br/>${centre.address}${centre.distance ? `<br/><span style="color:#ea580c;font-weight:700">${centre.distance} away</span>` : ''}`
      );
      marker.on('click', () => onSelectCentre(centre.id));
      markersRef.current[centre.id] = marker;
    });
  }, [centres, selectedCentreId]);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      const addr = data.address || {};
      const area = addr.suburb || addr.neighbourhood || addr.road || addr.village || addr.town || '';
      const city = addr.city || addr.town || addr.county || '';
      setLiveAreaName([area, city].filter(Boolean).join(', '));
    } catch (err) {
      console.error('Reverse geocode failed', err);
    }
  };

  const drawRoute = async (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes || !data.routes[0]) return;

      const coords = data.routes[0].geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      );

      if (routeLineRef.current) routeLineRef.current.remove();
      routeLineRef.current = L.polyline(coords, { color: '#7c3aed', weight: 5, opacity: 0.8 }).addTo(map);
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [40, 40] });
    } catch (err) {
      console.error('Route fetch failed', err);
    }
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedCentreId) return;
    const centre = centres.find(c => c.id === selectedCentreId);
    if (!centre) return;

    map.panTo([centre.lat, centre.lng]);

    const userPos = userMarkerRef.current?.getLatLng();
    if (userPos) {
      drawRoute({ lat: userPos.lat, lng: userPos.lng }, { lat: centre.lat, lng: centre.lng });
    }
  }, [selectedCentreId]);

  const startLiveTracking = () => {
    if (!navigator.geolocation) {
      setTrackError('Geolocation is not supported on this device.');
      return;
    }
    setTrackError('');
    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const map = mapRef.current;
        if (!map) return;

        setLiveAccuracy(accuracy);

        if (!userMarkerRef.current) {
          userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
          map.setView([latitude, longitude], 15);
        } else {
          userMarkerRef.current.setLatLng([latitude, longitude]);
        }

        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle([latitude, longitude], {
            radius: accuracy,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.12,
            weight: 1,
          }).addTo(map);
        } else {
          accuracyCircleRef.current.setLatLng([latitude, longitude]);
          accuracyCircleRef.current.setRadius(accuracy);
        }

        const now = Date.now();
        if (now - lastGeocodeRef.current > 10000) {
          lastGeocodeRef.current = now;
          reverseGeocode(latitude, longitude);
        }
        onLiveLocationUpdate?.(latitude, longitude);
      },
      (err) => {
        setTrackError(err.message || 'Unable to fetch live location.');
        setIsTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  };

  const stopLiveTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (routeLineRef.current) routeLineRef.current.remove();
    };
  }, []);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 500 }}>
        {!isTracking ? (
          <button onClick={startLiveTracking} className="btn btn-primary text-xs px-3 py-2 flex items-center gap-1.5 shadow-md">
            Track My Live Location
          </button>
        ) : (
          <button onClick={stopLiveTracking} className="btn btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 shadow-md">
            Stop Tracking {liveAccuracy ? `(+/-${Math.round(liveAccuracy)}m)` : ''}
          </button>
        )}
      </div>

      {liveAreaName && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 500 }} className="bg-white shadow-md rounded-lg px-3 py-2 text-xs font-semibold">
          {liveAreaName}
        </div>
      )}

      {trackError && (
        <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, zIndex: 500 }} className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2">
          {trackError}
        </div>
      )}
    </div>
  );
}

export const LeafletMapView = MapContainer;

export default function NearbyCentres() {
  const { analysisId, id } = useParams();
  const activeAnalysisId = analysisId || id;

  const [centres, setCentres] = useState<Centre[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchMethod, setSearchMethod] = useState<'none' | 'geolocation' | 'city' | 'pin'>('city');
  const [selectedCity, setSelectedCity] = useState('Pune');
  const [pinInput, setPinInput] = useState('');
  const [geoError, setGeoError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [selectedCentreId, setSelectedCentreId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>({ lat: 18.5314, lng: 73.8446 });
  const lastLiveFetchRef = useRef(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [queryLabel, setQueryLabel] = useState('');

  const CSC_LOCATOR_URL = 'https://findmycsc.nic.in/';
  const AAPLE_SARKAR_URL = 'https://aaplesarkar.mahaonline.gov.in/en/CommonForm/SewaKendraDetails';

  useEffect(() => {
    api.get('/centres').then(res => {
      setCities(res.data.cities || []);
    }).catch(console.error);

    searchByCity('Pune');
  }, []);

  const searchByCity = async (city: string) => {
    if (!city) return;
    setLoading(true);
    setSearchMethod('city');
    setSelectedCentreId(null);
    setQueryLabel(city);
    try {
      const { data } = await api.get(`/centres?city=${encodeURIComponent(city)}`);
      setCentres(data.centres || []);
    } catch (err) {
      console.error(err);
      setCentres([]);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  };

  const searchByPin = async () => {
    if (!pinInput || pinInput.length < 3) return;
    setLoading(true);
    setSearchMethod('pin');
    setSelectedCentreId(null);
    setQueryLabel(`PIN ${pinInput}`);
    try {
      const { data } = await api.get(`/centres?pin=${encodeURIComponent(pinInput)}`);
      setCentres(data.centres || []);
    } catch (err) {
      console.error(err);
      setCentres([]);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  };

  const searchByLocation = () => {
    setGeoLoading(true);
    setGeoError('');
    setSearchMethod('geolocation');
    setSelectedCentreId(null);

    if (!navigator.geolocation) {
      setUserLocation({ lat: 18.5314, lng: 73.8446 });
      searchByCity('Pune');
      setGeoLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setLoading(true);
        setQueryLabel('your current location');
        try {
          const { data } = await api.get(`/centres?lat=${latitude}&lng=${longitude}`);
          setCentres(data.centres || []);
        } catch (err) {
          console.error(err);
          setCentres([]);
        } finally {
          setLoading(false);
          setHasSearched(true);
          setGeoLoading(false);
        }
      },
      () => {
        setUserLocation({ lat: 18.5314, lng: 73.8446 });
        searchByCity('Pune');
        setGeoLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleLiveLocationUpdate = (lat: number, lng: number) => {
    setUserLocation({ lat, lng });
    const now = Date.now();
    if (now - lastLiveFetchRef.current < 10000) return;
    lastLiveFetchRef.current = now;
    setSearchMethod('geolocation');
    setQueryLabel('your current location');
    api.get(`/centres?lat=${lat}&lng=${lng}`)
      .then(({ data }) => setCentres((data.centres || []).slice().sort((a: any, b: any) => (a.distance ?? Infinity) - (b.distance ?? Infinity))))
      .catch(console.error);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'aadhaar_seva_kendra': return <Building2 size={18} className="text-blue-500" />;
      case 'pan_centre': return <CreditCard size={18} className="text-green-500" />;
      case 'sdm_office': return <Scale size={18} className="text-purple-500" />;
      case 'csc_centre': return <Landmark size={18} className="text-saffron-500" />;
      default: return <MapPin size={18} className="text-slate-400" />;
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'aadhaar_seva_kendra': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'pan_centre': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'sdm_office': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'csc_centre': return 'bg-saffron-500/10 text-saffron-500 border-saffron-500/20';
      default: return 'bg-slate-100 text-slate-500 border-slate-200';
    }
  };

  return (
    <div className="pt-24 px-6 max-w-4xl mx-auto min-h-screen relative z-10 pb-20">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Link
            to={activeAnalysisId ? `/guidance/${activeAnalysisId}` : "/correction-kit"}
            aria-label="Back to Correction Kit"
            className="text-blue-600 hover:underline shrink-0"
          >
            ← Back to Correction Kit
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 border border-green-500/20">
            <MapPin size={12} /> Nearby Centres
          </div>
        </div>
        <h2 className="text-3xl font-bold mb-2">Find Assistance Nearby</h2>
        <p className="text-slate-500">Locate the nearest Aadhaar Seva Kendra, PAN centre, SDM office, or Common Service Centre to get help with document corrections.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <button
          onClick={searchByLocation}
          disabled={geoLoading}
          className="card p-5 text-center hover:border-blue-500/30 hover:bg-blue-500/[0.02] transition-all cursor-pointer group"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
            {geoLoading ? <Loader2 size={22} className="text-blue-500 animate-spin" /> : <Navigation size={22} className="text-blue-500" />}
          </div>
          <div className="font-bold text-sm mb-1">Use My Location</div>
          <div className="text-xs text-slate-500">Instant GPS location match</div>
        </button>

        <div className="card p-5">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-3">
            <Building2 size={22} className="text-green-500" />
          </div>
          <div className="font-bold text-sm mb-2 text-center">Search by City</div>
          <div className="relative">
            <select
              value={selectedCity}
              onChange={e => { setSelectedCity(e.target.value); searchByCity(e.target.value); }}
              className="input text-sm pr-8 appearance-none cursor-pointer"
            >
              <option value="">Select a city</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div className="card p-5">
          <div className="w-12 h-12 rounded-xl bg-saffron-500/10 flex items-center justify-center mx-auto mb-3">
            <Search size={22} className="text-saffron-500" />
          </div>
          <div className="font-bold text-sm mb-2 text-center">Search by PIN Code</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={pinInput}
              onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="e.g. 411004"
              aria-label="Enter 6-digit postal PIN code"
              className="input text-sm flex-1"
              maxLength={6}
            />
            <button onClick={searchByPin} aria-label="Search centres by PIN code" className="btn btn-primary px-3 py-2 text-xs shrink-0">Go</button>
          </div>
        </div>
      </div>

      {geoError && (
        <div role="alert" aria-live="assertive" className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm mb-6">
          ⚠️ {geoError}. Showing default region centres.
        </div>
      )}

      {/* Map — explicit height ensures the map's position:relative actually
          contains its internally absolute-positioned 'Track My Live Location'
          button. Without a height the container collapses to 0px and the button
          bleeds out onto whatever follows (NeedOfflineHelp). */}
      <div className="rounded-xl overflow-hidden h-80 sm:h-96 mb-6">
        <MapContainer
          centres={centres}
          selectedCentreId={selectedCentreId}
          onSelectCentre={(id) => setSelectedCentreId(id)}
          userLocation={userLocation}
          activeCity={selectedCity}
          onLiveLocationUpdate={handleLiveLocationUpdate}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
        </MapContainer>
      </div>
      <NeedOfflineHelp />

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={28} className="animate-spin mr-3" /> Searching nearby centres...
        </div>
      )}

      {!loading && hasSearched && centres.length === 0 && (
        <div className="card p-8 text-center border-slate-200">
          <div className="w-14 h-14 rounded-2xl bg-saffron-500/10 flex items-center justify-center mx-auto mb-4">
            <Compass size={26} className="text-saffron-500" />
          </div>
          <h3 className="font-bold text-lg mb-2">
            No Verified Centre Found{queryLabel ? ` Near ${queryLabel}` : ''}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            We don't have a confirmed assistance centre in our records for this area yet.
            Use the official Government of India CSC Locator to find the nearest
            Common Service Centre instead.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href={CSC_LOCATOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"
            >
              <MapPin size={16} /> Open Official CSC Locator <ExternalLink size={14} />
            </a>
            <a href={AAPLE_SARKAR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary px-5 py-2.5 text-sm inline-flex items-center gap-2"
            >
              <MapPin size={16} /> Maharashtra Aaple Sarkar Sewa Kendra <ExternalLink size={14} />
            </a>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            National centres via findmycsc.nic.in, or Maharashtra state Sewa Kendra via aaplesarkar.mahaonline.gov.in.
          </p>
        </div>
      )}

      {!loading && centres.length > 0 && (
        <div>
          <div role="status" aria-live="polite" className="text-sm text-slate-500 mb-4 flex items-center justify-between">
            <span>
              Found <strong className="text-navy-950 dark:text-white">{centres.length}</strong> centre{centres.length !== 1 ? 's' : ''}
              {searchMethod === 'geolocation' && ' near your location'}
              {searchMethod === 'city' && selectedCity && ` in ${selectedCity}`}
              {searchMethod === 'pin' && ` matching PIN ${pinInput}`}
            </span>
            <span className="text-xs text-slate-400">Click a card to open directions</span>
          </div>

          <div className="space-y-4">
            {centres.map(centre => {
              const isSelected = centre.id === selectedCentreId;
              return (
                <div
                  key={centre.id}
                  onClick={() => setSelectedCentreId(centre.id)}
                  className={`card p-6 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-saffron-500 bg-saffron-500/[0.04] shadow-md'
                      : 'hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-white dark:bg-navy-900 border border-slate-200 dark:border-white/10 flex items-center justify-center">
                      {getTypeIcon(centre.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div>
                          <h3 className="font-bold text-navy-950 dark:text-white">{centre.name}</h3>
                          <p className="text-sm text-slate-500 mt-0.5">{centre.address}</p>
                        </div>
                        {centre.distance && (
                          <div className="shrink-0 text-sm font-bold text-blue-500 bg-blue-500/10 px-2.5 py-1 rounded-lg">
                            {centre.distance}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <span className={`badge border text-[10px] ${getTypeBadgeColor(centre.type)}`}>
                          {centre.typeLabel}
                        </span>
                        {centre.timing && (
                          <span className="badge bg-slate-50 dark:bg-navy-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 text-[10px]">
                            ?? {centre.timing}
                          </span>
                        )}
                        {centre.phone && (
                          <span className="badge bg-slate-50 dark:bg-navy-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 text-[10px]">
                            ?? {centre.phone}
                          </span>
                        )}
                      </div>

                      <div className="mt-4 flex gap-2">
                        <a href={centre.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open directions to ${centre.name} in Google Maps (opens in new tab)`}
                          onClick={(e) => e.stopPropagation()}
                          className="btn btn-primary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                        >
                          <MapPin size={14} /> Open in Google Maps <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

declare global {
  interface Window {
    kakao: any;
  }
}

type Session = {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  title?: string | null;
  note?: string | null;
  total_distance_m?: number | null;
  duration_sec?: number | null;
  avg_pace_sec_per_km?: number | null;
};

type Point = {
  id?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  recorded_at?: string;
};

type ResultSummary = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  totalDistanceMeters: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  pointCount: number;
  points: Point[];
  title?: string | null;
  note?: string | null;
};

const STORAGE_KEY = 'trailtrip_tracking_session';
const DEFAULT_CENTER = { lat: 33.3617, lng: 126.5292 };
const DEFAULT_TRAIL_ID = 'demo-trail-001';
const AUTO_SAVE_MIN_DISTANCE_METERS = 12;
const AUTO_SAVE_MIN_INTERVAL_MS = 20_000;
const AUTO_SAVE_MAX_ACCURACY_METERS = 80;

const DEFAULT_COURSE_PATH: Point[] = [
  { lat: 33.3617, lng: 126.5292 },
  { lat: 33.3621, lng: 126.5301 },
  { lat: 33.3628, lng: 126.5312 },
  { lat: 33.3636, lng: 126.5321 },
  { lat: 33.3645, lng: 126.533 },
  { lat: 33.3652, lng: 126.534 },
  { lat: 33.3659, lng: 126.535 },
];

function getDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) *
      Math.sin(dLng / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * y;
}

function formatMeters(meters: number) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (minutes > 0) {
    return `${minutes}분 ${seconds}초`;
  }

  return `${seconds}초`;
}

function formatPace(avgPaceSecPerKm: number | null) {
  if (!avgPaceSecPerKm || !Number.isFinite(avgPaceSecPerKm)) return '-';
  const minutes = Math.floor(avgPaceSecPerKm / 60);
  const seconds = Math.round(avgPaceSecPerKm % 60);
  return `${minutes}' ${String(seconds).padStart(2, '0')}"/km`;
}

function calculateDistance(points: Point[]) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += getDistanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function buildSummary(session: Session, points: Point[]): ResultSummary {
  const sortedPoints = [...points].sort(
    (a, b) =>
      new Date(a.recorded_at ?? '').getTime() -
      new Date(b.recorded_at ?? '').getTime()
  );

  const totalDistanceMeters = calculateDistance(sortedPoints);
  const startedAt = session.started_at;
  const endedAt = session.ended_at ?? new Date().toISOString();
  const durationSec = Math.max(
    0,
    Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
  const avgPaceSecPerKm =
    totalDistanceMeters > 0 ? durationSec / (totalDistanceMeters / 1000) : null;

  return {
    sessionId: session.id,
    startedAt,
    endedAt,
    totalDistanceMeters,
    durationSec,
    avgPaceSecPerKm,
    pointCount: sortedPoints.length,
    points: sortedPoints,
    title: session.title ?? '',
    note: session.note ?? '',
  };
}

export default function TrackingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [savingPoint, setSavingPoint] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointMessage, setPointMessage] = useState<string | null>(null);
  const [savedPoints, setSavedPoints] = useState<Point[]>([]);
  const [coursePath] = useState<Point[]>(DEFAULT_COURSE_PATH);
  const [livePath, setLivePath] = useState<Point[]>([]);
  const [currentPosition, setCurrentPosition] = useState<Point | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());
  const [resultSummary, setResultSummary] = useState<ResultSummary | null>(null);
  const [resultTitle, setResultTitle] = useState('');
  const [resultNote, setResultNote] = useState('');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const basePolylineRef = useRef<any>(null);
  const livePolylineRef = useRef<any>(null);
  const savedPolylineRef = useRef<any>(null);
  const currentMarkerRef = useRef<any>(null);
  const savedMarkersRef = useRef<any[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const lastSavedPointRef = useRef<Point | null>(null);
  const lastSavedAtRef = useRef<number>(0);
  const autoSavingRef = useRef(false);

  const savedDistanceMeters = useMemo(() => calculateDistance(savedPoints), [savedPoints]);

  const startedAtMs = session?.started_at ? new Date(session.started_at).getTime() : 0;
  const elapsedMs = session ? nowTs - startedAtMs : 0;
  const averagePaceSecPerKm =
    savedDistanceMeters > 0 ? elapsedMs / 1000 / (savedDistanceMeters / 1000) : 0;

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (!session?.id) return;

    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [session?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      initializeMap();
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (session?.id) {
      loadSavedPoints(session.id);
      startWatchingPosition();
    } else {
      stopWatchingPosition();
      setSavedPoints([]);
      setLivePath([]);
      setCurrentPosition(null);
      lastSavedPointRef.current = null;
      lastSavedAtRef.current = 0;
    }

    return () => {
      stopWatchingPosition();
    };
  }, [session?.id]);

  useEffect(() => {
    renderCoursePath();
  }, [coursePath]);

  useEffect(() => {
    renderSavedPointsAndPath();
  }, [savedPoints, resultSummary]);

  useEffect(() => {
    renderLivePath();
  }, [livePath]);

  useEffect(() => {
    renderCurrentPosition();
  }, [currentPosition]);

  function restoreSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        setLoading(false);
        return;
      }

      const parsed = JSON.parse(raw);

      if (parsed?.id && parsed?.status === 'active') {
        setSession({
          id: parsed.id,
          status: parsed.status,
          started_at: parsed.started_at ?? new Date().toISOString(),
          ended_at: parsed.ended_at ?? null,
          title: parsed.title ?? '',
          note: parsed.note ?? '',
        });
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error('세션 복구 실패:', err);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }

  function initializeMap() {
    if (!mapContainerRef.current) return;

    if (!window.kakao || !window.kakao.maps) {
      setError('카카오맵 SDK가 로드되지 않았어.');
      return;
    }

    window.kakao.maps.load(() => {
      if (!mapContainerRef.current) return;

      const center = new window.kakao.maps.LatLng(
        DEFAULT_CENTER.lat,
        DEFAULT_CENTER.lng
      );

      mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, {
        center,
        level: 4,
      });

      renderCoursePath();
      renderSavedPointsAndPath();
      renderLivePath();
      renderCurrentPosition();
    });
  }

  function clearSavedMarkers() {
    savedMarkersRef.current.forEach((marker) => marker.setMap(null));
    savedMarkersRef.current = [];
  }

  function renderCoursePath() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;
    if (!coursePath.length) return;

    if (basePolylineRef.current) {
      basePolylineRef.current.setMap(null);
      basePolylineRef.current = null;
    }

    const path = coursePath.map(
      (point) => new window.kakao.maps.LatLng(point.lat, point.lng)
    );

    basePolylineRef.current = new window.kakao.maps.Polyline({
      map: mapRef.current,
      path,
      strokeWeight: 6,
      strokeColor: '#4DB6AC',
      strokeOpacity: 0.8,
      strokeStyle: 'solid',
      zIndex: 1,
    });
  }

  function renderSavedPointsAndPath() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    clearSavedMarkers();

    if (savedPolylineRef.current) {
      savedPolylineRef.current.setMap(null);
      savedPolylineRef.current = null;
    }

    const targetPoints = resultSummary?.points?.length ? resultSummary.points : savedPoints;
    if (!targetPoints.length) return;

    const path = targetPoints.map(
      (point) => new window.kakao.maps.LatLng(point.lat, point.lng)
    );

    const first = targetPoints[0];
    const last = targetPoints[targetPoints.length - 1];

    [
      { point: first, title: '시작' },
      { point: last, title: '종료' },
    ].forEach(({ point, title }) => {
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(point.lat, point.lng),
        title,
      });
      marker.setMap(mapRef.current);
      marker.setZIndex(2);
      savedMarkersRef.current.push(marker);
    });

    if (path.length >= 2) {
      savedPolylineRef.current = new window.kakao.maps.Polyline({
        map: mapRef.current,
        path,
        strokeWeight: 5,
        strokeColor: '#0A84FF',
        strokeOpacity: 0.95,
        strokeStyle: 'solid',
        zIndex: 3,
      });
    }

    const bounds = new window.kakao.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    mapRef.current.setBounds(bounds);
  }

  function renderLivePath() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    if (livePolylineRef.current) {
      livePolylineRef.current.setMap(null);
      livePolylineRef.current = null;
    }

    if (livePath.length < 2) return;

    const path = livePath.map(
      (point) => new window.kakao.maps.LatLng(point.lat, point.lng)
    );

    livePolylineRef.current = new window.kakao.maps.Polyline({
      map: mapRef.current,
      path,
      strokeWeight: 7,
      strokeColor: '#1565C0',
      strokeOpacity: 0.5,
      strokeStyle: 'shortdash',
      zIndex: 4,
    });
  }

  function renderCurrentPosition() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    if (currentMarkerRef.current) {
      currentMarkerRef.current.setMap(null);
      currentMarkerRef.current = null;
    }

    if (!currentPosition || !session) return;

    currentMarkerRef.current = new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(
        currentPosition.lat,
        currentPosition.lng
      ),
      content: `
        <div style="
          width:18px;
          height:18px;
          border-radius:50%;
          background:#ff3b30;
          border:3px solid #ffffff;
          box-shadow:0 0 0 3px rgba(255,59,48,0.20);
        "></div>
      `,
      yAnchor: 0.5,
      zIndex: 6,
    });

    currentMarkerRef.current.setMap(mapRef.current);
  }

  async function persistPoint(point: Point, source: 'manual' | 'auto') {
    if (!session?.id) {
      return false;
    }

    const res = await fetch('/api/tracking/point', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: session.id,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy ?? null,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`위치 저장 실패: ${res.status} ${text}`);
    }

    const data = await res.json();
    const newPoint: Point = {
      id: data.point.id,
      lat: data.point.lat,
      lng: data.point.lng,
      accuracy: data.point.accuracy,
      recorded_at: data.point.recorded_at,
    };

    setSavedPoints((prev) => [...prev, newPoint]);
    lastSavedPointRef.current = newPoint;
    lastSavedAtRef.current = Date.now();

    if (source === 'manual') {
      setPointMessage(
        `위치 저장 완료 (${newPoint.lat.toFixed(5)}, ${newPoint.lng.toFixed(5)})`
      );
    } else {
      setPointMessage(`자동 저장 완료 · ${formatMeters(savedDistanceMeters)}`);
    }

    return true;
  }

  async function tryAutoSave(point: Point) {
    if (!session?.id || autoSavingRef.current) return;
    if (typeof point.accuracy === 'number' && point.accuracy > AUTO_SAVE_MAX_ACCURACY_METERS) return;

    const now = Date.now();
    const lastPoint = lastSavedPointRef.current;
    const timeEnough = now - lastSavedAtRef.current >= AUTO_SAVE_MIN_INTERVAL_MS;

    if (!lastPoint) {
      autoSavingRef.current = true;
      try {
        await persistPoint(point, 'auto');
      } catch (err) {
        console.error('자동 저장 실패:', err);
      } finally {
        autoSavingRef.current = false;
      }
      return;
    }

    const distance = getDistanceMeters(lastPoint, point);
    if (!timeEnough || distance < AUTO_SAVE_MIN_DISTANCE_METERS) return;

    autoSavingRef.current = true;
    try {
      await persistPoint(point, 'auto');
    } catch (err) {
      console.error('자동 저장 실패:', err);
    } finally {
      autoSavingRef.current = false;
    }
  }

  function startWatchingPosition() {
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 위치 정보를 지원하지 않아.');
      return;
    }

    if (watchIdRef.current !== null) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point: Point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recorded_at: new Date().toISOString(),
        };

        setCurrentPosition(point);
        tryAutoSave(point);

        setLivePath((prev) => {
          const last = prev[prev.length - 1];
          if (!last) return [point];

          const distance = getDistanceMeters(last, point);
          if (distance < 5) return prev;

          return [...prev, point];
        });
      },
      (geoError) => {
        console.error('실시간 위치 추적 실패:', geoError);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );

    setIsWatching(true);
  }

  function stopWatchingPosition() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setIsWatching(false);
  }

  function moveToCurrentLocation() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;
    if (!currentPosition) return;

    mapRef.current.setCenter(
      new window.kakao.maps.LatLng(currentPosition.lat, currentPosition.lng)
    );
  }

  function fitCourseBounds() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    const targetPoints = resultSummary?.points?.length
      ? resultSummary.points
      : savedPoints.length
      ? savedPoints
      : coursePath;
    if (!targetPoints.length) return;

    const bounds = new window.kakao.maps.LatLngBounds();
    targetPoints.forEach((point) => {
      bounds.extend(new window.kakao.maps.LatLng(point.lat, point.lng));
    });

    mapRef.current.setBounds(bounds);
  }

  async function loadSavedPoints(sessionId: string) {
    try {
      setLoadingPoints(true);
      setError(null);

      const res = await fetch(`/api/tracking/points?sessionId=${sessionId}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`포인트 불러오기 실패: ${res.status} ${text}`);
      }

      const data = await res.json();
      const points = Array.isArray(data.points) ? data.points : [];
      setSavedPoints(points);

      if (points.length > 0) {
        lastSavedPointRef.current = points[points.length - 1];
        lastSavedAtRef.current = Date.now();
      }
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '포인트 불러오기 중 오류가 발생했어.'
      );
    } finally {
      setLoadingPoints(false);
    }
  }

  async function handleStartTracking() {
    try {
      setStarting(true);
      setError(null);
      setPointMessage(null);
      setResultSummary(null);
      setResultTitle('');
      setResultNote('');

      const res = await fetch('/api/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trailId: DEFAULT_TRAIL_ID,
          reuseActive: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`세션 생성 실패: ${res.status} ${text}`);
      }

      const data = await res.json();
      const newSession: Session = {
        id: data.session.id,
        status: data.session.status ?? 'active',
        started_at: data.session.started_at ?? new Date().toISOString(),
        ended_at: data.session.ended_at ?? null,
        title: data.session.title ?? '',
        note: data.session.note ?? '',
      };

      setSession(newSession);
      setNowTs(Date.now());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
      setSavedPoints([]);
      setLivePath([]);
      setCurrentPosition(null);
      lastSavedPointRef.current = null;
      lastSavedAtRef.current = 0;
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '트래킹 시작 중 오류가 발생했어.'
      );
    } finally {
      setStarting(false);
    }
  }

  function handleClearSession() {
    stopWatchingPosition();
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setError(null);
    setPointMessage(null);
    setSavedPoints([]);
    setLivePath([]);
    setCurrentPosition(null);
    setResultSummary(null);
    setResultTitle('');
    setResultNote('');
    lastSavedPointRef.current = null;
    lastSavedAtRef.current = 0;
  }

  async function handleRestart() {
    if (session?.id) {
      const confirmed = window.confirm('현재 진행 중인 세션을 종료하고 새 세션을 시작할까?');
      if (!confirmed) return;

      const ended = await handleEndTracking({ quiet: true });
      if (!ended) return;
    }

    await handleStartTracking();
  }

  async function handleEndTracking(options?: { quiet?: boolean }) {
    if (!session?.id) {
      setError('종료할 세션이 없어.');
      return false;
    }

    try {
      setEnding(true);
      setError(null);
      setPointMessage(null);

      let finalPoints = [...savedPoints];

      if (currentPosition) {
        try {
          const saved = await persistPoint(currentPosition, 'auto');
          if (saved) {
            finalPoints = [
              ...finalPoints,
              {
                lat: currentPosition.lat,
                lng: currentPosition.lng,
                accuracy: currentPosition.accuracy,
                recorded_at: new Date().toISOString(),
              },
            ];
          }
        } catch (finalPointError) {
          console.error('종료 직전 마지막 포인트 저장 실패:', finalPointError);
        }
      }

      const temporarySummary = buildSummary(session, finalPoints);

      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.id,
          completeSession: true,
          totalDistanceMeters: temporarySummary.totalDistanceMeters,
          durationSec: temporarySummary.durationSec,
          avgPaceSecPerKm: temporarySummary.avgPaceSecPerKm,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`세션 종료 실패: ${res.status} ${text}`);
      }

      const data = await res.json();
      const endedSession: Session = data.session;
      const summary = buildSummary(endedSession, finalPoints);

      stopWatchingPosition();
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      setSavedPoints([]);
      setLivePath([]);
      setCurrentPosition(null);
      setResultSummary(summary);
      setResultTitle(summary.title ?? '');
      setResultNote(summary.note ?? '');
      lastSavedPointRef.current = null;
      lastSavedAtRef.current = 0;

      if (!options?.quiet) {
        setPointMessage('트래킹 결과를 확인하고 이름을 저장해줘.');
      }

      return true;
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '트래킹 종료 중 오류가 발생했어.'
      );
      return false;
    } finally {
      setEnding(false);
    }
  }

  async function handleSaveCurrentLocation() {
    if (!session) {
      setError('진행 중인 세션이 없어.');
      return;
    }

    if (!currentPosition) {
      setError('아직 현재 위치를 잡지 못했어. 잠깐 기다려줘.');
      return;
    }

    try {
      setSavingPoint(true);
      setError(null);
      setPointMessage(null);
      await persistPoint(currentPosition, 'manual');
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '위치 저장 중 오류가 발생했어.'
      );
    } finally {
      setSavingPoint(false);
    }
  }

  async function handleSaveResult() {
    if (!resultSummary) {
      setError('저장할 결과가 없어.');
      return;
    }

    try {
      setSavingResult(true);
      setError(null);
      setPointMessage(null);

      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: resultSummary.sessionId,
          title: resultTitle.trim() || null,
          note: resultNote.trim() || null,
          totalDistanceMeters: resultSummary.totalDistanceMeters,
          durationSec: resultSummary.durationSec,
          avgPaceSecPerKm: resultSummary.avgPaceSecPerKm,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`결과 저장 실패: ${res.status} ${text}`);
      }

      const data = await res.json();
      setResultSummary((prev) =>
        prev
          ? {
              ...prev,
              title: data.session.title ?? '',
              note: data.session.note ?? '',
            }
          : prev
      );
      setPointMessage('결과 이름과 메모를 저장했어.');
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '결과 저장 중 오류가 발생했어.'
      );
    } finally {
      setSavingResult(false);
    }
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>불러오는 중...</div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>TrailTrip Tracking</h1>

        <div ref={mapContainerRef} style={styles.mapBox} />

        {!session && !resultSummary ? (
          <>
            <p style={styles.desc}>현재 진행 중인 트래킹 세션이 없어.</p>
            <button
              onClick={handleStartTracking}
              disabled={starting}
              style={styles.primaryButton}
            >
              {starting ? '시작 중...' : '트래킹 시작'}
            </button>
          </>
        ) : null}

        {session ? (
          <>
            <div style={styles.statusBox}>
              <p style={styles.label}>현재 트래킹 진행 중</p>
              <p style={styles.metaText}><strong>상태:</strong> {session.status}</p>
              <p style={styles.metaText}><strong>시작 시간:</strong> {new Date(session.started_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
              <p style={styles.metaText}><strong>경과 시간:</strong> {formatDuration(elapsedMs)}</p>
              <p style={styles.metaText}><strong>누적 거리:</strong> {formatMeters(savedDistanceMeters)}</p>
              <p style={styles.metaText}><strong>평균 페이스:</strong> {formatPace(averagePaceSecPerKm)}</p>
              <p style={styles.metaText}><strong>저장 포인트:</strong> {savedPoints.length}개</p>
              <p style={styles.metaText}><strong>실시간 추적:</strong> {isWatching ? '켜짐' : '꺼짐'}</p>
              <p style={styles.metaText}><strong>자동 저장 기준:</strong> 12m 이상 이동 + 20초 이상 경과</p>
              {currentPosition?.accuracy !== undefined && currentPosition?.accuracy !== null && (
                <p style={styles.metaText}><strong>현재 정확도:</strong> {Math.round(currentPosition.accuracy)}m</p>
              )}
              {loadingPoints && <p style={styles.metaText}>저장된 포인트 불러오는 중...</p>}
            </div>

            <div style={styles.buttonColumn}>
              <button
                onClick={handleSaveCurrentLocation}
                disabled={savingPoint}
                style={styles.primaryButton}
              >
                {savingPoint ? '위치 저장 중...' : '현재 위치 수동 저장'}
              </button>

              <div style={styles.buttonRow}>
                <button onClick={moveToCurrentLocation} style={styles.secondaryButton}>
                  내 위치 보기
                </button>

                <button onClick={fitCourseBounds} style={styles.secondaryButton}>
                  전체 경로 보기
                </button>
              </div>

              <div style={styles.buttonRow}>
                <button
                  onClick={handleRestart}
                  disabled={starting || ending}
                  style={styles.secondaryButton}
                >
                  {starting ? '재시작 중...' : '새 세션 시작'}
                </button>

                <button
                  onClick={() => handleEndTracking()}
                  disabled={ending}
                  style={styles.endButton}
                >
                  {ending ? '종료 중...' : '트래킹 종료'}
                </button>

                <button onClick={handleClearSession} style={styles.dangerButton}>
                  로컬 세션 삭제
                </button>
              </div>
            </div>
          </>
        ) : null}

        {resultSummary ? (
          <div style={styles.resultBox}>
            <p style={styles.label}>이번 트래킹 결과</p>
            <p style={styles.metaText}><strong>시작 시간:</strong> {new Date(resultSummary.startedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
            <p style={styles.metaText}><strong>종료 시간:</strong> {new Date(resultSummary.endedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
            <p style={styles.metaText}><strong>총 거리:</strong> {formatMeters(resultSummary.totalDistanceMeters)}</p>
            <p style={styles.metaText}><strong>총 시간:</strong> {formatDuration(resultSummary.durationSec * 1000)}</p>
            <p style={styles.metaText}><strong>평균 페이스:</strong> {formatPace(resultSummary.avgPaceSecPerKm)}</p>
            <p style={styles.metaText}><strong>기록 포인트:</strong> {resultSummary.pointCount}개</p>

            <div style={styles.formGroup}>
              <label style={styles.inputLabel}>코스 이름</label>
              <input
                value={resultTitle}
                onChange={(e) => setResultTitle(e.target.value)}
                placeholder="예: 한라산 테스트 코스"
                style={styles.textInput}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.inputLabel}>메모</label>
              <textarea
                value={resultNote}
                onChange={(e) => setResultNote(e.target.value)}
                placeholder="느낀 점이나 보완할 점을 적어둬"
                style={styles.textArea}
              />
            </div>

            <div style={styles.buttonColumn}>
              <button onClick={handleSaveResult} disabled={savingResult} style={styles.primaryButton}>
                {savingResult ? '저장 중...' : '결과 이름 저장'}
              </button>
              <button onClick={handleStartTracking} disabled={starting} style={styles.secondaryButton}>
                {starting ? '시작 중...' : '새 트래킹 시작'}
              </button>
            </div>
          </div>
        ) : null}

        {pointMessage && <p style={styles.success}>{pointMessage}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f7f7f7',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '12px',
  },
  card: {
    width: '100%',
    maxWidth: '760px',
    background: '#fff',
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    marginBottom: '16px',
    lineHeight: 1.3,
  },
  mapBox: {
    width: '100%',
    height: '320px',
    borderRadius: '14px',
    marginBottom: '16px',
    background: '#eef2f7',
    overflow: 'hidden',
  },
  desc: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '16px',
    lineHeight: 1.5,
  },
  statusBox: {
    background: '#f3f6fb',
    borderRadius: '14px',
    padding: '16px',
    marginBottom: '16px',
    lineHeight: 1.7,
  },
  resultBox: {
    background: '#f8f6ef',
    borderRadius: '14px',
    padding: '16px',
    marginBottom: '16px',
    lineHeight: 1.7,
    border: '1px solid #eadfbe',
  },
  label: {
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '8px',
  },
  metaText: {
    fontSize: '14px',
    lineHeight: 1.6,
    margin: 0,
    marginBottom: '6px',
  },
  buttonColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  buttonRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '12px',
    marginBottom: '12px',
  },
  inputLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#444',
  },
  textInput: {
    width: '100%',
    padding: '14px 14px',
    borderRadius: '12px',
    border: '1px solid #d0d7de',
    fontSize: '15px',
  },
  textArea: {
    width: '100%',
    minHeight: '90px',
    padding: '14px 14px',
    borderRadius: '12px',
    border: '1px solid #d0d7de',
    fontSize: '15px',
    resize: 'vertical',
  },
  primaryButton: {
    width: '100%',
    padding: '15px 16px',
    borderRadius: '12px',
    border: 'none',
    background: '#111',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    padding: '15px 16px',
    borderRadius: '12px',
    border: '1px solid #ccc',
    background: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  endButton: {
    width: '100%',
    padding: '15px 16px',
    borderRadius: '12px',
    border: 'none',
    background: '#f3a712',
    color: '#111',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  dangerButton: {
    width: '100%',
    padding: '15px 16px',
    borderRadius: '12px',
    border: 'none',
    background: '#e5484d',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  success: {
    marginTop: '16px',
    color: '#16794c',
    fontSize: '14px',
    fontWeight: 600,
  },
  error: {
    marginTop: '16px',
    color: '#d93025',
    fontSize: '14px',
    fontWeight: 600,
  },
};

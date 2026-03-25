'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

declare global {
  interface Window {
    kakao: any;
  }
}

type Session = {
  id: string;
  status: string;
  started_at: string;
};

type Point = {
  id?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  recorded_at?: string;
};

const STORAGE_KEY = 'trailtrip_tracking_session';
const DEFAULT_CENTER = { lat: 33.3617, lng: 126.5292 };

/**
 * 임시 기본 코스 라인
 * 나중에 하귀-협재 GPX 좌표로 교체
 */
const DEFAULT_COURSE_PATH: Point[] = [
  { lat: 33.3617, lng: 126.5292 },
  { lat: 33.3621, lng: 126.5301 },
  { lat: 33.3628, lng: 126.5312 },
  { lat: 33.3636, lng: 126.5321 },
  { lat: 33.3645, lng: 126.5330 },
  { lat: 33.3652, lng: 126.5340 },
  { lat: 33.3659, lng: 126.5350 },
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

export default function TrackingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [savingPoint, setSavingPoint] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointMessage, setPointMessage] = useState<string | null>(null);

  const [savedPoints, setSavedPoints] = useState<Point[]>([]);
  const [coursePath] = useState<Point[]>(DEFAULT_COURSE_PATH);
  const [livePath, setLivePath] = useState<Point[]>([]);
  const [currentPosition, setCurrentPosition] = useState<Point | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);

  const basePolylineRef = useRef<any>(null);
  const livePolylineRef = useRef<any>(null);
  const savedPolylineRef = useRef<any>(null);
  const currentMarkerRef = useRef<any>(null);
  const savedMarkersRef = useRef<any[]>([]);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    restoreSession();
  }, []);

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
  }, [savedPoints]);

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

      if (parsed?.id && parsed?.status) {
        setSession({
          id: parsed.id,
          status: parsed.status,
          started_at: parsed.started_at ?? new Date().toISOString(),
        });
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

    const bounds = new window.kakao.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    mapRef.current.setBounds(bounds);
  }

  function renderSavedPointsAndPath() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    clearSavedMarkers();

    if (savedPolylineRef.current) {
      savedPolylineRef.current.setMap(null);
      savedPolylineRef.current = null;
    }

    if (!savedPoints.length) return;

    const path = savedPoints.map(
      (point) => new window.kakao.maps.LatLng(point.lat, point.lng)
    );

    savedPoints.forEach((point, index) => {
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(point.lat, point.lng),
        title: `저장 포인트 ${index + 1}`,
      });

      marker.setMap(mapRef.current);
      marker.setZIndex(2);
      savedMarkersRef.current.push(marker);
    });

    if (path.length >= 2) {
      savedPolylineRef.current = new window.kakao.maps.Polyline({
        map: mapRef.current,
        path,
        strokeWeight: 4,
        strokeColor: '#7c8aa5',
        strokeOpacity: 0.75,
        strokeStyle: 'shortdash',
        zIndex: 2,
      });
    }
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
      strokeOpacity: 0.95,
      strokeStyle: 'solid',
      zIndex: 4,
    });
  }

  function renderCurrentPosition() {
    if (!mapRef.current || !window.kakao || !window.kakao.maps) return;

    if (currentMarkerRef.current) {
      currentMarkerRef.current.setMap(null);
      currentMarkerRef.current = null;
    }

    if (!currentPosition) return;

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

        setLivePath((prev) => {
          const last = prev[prev.length - 1];

          if (!last) return [point];

          const distance = getDistanceMeters(last, point);

          if (distance < 5) {
            return prev;
          }

          return [...prev, point];
        });
      },
      (geoError) => {
        console.error('실시간 위치 추적 실패:', geoError);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
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
    if (!coursePath.length) return;

    const bounds = new window.kakao.maps.LatLngBounds();
    coursePath.forEach((point) => {
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
      setSavedPoints(Array.isArray(data.points) ? data.points : []);
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

      const res = await fetch('/api/session', {
        method: 'POST',
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`세션 생성 실패: ${res.status} ${text}`);
      }

      const data = await res.json();

      const newSession: Session = {
        id: data.id,
        status: data.status ?? 'active',
        started_at: data.started_at ?? new Date().toISOString(),
      };

      setSession(newSession);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
      setSavedPoints([]);
      setLivePath([]);
      setCurrentPosition(null);
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
  }

  async function handleRestart() {
    stopWatchingPosition();
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setError(null);
    setPointMessage(null);
    setSavedPoints([]);
    setLivePath([]);
    setCurrentPosition(null);
    await handleStartTracking();
  }

  function handleEndTracking() {
    try {
      setEnding(true);
      stopWatchingPosition();
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      setPointMessage('트래킹을 종료했어.');
      setError(null);
      setSavedPoints([]);
      setLivePath([]);
      setCurrentPosition(null);
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

      const res = await fetch('/api/tracking/point', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.id,
          lat: currentPosition.lat,
          lng: currentPosition.lng,
          accuracy: currentPosition.accuracy ?? null,
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
      setPointMessage(
        `위치 저장 완료 (${data.point.lat.toFixed(5)}, ${data.point.lng.toFixed(5)})`
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : '위치 저장 중 오류가 발생했어.'
      );
    } finally {
      setSavingPoint(false);
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

        {!session ? (
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
        ) : (
          <>
            <div style={styles.statusBox}>
              <p style={styles.label}>현재 트래킹 진행 중</p>
              <p style={styles.metaText}>
                <strong>상태:</strong> {session.status}
              </p>
              <p style={styles.metaText}>
                <strong>시작 시간:</strong>{' '}
                {new Date(session.started_at).toLocaleString()}
              </p>
              <p style={styles.metaText}>
                <strong>기본 코스:</strong> {coursePath.length}포인트
              </p>
              <p style={styles.metaText}>
                <strong>실시간 이동:</strong> {livePath.length}포인트
              </p>
              <p style={styles.metaText}>
                <strong>저장 포인트:</strong> {savedPoints.length}개
              </p>
              <p style={styles.metaText}>
                <strong>실시간 추적:</strong> {isWatching ? '켜짐' : '꺼짐'}
              </p>
              {loadingPoints && (
                <p style={styles.metaText}>저장된 포인트 불러오는 중...</p>
              )}
            </div>

            <div style={styles.buttonColumn}>
              <button
                onClick={handleSaveCurrentLocation}
                disabled={savingPoint}
                style={styles.primaryButton}
              >
                {savingPoint ? '위치 저장 중...' : '현재 위치 저장'}
              </button>

              <div style={styles.buttonRow}>
                <button
                  onClick={moveToCurrentLocation}
                  style={styles.secondaryButton}
                >
                  내 위치 보기
                </button>

                <button
                  onClick={fitCourseBounds}
                  style={styles.secondaryButton}
                >
                  코스 전체 보기
                </button>
              </div>

              <div style={styles.buttonRow}>
                <button
                  onClick={handleRestart}
                  disabled={starting}
                  style={styles.secondaryButton}
                >
                  {starting ? '재시작 중...' : '새 세션 시작'}
                </button>

                <button
                  onClick={handleEndTracking}
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
        )}

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
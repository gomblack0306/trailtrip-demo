'use client';

import { useState } from 'react';

type Session = {
  id: string;
  status: string;
  started_at: string;
  trail_id: string | null;
};

export default function TrackingPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<Session | null>(null);

  const handleStartTracking = async () => {
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/tracking/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trailId: 'demo-trail-001' }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || '세션 생성 실패');
      }

      setSession(result.session);
      setMessage('트래킹 세션 생성 완료');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>트래킹 테스트</h1>

      <button onClick={handleStartTracking} disabled={loading}>
        {loading ? '생성 중...' : '트래킹 시작'}
      </button>

      {message && <p style={{ marginTop: 16 }}>{message}</p>}

      {session && (
        <div style={{ marginTop: 20 }}>
          <p><strong>세션 ID:</strong> {session.id}</p>
          <p><strong>상태:</strong> {session.status}</p>
          <p><strong>시작시간:</strong> {session.started_at}</p>
          <p><strong>코스 ID:</strong> {session.trail_id}</p>
        </div>
      )}
    </div>
  );
}
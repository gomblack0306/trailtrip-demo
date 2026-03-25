'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type UserState = {
  email?: string;
};

export default function MyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserState | null>(null);

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.replace('/login');
        return;
      }

      setUser({ email: user.email });
      setLoading(false);
    };

    checkUser();
  }, [router]);

  if (loading) {
    return <div style={{ padding: 40 }}>로딩중...</div>;
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>내 페이지</h1>
      <p>이메일: {user?.email}</p>
    </div>
  );
}
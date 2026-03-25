import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function MyPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>내 페이지</h1>
      <p>이메일: {user.email}</p>
    </div>
  );
}
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId가 필요합니다.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('trekking_points')
      .select('id, lat, lng, accuracy, recorded_at')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true });

    if (error) {
      console.error('[TRACKING_POINTS_FETCH_ERROR]', error);
      return NextResponse.json(
        { error: '포인트 조회 실패' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      points: data ?? [],
    });
  } catch (error) {
    console.error('[TRACKING_POINTS_GET]', error);

    return NextResponse.json(
      { error: '포인트 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
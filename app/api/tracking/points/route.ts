import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  }

  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

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
      console.error('[TRACKING_POINTS_GET_ERROR]', error);
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
    console.error('[TRACKING_POINTS_ROUTE]', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '포인트 조회 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
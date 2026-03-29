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

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'tracking point api alive',
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { sessionId, lat, lng, accuracy } = body;

    if (!sessionId || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json(
        { error: 'sessionId, lat, lng는 필수입니다.' },
        { status: 400 }
      );
    }

    const { data: activeSession, error: sessionError } = await supabase
      .from('trekking_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('status', 'active')
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json(
        {
          error: '세션 확인 실패',
          detail: sessionError.message,
        },
        { status: 500 }
      );
    }

    if (!activeSession) {
      return NextResponse.json(
        { error: '활성 세션이 없어서 위치를 저장할 수 없습니다.' },
        { status: 404 }
      );
    }

    const recorded_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('trekking_points')
      .insert({
        session_id: sessionId,
        lat,
        lng,
        accuracy: typeof accuracy === 'number' ? accuracy : null,
        recorded_at,
      })
      .select()
      .single();

    if (error) {
      console.error('[TRACKING_POINT_INSERT_ERROR]', error);
      return NextResponse.json(
        { error: 'DB에 위치 저장 실패', detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        point: {
          id: data.id,
          session_id: data.session_id,
          lat: data.lat,
          lng: data.lng,
          accuracy: data.accuracy,
          recorded_at: data.recorded_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[TRACKING_POINT_POST]', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '위치 저장에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}

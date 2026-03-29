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

const SESSION_SELECT = `
  id,
  trail_id,
  status,
  started_at,
  ended_at,
  title,
  note,
  total_distance_m,
  duration_sec,
  avg_pace_sec_per_km
`;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: 'tracking session api alive',
    },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const trailId =
      typeof body?.trailId === 'string' && body.trailId.trim()
        ? body.trailId.trim()
        : 'demo-trail-001';

    const startedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('trekking_sessions')
      .insert({
        trail_id: trailId,
        status: 'active',
        started_at: startedAt,
      })
      .select(SESSION_SELECT)
      .single();

    if (error) {
      console.error('[TRACKING_SESSION_INSERT_ERROR]', error);
      return NextResponse.json(
        {
          error: 'DB에 세션 저장 실패',
          detail: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        reused: false,
        session: data,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[TRACKING_SESSION_POST]', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '세션 생성에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const sessionId = body?.sessionId;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId는 필수입니다.' },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from('trekking_sessions')
      .select(SESSION_SELECT)
      .eq('id', sessionId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: '세션 조회 실패', detail: existingError.message },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: '세션을 찾지 못했습니다.' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (body?.completeSession === true && existing.status === 'active') {
      updateData.status = 'completed';
      updateData.ended_at = new Date().toISOString();
    }

    if (typeof body?.title === 'string' || body?.title === null) {
      updateData.title = body.title;
    }

    if (typeof body?.note === 'string' || body?.note === null) {
      updateData.note = body.note;
    }

    if (typeof body?.totalDistanceMeters === 'number') {
      updateData.total_distance_m = body.totalDistanceMeters;
    }

    if (typeof body?.durationSec === 'number') {
      updateData.duration_sec = Math.max(0, Math.round(body.durationSec));
    }

    if (
      typeof body?.avgPaceSecPerKm === 'number' &&
      Number.isFinite(body.avgPaceSecPerKm)
    ) {
      updateData.avg_pace_sec_per_km = Math.round(body.avgPaceSecPerKm);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { ok: true, session: existing },
        { status: 200 }
      );
    }

    const { data, error } = await supabase
      .from('trekking_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select(SESSION_SELECT)
      .single();

    if (error) {
      console.error('[TRACKING_SESSION_PATCH_ERROR]', error);
      return NextResponse.json(
        {
          error: '세션 업데이트 실패',
          detail: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        session: data,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[TRACKING_SESSION_PATCH]', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '세션 종료에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}

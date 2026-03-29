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
    const reuseActive = body?.reuseActive !== false;

    if (reuseActive) {
      const { data: existing, error: existingError } = await supabase
        .from('trekking_sessions')
        .select('id, trail_id, status, started_at, ended_at')
        .eq('trail_id', trailId)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        console.error('[TRACKING_SESSION_FIND_ACTIVE_ERROR]', existingError);
        return NextResponse.json(
          {
            error: '기존 active 세션 조회 실패',
            detail: existingError.message,
          },
          { status: 500 }
        );
      }

      if (existing) {
        return NextResponse.json(
          {
            ok: true,
            reused: true,
            session: existing,
          },
          { status: 200 }
        );
      }
    }

    const startedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('trekking_sessions')
      .insert({
        trail_id: trailId,
        status: 'active',
        started_at: startedAt,
      })
      .select('id, trail_id, status, started_at, ended_at')
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

    const endedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('trekking_sessions')
      .update({
        status: 'completed',
        ended_at: endedAt,
      })
      .eq('id', sessionId)
      .eq('status', 'active')
      .select('id, trail_id, status, started_at, ended_at');

    if (error) {
      console.error('[TRACKING_SESSION_END_ERROR]', error);
      return NextResponse.json(
        {
          error: '세션 종료 업데이트 실패',
          detail: error.message,
        },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: '종료할 active 세션을 찾지 못했습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        session: data[0],
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

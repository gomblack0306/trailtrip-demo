import { NextResponse } from 'next/server';

export async function POST() {
  try {
    return NextResponse.json(
      {
        id: crypto.randomUUID(),
        status: 'active',
        started_at: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[TRACKING_SESSION_POST]', error);

    return NextResponse.json(
      {
        error: '세션 생성에 실패했습니다.',
      },
      { status: 500 }
    );
  }
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
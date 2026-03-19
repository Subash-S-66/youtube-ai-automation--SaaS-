import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  const { promptId, settings, acceptedYouTubeLimitWarning } = body;

  if (settings.videoCount > 10 && !acceptedYouTubeLimitWarning) {
    return NextResponse.json(
      { success: false, message: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?', warning: 'YouTube allows ~10 uploads per 24 hours. This may affect uploads. Proceed?' },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, jobId: 'mock-job-id' });
}

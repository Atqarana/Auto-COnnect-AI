import { NextResponse } from 'next/server';
import { ElevenLabsClient } from 'elevenlabs';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!ELEVENLABS_API_KEY) {
  throw new Error('Missing ELEVENLABS_API_KEY ');
}

const client = new ElevenLabsClient({
  apiKey: ELEVENLABS_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const audioStream = await client.generate({
      voice: 'Jessica',
      model_id: 'eleven_turbo_v2_5',
      text,
    });

    const audioChunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      audioChunks.push(chunk);
    }

    return new Response(Buffer.concat(audioChunks), {
      headers: { 'Content-Type': 'audio/wav' },
    });
  } catch (error) {
    console.error('Error generating audio:', error);
    return NextResponse.error();
  }
}

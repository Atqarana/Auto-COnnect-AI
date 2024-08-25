import Groq from "groq-sdk"; // Import Groq SDK for AI infrastructure
import { headers } from "next/headers"; // Import headers from Next.js
import { z } from "zod"; // Import Zod for schema validation
import { zfd } from "zod-form-data"; // Import Zod Form Data for handling form data
import { ElevenLabsClient, ElevenLabsError } from "elevenlabs"; // Import ElevenLabs client and error handling

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY; // Retrieve API key from environment variables

if (!ELEVENLABS_API_KEY) {
  throw new Error("Missing ELEVENLABS_API_KEY"); // Error if API key is missing
}

const client = new ElevenLabsClient({
  apiKey: ELEVENLABS_API_KEY, // Initialize ElevenLabs client with API key
});

const groq = new Groq(); // Initialize Groq SDK instance

// Define validation schema for incoming form data
const schema = zfd.formData({
  input: z.union([zfd.text(), z.any()]), // Input can be text or any type (e.g., file)
  message: zfd.repeatableOfType(
    zfd.json(
      z.object({
        role: z.enum(["user", "assistant"]), // Role in the conversation
        content: z.string(), // Content of the message
      })
    )
  ),
});

// Handle POST requests
export async function POST(request: Request) {
  console.time("transcribe " + (request.headers.get("x-vercel-id") || "local")); // Start timing transcription

  const { data, success } = schema.safeParse(await request.formData()); // Validate and parse form data
  if (!success) return new Response("Invalid request", { status: 400 }); // Return error if validation fails

  let transcript: string;
  if (data.input instanceof File) { // If input is a file, get transcript from audio
    const result = await getTranscript(data.input);
    if (!result) return new Response("Invalid audio", { status: 400 }); // Return error if audio transcription fails
    transcript = result;
  } else {
    transcript = data.input; // Otherwise, use the input directly
  }

  console.timeEnd("transcribe " + (request.headers.get("x-vercel-id") || "local")); // End timing transcription
  console.time("text completion " + (request.headers.get("x-vercel-id") || "local")); // Start timing text completion

  // Create chat completion using Groq AI
  const completion = await groq.chat.completions.create({
    model: "llama3-8b-8192", // Use the specified AI model
    messages: [
      {
        role: "system", // System message to guide the assistant
        content: `- You are Auto Connect AI, a friendly and helpful voice assistant.
        - Respond briefly to the user's request, and do not provide unnecessary information.
        - If you don't understand the user's request, ask for clarification.
        - You will respond to the user in the language that matches their request or the language detected in their input.
        - You do not have access to up-to-date information, so you should not provide real-time data.
        - You are not capable of performing actions other than responding to the user.
        - Do not use markdown, emojis, or other formatting in your responses. Respond in a way easily spoken by text-to-speech software.
        - User location is ${location()}.
        - The current time is ${time()}.
        - Your large language model is Llama 3, created by Meta, the 8 billion parameter version. It is hosted on Groq, an AI infrastructure company that builds fast inference technology.
        - Your text-to-speech service was created and is hosted by Elevenlabs.
        - You are built with Next.js and hosted on Vercel.`,
      },
      ...data.message, // Add the user's messages
      {
        role: "user", // User message containing the transcript
        content: transcript,
      },
    ],
  });

  const response = completion.choices[0].message.content; // Get the response content from the completion
  console.timeEnd("text completion " + (request.headers.get("x-vercel-id") || "local")); // End timing text completion

  let audioBuffer: Buffer | null = null;
  try {
    audioBuffer = await createAudioStreamFromText(response); // Generate audio from response text
  } catch (error) {
    console.error("Error generating audio:", error); // Log error if audio generation fails
  }

  // Return the response with text and audio buffer (if available)
  return new Response(
    JSON.stringify({
      text: response,
      audioBuffer: audioBuffer ? audioBuffer.toString('base64') : null // Convert audio buffer to base64 string
    }),
    {
      headers: {
        "Content-Type": "application/json", // Set content type to JSON
      },
    }
  );
}

// Get the user's location based on headers
function location() {
  const headersList = headers();

  const country = headersList.get("x-vercel-ip-country");
  const region = headersList.get("x-vercel-ip-country-region");
  const city = headersList.get("x-vercel-ip-city");

  if (!country || !region || !city) return "unknown";

  return `${city}, ${region}, ${country}`;
}

// Get the current time based on timezone header
function time() {
  return new Date().toLocaleString("en-US", {
    timeZone: headers().get("x-vercel-ip-timezone") || undefined,
  });
}

// Transcribe audio file to text using Groq
async function getTranscript(input: File) {
  try {
    const { text } = await groq.audio.transcriptions.create({
      file: input,
      model: "whisper-large-v3", // Use the specified transcription model
    });

    return text.trim() || null; // Return trimmed transcript or null if empty
  } catch {
    return null; // Return null if transcription fails
  }
}

// Generate audio stream from text using ElevenLabs
async function createAudioStreamFromText(text: string): Promise<Buffer> {
  try {
    const audioStream = await client.generate({
      voice: "Jessica", // Use the specified voice
      model_id: "eleven_turbo_v2_5", // Use the specified TTS model
      text,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk); // Collect audio chunks
    }

    return Buffer.concat(chunks); // Combine chunks into a single Buffer
  } catch (error) {
    if (error instanceof ElevenLabsError && error.statusCode === 401) {
      console.error("Invalid API key or authentication error.");
    } else {
      console.error("TTS API error, possibly out of tokens.");
    }
    throw error; // Re-throw error if audio generation fails
  }
}

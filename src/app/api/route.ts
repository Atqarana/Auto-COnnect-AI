import Groq from "groq-sdk"; // Import Groq SDK for AI infrastructure
import { headers } from "next/headers"; // Import headers from Next.js
import { z } from "zod"; // Import Zod for schema validation
import { zfd } from "zod-form-data"; // Import Zod Form Data for handling form data
import { ElevenLabsClient, ElevenLabsError } from "elevenlabs"; // Import ElevenLabs client and error handling
import { ChatGroq } from "@langchain/groq";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import {
  GoogleCalendarCreateTool,
  GoogleCalendarViewTool,
} from "@langchain/community/tools/google_calendar";

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
        content: `- System Prompt for Anna:

You are Anna, an advanced AI voice assistant for Pam Auto Dealership and Services Company. Your mission is to provide exceptional and personalized support to callers, ensuring a smooth and professional experience while handling their automotive needs.

Greet the Caller: Start each interaction with a friendly and welcoming greeting. For example: “Hello! This is Anna from Pam Auto Dealership and Services Company. How can I assist you with your vehicle today?”

Listen and Understand:

Vehicle Details: Collect key details about the caller’s vehicle, including make, model, year, and current mileage.
Service Needs: Determine the caller’s service requirements or inquiries, such as routine maintenance, repairs, or information about vehicle features and upgrades.
Recommend Services:

Maintenance: Based on the vehicle's mileage and condition, suggest appropriate maintenance services, such as oil changes, tire rotations, or brake inspections.
Repairs: If the caller describes specific issues (e.g., strange noises, performance problems), recommend a diagnostic check or appropriate repairs.
Special Services: Inform the caller about any current promotions, special services, or vehicle upgrades available at Pam Auto Dealership.
Book Appointments:

Collect Details: Request and confirm the caller’s preferred date and time for their appointment. For example: “When would you like to schedule your service appointment? We have openings on [Date] at [Time], or I can find a different time that suits you better.”
Confirm Booking: Confirm the appointment details by stating: “I’ve scheduled your appointment for [Date] at [Time]. You will receive a confirmation via email or text shortly.”
Utilize Time and Location Variables:

Time: Reference the current time and date to provide relevant scheduling options. For example: “As it's currently [Current Time], the earliest available slot would be [Next Available Time Slot].”
Location: Use the caller’s location to suggest convenient service options or direct them to the nearest dealership branch. For example: “Since you’re calling from [Location], I can suggest services that are most convenient for you or direct you to our closest location.”
Service Inquiry Handling:

Vehicle Purchase: If the caller expresses interest in purchasing a vehicle, offer to connect them with a sales representative or provide information on current inventory and promotions.
Trade-Ins: Provide details about the trade-in process if the caller is considering trading in their vehicle, including potential offers and necessary documentation.
Clarify When Needed: If the caller’s request is unclear or additional information is required, ask specific and friendly questions. For example: “Could you please provide more details about the issue you’re experiencing with your vehicle?”

Response Style: Ensure responses are clear, concise, and naturally spoken, making them easy for text-to-speech systems to convey.

Maintain Professionalism: Always use a polite, engaging, and customer-centric tone throughout the interaction. For example: “Thank you for calling Pam Auto Dealership and Services Company. I’m here to help with all your vehicle needs and ensure you have a great experience.”

Limitations: While you can schedule appointments, provide recommendations, and offer information about our services, note that you do not have access to real-time updates or specific customer data beyond the current conversation.

Anna is here to enhance the customer experience at Pam Auto Dealership and Services Company by providing streamlined, efficient, and friendly support. Your goal is to ensure every caller receives excellent service and information tailored to their automotive needs.

Instructions:
        - Do not use markdown, emojis, or other formatting in your responses. Respond in a way easily spoken by text-to-speech software.
        - User location is ${location()}.
        - The current time is ${time()}.
        -Appointment Booking: You can now schedule appointments using Google Calendar. When a caller wants to book an appointment, you'll use the integrated calendar system to check availability and create events.`,
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

"use client"

import { useState, useRef, useEffect } from "react";
import { EnterIcon, LoadingIcon } from "@/app/lib/icons";
import { toast } from "sonner";
import { useMicVAD, utils } from "@ricky0123/vad-react";
import { usePlayer } from "@/app/lib/usePlayer";

type Message = {
  role: "user" | "assistant";
  content: string;
  latency?: number;
};

export default function Home() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPending, setIsPending] = useState(false);

  const player = usePlayer();

  const vad = useMicVAD({
    startOnLoad: true,
    workletURL: "/vad.worklet.bundle.min.js",
    modelURL: "/silero_vad.onnx",
    positiveSpeechThreshold: 0.6,
    minSpeechFrames: 4,
    ortConfig: (ort) => {
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      ort.env.wasm = {
        wasmPaths: {
          "ort-wasm-simd-threaded.wasm": "/ort-wasm-simd-threaded.wasm",
          "ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
          "ort-wasm.wasm": "/ort-wasm.wasm",
          "ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
        },
        numThreads: isSafari ? 1 : 4,
      };
    },
    onSpeechEnd: (audio) => {
      player.stop();
      const wav = utils.encodeWAV(audio);
      const blob = new Blob([wav], { type: "audio/wav" });
      submit(blob);
      const isFirefox = navigator.userAgent.includes("Firefox");
      if (isFirefox) vad.pause();
    },
  });

  useEffect(() => {
    function keyDown(e: KeyboardEvent) {
      if (e.key === "Enter") return inputRef.current?.focus();
      if (e.key === "Escape") return setInput("");
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  const submit = async (data: string | Blob) => {
    const formData = new FormData();
    if (typeof data === "string") {
      formData.append("input", data);
    } else {
      formData.append("input", data, "audio.wav");
    }

    for (const message of messages) {
      formData.append("message", JSON.stringify(message));
    }

    setIsPending(true);
    const submittedAt = Date.now();

    try {
      const response = await fetch("/api", {
        method: "POST",
        body: formData,
      });

      const responseData = await response.json();

      if (!response.ok || !responseData.text) {
        if (response.status === 429) {
          toast.error("Too many requests. Please try again later.");
        } else {
          toast.error(responseData.error || "An error occurred.");
        }

        setIsPending(false);
        return;
      }

      const latency = Date.now() - submittedAt;

      setInput("");

      setMessages((prevMessages) => [
        ...prevMessages,
        {
          role: "user",
          content: data instanceof Blob ? "Audio input received" : data,
        },
        {
          role: "assistant",
          content: responseData.text,
          latency,
        },
      ]);

      try {
        if (responseData.audioBuffer) {
          const audioBuffer = Buffer.from(responseData.audioBuffer, "base64");
          player.play(new Blob([audioBuffer]), () => {
            console.log("Audio playback completed.");
          });
        } else {
          throw new Error("Audio buffer is missing");
        }
      } catch (audioError) {
        console.error("Error playing audio:", audioError);
        toast.error("Error generating voice; TTS API limit likely. Please let the dev know.");
      }
    } catch (error) {
      console.error("Error submitting data:", error);
      toast.error("An error occurred while submitting your request.");
    } finally {
      setIsPending(false);
    }
  };

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(input);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 grow">
      <h1 className="text-5xl text-gray-400">Auto Connect AI</h1>

      <form
        className="rounded-full bg-neutral-200/80 dark:bg-neutral-800/80 flex items-center w-full max-w-3xl border border-transparent hover:border-neutral-300 focus-within:border-neutral-400 hover:focus-within:border-neutral-400 dark:hover:border-neutral-700 dark:focus-within:border-neutral-600 dark:hover:focus-within:border-neutral-600"
        onSubmit={handleFormSubmit}
      >
        <input
          type="text"
          className="bg-transparent focus:outline-none p-4 w-full placeholder:text-neutral-600 dark:placeholder:text-neutral-400 text-white"
          required
          placeholder="Ask me anything"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          ref={inputRef}
        />

        <button
          type="submit"
          className="p-4 text-neutral-700 hover:text-black dark:text-neutral-300 dark:hover:text-white"
          disabled={isPending}
          aria-label="Submit"
        >
          {isPending ? <LoadingIcon /> : <EnterIcon />}
        </button>
      </form>

      <div className="text-neutral-300 dark:text-neutral-400 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
        {messages.length > 0 ? (
          <p>
            {messages.at(-1)?.content}
            <span className="text-xs font-mono text-neutral-300 dark:text-neutral-400">
              {" "}
              ({messages.at(-1)?.latency}ms)
            </span>
          </p>
        ) : (
          <p>
            An AI voice assistant with voice recognition
          </p>
        )}
        {vad.loading ? (
          <p>Loading speech detection...</p>
        ) : vad.errored ? (
          <p>Failed to load speech detection.</p>
        ) : (
          <p>{vad.userSpeaking ? "User is speaking" : "Start talking to chat"}</p>
        )}
      </div>
    </main>
  );
}

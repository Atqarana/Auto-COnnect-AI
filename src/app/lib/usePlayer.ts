import { useRef, useState } from "react";

export function usePlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);

  async function play(audioData: Buffer | Blob, callback: () => void) {
    stop();

    audioContext.current = new AudioContext({ sampleRate: 24000 });
    setIsPlaying(true);

    let arrayBuffer: ArrayBuffer;

    if (audioData instanceof Blob) {
      arrayBuffer = await audioData.arrayBuffer();
    } else {
      arrayBuffer = audioData.buffer.slice(
        audioData.byteOffset,
        audioData.byteOffset + audioData.byteLength
      );
    }

    const audioBufferDecoded = await audioContext.current.decodeAudioData(arrayBuffer);

    source.current = audioContext.current.createBufferSource();
    source.current.buffer = audioBufferDecoded;
    source.current.connect(audioContext.current.destination);
    source.current.start();

    source.current.onended = () => {
      stop();
      callback();
    };
  }

  function stop() {
    audioContext.current?.close();
    audioContext.current = null;
    setIsPlaying(false);
  }

  return {
    isPlaying,
    play,
    stop,
  };
}
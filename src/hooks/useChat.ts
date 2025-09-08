import { useRef, useState } from "react";

export function useChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const previousResponseIdRef = useRef<string | null>(null);

  async function send(
    message: string,
    onDelta: (chunk: string) => void,
    conversationId?: string | null
  ) {
    console.log('🌐 useChat.send called with:', { message, conversationId, previousResponseId: previousResponseIdRef.current });
    setIsStreaming(true);
    setError(null);

    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        previousResponseId: previousResponseIdRef.current,
        conversation_id: conversationId,
      }),
      headers: { "Content-Type": "application/json" },
    });

    console.log('📡 API response status:', res.status, res.ok);
    if (!res.ok || !res.body) {
      console.log('❌ API request failed:', res.status, res.statusText);
      setIsStreaming(false);
      setError("Network error");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    console.log('📖 Starting to read stream...');
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log('📖 Stream reading complete');
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      console.log('📥 Raw chunk received:', chunk);
      buffer += chunk;

      // Check for the sentinel with response_id
      const marker = buffer.indexOf("<<<response_id:");
      if (marker !== -1) {
        const end = buffer.indexOf(">>>", marker);
        if (end !== -1) {
          const id = buffer.slice(marker + 15, end).trim();
          previousResponseIdRef.current = id;

          // Remove sentinel from visible output
          buffer = buffer.slice(0, marker);
        }
      }

      // Send accumulated visible portion to UI and clear buffer.
      // Sending the buffer (instead of the raw chunk) avoids missing
      // content when chunk boundaries split tokens or sentinel markers.
      if (buffer.length > 0) {
        if (buffer.trim().length > 0) {
          console.log('📤 Sending to UI:', buffer);
          onDelta(buffer);
        } else {
          console.log('⚪ Ignoring empty/whitespace chunk');
        }
        buffer = "";
      }
    }

    setIsStreaming(false);
  }

  return {
    isStreaming,
    text,
    setText,
    error,
    send,
    previousResponseIdRef,
  };
}

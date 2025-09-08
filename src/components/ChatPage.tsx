"use client";
import { useChat } from "@/hooks/useChat";
import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
};

export default function ChatPage({ conversationId }: { conversationId?: string | null }) {
  const { send, isStreaming } = useChat();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // scroll to bottom smoothly
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function appendMessage(msg: Message) {
    setMessages((m) => [...m, msg]);
  }

  function updateLastAssistantChunk(id: string, chunk: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text: m.text + chunk } : m))
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text) return;

    const userMsg: Message = { id: String(Date.now()) + "-u", role: "user", text };
    appendMessage(userMsg);
    setInput("");

    const assistantId = String(Date.now()) + "-a";
    const assistantMsg: Message = { id: assistantId, role: "assistant", text: "" };
    appendMessage(assistantMsg);

    // Stream assistant deltas into the assistant message
    try {
      await send(
        text,
        (delta: string) => {
          updateLastAssistantChunk(assistantId, delta);
        },
        conversationId
      );
    } catch (e) {
      updateLastAssistantChunk(assistantId, "\n[Error receiving response]");
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[80vh] w-full md:w-2/3 mx-auto border rounded-md">
      <div className="px-4 py-2 border-b">
        <h2 className="text-lg font-semibold">Chat</h2>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-4 space-y-4 bg-white">
        {messages.length === 0 && (
          <div className="text-sm text-gray-500">No messages yet — say hello!</div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="flex flex-col">
            <div className="text-xs text-gray-400 mb-1">{m.role}</div>
            <div
              className={
                "max-w-[90%] p-3 rounded-lg " +
                (m.role === "user" ? "bg-blue-100 self-end text-black" : "bg-gray-100 text-black self-start")
              }
            >
              <pre className="whitespace-pre-wrap">{m.text}</pre>
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="text-sm text-gray-500">Assistant is typing...</div>
        )}
      </div>

      <div className="px-4 py-3 border-t bg-gray-50">
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded-md p-2 border resize-none h-20"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
          />
          <div className="flex flex-col justify-between">
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
              onClick={handleSend}
              disabled={isStreaming || input.trim() === ""}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

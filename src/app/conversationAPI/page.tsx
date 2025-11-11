'use client';

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { initialVoiceModel, voiceReducer } from '@/state/voiceReducer';
import { useChat } from '@/hooks/useChat';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { Mic, MicOff, Volume2 } from 'lucide-react';

type Message = { id: string; text: string; type: 'user' | 'assistant' };

export default function VoiceTest() {
  const [model, dispatch] = useReducer(voiceReducer, initialVoiceModel);

  // ASR hook
  const {
    state: asrState,
    interim,
    transcript,
    chunks,
    start,
    stop,
    pause,
    resume,
    clear: clearASR,
  } = useSpeechRecognition('en-US');

  // Messages and input
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserMsgId, setCurrentUserMsgId] = useState<string | null>(null);
  const lastLiveTextRef = useRef('');
  const [inputText, setInputText] = useState('');

  const [autoResumeAfterTTS, setAutoResumeAfterTTS] = useState(true);
  const speakingRef = useRef(false);
  const { send, isStreaming, previousResponseIdRef } = useChat();
  const conversationIdRef = useRef<string | null>(null);

  // Track previous chunks length to detect new final utterances
  const prevChunksLen = useRef(0);

  // Wire ASR hook outputs into the reducer so UI reflects interim/final
  useEffect(() => {
    // ASR started
    if (asrState === 'listening') dispatch({ type: 'ASR_STARTED' });
  }, [asrState]);

  useEffect(() => {
    // Interim updates
    if (interim) {
      dispatch({ type: 'ASR_INTERIM', text: interim });
      // Update live bubble text and keep it pinned
      if (currentUserMsgId) {
        lastLiveTextRef.current = interim;
        setMessages((prev) => prev.map((m) => (m.id === currentUserMsgId ? { ...m, text: interim } : m)));
      }
    }
  }, [interim]);

  useEffect(() => {
    // Detect new final chunks
    if (chunks.length > prevChunksLen.current) {
      const newChunks = chunks.slice(prevChunksLen.current);
      for (const c of newChunks) {
        dispatch({ type: 'ASR_FINAL', text: c });
        if (currentUserMsgId) {
          // Update live bubble with accumulated transcript so it doesn't disappear
          const next = ((model.ctx.transcript + ' ' + c).trim());
          lastLiveTextRef.current = next;
          setMessages((prev) => prev.map((m) => (m.id === currentUserMsgId ? { ...m, text: next } : m)));
        }
      }
    }
    prevChunksLen.current = chunks.length;
  }, [chunks]);

  // TTS helper that pauses ASR to avoid echo and optionally resumes
  const speakText = (text: string) => {
    if (!('speechSynthesis' in window) || speakingRef.current || !text) return;

    pause();
    speakingRef.current = true;
    dispatch({ type: 'TTS_BEGIN' });

    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => {
      speakingRef.current = false;
      dispatch({ type: 'TTS_END' });
      if (autoResumeAfterTTS) {
        resume();
      }
    };

    window.speechSynthesis.speak(utter);
  };

  // Handle sending user text to OpenAI via existing useChat
  const handleUserSubmit = async (text: string) => {
    if (!text || !text.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), text, type: 'user' };
    setMessages((p) => [...p, userMsg]);
    setInputText('');

    // add assistant placeholder
    const assistantId = `${Date.now()}-assistant`;
    setMessages((p) => [...p, { id: assistantId, text: '', type: 'assistant' }]);

    let full = '';
    try {
      await send(
        text,
        (delta: string) => {
          full += delta;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
        },
        conversationIdRef.current ?? undefined
      );

      // After stream completes, speak final
      if (full) speakText(full);
    } catch (err) {
      console.error('Chat error', err);
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: '\n[Error generating response]' } : m)));
    }
  };

  // When user stops listening, submit the accumulated transcript
  const handleStopListening = () => {
    stop();
    const finalText = (model.ctx.transcript || transcript || lastLiveTextRef.current || '').trim();
    if (finalText) {
      // Submit using existing live bubble
      const assistantId = `${Date.now()}-assistant`;
      if (currentUserMsgId) {
        setMessages((prev) => prev.map((m) => (m.id === currentUserMsgId ? { ...m, text: finalText } : m)));
      } else {
        const id = `${Date.now()}-user-live`;
        setMessages((p) => [...p, { id, text: finalText, type: 'user' }]);
      }
      setMessages((p) => [...p, { id: assistantId, text: '', type: 'assistant' }]);

      let full = '';
      send(
        finalText,
        (delta: string) => {
          full += delta;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
        },
        conversationIdRef.current ?? undefined
      )
        .then(() => {
          if (full) speakText(full);
        })
        .catch((err) => {
          console.error('Chat error', err);
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: '\n[Error generating response]' } : m)));
        })
        .finally(() => {
          setCurrentUserMsgId(null);
          lastLiveTextRef.current = '';
        });
    }
    dispatch({ type: 'USER_STOP' });
    clearASR();
    prevChunksLen.current = 0;
  };

  const handleStartListening = () => {
    dispatch({ type: 'USER_TAP_MIC' });
    start();
    const id = `${Date.now()}-user-live`;
    setMessages((p) => [...p, { id, text: '', type: 'user' }]);
    setCurrentUserMsgId(id);
    lastLiveTextRef.current = '';
  };

  const clearConversation = () => setMessages([]);

  return (
    <main className="p-6">
      <div className="flex flex-col gap-6">
        {model.ctx.blocked && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
            Microphone access is blocked. You can continue using the text box below, or enable mic access in your browser settings and reload.
          </div>
        )}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Voice Test</h1>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <MessageCircle className="h-4 w-4" />
            <Badge variant="outline">{model.state}</Badge>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-500">
            <MessageCircle className="h-4 w-4" />
            <span>Conversation</span>
            <Badge variant="outline" className="ml-auto">
              {model.state}
            </Badge>
          </div>

          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
            {messages.length === 0 ? (
              <p className="text-sm text-zinc-500">Say something or type a message to begin…</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.type === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-zinc-900 border dark:bg-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))
            )}

            {/* Live bubble is now part of messages and updated in place */}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              className="flex-1 rounded-md border px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type a message…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUserSubmit(inputText.trim());
              }}
            />
            <button
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => handleUserSubmit(inputText.trim())}
            >
              Send
            </button>

            {model.state !== 'listening' ? (
              <button
                className="rounded-md border px-2 py-2 dark:border-zinc-800"
                aria-label="Start listening"
                onClick={handleStartListening}
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="rounded-md border px-2 py-2 dark:border-zinc-800"
                aria-label="Stop listening"
                onClick={handleStopListening}
              >
                <MicOff className="h-4 w-4" />
              </button>
            )}

            <button
              className="rounded-md border px-2 py-2 dark:border-zinc-800"
              onClick={() => {
                const lastAssistant = [...messages].reverse().find((m) => m.type === 'assistant');
                if (lastAssistant) speakText(lastAssistant.text);
              }}
              aria-label="Play response"
            >
              <Volume2 className="h-4 w-4" />
            </button>

            <button className="rounded-md border px-2 py-2 dark:border-zinc-800" onClick={clearConversation}>
              Clear
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

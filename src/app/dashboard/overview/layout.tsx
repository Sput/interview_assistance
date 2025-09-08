'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useChat } from '@/hooks/useChat';

import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter
} from '@/components/ui/card';
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';

// ⬇️ From App.tsx
import { Mic, MicOff, Volume2, AlertCircle, MessageCircle } from 'lucide-react';

/* =========================
   Types from App.tsx
   ========================= */
interface Message {
  id: string;
  text: string;
  type: 'user' | 'assistant';
  timestamp: Date;
}
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

/* =========================
   Component
   ========================= */
export default function OverViewLayout({
  /* ...any props you had here... */
}: {
  // add prop types if you had them
}) {
  // ====== Existing Overview state/effects (keep yours) ======
  // (If you had finance data fetching, keep it here)
  useEffect(() => {
    const fetchFinanceData = async () => {
      try {
        // ... your original finance fetch logic ...
      } catch (error) {
        console.error('Error fetching finance data:', error);
      }
    };
    fetchFinanceData();
  }, []);

  // ====== Inlined App.tsx state ======
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isSupported, setIsSupported] = useState(true);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [inputText, setInputText] = useState('');
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ====== Inlined App.tsx effects & helpers ======
  useEffect(() => {
    // Check browser speech API availability (example)
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
      }
      if (finalText) setCurrentTranscript(finalText.trim());
      // If you want interim text, capture it here as well.
    };
    recognitionRef.current.onend = () => {
      if (voiceState === 'listening') {
        // auto-restart if desired
        recognitionRef.current?.start();
      }
    };
  }, [voiceState]);

  const startListening = () => {
    if (!recognitionRef.current) return;
    setVoiceState('listening');
    setCurrentTranscript('');
    recognitionRef.current.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setVoiceState('processing');
    // Simulate submit of transcript → generate response
    if (currentTranscript) {
      handleUserSubmit(currentTranscript);
    } else {
      setVoiceState('idle');
    }
  };

  const speakText = async (text: string) => {
    // Basic speech synthesis; replace with your TTS if you had one.
    const synth = window.speechSynthesis;
    if (!synth) return;
    setVoiceState('speaking');
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => setVoiceState('idle');
    synth.speak(utter);
  };

  const { send, isStreaming } = useChat();

  const generateResponse = async (userText: string) => {
    // Append assistant placeholder and stream deltas from the API
    const assistantId = `${Date.now()}-assistant`;
    const assistantMsg: Message = {
      id: assistantId,
      text: '',
      type: 'assistant',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    let fullText = '';
    try {
      await send(
        userText,
        (delta: string) => {
          fullText += delta;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m))
          );
        },
        conversationId
      );
      // speak the final accumulated text
      if (fullText) await speakText(fullText);
    } catch (err) {
      console.error('Error generating response:', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: '\n[Error generating response]' } : m
        )
      );
    }
  };

  const handleUserSubmit = (text: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      type: 'user',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setCurrentTranscript('');
    setVoiceState('processing');
    // Simulate async processing; replace with your App.tsx logic
    setTimeout(() => generateResponse(text), 400);
  };

  const handleSendClick = () => {
    if (!inputText.trim()) return;
    handleUserSubmit(inputText.trim());
  };

  const clearConversation = () => setMessages([]);

  // ====== Load conversation + messages from Supabase (if any) ======
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // fetch existing conversation for this user
        const convRes = await supabase
          .from('conversations')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        const convId = convRes.data?.id ?? null;
        if (!convId) return;
        setConversationId(convId);

        // fetch latest messages for the conversation
        const { data: msgs } = await supabase
          .from('messages')
          .select('id,role,content,created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true });

        if (!mounted || !msgs) return;

        const mapped: Message[] = (msgs as any[]).map((m) => ({
          id: m.id,
          text: m.content,
          type: m.role === 'assistant' ? 'assistant' : 'user',
          timestamp: new Date(m.created_at),
        }));

        setMessages(mapped);
      } catch (err) {
        console.error('Failed to load conversation/messages', err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  /* =========================
     Render
     ========================= */
  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        {/* ===== Existing Overview header ===== */}
        <h1 className="text-2xl font-bold">Overview</h1>

        {/* ===== Inlined App.tsx UI (simplified layout; drop into your design) ===== */}
        {!isSupported ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
            <AlertCircle className="h-5 w-5" />
            <p>Your browser does not support speech recognition.</p>
          </div>
        ) : null}

        {/* Conversation */}
        <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-500">
            <MessageCircle className="h-4 w-4" />
            <span>Conversation</span>
            <Badge variant="outline" className="ml-auto">
              {voiceState}
            </Badge>
          </div>

          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
            {messages.length === 0 ? (
              <p className="text-sm text-zinc-500">Say something or type a message to begin…</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${
                    m.type === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
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
            {voiceState === 'listening' && currentTranscript && (
              <div className="flex justify-end">
                <div className="max-w-[75%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white opacity-70">
                  {currentTranscript}
                </div>
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="mt-3 flex items-center gap-2">
            <input
              className="flex-1 rounded-md border px-3 py-2 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Type a message…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendClick();
              }}
            />
            <button
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={handleSendClick}
            >
              Send
            </button>
            {voiceState !== 'listening' ? (
              <button
                className="rounded-md border px-2 py-2 dark:border-zinc-800"
                aria-label="Start listening"
                onClick={startListening}
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="rounded-md border px-2 py-2 dark:border-zinc-800"
                aria-label="Stop listening"
                onClick={stopListening}
              >
                <MicOff className="h-4 w-4" />
              </button>
            )}
            <button
              className="rounded-md border px-2 py-2 dark:border-zinc-800"
              onClick={() => {
                // Instead of generating a new assistant response (which produced
                // an unnecessary second reply), play the last assistant message
                // if available.
                const lastAssistant = [...messages].reverse().find((m) => m.type === 'assistant');
                if (lastAssistant) speakText(lastAssistant.text);
              }}
              aria-label="Play response"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            <button
              className="rounded-md border px-2 py-2 dark:border-zinc-800"
              onClick={clearConversation}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

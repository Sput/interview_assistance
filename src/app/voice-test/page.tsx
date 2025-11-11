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
    start,
    stop,
    pause,
    resume,
    isRunning,
  } = useSpeechRecognition(dispatch, 'en-US');

  // Messages and input
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentUserMsgId, setCurrentUserMsgId] = useState<string | null>(null);
  const lastLiveTextRef = useRef('');

  const [autoResumeAfterTTS, setAutoResumeAfterTTS] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [conversationActive, setConversationActive] = useState(true);
  const speakingRef = useRef(false);
  const conversationActiveRef = useRef(true);
  const { send, isStreaming, previousResponseIdRef } = useChat();
  const conversationIdRef = useRef<string | null>(null);

  // Track previous chunks length (kept for potential future use)
  const prevChunksLen = useRef(0);
  const awaitingFinalRef = useRef(false);
  const endFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TTS helper that pauses ASR to avoid echo and optionally resumes
  const speakText = (text: string) => {
    console.log('🔊 speakText called with:', text);
    if (!('speechSynthesis' in window)) {
      console.log('❌ Speech synthesis not supported');
      return;
    }
    if (speakingRef.current) {
      console.log('⚠️ Already speaking, skipping');
      return;
    }
    if (!text) {
      console.log('⚠️ No text to speak');
      return;
    }

    console.log('🔇 Pausing ASR for TTS');
    pause();
    speakingRef.current = true;
    dispatch({ type: 'TTS_BEGIN' });

    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => {
      console.log('🔊 TTS completed');
      speakingRef.current = false;
      dispatch({ type: 'TTS_END' });
      if (autoResumeAfterTTS && conversationActiveRef.current) {
        console.log('🔄 Auto-resuming ASR after TTS');
        resume();
      }
    };

    console.log('🔊 Starting speech synthesis');
    window.speechSynthesis.speak(utter);
  };

  // Handle sending user text to OpenAI via existing useChat
  const handleUserSubmit = async (text: string) => {
    console.log('🚀 Starting handleUserSubmit with text:', text);
    if (!text || !text.trim()) {
      console.log('❌ No text to submit');
      return;
    }

    console.log('📤 Adding user message to UI');
    const userMsg: Message = { id: Date.now().toString(), text, type: 'user' };
    setMessages((p) => [...p, userMsg]);
    setInputText('');

    console.log('🤖 Adding assistant placeholder');
    const assistantId = `${Date.now()}-assistant`;
    setMessages((p) => [...p, { id: assistantId, text: '', type: 'assistant' }]);

    let full = '';
    try {
      // Indicate we are processing a response
      dispatch({ type: 'PROCESS_BEGIN' });
      console.log('🌐 Calling OpenAI API...');
      await send(
        text,
        (delta: string) => {
          console.log('📥 Received delta:', delta);
          full += delta;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
        },
        conversationIdRef.current ?? undefined
      );

      console.log('✅ OpenAI response complete. Full response:', full);
      // After stream completes, speak final
      if (full) {
        console.log('🔊 Starting TTS for response');
        speakText(full);
      } else {
        console.log('⚠️ No response to speak');
      }
    } catch (err) {
      console.error('❌ Chat error:', err);
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: '\n[Error generating response]' } : m)));
      // Clear processing state on error
      dispatch({ type: 'USER_STOP' });
      return;
    } finally {
      // If not auto-resuming after TTS, conversation is inactive, or no content was returned, reset to idle
      if (!autoResumeAfterTTS || !conversationActiveRef.current || !full) {
        dispatch({ type: 'USER_STOP' });
      }
    }
  };

  // Submit using the existing live user bubble (do not create a new one)
  const submitFromLiveBubble = async (finalText: string) => {
    const text = finalText.trim();
    if (!text) return;
    if (currentUserMsgId) {
      setMessages((prev) => prev.map((m) => (m.id === currentUserMsgId ? { ...m, text } : m)));
    }
    const assistantId = `${Date.now()}-assistant`;
    setMessages((p) => [...p, { id: assistantId, text: '', type: 'assistant' }]);

    let full = '';
    try {
      dispatch({ type: 'PROCESS_BEGIN' });
      await send(
        text,
        (delta: string) => {
          full += delta;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
        },
        conversationIdRef.current ?? undefined
      );
      if (full) speakText(full);
    } catch (err) {
      console.error('❌ Chat error:', err);
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: '\n[Error generating response]' } : m)));
      dispatch({ type: 'USER_STOP' });
      return;
    } finally {
      if (!autoResumeAfterTTS || !conversationActiveRef.current || !full) {
        dispatch({ type: 'USER_STOP' });
      }
      setCurrentUserMsgId(null);
      lastLiveTextRef.current = '';
    }
  };

  // When user stops listening, submit the accumulated transcript
  const handleStopListening = () => {
    console.log('🎤 User stopped listening');
    stop();
    setIsListening(false);
    // We need to wait a tick for Chrome to deliver the final result
    awaitingFinalRef.current = true;
    if (endFallbackTimerRef.current) clearTimeout(endFallbackTimerRef.current);
    endFallbackTimerRef.current = setTimeout(() => {
      if (!awaitingFinalRef.current) return; // already handled by final event
      const fallback = (model.ctx.transcript || lastLiveTextRef.current || '').trim();
      console.log('⏱️ Fallback submit with transcript:', fallback);
      if (fallback) {
        submitFromLiveBubble(fallback);
      } else {
        console.log('⚠️ No transcript available after timeout; resetting to idle');
        dispatch({ type: 'USER_STOP' });
      }
      awaitingFinalRef.current = false;
    }, 600);
    prevChunksLen.current = 0;
  };

  const handleStartListening = () => {
    console.log('🎤 User started listening');
    dispatch({ type: 'USER_TAP_MIC' });
    start();
    setIsListening(true);
    setConversationActive(true);
    conversationActiveRef.current = true;
    // Create or reuse a live user bubble
    const id = `${Date.now()}-user-live`;
    setMessages((p) => [...p, { id, text: '', type: 'user' }]);
    setCurrentUserMsgId(id);
    lastLiveTextRef.current = '';
  };

  // Auto-resume listening after TTS completes (only if auto-resume is enabled)
  useEffect(() => {
    if (model.state === 'idle' && autoResumeAfterTTS && messages.length > 0 && !isListening) {
      const timer = setTimeout(() => {
        if (conversationActive) handleStartListening();
      }, 1000); // Wait 1 second after TTS ends
      return () => clearTimeout(timer);
    }
  }, [model.state, autoResumeAfterTTS, messages.length, isListening, conversationActive]);

  // Removed: auto-submit on ASR final. Submission now happens only when the user presses the button.

  // When a final transcript arrives after we pressed End response, submit it
  useEffect(() => {
    if (!awaitingFinalRef.current) return;
    const finalText = (model.ctx.transcript || '').trim();
    if (!finalText) return;
    console.log('✅ Final transcript arrived post-stop:', finalText);
    awaitingFinalRef.current = false;
    if (endFallbackTimerRef.current) {
      clearTimeout(endFallbackTimerRef.current);
      endFallbackTimerRef.current = null;
    }
    submitFromLiveBubble(finalText);
  }, [model.ctx.transcript]);

  // Keep the live bubble text pinned during pauses
  useEffect(() => {
    if (!isListening || !currentUserMsgId) return;
    const live = (model.ctx.interim || model.ctx.transcript || '').trim();
    if (!live) return; // don't clear on silence
    lastLiveTextRef.current = live;
    setMessages((prev) => prev.map((m) => (m.id === currentUserMsgId ? { ...m, text: live } : m)));
  }, [model.ctx.interim, model.ctx.transcript, isListening, currentUserMsgId]);

  const clearConversation = () => {
    setMessages([]);
    setCurrentUserMsgId(null);
    lastLiveTextRef.current = '';
  };

  const handleEndConversation = () => {
    console.log('🛑 Ending conversation');
    stop();
    setIsListening(false);
    setConversationActive(false);
    conversationActiveRef.current = false;
    dispatch({ type: 'USER_STOP' });
    prevChunksLen.current = 0;
    setCurrentUserMsgId(null);
    lastLiveTextRef.current = '';
  };

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
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoResumeAfterTTS}
                onChange={(e) => setAutoResumeAfterTTS(e.target.checked)}
                className="rounded"
              />
              Auto-resume listening
            </label>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <MessageCircle className="h-4 w-4" />
              <Badge variant="outline">{model.state}</Badge>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-500">
            <MessageCircle className="h-4 w-4" />
            <span>Conversation</span>
            <Badge 
              variant="outline" 
              className={`ml-auto ${
                model.state === 'listening' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                model.state === 'speaking' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                model.state === 'processing' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
              }`}
            >
              {model.state === 'listening' ? 'Listening...' :
               model.state === 'speaking' ? 'Speaking...' :
               model.state === 'processing' ? 'Processing...' :
               'Ready'}
            </Badge>
          </div>

          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
            {messages.length === 0 ? (
              <p className="text-sm text-zinc-500">Click the microphone button to start speaking, or type a message below…</p>
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

            {!isListening && (
              <button
                className="rounded-md border px-2 py-2 dark:border-zinc-800"
                aria-label="Start listening"
                onClick={handleStartListening}
                disabled={model.state === 'speaking' || model.state === 'processing'}
                title="Start listening"
              >
                <Mic className="h-4 w-4" />
              </button>
            )}

            {isListening && (
              <button
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                onClick={handleStopListening}
                aria-label="End response"
                title="End response"
              >
                End response
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

            <button
              className="rounded-md border px-2 py-2 dark:border-zinc-800"
              onClick={handleEndConversation}
              aria-label="End conversation"
            >
              End
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

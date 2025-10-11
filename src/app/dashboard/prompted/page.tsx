'use client';

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { initialVoiceModel, voiceReducer } from '@/state/voiceReducer';
// import { useChat } from '@/hooks/useChat';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { createClient } from '@/lib/supabase';

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

  const [autoResumeAfterTTS, setAutoResumeAfterTTS] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [conversationActive, setConversationActive] = useState(true);
  const speakingRef = useRef(false);
  const conversationActiveRef = useRef(true);
  const conversationIdRef = useRef<string | null>(null);
  const chatPrevResponseIdRef = useRef<string | null>(null);
  const lastQuestionIdRef = useRef<number | null>(null);
  const lastAnswerIdRef = useRef<number | null>(null);

  // Local sender that uses chat_completions via our /api/chat route
  async function sendWithChatCompletions(
    message: string,
    onDelta: (chunk: string) => void,
    conversationId?: string | null
  ) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        previousResponseId: chatPrevResponseIdRef.current,
        conversation_id: conversationId,
        mode: 'chat_completions',
      }),
    });

    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const marker = buffer.indexOf('<<<response_id:');
      if (marker !== -1) {
        const end = buffer.indexOf('>>>', marker);
        if (end !== -1) {
          const id = buffer.slice(marker + 15, end).trim();
          chatPrevResponseIdRef.current = id;
          buffer = buffer.slice(0, marker);
        }
      }

      if (buffer.trim().length > 0) {
        onDelta(buffer);
        buffer = '';
      } else {
        buffer = '';
      }
    }
  }

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
      await sendWithChatCompletions(
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

  // Fetch a question from Supabase and ask it
  const askInterviewQuestion = async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('questions_table')
        .select('id, interview_question')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching interview question:', {
          message: (error as any)?.message,
          code: (error as any)?.code,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-iq-error`,
            text:
              'Unable to fetch an interview question. Please ensure the table has data and the anon role has a SELECT policy.',
            type: 'assistant',
          },
        ]);
        return;
      }

      if (!data) {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-iq-empty`,
            text: 'No questions found in questions_table.',
            type: 'assistant',
          },
        ]);
        return;
      }

      const question = data.interview_question?.trim();
      if (!question) {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-iq-badrow`,
            text: 'Fetched a question row, but it had no text.',
            type: 'assistant',
          },
        ]);
        return;
      }

      // Track the last asked question id
      lastQuestionIdRef.current = (data as any).id ?? null;

      // Also create a new answers_table row now, capturing the generated id for later update
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;

        if (!userId) {
          console.warn('No logged-in user; cannot pre-create answers_table row (user_id required).');
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-no-user`,
              text: 'You are not logged in. Your answer may not be saved.',
              type: 'assistant',
            },
          ]);
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from('answers_table')
            .insert({ user_id: userId, question_id: (data as any).id })
            .select('id')
            .single();

          if (insertError) {
            console.error('Failed to pre-create answers_table row:', {
              message: (insertError as any)?.message,
              code: (insertError as any)?.code,
              details: (insertError as any)?.details,
              hint: (insertError as any)?.hint,
            });
          } else {
            lastAnswerIdRef.current = (inserted as any)?.id ?? null;
            console.log('Pre-created answers_table row with id:', lastAnswerIdRef.current);
          }
        }
      } catch (preErr) {
        console.error('Unexpected error pre-creating answers_table row:', preErr);
      }

      const assistantMsg: Message = {
        id: `${Date.now()}-iq`,
        text: question,
        type: 'assistant',
      };
      setMessages((prev) => [...prev, assistantMsg]);
      speakText(question);
    } catch (e: any) {
      console.error('Unexpected error fetching question:', e?.message || e);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-iq-unexpected`,
          text: 'Unexpected error while fetching a question. See console for details.',
          type: 'assistant',
        },
      ]);
    }
  };

  // Save the user's answer to Supabase answers_table
  const saveAnswerToDB = async (answerText: string) => {
    try {
      const questionId = lastQuestionIdRef.current;
      if (!questionId) {
        console.warn('No questionId available; not saving answer.');
        return;
      }
      const supabase = createClient();
      // Try to get the user id if logged in
      let userId: string | undefined = undefined;
      try {
        const { data: userData } = await supabase.auth.getUser();
        userId = userData?.user?.id;
      } catch (_) {}

      // If we pre-created an answers_table row, update it; else insert a new one (fallback)
      if (lastAnswerIdRef.current) {
        const query = supabase
          .from('answers_table')
          .update({ answer_text: answerText })
          .eq('id', lastAnswerIdRef.current);

        const { error: updateError } = await query;
        if (updateError) {
          console.error('Failed to update pre-created answer row:', {
            message: (updateError as any)?.message,
            code: (updateError as any)?.code,
            details: (updateError as any)?.details,
            hint: (updateError as any)?.hint,
          });
        } else {
          console.log('Updated pre-created answer row successfully.');
          // Fire edge function for vectorization (best-effort)
          try {
            await supabase.functions.invoke('answer_vectors', {
              body: {
                answer_id: lastAnswerIdRef.current,
                question_id: questionId,
                user_id: userId,
              },
            });
          } catch (fnErr) {
            console.error('answer_vectors invocation failed (update path):', fnErr);
          }
          // Clear reference so subsequent answers don’t overwrite the same row
          lastAnswerIdRef.current = null;
        }
      } else {
        const payload: any = {
          question_id: questionId,
          answer_text: answerText,
        };
        if (userId) payload.user_id = userId;

        const { data: insertedRow, error } = await supabase
          .from('answers_table')
          .insert(payload)
          .select('id')
          .single();
        if (error) {
          console.error('Failed to insert answer:', {
            message: (error as any)?.message,
            code: (error as any)?.code,
            details: (error as any)?.details,
            hint: (error as any)?.hint,
          });
        } else {
          console.log('Answer inserted successfully (no pre-created row).');
          // Fire edge function for vectorization (best-effort)
          try {
            await supabase.functions.invoke('answer_vectors', {
              body: {
                answer_id: (insertedRow as any)?.id,
                question_id: questionId,
                user_id: userId,
              },
            });
          } catch (fnErr) {
            console.error('answer_vectors invocation failed (insert path):', fnErr);
          }
        }
      }
    } catch (e) {
      console.error('Unexpected error saving answer:', e);
    }
  };

  // Ask only when user clicks the button (no auto-ask on mount)

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
      const fallback = (model.ctx.transcript || '').trim();
      console.log('⏱️ Fallback submit with transcript:', fallback);
      if (fallback) {
        // Save answer then submit to the model
        saveAnswerToDB(fallback);
        handleUserSubmit(fallback);
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
    // Save answer then submit to the model
    saveAnswerToDB(finalText);
    handleUserSubmit(finalText);
  }, [model.ctx.transcript]);

  const clearConversation = () => setMessages([]);

  const handleEndConversation = () => {
    console.log('🛑 Ending conversation');
    stop();
    setIsListening(false);
    setConversationActive(false);
    conversationActiveRef.current = false;
    dispatch({ type: 'USER_STOP' });
    prevChunksLen.current = 0;
  };

  return (
    <main className="p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Prompted</h1>
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

            {/* Interim bubble while listening */}
            {model.state === 'listening' && model.ctx.interim && (
              <div className="flex justify-end">
                <div className="max-w-[75%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white opacity-80">
                  {model.ctx.interim}
                </div>
              </div>
            )}
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

            <button
              className="rounded-md border px-3 py-2 text-sm dark:border-zinc-800"
              onClick={askInterviewQuestion}
            >
              Ask Interview Question
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

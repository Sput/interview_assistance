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
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [inputText, setInputText] = useState('');
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

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

  // Load categories from DB and set default selection
  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;
    async function loadCategories() {
      console.log('[prompted] Loading categories…');
      setLoadingCategories(true);
      const { data, error } = await supabase
        .from('question_categories')
        .select('id, category_name')
        .order('category_name', { ascending: true });
      if (!isMounted) return;
      if (error) {
        console.error('[prompted] Failed to load categories:', error);
      }
      if (!error && data) {
        console.log('[prompted] Raw categories:', data);
        const mapped = (data as any[])
          .map((r) => ({ id: r.id as number, name: (r as any).category_name as string }))
          .filter((r) => r.name);
        console.log('[prompted] Mapped categories:', mapped);
        setCategories(mapped);
        // If nothing selected yet, choose first
        if (!selectedCategoryId && mapped.length > 0) {
          console.log('[prompted] No selectedCategoryId, defaulting to first:', mapped[0]);
          setSelectedCategoryId(String(mapped[0].id));
        }
      }
      setLoadingCategories(false);
      console.log('[prompted] Finished loading categories');
    }
    loadCategories();
    // Refresh on external changes from the manager component
    const onChanged = () => loadCategories();
    window.addEventListener('question-categories-changed', onChanged);
    return () => {
      isMounted = false;
      window.removeEventListener('question-categories-changed', onChanged);
    };
  }, []);

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

  // New: Treat submitted text as an interview answer only (no general chat)
  const processSubmittedAnswer = async (text: string) => {
    const answer = text.trim();
    if (!answer) return;
    // Show user's answer bubble
    const userMsg: Message = { id: Date.now().toString(), text: answer, type: 'user' };
    setMessages((p) => [...p, userMsg]);
    setInputText('');
    // Save and trigger grading/feedback loop (handled downstream in saveAnswerToDB)
    await saveAnswerToDB(answer);
  };

  // Fetch a question from Supabase and ask it
  const askInterviewQuestion = async () => {
    try {
      const supabase = createClient();
      // Identify current user to avoid their recent questions
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      console.log('[prompted] askInterviewQuestion: selectedCategoryId=', selectedCategoryId);
      const selectedCategoryName = selectedCategoryId
        ? categories.find((c) => String(c.id) === String(selectedCategoryId))?.name ?? null
        : null;
      console.log('[prompted] askInterviewQuestion: selectedCategoryName=', selectedCategoryName);
      const lastId = lastQuestionIdRef.current;

      // Fetch recent question_ids answered/asked by this user to avoid repeats
      let recentIds: number[] = [];
      if (userId) {
        const { data: recentRows, error: recentErr } = await supabase
          .from('answers_table')
          .select('question_id')
          .eq('user_id', userId)
          .order('id', { ascending: false })
          .limit(5);
        if (!recentErr && recentRows) {
          recentIds = (recentRows as any[])
            .map((r) => r?.question_id)
            .filter((id: any) => typeof id === 'number');
        }
        if (recentErr) {
          console.warn('[prompted] recentIds error:', recentErr);
        }
      }
      console.log('[prompted] recentIds=', recentIds);

      // First get eligible row count to pick a random offset (excluding recent)
      const categoryId = selectedCategoryId ? Number(selectedCategoryId) : null;
      let count: number | null = null;
      let ignoreRecent = false;
      if (recentIds.length > 0) {
        let q = supabase.from('questions_table').select('*', { count: 'exact', head: true });
        if (categoryId !== null) q = q.eq('category_id', categoryId);
        q = q.not('id', 'in', `(${recentIds.join(',')})`);
        if (lastId) q = (q as any).neq('id', lastId);
        console.log('[prompted] Count query (with recent filter), by category_id:', { categoryId });
        let { count: c1, error: err1 } = await (q as any);
        console.log('[prompted] Count result:', { c1, err1 });
        // Fallback to legacy string category if error or zero count but legacy text exists
        if ((err1 || (c1 ?? 0) === 0) && categoryId !== null && selectedCategoryName) {
          // Fallback to legacy text category if RLS/schema mismatch
          let q2 = supabase.from('questions_table').select('*', { count: 'exact', head: true }).eq('category', selectedCategoryName);
          q2 = q2.not('id', 'in', `(${recentIds.join(',')})`);
          if (lastId) q2 = (q2 as any).neq('id', lastId);
          console.log('[prompted] Count fallback by legacy category:', selectedCategoryName);
          const r2 = await (q2 as any);
          c1 = r2.count as number | null;
          err1 = r2.error;
          console.log('[prompted] Count fallback result:', { c1, err1 });
        }
        if (!err1) count = c1 ?? 0;

        // If still zero, try ignoring recent filter entirely for this category
        if ((count ?? 0) === 0) {
          console.log('[prompted] Zero eligible with recent filter; trying without recent filter…');
          let q3 = supabase.from('questions_table').select('*', { count: 'exact', head: true });
          if (categoryId !== null) q3 = q3.eq('category_id', categoryId);
          if (lastId) q3 = (q3 as any).neq('id', lastId);
          let { count: c3, error: err3 } = await (q3 as any);
          console.log('[prompted] Count without recent (by category_id) result:', { c3, err3 });
          if ((err3 || (c3 ?? 0) === 0) && categoryId !== null && selectedCategoryName) {
            const q4 = supabase.from('questions_table').select('*', { count: 'exact', head: true }).eq('category', selectedCategoryName);
            let _q4: any = q4;
            if (lastId) _q4 = _q4.neq('id', lastId);
            const r4 = await (_q4 as any);
            c3 = r4.count as number | null;
            console.log('[prompted] Count without recent (legacy category) result:', { c3, err: r4.error });
          }
          if ((c3 ?? 0) > 0) {
            count = c3 ?? 0;
            ignoreRecent = true;
            console.log('[prompted] Will ignore recent filter for this pick.');
          }
        }
      } else {
        let q = supabase.from('questions_table').select('*', { count: 'exact', head: true });
        if (categoryId !== null) q = q.eq('category_id', categoryId);
        if (lastId) q = (q as any).neq('id', lastId);
        console.log('[prompted] Count query (no recent filter), by category_id:', { categoryId });
        let { count: c2, error: err2 } = await (q as any);
        console.log('[prompted] Count result:', { c2, err2 });
        if ((err2 || (c2 ?? 0) === 0) && categoryId !== null && selectedCategoryName) {
          const q2 = supabase.from('questions_table').select('*', { count: 'exact', head: true }).eq('category', selectedCategoryName);
          let _q2: any = q2;
          if (lastId) _q2 = _q2.neq('id', lastId);
          console.log('[prompted] Count fallback by legacy category (no recent):', selectedCategoryName);
          const r2 = await (_q2 as any);
          c2 = r2.count as number | null;
          err2 = r2.error;
          console.log('[prompted] Count fallback result (no recent):', { c2, err2 });
        }
        if (!err2) count = c2 ?? 0;
      }

      if (count === null) {
        console.error('Error fetching interview question:', {
          message: 'Unable to determine question count',
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

      console.log('[prompted] Eligible count:', count);
      if (!count || count <= 0) {
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

      const randomOffset = Math.floor(Math.random() * count);
      console.log('[prompted] Random offset:', randomOffset);
      let rows: any[] | null = null;
      let fetchError: any = null;
      if (recentIds.length > 0 && !ignoreRecent) {
        let q = supabase
          .from('questions_table')
          .select('id, interview_question')
          .order('id', { ascending: true })
          .not('id', 'in', `(${recentIds.join(',')})`);
        if (categoryId !== null) q = q.eq('category_id', categoryId);
        if (lastId) q = (q as any).neq('id', lastId);
        console.log('[prompted] Fetch query (with recent), by category_id:', { categoryId });
        let { data, error } = await (q as any).range(randomOffset, randomOffset);
        console.log('[prompted] Fetch result:', { len: data?.length ?? 0, error });
        if ((error || !data || data.length === 0) && categoryId !== null && selectedCategoryName) {
          let q2 = supabase
            .from('questions_table')
            .select('id, interview_question')
            .order('id', { ascending: true })
            .eq('category', selectedCategoryName)
            .not('id', 'in', `(${recentIds.join(',')})`);
          if (lastId) q2 = (q2 as any).neq('id', lastId);
          console.log('[prompted] Fetch fallback by legacy category (with recent):', selectedCategoryName);
          const r2 = await (q2 as any).range(randomOffset, randomOffset);
          data = r2.data as any[] | null;
          error = r2.error;
          console.log('[prompted] Fetch fallback result (with recent):', { len: data?.length ?? 0, error });
        }
        rows = data as any[] | null;
        fetchError = error;
      } else {
        let q = supabase
          .from('questions_table')
          .select('id, interview_question')
          .order('id', { ascending: true });
        if (categoryId !== null) q = q.eq('category_id', categoryId);
        if (lastId) q = (q as any).neq('id', lastId);
        console.log('[prompted] Fetch query (no recent), by category_id:', { categoryId });
        let { data, error } = await (q as any).range(randomOffset, randomOffset);
        console.log('[prompted] Fetch result (no recent):', { len: data?.length ?? 0, error });
        if ((error || !data || data.length === 0) && categoryId !== null && selectedCategoryName) {
          const q2 = supabase
            .from('questions_table')
            .select('id, interview_question')
            .order('id', { ascending: true })
            .eq('category', selectedCategoryName);
          let _q2: any = q2;
          if (lastId) _q2 = _q2.neq('id', lastId);
          console.log('[prompted] Fetch fallback by legacy category (no recent):', selectedCategoryName);
          const r2 = await (_q2 as any).range(randomOffset, randomOffset);
          data = r2.data as any[] | null;
          error = r2.error;
          console.log('[prompted] Fetch fallback result (no recent):', { len: data?.length ?? 0, error });
        }
        rows = data as any[] | null;
        fetchError = error;
      }

      // If filtering left us empty (e.g., all recent), fall back to full pool
      if ((!rows || rows.length === 0) && recentIds.length > 0) {
        let q = supabase
          .from('questions_table')
          .select('id, interview_question')
          .order('id', { ascending: true });
        if (categoryId !== null) q = q.eq('category_id', categoryId);
        if (lastId) q = (q as any).neq('id', lastId);
        console.log('[prompted] Fallback fetch to full pool (still by category_id if present):', { categoryId });
        let { data, error } = await (q as any).range(randomOffset, randomOffset);
        console.log('[prompted] Fallback full-pool fetch result:', { len: data?.length ?? 0, error });
        if ((error || !data || data.length === 0) && categoryId !== null && selectedCategoryName) {
          const q2 = supabase
            .from('questions_table')
            .select('id, interview_question')
            .order('id', { ascending: true })
            .eq('category', selectedCategoryName);
          let _q2b: any = q2;
          if (lastId) _q2b = _q2b.neq('id', lastId);
          console.log('[prompted] Fallback full-pool by legacy category:', selectedCategoryName);
          const r2 = await (_q2b as any).range(randomOffset, randomOffset);
          data = r2.data as any[] | null;
          error = r2.error;
          console.log('[prompted] Fallback full-pool legacy result:', { len: data?.length ?? 0, error });
        }
        rows = data as any[] | null;
        fetchError = error;
      }

      if (fetchError || !rows || rows.length === 0) {
        console.error('Error fetching random interview question:', fetchError);
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-iq-fetch-error`,
            text: 'Unable to fetch a random interview question. Please try again.',
            type: 'assistant',
          },
        ]);
        return;
      }

      const row: any = rows[0];
      const question = row.interview_question?.trim();
      console.log('[prompted] Selected row:', row);
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
      lastQuestionIdRef.current = row.id ?? null;

      // Best-effort: ensure the question has an embedding generated
      try {
        const supabase = createClient();
        const { data: sess } = await supabase.auth.getSession();
        const authHeader = sess?.session?.access_token
          ? { Authorization: `Bearer ${sess.session.access_token}` }
          : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
              ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }
              : {});
        const { error: vecErr } = await supabase.functions.invoke('make_vectors', {
          headers: authHeader,
          body: { question_id: row.id },
        });
        if (vecErr) {
          console.warn('make_vectors invocation failed (question path):', vecErr);
        }
      } catch (makeVecErr) {
        console.warn('make_vectors invocation threw (question path):', makeVecErr);
      }

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
            .insert({ user_id: userId, question_id: row.id })
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
    const MIN_CHARS = 300;
    // Helper to trigger cosine similarity grading via Supabase Edge Function
    const runCosineSimilarity = async () => {
      try {
        const supabase = createClient();
        const { data: sess } = await supabase.auth.getSession();
        const authHeader = sess?.session?.access_token
          ? { Authorization: `Bearer ${sess.session.access_token}` }
          : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
              ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }
              : {});
        const { error } = await supabase.functions.invoke('calc_cos_similarity', {
          headers: authHeader,
          body: {},
        });
        if (error) {
          console.error('Failed to invoke calc_cos_similarity function:', error);
        }
      } catch (e) {
        console.error('Error invoking calc_cos_similarity function:', e);
      }
    };

    // Poll for the grade of a specific answer and, if < 60, provide feedback and re-ask
    const handlePostGrade = async (
      answerId: number,
      questionId: number,
      userAnswer: string
    ) => {
      const supabase = createClient();
      const maxAttempts = 20;
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

      let grade: number | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Occasionally re-run the script in case embeddings were late
        if (attempt === 0 || attempt === 5 || attempt === 10) {
          runCosineSimilarity();
        }
        const { data, error } = await supabase
          .from('answers_table')
          .select('grade')
          .eq('id', answerId)
          .maybeSingle();

        if (!error && data && data.grade !== null && data.grade !== undefined) {
          grade = data.grade as unknown as number;
          break;
        }
        await delay(1000);
      }

      if (grade === null) {
        console.warn('No grade available after polling; skipping feedback loop for now.');
        return;
      }

      console.log(`Grade for answer ${answerId}:`, grade);
      // Update the UI card with the latest score
      try { setCurrentScore(grade); } catch {}
      if (grade < 60) {
        // Fetch the question text and model answer
        const { data: q, error: qErr } = await supabase
          .from('questions_table')
          .select('interview_question, model_answer')
          .eq('id', questionId)
          .maybeSingle();
        if (qErr || !q) {
          console.error('Failed to fetch question/model answer for feedback:', qErr);
          return;
        }

        const prompt = `A user was asked this: "${q.interview_question}" and responded with: "${userAnswer}". The model answer was: "${q.model_answer ?? ''}". Give the user information that will help them make a better answer.`;

        // Stream feedback to the UI
        const feedbackId = `${Date.now()}-feedback`;
        setMessages((p) => [...p, { id: feedbackId, text: '', type: 'assistant' }]);
        let feedbackFull = '';
        try {
          await sendWithChatCompletions(
            prompt,
            (delta: string) => {
              feedbackFull += delta;
              setMessages((prev) => prev.map((m) => (m.id === feedbackId ? { ...m, text: m.text + delta } : m)));
            },
            conversationIdRef.current ?? undefined
          );
        } catch (err) {
          console.error('Error generating feedback:', err);
        }

        // After feedback, re-ask the same question and resume listening
        const questionAgain = q.interview_question?.trim();
        if (questionAgain) {
          const assistantMsg = { id: `${Date.now()}-iq-repeat`, text: questionAgain, type: 'assistant' as const };
          setMessages((prev) => [...prev, assistantMsg]);
          speakText(questionAgain);
          // Auto-resume will kick in after TTS if enabled; ensure conversation remains active
          setConversationActive(true);
          conversationActiveRef.current = true;
        }
      } else {
        // Success path: congratulate and end the loop (no re-ask)
        const successMsg = `Great job! Your score is ${grade}. You can move on to the next question when ready.`;
        setMessages((p) => [
          ...p,
          { id: `${Date.now()}-success`, text: successMsg, type: 'assistant' },
        ]);
        speakText(successMsg);
      }
    };

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
        const currentAnswerId = lastAnswerIdRef.current;
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
          // If answer is too short, auto-grade as 0 and skip cosine similarity
          if (answerText.trim().length < MIN_CHARS) {
            console.log(`Answer length < ${MIN_CHARS}. Auto-grading 0 for answer_id=${currentAnswerId}`);
            const { error: gradeErr } = await supabase
              .from('answers_table')
              .update({ grade: 0 })
              .eq('id', currentAnswerId);
            if (gradeErr) {
              console.error('Failed to set short-answer grade:', gradeErr);
            }
          } else {
            // Fire edge function for vectorization (best-effort)
            try {
              const { data: sess } = await supabase.auth.getSession();
              const authHeader = sess?.session?.access_token
                ? { Authorization: `Bearer ${sess.session.access_token}` }
                : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                    ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }
                    : {});
              await supabase.functions.invoke('answer_vectors', {
                headers: authHeader,
                body: {
                  answer_id: lastAnswerIdRef.current,
                  question_id: questionId,
                  user_id: userId,
                },
              });
            } catch (fnErr) {
              console.error('answer_vectors invocation failed (update path):', fnErr);
            }
            // Best-effort: run cosine similarity grading script
            runCosineSimilarity();
          }
          // Begin post-grade flow for feedback/looping
          handlePostGrade(currentAnswerId as unknown as number, questionId as unknown as number, answerText);
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
          const newId = (insertedRow as any)?.id;
          if (answerText.trim().length < MIN_CHARS && newId) {
            console.log(`Answer length < ${MIN_CHARS}. Auto-grading 0 for answer_id=${newId}`);
            const { error: gradeErr } = await supabase
              .from('answers_table')
              .update({ grade: 0 })
              .eq('id', newId);
            if (gradeErr) {
              console.error('Failed to set short-answer grade:', gradeErr);
            }
          } else {
            // Fire edge function for vectorization (best-effort)
            try {
              const { data: sess } = await supabase.auth.getSession();
              const authHeader = sess?.session?.access_token
                ? { Authorization: `Bearer ${sess.session.access_token}` }
                : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                    ? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }
                    : {});
              await supabase.functions.invoke('answer_vectors', {
                headers: authHeader,
                body: {
                  answer_id: newId,
                  question_id: questionId,
                  user_id: userId,
                },
              });
            } catch (fnErr) {
              console.error('answer_vectors invocation failed (insert path):', fnErr);
            }
            // Best-effort: run cosine similarity grading script
            runCosineSimilarity();
          }
          // Begin post-grade flow for feedback/looping
          if ((insertedRow as any)?.id) {
            handlePostGrade((insertedRow as any).id as number, questionId as unknown as number, answerText);
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
        // Save answer and do grading/feedback flow only
        processSubmittedAnswer(fallback);
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
    // Save answer and do grading/feedback flow only
    processSubmittedAnswer(finalText);
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">
              Answer Interview Questions by pressing the 'Ask Interview Question' button
            </h1>
            <h3 className="text-lg font-bold">
              You can answer questions by speaking into the microphone, or by typing in the text box below.
            </h3>
            <h3 className="text-lg font-bold">
              Your answer will be scored by an Edge Function that computes the cosine similarity between your answer and the model's response. The model will respond with a score between 0 and 100, and provide feedback on how to improve your answer.
            </h3>
          </div>
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
                  (model.state === 'listening' || model.state === 'speaking')
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : model.state === 'processing'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                }`}
              >
                {(model.state === 'listening' || model.state === 'speaking')
                  ? 'Waiting...'
                  : model.state === 'processing'
                    ? 'Processing...'
                    : 'Ready'}
              </Badge>
            </div>

          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
            {messages.length === 0 ? (
              <p className="text-sm text-zinc-500">Click the 'Ask Interview Question' button to start the conversation.</p>
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
                if (e.key === 'Enter') processSubmittedAnswer(inputText);
              }}
            />
            <button
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => processSubmittedAnswer(inputText)}
            >
              Send
            </button>

            <select
              className="rounded-md border px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              value={selectedCategoryId}
              onChange={(e) => {
                console.log('[prompted] User selected categoryId:', e.target.value);
                setSelectedCategoryId(e.target.value);
              }}
              aria-label="Question category"
            >
              {loadingCategories && <option value="" disabled>Loading…</option>}
              {!loadingCategories && categories.length === 0 && (
                <option value="" disabled>No categories</option>
              )}
              {!loadingCategories && categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>

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
        {/* Current Score Card below conversation */}
        <div className="flex items-stretch gap-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Current Score</div>
            <div
              className={
                "mt-1 font-semibold text-5xl " +
                (currentScore >= 60 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
              }
            >
              {currentScore}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

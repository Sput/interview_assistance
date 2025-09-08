'use client';
import { useCallback, useEffect, useRef } from 'react';
import { startChromeRecognition, TranscriptListener } from '@/lib/voice/startChromeRecognition';
import type { VoiceEvent } from '@/types/voice';

type Controls = { stop: () => void; pause: () => void; resume: () => void };

export function useSpeechRecognition(
  dispatch: (e: VoiceEvent) => void,
  lang = 'en-US'
) {
  const controlRef = useRef<Controls | null>(null);

  const onTranscript: TranscriptListener = useCallback((text, isFinal) => {
    console.log('🎤 Speech recognition result:', { text, isFinal });
    if (isFinal) {
      console.log('✅ Final transcript:', text.trim());
      dispatch({ type: 'ASR_FINAL', text: text.trim() });
    } else {
      console.log('⏳ Interim transcript:', text);
      dispatch({ type: 'ASR_INTERIM', text });
    }
  }, [dispatch]);

  const start = useCallback(() => {
    console.log('🎤 Starting speech recognition...');
    if (controlRef.current) {
      console.log('⚠️ Speech recognition already running');
      return;
    }
    dispatch({ type: 'ASR_STARTED' });
    controlRef.current = startChromeRecognition(onTranscript, { lang });
    console.log('✅ Speech recognition started');
  }, [dispatch, lang, onTranscript]);

  const stop = useCallback(() => {
    console.log('🛑 Stopping speech recognition...');
    controlRef.current?.stop();
    controlRef.current = null;
    dispatch({ type: 'USER_STOP' });
    console.log('✅ Speech recognition stopped');
  }, [dispatch]);

  const pause = useCallback(() => {
    controlRef.current?.pause();
    // We don't change state here; reducer decides on PROCESSING when appropriate
  }, []);

  const resume = useCallback(() => {
    controlRef.current?.resume();
    dispatch({ type: 'ASR_STARTED' });
  }, [dispatch]);

  useEffect(() => () => { controlRef.current?.stop(); }, []);

  return { start, stop, pause, resume, isRunning: !!controlRef.current };
}
export type TranscriptListener = (text: string, isFinal: boolean) => void;

interface RecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onError?: (code: string) => void;
}

export function startChromeRecognition(
  onTranscript: TranscriptListener,
  options: RecognitionOptions = {}
): { stop: () => void; pause: () => void; resume: () => void } {
  console.log('🔧 Starting Chrome recognition with options:', options);

  const SpeechRecognition =
    (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.log('❌ Speech recognition not supported');
    throw new Error('Speech recognition not supported');
  }

  // Helper to proactively request mic access; resolves if allowed, rejects otherwise
  const ensureMicPermission = async () => {
    try {
      // If Permissions API exists, inspect state for clearer handling
      const perms: any = (navigator as any).permissions;
      if (perms?.query) {
        try {
          const status = await perms.query({ name: 'microphone' as any });
          if (status.state === 'denied') {
            throw new Error('microphone-permission-denied');
          }
        } catch {
          // Ignore query errors; fall through to getUserMedia prompt
        }
      }

      // Trigger the permission prompt if needed
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks; we only needed the grant
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      }
    } catch (err: any) {
      // Normalize common NotAllowed cases
      const name = err?.name || '';
      const msg = err?.message || '';
      if (name === 'NotAllowedError' || msg.includes('denied') || msg.includes('Permission denied')) {
        throw new Error('not-allowed');
      }
      // Surface original error otherwise
      throw err;
    }
  };

  const recognition = new SpeechRecognition();
  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = options.interimResults ?? true;
  recognition.lang = options.lang ?? 'en-US';

  console.log('🔧 Recognition configured:', {
    continuous: recognition.continuous,
    interimResults: recognition.interimResults,
    lang: recognition.lang,
  });

  recognition.onresult = (event: any) => {
    console.log('🎤 Chrome recognition result event:', event);
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      console.log('📝 Result', i, ':', transcript, 'isFinal:', event.results[i].isFinal);
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      console.log('✅ Calling onTranscript with final:', finalTranscript);
      onTranscript(finalTranscript, true);
    }
    if (interimTranscript) {
      console.log('⏳ Calling onTranscript with interim:', interimTranscript);
      onTranscript(interimTranscript, false);
    }
  };

  recognition.onstart = () => {
    console.log('🎙️ Speech recognition started');
  };

  recognition.onend = () => {
    console.log('🛑 Speech recognition ended');
  };

  recognition.onerror = (event: any) => {
    const err = event?.error || 'unknown';
    // Provide actionable guidance for the common NotAllowed case
    if (err === 'not-allowed') {
      try { options.onError?.('not-allowed'); } catch {}
      console.error('❌ Speech recognition error: not-allowed. Tips:', {
        fix: [
          'Click the microphone icon in the address bar and Allow access',
          'Ensure this page is served from https:// or http://localhost',
          'Start recognition from a user gesture (button click)',
          'Check OS privacy settings to allow microphone for your browser',
        ],
      });
      return;
    }
    console.error('❌ Speech recognition error:', err, event);
  };

  // Start after ensuring we have mic permission. This avoids NotAllowed in Chrome.
  console.log('🚦 Checking microphone permission…');
  ensureMicPermission()
    .then(() => {
      console.log('🚀 Starting recognition…');
      try {
        recognition.start();
      } catch (e) {
        console.error('❌ Failed to start recognition:', e);
      }
    })
    .catch((e) => {
      if (e?.message === 'not-allowed') {
        try { options.onError?.('not-allowed'); } catch {}
        recognition.onerror?.({ error: 'not-allowed' });
      } else {
        console.error('❌ Microphone permission error:', e);
      }
    });

  return {
    stop: () => recognition.stop(),
    pause: () => recognition.stop(),
    resume: () => {
      // On resume, ensure permission then start again
      ensureMicPermission()
        .then(() => {
          try { recognition.start(); } catch (e) { console.error('❌ Failed to resume recognition:', e); }
        })
        .catch((e) => {
          if (e?.message === 'not-allowed') {
            try { options.onError?.('not-allowed'); } catch {}
            recognition.onerror?.({ error: 'not-allowed' });
          } else {
            console.error('❌ Microphone permission error on resume:', e);
          }
        });
    },
  };
}

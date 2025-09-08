export type TranscriptListener = (text: string, isFinal: boolean) => void;

interface RecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export function startChromeRecognition(
  onTranscript: TranscriptListener,
  options: RecognitionOptions = {}
): { stop: () => void; pause: () => void; resume: () => void } {
  console.log('🔧 Starting Chrome recognition with options:', options);
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.log('❌ Speech recognition not supported');
    throw new Error('Speech recognition not supported');
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = options.interimResults ?? true;
  recognition.lang = options.lang ?? 'en-US';
  
  console.log('🔧 Recognition configured:', { continuous: recognition.continuous, interimResults: recognition.interimResults, lang: recognition.lang });

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

  recognition.onerror = (event: any) => {
    console.error('❌ Speech recognition error:', event.error, event);
  };

  console.log('🚀 Starting recognition...');
  recognition.start();

  return {
    stop: () => recognition.stop(),
    pause: () => recognition.stop(),
    resume: () => recognition.start()
  };
}


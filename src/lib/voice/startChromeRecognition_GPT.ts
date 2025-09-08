// Lightweight, browser-only utility for Chrome/WebKit
export type TranscriptListener = (text: string, isFinal: boolean) => void;

export function startChromeRecognition(
  onTranscript: TranscriptListener,
  { lang = 'en-US', restartDelayMs = 150 } = {}
) {
  const SR: any = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
  if (!SR) throw new Error('Web Speech API not available in this browser');

  let rec: SpeechRecognition | null = null;
  let stoppedByApp = false;
  let backoff = 0;

  const start = () => {
    if (rec) return;
    rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true; // best-effort; Chrome may still stop

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const i = e.resultIndex;
      const res = e.results[i];
      if (res && res[0]) onTranscript(res[0].transcript, res.isFinal);
    };

    rec.onerror = () => { /* allow onend to handle restart */ };

    rec.onend = () => {
      rec = null;
      if (stoppedByApp) return;
      const delay = restartDelayMs + Math.min(backoff, 2000);
      backoff = backoff ? Math.min(backoff * 2, 2000) : 100;
      setTimeout(start, delay);
    };

    backoff = 0;
    rec.start();
  };

  const stop = () => {
    stoppedByApp = true;
    try { rec?.stop(); } catch {}
    rec = null;
  };

  const pause = () => {
    stoppedByApp = true;
    try { rec?.abort(); } catch {}
    rec = null;
  };

  const resume = () => {
    stoppedByApp = false;
    start();
  };

  start();
  return { stop, pause, resume };
}
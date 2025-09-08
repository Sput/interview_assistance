'use client';

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

export default function MicButton() {
  const { state, interim, transcript, start, stop, pause, resume, clear } = useSpeechRecognition('en-US');

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {state !== 'listening' ? (
          <button className="px-3 py-1 rounded bg-black text-white" onClick={start}>Start</button>
        ) : (
          <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={stop}>Stop</button>
        )}
        <button className="px-3 py-1 rounded border" onClick={pause}>Pause</button>
        <button className="px-3 py-1 rounded border" onClick={resume}>Resume</button>
        <button className="px-3 py-1 rounded border" onClick={clear}>Clear</button>
      </div>

      <div className="text-sm text-gray-500">State: {state}</div>
      {!!interim && <div className="italic opacity-80">{interim}</div>}
      {!!transcript && <div>{transcript}</div>}
    </div>
  );
}
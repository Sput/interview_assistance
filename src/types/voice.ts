export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export type VoiceEvent = 
  | { type: 'ASR_STARTED' }
  | { type: 'ASR_FINAL'; text: string }
  | { type: 'ASR_INTERIM'; text: string }
  | { type: 'ASR_BLOCKED'; reason?: string }
  | { type: 'PROCESS_BEGIN' }
  | { type: 'PROCESS_END' }
  | { type: 'USER_STOP' }
  | { type: 'USER_TAP_MIC' }
  | { type: 'TTS_BEGIN' }
  | { type: 'TTS_END' };

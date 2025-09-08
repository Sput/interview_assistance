import type { VoiceEvent, VoiceState } from '@/types/voice';

export type VoiceContext = {
  interim: string;
  transcript: string; // accumulated finals
};
export type VoiceModel = { state: VoiceState; ctx: VoiceContext };

export const initialVoiceModel: VoiceModel = {
  state: 'idle',
  ctx: { interim: '', transcript: '' },
};

export function voiceReducer(model: VoiceModel, evt: VoiceEvent): VoiceModel {
  const { state, ctx } = model;
  console.log('🔄 Voice reducer:', evt.type, 'from', state, 'to', evt);

  switch (evt.type) {
    case 'USER_TAP_MIC':
      return { state: 'listening', ctx: { ...ctx, interim: '' } };

    case 'ASR_STARTED':
      return { state: 'listening', ctx };

    case 'ASR_INTERIM':
      if (state !== 'listening') return model;
      return { state, ctx: { ...ctx, interim: evt.text } };

    case 'ASR_FINAL':
      // append and clear interim
      return {
        state: 'processing', // move to processing when we have a final chunk
        ctx: { interim: '', transcript: (ctx.transcript + ' ' + evt.text).trim() },
      };

    case 'PROCESS_BEGIN':
      return { state: 'processing', ctx };

    case 'PROCESS_END':
      // if you want to resume listening after thinking, go back to listening
      return { state: 'listening', ctx };

    case 'TTS_BEGIN':
      return { state: 'speaking', ctx };

    case 'TTS_END':
      // after speaking, resume listening (or idle if you prefer push-to-talk UX)
      return { state: 'listening', ctx };

    case 'ASR_END':
      // Chrome ended the segment; keep the state logical:
      // if we were listening, we’ll auto-restart in the hook (below)
      return { state: state === 'listening' ? 'listening' : state, ctx };

    case 'USER_STOP':
      return { state: 'idle', ctx: { interim: '', transcript: '' } };

    default:
      return model;
  }
}
// app/api/chat/route.ts
import { NextRequest } from "next/server";
import { createServerClient } from '@/lib/supabase';
// We'll dynamically import OpenAI inside the handler so building the app
// doesn't fail when the `openai` package isn't installed in this env.

export const runtime = "nodejs"; // ensure server env
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  console.log('🚀 API route called');
  const { message, previousResponseId, conversation_id } = await req.json();
  console.log('📥 Request data:', { message, previousResponseId, conversation_id });

  // Check if API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    return new Response('OpenAI API key not configured', { status: 500 });
  }
  console.log('✅ OpenAI API key is set');

  // Dynamically import the OpenAI client. If not available, fail gracefully.
  let client: any;
  try {
    console.log('📦 Importing OpenAI client...');
    const OpenAIMod = await import('openai');
    const OpenAI = OpenAIMod?.default ?? OpenAIMod;
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    console.log('✅ OpenAI client created');
  } catch (err) {
    console.error('❌ OpenAI client not available:', err);
    return new Response('OpenAI client not available', { status: 500 });
  }

  // Build a request using the OpenAI Responses API with streaming
  console.log('🌐 Creating OpenAI Responses stream...');
  let respStream: any;
  try {
    const hasResponsesStream = !!(client as any)?.responses?.stream;
    if (!hasResponsesStream) {
      console.warn('⚠️ openai package version lacks Responses.stream(). Falling back to Chat Completions.');
      // Fallback: replicate prior chat.completions streaming behavior
      const stream = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an interviewer at a technology company. You will ask the user questions' },
          { role: 'user', content: message },
        ],
        stream: true,
      });

      const encoder = new TextEncoder();
      let assistantText = '';
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                assistantText += content;
                controller.enqueue(encoder.encode(content));
              }
              if (chunk.choices[0]?.finish_reason) {
                const responseId = String(Date.now());
                controller.enqueue(encoder.encode(`\n<<<response_id:${responseId}>>>`));
                controller.close();
                (async () => {
                  try {
                    const supabase = await createServerClient();
                    if (conversation_id) {
                      await supabase.from('messages').insert([
                        { conversation_id, role: 'user', content: message },
                        { conversation_id, role: 'assistant', content: assistantText },
                      ]);
                    }
                  } catch (err) {
                    console.error('Failed to persist messages (fallback):', err);
                  }
                })();
                break;
              }
            }
          } catch (err) {
            console.error('❌ Stream processing error (fallback):', err);
            controller.error(err);
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Primary path: Responses API
    respStream = await client.responses.stream({
      model: 'gpt-4o-mini',
      input: message,
      instructions: 'You are an interviewer at a technology company. You will ask the user questions',
      // text-only; no modalities param for older API versions
    });
    console.log('✅ Responses stream created');
  } catch (err) {
    console.error('❌ Failed to create Responses stream:', err);
    return new Response('Failed to create OpenAI stream', { status: 500 });
  }

  // Stream text deltas to the client and capture the final response_id
  const encoder = new TextEncoder();
  let assistantText = '';

  const readable = new ReadableStream({
    async start(controller) {
      console.log('📡 Processing Responses stream...');

      // Forward textual deltas as they arrive (support multiple SDK event names)
      const handleDelta = (raw: any) => {
        try {
          // Normalize event payloads into plain text
          let text: string = '';
          if (typeof raw === 'string') {
            text = raw;
          } else if (raw && typeof raw === 'object') {
            // Common fields across SDK event payloads
            text = (raw.delta ?? raw.text ?? raw.snapshot ?? raw.content ?? '') as string;
          }
          if (!text) return;
          console.log('📥 text delta:', text);
          assistantText += text;
          controller.enqueue(encoder.encode(text));
        } catch (err) {
          console.error('❌ Error enqueuing delta:', err);
        }
      };

      // Newer SDK sugar event
      respStream.on?.('textDelta', handleDelta as any);
      // Canonical event name for text output
      respStream.on?.('response.output_text.delta', (evt: any) => handleDelta(evt));
      // Some SDKs emit message tokens
      respStream.on?.('message.delta', (delta: any) => {
        const text = typeof delta === 'string' ? delta : (delta?.content ?? delta?.delta ?? '');
        if (text) handleDelta(text);
      });

      respStream.on('error', (err: any) => {
        console.error('❌ Responses stream error:', err);
        controller.error(err);
      });

      try {
        // Wait for the final response object to complete
        const finalResponse = await respStream.finalResponse?.() ?? null;
        const responseId = finalResponse?.id ?? String(Date.now());
        const fallbackText = (finalResponse as any)?.output_text || '';
        if (!assistantText && fallbackText) {
          assistantText = fallbackText;
          controller.enqueue(encoder.encode(fallbackText));
        }
        console.log('✅ Responses stream completed. Final text:', assistantText, 'id:', responseId);

        // Append sentinel with response_id for the client
        controller.enqueue(encoder.encode(`\n<<<response_id:${responseId}>>>`));
        controller.close();

        // Persist messages to Supabase (do not block the response stream)
        (async () => {
          try {
            const supabase = await createServerClient();
            if (conversation_id) {
              await supabase.from('messages').insert([
                {
                  conversation_id: conversation_id,
                  role: 'user',
                  content: message,
                },
                {
                  conversation_id: conversation_id,
                  role: 'assistant',
                  content: assistantText,
                },
              ]);
            } else {
              console.warn('No conversation_id provided; skipping message persistence');
            }
          } catch (err) {
            console.error('Failed to persist messages:', err);
          }
        })();
      } catch (err) {
        console.error('❌ Error awaiting final response:', err);
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

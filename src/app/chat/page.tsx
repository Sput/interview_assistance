import ChatPage from '@/components/ChatPage';
import { createServerClient } from '@/lib/supabase';

export default async function Page() {
  const supabase = await createServerClient();

  let conversationId: string | null = null;
  try {
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && (data as any).id) {
      conversationId = (data as any).id;
    }
  } catch (err) {
    console.error('Could not bootstrap conversation id', err);
    conversationId = null;
  }

  return (
    <main className="p-6">
      <ChatPage conversationId={conversationId} />
    </main>
  );
}

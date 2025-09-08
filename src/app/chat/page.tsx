import ChatPage from '@/components/ChatPage';
import { createServerClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';

export default async function Page() {
  const supabase = await createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return redirect('/auth/sign-in');
  }

  let conversationId: string | null = null;
  try {
    // Try to find an existing conversation for this user
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', session.user.id)
      .limit(1)
      .maybeSingle();

    if (data && (data as any).id) {
      conversationId = (data as any).id;
    } else {
      // Create a new conversation
      const { data: created } = await supabase
        .from('conversations')
        .insert({ user_id: session.user.id })
        .select('id')
        .single();
      if (created && (created as any).id) conversationId = (created as any).id;
    }
  } catch (err) {
    // If anything goes wrong, we'll simply render the chat without a conversation id.
    console.error('Could not bootstrap conversation id', err);
    conversationId = null;
  }

  return (
    <main className="p-6">
      <ChatPage conversationId={conversationId} />
    </main>
  );
}

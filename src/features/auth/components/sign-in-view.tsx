import { SupabaseAuth } from '@/components/auth/supabase-auth';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Interview AI.'
};

export default function SignInViewPage({ stars }: { stars?: number }) {
  return (
    <div className='flex min-h-screen items-center justify-center p-4 lg:p-8'>
      <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
        <SupabaseAuth mode='sign-in' />
      </div>
    </div>
  );
}

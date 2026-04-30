import { SupabaseAuth } from '@/components/auth/supabase-auth';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Interview AI.'
};

export default function SignInViewPage({ stars }: { stars?: number }) {
  return (
    <div className='grid min-h-screen lg:grid-cols-2'>
      <div className='hidden bg-zinc-950 p-10 text-white lg:flex lg:flex-col'>
        <div className='text-lg font-semibold'>Interview AI</div>
        <div className='mt-auto max-w-md space-y-3'>
          <p className='text-3xl font-semibold tracking-normal'>
            Practice interviews with saved questions, answers, and feedback.
          </p>
          <p className='text-sm text-zinc-300'>
            Sign in to continue your interview prep workspace.
          </p>
        </div>
      </div>
      <div className='flex min-h-screen items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          <SupabaseAuth mode='sign-in' />
        </div>
      </div>
    </div>
  );
}

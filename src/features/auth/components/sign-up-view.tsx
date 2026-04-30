import { SupabaseAuth } from '@/components/auth/supabase-auth';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create an Interview AI account.'
};

export default function SignUpViewPage({ stars }: { stars?: number }) {
  return (
    <div className='grid min-h-screen lg:grid-cols-2'>
      <div className='hidden bg-zinc-950 p-10 text-white lg:flex lg:flex-col'>
        <div className='text-lg font-semibold'>Interview AI</div>
        <div className='mt-auto max-w-md space-y-3'>
          <p className='text-3xl font-semibold tracking-normal'>
            Build a focused interview prep history you can return to.
          </p>
          <p className='text-sm text-zinc-300'>
            Create an account to save questions, answers, and feedback.
          </p>
        </div>
      </div>
      <div className='flex min-h-screen items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          <SupabaseAuth mode='sign-up' />
        </div>
      </div>
    </div>
  );
}

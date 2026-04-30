import { Metadata } from 'next';
import SignInViewPage from '@/features/auth/components/sign-in-view';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Interview AI.'
};

export default async function Page() {
  return <SignInViewPage stars={0} />;
}

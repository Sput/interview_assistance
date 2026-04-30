import { Metadata } from 'next';
import SignUpViewPage from '@/features/auth/components/sign-up-view';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create an Interview AI account.'
};

export default async function Page() {
  return <SignUpViewPage stars={0} />;
}

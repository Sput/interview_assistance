import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Authentication Removed',
  description: 'This application no longer requires sign up.'
};

export default async function Page() {
  redirect('/dashboard/overview');
}

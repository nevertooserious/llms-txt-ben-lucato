import type { Metadata } from 'next';
import { ApiDocsScreen } from '@/features/api-docs/api-docs-screen';

export const metadata: Metadata = { title: 'API docs · llms.txt generator' };

export default function ApiDocsPage() {
  return <ApiDocsScreen />;
}

import type { Metadata } from 'next';
import { DemoStartClient } from '../../../features/demo-control/demo-start-client.tsx';

export const metadata: Metadata = { title: '正在准备演示 · DGBook' };
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function DemoStartPage() {
  return <DemoStartClient />;
}

import type { Metadata } from 'next';
import '@xyflow/react/dist/style.css';
import './globals.css';
import './classroom.css';
import './feature-polish.css';
import './graphic-system.css';
import './skill-learning.css';
import './textbook-scene.css';
import './node-route-gate.css';
import './capability-map.css';
import './auth.css';
import './digital-textbook-v4.css';
import './digital-classroom-v4.css';
import './classroom-scope-map.css';
import './digital-classroom-task8.css';
import './student-classroom-runtime.css';
import './p01-n02-lesson-stage.css';
import './role-home-v5.css';
import './p1-project.css';
import './annotated-engineering-figure.css';
import './self-study-textbook.css';
import './self-study-practice-tabs.css';
import './self-study-scope-map.css';
import './learning-activities.css';
import './professional-output.css';
import './formal-assessment.css';
import './demo-control.css';
import { ChunkLoadRecovery } from './chunk-load-recovery';

export const metadata: Metadata = {
  title: 'DGBook 5G网络优化（高级）数字教材',
  description: '以课程能力图谱贯通教师授课、学生跟学、自主学习和专业证据回收的5G数字教材。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="dgbook-skip-link" href="#dgbook-main-content">跳到主要内容</a>
        <ChunkLoadRecovery />
        <div id="dgbook-main-content" tabIndex={-1}>{children}</div>
      </body>
    </html>
  );
}

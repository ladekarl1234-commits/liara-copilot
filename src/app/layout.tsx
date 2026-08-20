import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Liara Copilot — دستیار هوشمند لیارا',
  description:
    'دستیار هوشمند لیارا؛ پاسخ دقیق، عیب‌یابی گام‌به‌گام و راهنمای استقرار بر پایه‌ی مستندات رسمی Liara.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

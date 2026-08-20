import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Vazirmatn } from 'next/font/google';
import './globals.css';

// Self-hosted (next/font) — no external font host, so the CSP needs no change.
const vazir = Vazirmatn({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-vazir',
});

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

// Set the saved theme before first paint to avoid a light/dark flash.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('liara-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

'use client';

import { useRef, useState, type ReactNode } from 'react';

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function CodeBlock({
  language,
  codeClassName,
  children,
}: {
  language?: string;
  codeClassName?: string;
  children?: ReactNode;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = codeRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard unavailable — leave the button as-is
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block" dir="ltr">
      <div className="code-head">
        <span className="code-lang">{language ?? ''}</span>
        <button
          type="button"
          className={`code-copy ${copied ? 'copied' : ''}`}
          onClick={copy}
          aria-label="کپی"
          title="کپی"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <pre>
        <code ref={codeRef} className={codeClassName}>
          {children}
        </code>
      </pre>
    </div>
  );
}

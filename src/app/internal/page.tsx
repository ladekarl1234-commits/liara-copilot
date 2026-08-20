// Server gate: /internal returns 404 unless diagnostics are enabled (dev, or
// DIAG_ENABLED=on) — the page itself, not just /api/diag, must not exist in
// prod. The actual UI is the client component below.
import { notFound } from 'next/navigation';
import { config } from '@/lib/config';
import InternalClient from './InternalClient';

export const dynamic = 'force-dynamic';

export default function Page() {
  if (!config().diagEnabled) notFound();
  return <InternalClient />;
}

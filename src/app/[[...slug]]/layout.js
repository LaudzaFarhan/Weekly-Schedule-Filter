'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';

/**
 * This layout wraps the catch-all route. Because Next.js keeps layouts mounted
 * across navigations within the same segment (only the page remounts), placing
 * AuthProvider + AppShell here means they persist as you move between routes —
 * no remount, no auth re-check, and no loading-screen "blink".
 */
export default function SlugLayout() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

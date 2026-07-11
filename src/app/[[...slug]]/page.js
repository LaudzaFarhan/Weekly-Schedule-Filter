'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';

export default function CatchAllRootPage() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

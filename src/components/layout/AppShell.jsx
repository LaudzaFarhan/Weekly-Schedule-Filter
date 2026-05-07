'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import LoginOverlay from '@/components/auth/LoginOverlay';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import HomePage from '@/views/HomePage';
import ConflictsPage from '@/views/ConflictsPage';
import AvailabilityPage from '@/views/AvailabilityPage';
import LeavePage from '@/views/LeavePage';
import TrialPriorityPage from '@/views/TrialPriorityPage';
import FinderPage from '@/views/FinderPage';
import SchedulePage from '@/views/SchedulePage';
import TrialInputPage from '@/views/TrialInputPage';
import ApiDocsPage from '@/views/ApiDocsPage';
import AdminPage from '@/views/AdminPage';

const PAGE_MAP = {
  home: HomePage,
  conflicts: ConflictsPage,
  availability: AvailabilityPage,
  leave: LeavePage,
  'trial-priority': TrialPriorityPage,
  finder: FinderPage,
  schedule: SchedulePage,
  'trial-input': TrialInputPage,
  'api-docs': ApiDocsPage,
  admin: AdminPage,
};

export default function AppShell() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginOverlay />;
  }

  const PageComponent = PAGE_MAP[currentPage] || HomePage;

  return (
    <ScheduleProvider>
      <div className="app-layout">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="dashboard-container">
          <Header />
          <div className="dashboard-views">
            <PageComponent />
          </div>
        </main>
      </div>
    </ScheduleProvider>
  );
}

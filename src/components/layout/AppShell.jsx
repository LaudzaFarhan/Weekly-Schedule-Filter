'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { ToastProvider } from '@/components/ui/Toast';
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
import ProfilePage from '@/views/ProfilePage';
import WorkloadPage from '@/views/WorkloadPage';

const PAGE_MAP = {
  home: HomePage,
  conflicts: ConflictsPage,
  availability: AvailabilityPage,
  leave: LeavePage,
  'trial-priority': TrialPriorityPage,
  finder: FinderPage,
  schedule: SchedulePage,
  'trial-input': TrialInputPage,
  profiles: ProfilePage,
  workload: WorkloadPage,
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

  const handleNavigate = (page) => {
    setCurrentPage(page);
    // Smooth scroll to top of dashboard
    const container = document.querySelector('.dashboard-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <ToastProvider>
      <ScheduleProvider>
        <div className="app-layout">
          <Sidebar currentPage={currentPage} onNavigate={handleNavigate} />
          <main className="dashboard-container">
            <Header />
            <div className="dashboard-views">
              <PageComponent onNavigate={handleNavigate} />
            </div>
          </main>
        </div>
      </ScheduleProvider>
    </ToastProvider>
  );
}

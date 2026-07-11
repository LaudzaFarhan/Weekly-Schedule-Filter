'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { ToastProvider } from '@/components/ui/Toast';
import LoginOverlay from '@/components/auth/LoginOverlay';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import StudentSearchSidebar from '@/components/layout/StudentSearchSidebar';
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
import TasksPage from '@/views/TasksPage';
import CrmPage from '@/views/CrmPage';
import ComingSoonPage from '@/views/ComingSoonPage';
import NewSchedulePage from '@/views/NewSchedulePage';
import NewStudentsPage from '@/views/NewStudentsPage';

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
  tasks: TasksPage,
  crm: CrmPage,
  'api-docs': ApiDocsPage,
  admin: AdminPage,
};

export default function AppShell() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');
  const [pageParams, setPageParams] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [opsMode, setOpsMode] = useState('old');

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

  let PageComponent;
  if (opsMode === 'new') {
    if (currentPage === 'students') {
      PageComponent = NewStudentsPage;
    } else {
      PageComponent = NewSchedulePage;
    }
  } else {
    PageComponent = PAGE_MAP[currentPage] || HomePage;
  }

  const handleNavigate = (page, params = null) => {
    setCurrentPage(page);
    setPageParams(params);
    // Smooth scroll to top of dashboard
    const container = document.querySelector('.dashboard-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <ToastProvider>
      <ScheduleProvider>
        <div className="app-layout">
          <Sidebar 
            currentPage={currentPage} 
            onNavigate={handleNavigate} 
            onToggleSearch={() => setIsSearchOpen(true)} 
            opsMode={opsMode}
            setOpsMode={setOpsMode}
          />
          <main className="dashboard-container">
            <Header onToggleSearch={() => setIsSearchOpen(true)} opsMode={opsMode} />
            <div className="dashboard-views">
              <PageComponent onNavigate={handleNavigate} params={pageParams} />
            </div>
          </main>
          {opsMode === 'old' && (
            <StudentSearchSidebar isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
          )}
        </div>
      </ScheduleProvider>
    </ToastProvider>
  );
}

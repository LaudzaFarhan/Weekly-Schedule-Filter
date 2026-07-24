'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
import NewOperationalsPage from '@/views/NewOperationalsPage';
import NewStudentsPage from '@/views/NewStudentsPage';
import NewInstructorsPage from '@/views/NewInstructorsPage';
import NewCrmPage from '@/views/NewCrmPage';
import NewApiDocsPage from '@/views/NewApiDocsPage';
import NewWorkloadPage from '@/views/NewWorkloadPage';
import NewTrialAvailabilityPage from '@/views/NewTrialAvailabilityPage';
import NewActivityPage from '@/views/NewActivityPage';

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
  const router = useRouter();
  const pathname = usePathname();
  const [currentPage, setCurrentPage] = useState('home');
  const [pageParams, setPageParams] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [opsMode, setOpsMode] = useState('old');

  // Sync state from URL pathname on mount and changes
  useEffect(() => {
    if (!pathname) return;
    const parts = pathname.split('/').filter(Boolean);

    let mode = 'old';
    let page = 'home';

    if (parts[0] === 'new') {
      mode = 'new';
      page = parts[1] || 'schedule';
    } else if (parts[0] === 'old') {
      mode = 'old';
      page = parts[1] || 'home';
    } else if (parts[0]) {
      mode = 'old';
      page = parts[0];
    }

    setOpsMode(mode);
    setCurrentPage(page);
  }, [pathname]);

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
    if (currentPage === 'operationals') {
      PageComponent = NewOperationalsPage;
    } else if (currentPage === 'students') {
      PageComponent = NewStudentsPage;
    } else if (currentPage === 'instructors') {
      PageComponent = NewInstructorsPage;
    } else if (currentPage === 'crm') {
      PageComponent = NewCrmPage;
    } else if (currentPage === 'workload') {
      PageComponent = NewWorkloadPage;
    } else if (currentPage === 'trial-availability') {
      PageComponent = NewTrialAvailabilityPage;
    } else if (currentPage === 'activity') {
      PageComponent = NewActivityPage;
    } else if (currentPage === 'api') {
      PageComponent = NewApiDocsPage;
    } else {
      PageComponent = NewSchedulePage;
    }
  } else {
    PageComponent = PAGE_MAP[currentPage] || HomePage;
  }

  const handleNavigate = (page, params = null) => {
    setPageParams(params);
    if (opsMode === 'new') {
      router.push(`/new/${page}`);
    } else {
      router.push(`/${page}`);
    }
    // Smooth scroll to top of dashboard
    const container = document.querySelector('.dashboard-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSetOpsMode = (mode) => {
    if (mode === 'new') {
      router.push('/new/schedule');
    } else {
      router.push('/home');
    }
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
            setOpsMode={handleSetOpsMode}
          />
          <main className="dashboard-container">
            <Header onToggleSearch={() => setIsSearchOpen(true)} opsMode={opsMode} />
            <div className={`dashboard-views ${opsMode === 'new' ? 'new-ops-anim' : ''}`}>
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

'use client';

import { useState, useEffect, useCallback } from 'react';
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
import NewHomePage from '@/views/NewHomePage';
import NewLeavePage from '@/views/NewLeavePage';
import NewSchedulePage from '@/views/NewSchedulePage';
import NewOperationalsPage from '@/views/NewOperationalsPage';
import NewStudentsPage from '@/views/NewStudentsPage';
import NewInstructorsPage from '@/views/NewInstructorsPage';
import NewCrmPage from '@/views/NewCrmPage';
import NewApiDocsPage from '@/views/NewApiDocsPage';
import NewWorkloadPage from '@/views/NewWorkloadPage';
import NewTrialAvailabilityPage from '@/views/NewTrialAvailabilityPage';
import NewActivityPage from '@/views/NewActivityPage';
import NewKinderProgressPage from '@/views/NewKinderProgressPage';
import NewJuniorProgressPage from '@/views/NewJuniorProgressPage';
import NewCoderProgressPage from '@/views/NewCoderProgressPage';

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

/** Derive { mode, page } from a URL pathname. */
function parsePath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0] === 'new') return { mode: 'new', page: parts[1] || 'home' };
  if (parts[0] === 'old') return { mode: 'old', page: parts[1] || 'home' };
  if (parts[0]) return { mode: 'old', page: parts[0] };
  return { mode: 'old', page: 'home' };
}

export default function AppShell() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');
  const [pageParams, setPageParams] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [opsMode, setOpsMode] = useState('old');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Restore sidebar collapsed preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebarCollapsed');
      if (saved != null) setSidebarCollapsed(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('sidebarCollapsed', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Sync the view from the URL on first mount, then only on browser back /
  // forward. Navigation itself uses history.pushState (see handleNavigate), so
  // the App Router never re-resolves the route — no segment remount, no auth
  // re-check, and therefore no loading-screen flash between pages.
  const syncFromLocation = useCallback(() => {
    const { mode, page } = parsePath(window.location.pathname);
    setOpsMode(mode);
    setCurrentPage(page);
  }, []);

  useEffect(() => {
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [syncFromLocation]);

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
    if (currentPage === 'home' || currentPage === 'dashboard') {
      PageComponent = NewHomePage;
    } else if (currentPage === 'operationals') {
      PageComponent = NewOperationalsPage;
    } else if (currentPage === 'students') {
      PageComponent = NewStudentsPage;
    } else if (currentPage === 'instructors') {
      PageComponent = NewInstructorsPage;
    } else if (currentPage === 'crm') {
      PageComponent = NewCrmPage;
    } else if (currentPage === 'workload') {
      PageComponent = NewWorkloadPage;
    } else if (currentPage === 'leave') {
      PageComponent = NewLeavePage;
    } else if (currentPage === 'trial-availability') {
      PageComponent = NewTrialAvailabilityPage;
    } else if (currentPage === 'activity') {
      PageComponent = NewActivityPage;
    } else if (currentPage === 'progress-kinder') {
      PageComponent = NewKinderProgressPage;
    } else if (currentPage === 'progress-junior') {
      PageComponent = NewJuniorProgressPage;
    } else if (currentPage === 'progress-coder') {
      PageComponent = NewCoderProgressPage;
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
    // Swap the view immediately and update the address bar without going
    // through the router, so nothing above this component is torn down.
    setCurrentPage(page);
    const url = opsMode === 'new' ? `/new/${page}` : `/${page}`;
    if (window.location.pathname !== url) {
      window.history.pushState({}, '', url);
    }
    // Smooth scroll to top of dashboard
    const container = document.querySelector('.dashboard-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSetOpsMode = (mode) => {
    const page = 'home';
    setOpsMode(mode);
    setCurrentPage(page);
    const url = mode === 'new' ? '/new/home' : '/home';
    if (window.location.pathname !== url) {
      window.history.pushState({}, '', url);
    }
  };

  return (
    <ToastProvider>
      <ScheduleProvider>
        <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <Sidebar 
            currentPage={currentPage} 
            onNavigate={handleNavigate} 
            onToggleSearch={() => setIsSearchOpen(true)} 
            opsMode={opsMode}
            setOpsMode={handleSetOpsMode}
            onToggleSidebar={toggleSidebar}
          />
          <main className="dashboard-container">
            <Header onToggleSearch={() => setIsSearchOpen(true)} opsMode={opsMode} onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} onNavigate={handleNavigate} />
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

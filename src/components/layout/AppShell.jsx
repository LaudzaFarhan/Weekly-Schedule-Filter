'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { ToastProvider } from '@/components/ui/Toast';
import LoginOverlay from '@/components/auth/LoginOverlay';
import TourProvider, { useTour } from '@/components/tour/TourProvider';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import StudentSearchSidebar from '@/components/layout/StudentSearchSidebar';
import OpsSunsetBanner from '@/components/ops/OpsSunsetBanner';
import { useSunsetNotice } from '@/components/ops/useSunsetNotice';
import NewHomePage from '@/views/NewHomePage';
import NewLeavePage from '@/views/NewLeavePage';
import NewSchedulePage from '@/views/NewSchedulePage';
import NewOperationalsPage from '@/views/NewOperationalsPage';
import NewStudentsPage from '@/views/NewStudentsPage';
import NewStudentReportCardsPage from '@/views/NewStudentReportCardsPage';
import NewRubricSetupPage from '@/views/NewRubricSetupPage';
import NewInstructorsPage from '@/views/NewInstructorsPage';
import NewCrmPage from '@/views/NewCrmPage';
import NewApiDocsPage from '@/views/NewApiDocsPage';
import NewUsersPage from '@/views/NewUsersPage';
import NewWorkloadPage from '@/views/NewWorkloadPage';
import NewTrialAvailabilityPage from '@/views/NewTrialAvailabilityPage';
import NewActivityPage from '@/views/NewActivityPage';
import NewKinderProgressPage from '@/views/NewKinderProgressPage';
import NewJuniorProgressPage from '@/views/NewJuniorProgressPage';
import NewCoderProgressPage from '@/views/NewCoderProgressPage';
import NewMeetingsPage from '@/views/NewMeetingsPage';
import NewStudentSubscriptionsPage from '@/views/NewStudentSubscriptionsPage';
import VercelMigrationNotice from '@/components/layout/VercelMigrationNotice';

/** Derive page from URL pathname for New Operations */
function parsePath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0] === 'new') return { mode: 'new', page: parts[1] || 'home' };
  return { mode: 'new', page: parts[0] || 'home' };
}

/**
 * The sunset banner, plus the one callback that has to reach the tour.
 *
 * This exists as its own component for a single reason: `useTour()` only works
 * inside the tree `TourProvider` wraps, and `AppShell`'s own body sits outside
 * it. Rendering the banner here — a child of the provider — puts `start` within
 * reach without moving the provider or the layout around it.
 *
 * It holds no state of its own and decides nothing about the notice; the model,
 * the dismissal and the sidebar state all arrive as props.
 */
function SunsetBannerSlot({ notice, onDismiss, sidebarCollapsed, onExpandSidebar }) {
  const { start } = useTour();

  const showMeNewOps = useCallback(() => {
    // The tour's first stop after the banner is the switcher pill, which lives
    // in the sidebar. A collapsed sidebar has no laid-out switcher to measure,
    // so expand it first and start on the next frame — by then React has
    // committed and the anchor has a box. Req 4.11, 6.11, 7.9
    if (sidebarCollapsed) onExpandSidebar();

    const raf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (cb) => setTimeout(cb, 0);
    raf(() => start('ops-sunset'));
  }, [sidebarCollapsed, onExpandSidebar, start]);

  return (
    <OpsSunsetBanner notice={notice} onDismiss={onDismiss} onShowMe={showMeNewOps} />
  );
}

export default function AppShell() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');
  const [pageParams, setPageParams] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const opsMode = 'new';
  const setOpsMode = () => {};
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

  const expandSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    try { localStorage.setItem('sidebarCollapsed', JSON.stringify(false)); } catch { /* ignore */ }
  }, []);

  const { notice, dismiss } = useSunsetNotice('new');

  const syncFromLocation = useCallback(() => {
    const { page } = parsePath(window.location.pathname);
    setCurrentPage(page);
  }, []);

  useEffect(() => {
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [syncFromLocation]);

  const [isVercelDomain, setIsVercelDomain] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const searchParams = new URLSearchParams(window.location.search);
      if (hostname.includes('vercel.app') || searchParams.get('migration') === 'true') {
        setIsVercelDomain(true);
      }
    }
  }, []);

  if (isVercelDomain) {
    return <VercelMigrationNotice />;
  }

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
  if (currentPage === 'home' || currentPage === 'dashboard') {
    PageComponent = NewHomePage;
  } else if (currentPage === 'operationals') {
    PageComponent = NewOperationalsPage;
  } else if (currentPage === 'students') {
    PageComponent = NewStudentsPage;
  } else if (currentPage === 'student-subscriptions') {
    PageComponent = NewStudentSubscriptionsPage;
  } else if (currentPage === 'report-cards' || currentPage === 'report-cards-list') {
    PageComponent = NewStudentReportCardsPage;
  } else if (currentPage === 'report-cards-rubric') {
    PageComponent = NewRubricSetupPage;
  } else if (currentPage === 'instructors') {
    PageComponent = NewInstructorsPage;
  } else if (currentPage === 'crm') {
    PageComponent = NewCrmPage;
  } else if (currentPage === 'meetings') {
    PageComponent = NewMeetingsPage;
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
  } else if (currentPage === 'users') {
    PageComponent = NewUsersPage;
  } else if (currentPage === 'api') {
    PageComponent = NewApiDocsPage;
  } else {
    PageComponent = NewSchedulePage;
  }

  const handleNavigate = (page, params = null) => {
    setPageParams(params);
    setCurrentPage(page);
    const url = `/new/${page}`;
    if (window.location.pathname !== url) {
      window.history.pushState({}, '', url);
    }
    const container = document.querySelector('.dashboard-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <ToastProvider>
      <ScheduleProvider>
        <TourProvider
          page={currentPage}
          opsMode="new"
          sunsetLive={false}
          sidebarCollapsed={sidebarCollapsed}
          onNavigate={handleNavigate}
        >
        <div className={`app-layout new-ops-active ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <Sidebar 
            currentPage={currentPage} 
            onNavigate={handleNavigate} 
            onToggleSearch={() => setIsSearchOpen(true)} 
            opsMode="new"
            setOpsMode={setOpsMode}
            onToggleSidebar={toggleSidebar}
            sidebarCollapsed={sidebarCollapsed}
            sunsetBadge=""
          />
          <main className="dashboard-container">
            <Header onToggleSearch={() => setIsSearchOpen(true)} opsMode="new" onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} onNavigate={handleNavigate} />
            <div className="dashboard-views new-ops-anim">
              <PageComponent onNavigate={handleNavigate} params={pageParams} page={currentPage} />
            </div>
          </main>
        </div>
        </TourProvider>
      </ScheduleProvider>
    </ToastProvider>
  );
}

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
import NewMeetingsPage from '@/views/NewMeetingsPage';

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

  /**
   * Open the sidebar, whatever state it is in. Used before the sunset tour runs,
   * because its second step points at a control the collapsed rail does not lay
   * out. Persisted like any other collapse change, so the tour does not leave the
   * preference disagreeing with what is on screen.
   */
  const expandSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    try { localStorage.setItem('sidebarCollapsed', JSON.stringify(false)); } catch { /* ignore */ }
  }, []);

  // The sunset notice. `opsMode` is reported as `'new'` until there is a signed-in
  // user, so the login screen starts no clock and issues no config request; the
  // hook picks both up on the switch to `'old'` once the session resolves.
  // Nothing about the shell varies with the phase beyond the fields the banner
  // and the badge render: no redirect, no `opsMode` change, no read-only views.
  // Req 6.5, 6.10, 13.6
  const { notice, dismiss } = useSunsetNotice(user ? opsMode : 'new');

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
    } else if (currentPage === 'report-cards') {
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
        {/* Inside the providers, so a tour step can describe anything the app
            renders; outside the page, so switching pages cannot unmount a
            running tour mid-step. */}
        <TourProvider
          page={currentPage}
          opsMode={opsMode}
          sunsetLive={notice.phase !== 'past'}
          sidebarCollapsed={sidebarCollapsed}
        >
        <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <Sidebar 
            currentPage={currentPage} 
            onNavigate={handleNavigate} 
            onToggleSearch={() => setIsSearchOpen(true)} 
            opsMode={opsMode}
            setOpsMode={handleSetOpsMode}
            onToggleSidebar={toggleSidebar}
            sunsetBadge={notice.badge}
          />
          <main className="dashboard-container">
            <Header onToggleSearch={() => setIsSearchOpen(true)} opsMode={opsMode} onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} onNavigate={handleNavigate} />
            {/* Between the Header and the scrolling views, outside both: above the
                scroll region so it cannot scroll away, and outside PageComponent so
                it is one mount whichever page is active. Req 4.1, 4.3, 4.4 */}
            {opsMode === 'old' && (
              <SunsetBannerSlot
                notice={notice}
                onDismiss={dismiss}
                sidebarCollapsed={sidebarCollapsed}
                onExpandSidebar={expandSidebar}
              />
            )}
            <div className={`dashboard-views ${opsMode === 'new' ? 'new-ops-anim' : ''}`}>
              <PageComponent onNavigate={handleNavigate} params={pageParams} />
            </div>
          </main>
          {opsMode === 'old' && (
            <StudentSearchSidebar isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
          )}
        </div>
        </TourProvider>
      </ScheduleProvider>
    </ToastProvider>
  );
}

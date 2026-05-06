import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ScheduleProvider } from './contexts/ScheduleContext';
import AppLayout from './components/layout/AppLayout';
import LoginOverlay from './components/auth/LoginOverlay';
import HomePage from './pages/HomePage';
import ConflictsPage from './pages/ConflictsPage';
import AvailabilityPage from './pages/AvailabilityPage';
import LeavePage from './pages/LeavePage';
import TrialPriorityPage from './pages/TrialPriorityPage';
import FinderPage from './pages/FinderPage';
import SchedulePage from './pages/SchedulePage';
import TrialInputPage from './pages/TrialInputPage';
import AdminPage from './pages/AdminPage';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();

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

  return (
    <ScheduleProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="conflicts" element={<ConflictsPage />} />
          <Route path="availability" element={<AvailabilityPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="trial-priority" element={<TrialPriorityPage />} />
          <Route path="finder" element={<FinderPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="trial-input" element={<TrialInputPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </ScheduleProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

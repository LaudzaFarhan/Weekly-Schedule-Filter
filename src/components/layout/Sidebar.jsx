'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Settings, LogOut,
} from 'lucide-react';

const navItems = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'conflicts', icon: AlertTriangle, label: 'Conflict Report' },
  { id: 'availability', icon: Calendar, label: 'Slot Checker' },
  { id: 'leave', icon: Activity, label: 'Leave Management' },
  { id: 'trial-priority', icon: Star, label: 'Trial Priority' },
  { id: 'finder', icon: Search, label: 'Free Finder' },
  { id: 'schedule', icon: FileText, label: 'Master Schedule' },
  { id: 'trial-input', icon: PenLine, label: 'Input Trial Leads' },
  { id: 'admin', icon: Settings, label: 'Admin Settings' },
];

export default function Sidebar({ currentPage, onNavigate }) {
  const { logout } = useAuth();
  const { featureToggles } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  // Map feature toggles to page IDs for hiding
  const hiddenPages = new Set();
  if (!featureToggles.conflicts) hiddenPages.add('conflicts');
  if (!featureToggles.availability) hiddenPages.add('availability');
  if (!featureToggles.leave) hiddenPages.add('leave');
  if (!featureToggles.trial && !featureToggles.trial_overview) hiddenPages.add('trial-priority');
  if (!featureToggles.finder) hiddenPages.add('finder');
  if (!featureToggles.schedule) hiddenPages.add('schedule');
  if (!featureToggles.trial_input) hiddenPages.add('trial-input');

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Schedule<br />Intelligence</h2>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(({ id, icon: Icon, label }) => {
          if (hiddenPages.has(id)) return null;
          return (
            <button
              key={id}
              className={`nav-item ${currentPage === id ? 'active' : ''}`}
              onClick={() => onNavigate(id)}
            >
              <Icon size={20} />
              {label}
            </button>
          );
        })}
        <div style={{ flexGrow: 1 }} />
        <button className="nav-item logout-btn" onClick={handleLogout}>
          <LogOut size={20} />
          Logout
        </button>
      </nav>
    </aside>
  );
}

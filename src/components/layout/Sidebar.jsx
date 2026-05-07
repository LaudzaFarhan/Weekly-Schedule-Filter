'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Terminal, Settings, LogOut,
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
  { id: 'api-docs', icon: Terminal, label: 'API Documentation' },
  { id: 'admin', icon: Settings, label: 'Admin Settings' },
];

export default function Sidebar({ currentPage, onNavigate }) {
  const { user, logout } = useAuth();
  const { roleToggles, users, featureToggles } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  const userRole = users?.[user?.email] || 'Instructor';
  const currentToggles = roleToggles?.[userRole] || roleToggles?.['Instructor'] || {};

  const hiddenPages = new Set();
  
  // Global Internal Feature Toggles
  if (!featureToggles?.conflicts) hiddenPages.add('conflicts');
  if (!featureToggles?.availability) hiddenPages.add('availability');
  if (!featureToggles?.leave) hiddenPages.add('leave');
  if (!featureToggles?.trial && !featureToggles?.trial_overview) hiddenPages.add('trial-priority');

  // Role-Based Sidebar Toggles
  if (!currentToggles.schedule) hiddenPages.add('schedule');
  if (!currentToggles.finder) hiddenPages.add('finder');
  if (!currentToggles.trial_input) hiddenPages.add('trial-input');
  if (!currentToggles.api_docs) hiddenPages.add('api-docs');
  if (!currentToggles.admin) hiddenPages.add('admin');

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

import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSchedule } from '../../contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Settings, LogOut,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/conflicts', icon: AlertTriangle, label: 'Conflict Report' },
  { to: '/availability', icon: Calendar, label: 'Slot Checker' },
  { to: '/leave', icon: Activity, label: 'Leave Management' },
  { to: '/trial-priority', icon: Star, label: 'Trial Priority' },
  { to: '/finder', icon: Search, label: 'Free Finder' },
  { to: '/schedule', icon: FileText, label: 'Master Schedule' },
  { to: '/trial-input', icon: PenLine, label: 'Input Trial Leads' },
  { to: '/admin', icon: Settings, label: 'Admin Settings' },
];

export default function Sidebar() {
  const { logout } = useAuth();
  const { featureToggles } = useSchedule();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Map feature toggles to routes for hiding
  const hiddenRoutes = new Set();
  if (!featureToggles.conflicts) hiddenRoutes.add('/conflicts');
  if (!featureToggles.availability) hiddenRoutes.add('/availability');
  if (!featureToggles.leave) hiddenRoutes.add('/leave');
  if (!featureToggles.trial && !featureToggles.trial_overview) hiddenRoutes.add('/trial-priority');
  if (!featureToggles.finder) hiddenRoutes.add('/finder');
  if (!featureToggles.schedule) hiddenRoutes.add('/schedule');
  if (!featureToggles.trial_input) hiddenRoutes.add('/trial-input');

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Schedule<br />Intelligence</h2>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(({ to, icon: Icon, label }) => {
          if (hiddenRoutes.has(to)) return null;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} />
              {label}
            </NavLink>
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

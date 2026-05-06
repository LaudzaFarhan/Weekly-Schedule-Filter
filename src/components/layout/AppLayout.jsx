import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="dashboard-container">
        <Header />
        <div className="dashboard-views">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

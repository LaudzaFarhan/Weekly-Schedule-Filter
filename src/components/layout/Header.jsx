import { useSchedule } from '../../contexts/ScheduleContext';
import { RefreshCw } from 'lucide-react';

export default function Header() {
  const {
    sheetUrl, setSheetUrl,
    syncSchedule, isSyncing, syncStatus, lastSyncTime,
  } = useSchedule();

  return (
    <header className="app-header">
      <div className="header-content">
        <h1>Schedule Intelligence</h1>
        <p>Automated Conflict Detection &amp; Instructor Availability</p>
        <div className="url-input-container">
          <label htmlFor="sheet-url">Published Sheet URL</label>
          <input
            type="text"
            id="sheet-url"
            placeholder="Paste your Google Sheets 'Publish to Web' link here..."
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
          />
        </div>
      </div>
      <div className="header-actions">
        <div className="sync-controls">
          <div className="sync-status">
            {lastSyncTime ? `Last synced: ${lastSyncTime.toLocaleTimeString()}` : 'Not synced yet'}
          </div>
          <button
            className="btn btn-primary"
            onClick={syncSchedule}
            disabled={isSyncing}
          >
            <RefreshCw size={18} className={isSyncing ? 'spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync Schedule'}
          </button>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${isSyncing ? 'syncing' : lastSyncTime ? 'synced' : ''}`} />
          <span>{syncStatus}</span>
        </div>
      </div>
    </header>
  );
}

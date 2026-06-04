import React from 'react';
import { X, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export default function SyncReportModal({ report, onClose }) {
  if (!report) return null;

  const { successCount, failCount, failed, skipped, scheduleDiff, conflictDiff } = report;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div style={{
        background: 'var(--panel-bg)',
        width: '100%',
        maxWidth: '550px',
        maxHeight: '90vh',
        borderRadius: '12px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-color)'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Sync Report Details</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '0.25rem', borderRadius: '4px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto' }}>
          
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Branches Summary
            </h3>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)' }}>
                <CheckCircle size={16} /> <strong>{successCount}</strong> synced
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: failCount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                <XCircle size={16} /> <strong>{failCount}</strong> failed
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
                <AlertTriangle size={16} /> <strong>{skipped.length}</strong> skipped
              </div>
            </div>
            {failed.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
                Failed branches: {failed.join(', ')}
              </div>
            )}
            {skipped.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Skipped branches: {skipped.join(', ')}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Classes Diff
            </h3>
            {scheduleDiff.added.length === 0 && scheduleDiff.removed.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No changes to classes.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {scheduleDiff.added.length > 0 && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>+{scheduleDiff.added.length}</span> added
                  </div>
                )}
                {scheduleDiff.removed.length > 0 && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>-{scheduleDiff.removed.length}</span> removed
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Conflicts Diff
            </h3>
            {conflictDiff.added.length === 0 && conflictDiff.resolved.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No changes to conflicts.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {conflictDiff.added.length > 0 && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }}>+{conflictDiff.added.length}</span> new conflicts
                  </div>
                )}
                {conflictDiff.resolved.length > 0 && (
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>-{conflictDiff.resolved.length}</span> conflicts resolved
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

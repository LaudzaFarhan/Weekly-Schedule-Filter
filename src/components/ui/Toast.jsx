'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastIdCounter = 0;

const VARIANT_CONFIG = {
  success: { icon: CheckCircle, color: 'var(--success)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)' },
  error:   { icon: XCircle,      color: 'var(--danger)'  },
  info:    { icon: Info,         color: 'var(--primary-blue)' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback((options = {}) => {
    const id = ++toastIdCounter;
    const toast = {
      id,
      title: options.title || '',
      message: options.message || '',
      details: options.details || null, // [{ label, value, variant }]
      variant: options.variant || 'info',
      duration: options.duration ?? 6000,
    };
    setToasts((prev) => [...prev, toast]);

    if (toast.duration > 0) {
      const timer = setTimeout(() => dismissToast(id), toast.duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismissToast]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const cfg = VARIANT_CONFIG[toast.variant] || VARIANT_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <div className="toast-item" style={{ borderLeftColor: cfg.color }} role="status">
      <div className="toast-icon" style={{ color: cfg.color }}>
        <Icon size={18} />
      </div>
      <div className="toast-body">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        {toast.message && <div className="toast-message">{toast.message}</div>}
        {toast.details && toast.details.length > 0 && (
          <div className="toast-details">
            {toast.details.map((d, i) => (
              <span key={i} className={`toast-chip toast-chip-${d.variant || 'neutral'}`}>
                {d.value !== '' && d.value !== undefined && d.value !== null && (
                  <strong style={{ marginRight: d.label ? '4px' : 0 }}>{d.value}</strong>
                )}
                {d.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

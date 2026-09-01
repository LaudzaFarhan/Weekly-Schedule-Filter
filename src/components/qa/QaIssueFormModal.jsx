'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Upload, 
  Image as ImageIcon, 
  Sparkles, 
  Trash2, 
  Eye, 
  Edit3, 
  Monitor, 
  ClipboardPaste, 
  AlertCircle, 
  Check, 
  Loader2 
} from 'lucide-react';
import { 
  ISSUE_TYPES, 
  ISSUE_PRIORITIES, 
  ISSUE_MODULES, 
  ISSUE_STATUSES,
  createIssue, 
  updateIssue, 
  compressImage, 
  captureEnvironmentInfo 
} from '@/services/qaTrackerService';
import ImageAnnotatorModal from './ImageAnnotatorModal';
import ImageViewerModal from './ImageViewerModal';

export default function QaIssueFormModal({
  isOpen,
  issue = null, // if provided, edit mode
  currentUser = null,
  onClose,
  onSuccess
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('Bug');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('Open');
  const [moduleName, setModuleName] = useState('General');
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [includeEnv, setIncludeEnv] = useState(true);
  const [envInfo, setEnvInfo] = useState({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Annotator Modal State
  const [annotatingImg, setAnnotatingImg] = useState(null);
  const [annotatingIndex, setAnnotatingIndex] = useState(-1);

  // Viewer Modal State
  const [viewingIndex, setViewingIndex] = useState(-1);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    if (issue) {
      setTitle(issue.title || '');
      setDescription(issue.description || '');
      setType(issue.type || 'Bug');
      setPriority(issue.priority || 'Medium');
      setStatus(issue.status || 'Open');
      setModuleName(issue.module || 'General');
      setAssigneeName(issue.assigneeName || '');
      setAssigneeEmail(issue.assigneeEmail || '');
      setAttachments(issue.attachments || []);
      setEnvInfo(issue.environment || {});
      setIncludeEnv(Boolean(issue.environment && Object.keys(issue.environment).length > 0));
    } else {
      setTitle('');
      setDescription('');
      setType('Bug');
      setPriority('Medium');
      setStatus('Open');
      setModuleName('General');
      setAssigneeName('');
      setAssigneeEmail('');
      setAttachments([]);
      const env = captureEnvironmentInfo();
      setEnvInfo(env);
      setIncludeEnv(true);
    }
    setError(null);
  }, [isOpen, issue]);

  // Global Clipboard Paste Listener (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = async (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData || !clipboardData.items) return;

      const items = Array.from(clipboardData.items);
      const imageItems = items.filter(item => item.type.startsWith('image/'));

      if (imageItems.length > 0) {
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) {
            try {
              const compressedUrl = await compressImage(file);
              setAttachments(prev => [
                ...prev,
                {
                  id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                  url: compressedUrl,
                  name: `Screenshot_${new Date().toLocaleTimeString().replace(/:/g, '-')}.jpg`,
                  size: Math.round(compressedUrl.length * 0.75),
                  annotated: false,
                  createdAt: new Date().toISOString()
                }
              ]);
            } catch (err) {
              console.error('Error handling pasted image:', err);
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const compressedUrl = await compressImage(file);
        setAttachments(prev => [
          ...prev,
          {
            id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            url: compressedUrl,
            name: file.name,
            size: Math.round(compressedUrl.length * 0.75),
            annotated: false,
            createdAt: new Date().toISOString()
          }
        ]);
      } catch (err) {
        console.error('Error reading uploaded image:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveAttachment = (idxToRemove) => {
    setAttachments(prev => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const handleSaveAnnotatedImage = (annotatedData) => {
    if (annotatingIndex >= 0) {
      setAttachments(prev => prev.map((att, idx) => {
        if (idx === annotatingIndex) {
          return {
            ...att,
            url: annotatedData.url,
            originalUrl: annotatedData.originalUrl,
            annotated: true
          };
        }
        return att;
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a Topic / Title for this issue.');
      return;
    }
    if (!description.trim()) {
      setError('Please provide a Description or Steps to Reproduce.');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      title: title.trim(),
      description: description.trim(),
      type,
      priority,
      status,
      module: moduleName,
      assigneeName: assigneeName.trim() || null,
      assigneeEmail: assigneeEmail.trim() || null,
      attachments,
      environment: includeEnv ? envInfo : {}
    };

    if (!issue) {
      payload.reporterName = currentUser?.displayName || currentUser?.username || 'QA User';
      payload.reporterEmail = currentUser?.email || null;
    }

    try {
      if (issue) {
        await updateIssue(issue.id, payload);
      } else {
        await createIssue(payload);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save QA issue');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="modal-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(5px)',
          zIndex: 9990,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          overflowY: 'auto'
        }}
      >
        <div 
          className="modal-content"
          style={{
            width: '100%',
            maxWidth: '780px',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            animation: 'modalAppear 0.2s ease-out'
          }}
        >
          {/* Modal Header */}
          <div 
            style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc'
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {issue ? 'Edit QA Ticket' : 'Report Problem / Bug / Update'}
              </h2>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                Capture details, attach screenshots, and highlight issues for dev review.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '0.4rem',
                borderRadius: '8px',
                display: 'flex'
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Modal Body */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '1.5rem', gap: '1.25rem' }}>
            {error && (
              <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertCircle size={16} /> {error}
              </div>
            )}

            {/* Topic / Title */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                Topic / Title <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Schedule grid crashes when dragging slot on Tuesday"
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.92rem',
                  outline: 'none'
                }}
                required
              />
            </div>

            {/* Row 1: Type, Priority, Status, Module */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  Category / Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    background: '#fff'
                  }}
                >
                  {ISSUE_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  Priority / Severity
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    background: '#fff'
                  }}
                >
                  {ISSUE_PRIORITIES.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    background: '#fff'
                  }}
                >
                  {ISSUE_STATUSES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  Module / Page
                </label>
                <select
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    background: '#fff'
                  }}
                >
                  {ISSUE_MODULES.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  Description & Reproduction Steps <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDescription(
                      `**Steps to Reproduce:**\n1. Go to ...\n2. Click on ...\n3. \n\n**Expected Result:**\n...\n\n**Actual Result:**\n...\n\n**Notes / Suggestions:**\n...`
                    );
                  }}
                  style={{
                    fontSize: '0.75rem',
                    background: 'transparent',
                    border: 'none',
                    color: '#4f46e5',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Insert QA Template
                </button>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the issue, steps to reproduce, expected vs actual behavior..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                  resize: 'vertical'
                }}
                required
              />
            </div>

            {/* Attachments Section with Drag & Drop + Clipboard Paste */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  Screenshots & Attachments ({attachments.length})
                </label>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <ClipboardPaste size={13} /> You can press <strong>Ctrl+V</strong> anywhere to paste screenshot
                </span>
              </div>

              {/* Upload Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  textAlign: 'center',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s'
                }}
              >
                <Upload size={24} color="#64748b" style={{ margin: '0 auto 0.4rem auto' }} />
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#334155' }}>
                  Click to upload images, drag and drop, or press Ctrl+V
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  Supports PNG, JPG, WebP (Automatically compressed for instant loading)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Attachment Thumbnails Grid */}
              {attachments.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                  {attachments.map((att, idx) => (
                    <div
                      key={att.id || idx}
                      style={{
                        position: 'relative',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        backgroundColor: '#fff',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      {/* Thumbnail */}
                      <div 
                        style={{ height: '110px', position: 'relative', background: '#0f172a', cursor: 'pointer' }}
                        onClick={() => setViewingIndex(idx)}
                      >
                        <img
                          src={att.url}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {att.annotated && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '6px',
                              left: '6px',
                              background: '#0284c7',
                              color: '#fff',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px'
                            }}
                          >
                            <Sparkles size={10} /> HIGHLIGHTED
                          </div>
                        )}
                      </div>

                      {/* Card Bottom Controls */}
                      <div style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setAnnotatingImg(att);
                            setAnnotatingIndex(idx);
                          }}
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '6px',
                            border: '1px solid #4f46e5',
                            background: '#eef2ff',
                            color: '#4f46e5',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title="Add highlight rectangle, arrow or circle"
                        >
                          <Edit3 size={12} /> {att.annotated ? 'Edit Highlight' : 'Add Highlight'}
                        </button>

                        <div style={{ display: 'flex', gap: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => setViewingIndex(idx)}
                            style={{ padding: '0.25rem', border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer' }}
                            title="View Fullsize"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(idx)}
                            style={{ padding: '0.25rem', border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                            title="Remove attachment"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Environment Auto Capture Switch */}
            <div style={{ padding: '0.75rem', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Monitor size={18} color="#475569" />
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
                    Auto-Capture Device & Browser Info
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {envInfo.browser || 'Browser'} on {envInfo.os || 'OS'} • {envInfo.screen || 'Screen'} • Path: {envInfo.url || '/'}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeEnv}
                onChange={(e) => setIncludeEnv(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>

            {/* Footer Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#4f46e5',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)'
                }}
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="loading-spinner" /> Saving...
                  </>
                ) : (
                  <>
                    <Check size={16} /> {issue ? 'Update Ticket' : 'Create QA Ticket'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Image Annotator Modal */}
      {annotatingImg && (
        <ImageAnnotatorModal
          isOpen={Boolean(annotatingImg)}
          imageSrc={annotatingImg.originalUrl || annotatingImg.url}
          imageName={annotatingImg.name}
          onSave={handleSaveAnnotatedImage}
          onClose={() => {
            setAnnotatingImg(null);
            setAnnotatingIndex(-1);
          }}
        />
      )}

      {/* Image Lightbox Viewer Modal */}
      {viewingIndex >= 0 && (
        <ImageViewerModal
          isOpen={viewingIndex >= 0}
          images={attachments}
          initialIndex={viewingIndex}
          onClose={() => setViewingIndex(-1)}
          onOpenAnnotator={(img, idx) => {
            setViewingIndex(-1);
            setAnnotatingImg(img);
            setAnnotatingIndex(idx);
          }}
        />
      )}
    </>
  );
}

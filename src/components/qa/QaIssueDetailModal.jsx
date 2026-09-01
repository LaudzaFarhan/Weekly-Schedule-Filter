'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Edit3, 
  Trash2, 
  Sparkles, 
  Send, 
  Image as ImageIcon, 
  Monitor, 
  User, 
  Clock, 
  MessageSquare, 
  CheckCircle2, 
  ArrowRight,
  ExternalLink,
  ClipboardPaste,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { 
  ISSUE_STATUSES, 
  STATUS_COLORS, 
  PRIORITY_COLORS, 
  updateIssue, 
  deleteIssue, 
  getComments, 
  addComment,
  compressImage 
} from '@/services/qaTrackerService';
import ImageViewerModal from './ImageViewerModal';
import ImageAnnotatorModal from './ImageAnnotatorModal';

export default function QaIssueDetailModal({
  isOpen,
  issue,
  currentUser,
  onClose,
  onEdit,
  onUpdated,
  onDeleted
}) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentAttachments, setCommentAttachments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  // Status updating state
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Viewer and Annotator
  const [viewingIndex, setViewingIndex] = useState(-1);
  const [viewerImages, setViewerImages] = useState([]);
  const [annotatingImg, setAnnotatingImg] = useState(null);
  const [annotatingIndex, setAnnotatingIndex] = useState(-1);

  const commentFileInputRef = useRef(null);

  // Fetch comments when modal opens
  useEffect(() => {
    if (!isOpen || !issue?.id) return;
    fetchComments();
  }, [isOpen, issue?.id]);

  const fetchComments = async () => {
    try {
      setLoadingComments(true);
      const data = await getComments(issue.id);
      setComments(data);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  // Clipboard Paste (Ctrl+V) for comment box
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
              setCommentAttachments(prev => [
                ...prev,
                {
                  id: `comm_img_${Date.now()}`,
                  url: compressedUrl,
                  name: `Retest_Screenshot_${new Date().toLocaleTimeString().replace(/:/g, '-')}.jpg`,
                  annotated: false
                }
              ]);
            } catch (err) {
              console.error('Error pasting comment screenshot:', err);
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  const handleStatusChange = async (newStatus) => {
    if (newStatus === issue.status || updatingStatus) return;
    try {
      setUpdatingStatus(true);
      const updated = await updateIssue(issue.id, { status: newStatus });
      
      // Auto-log a system comment about status transition
      await addComment(issue.id, {
        userName: currentUser?.displayName || currentUser?.username || 'System',
        userEmail: currentUser?.email || null,
        comment: `Changed status from **${issue.status}** to **${newStatus}**`
      });

      onUpdated(updated);
      fetchComments();
    } catch (err) {
      console.error('Error changing status:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ticket #${issue.id}: "${issue.title}"?`)) return;
    try {
      await deleteIssue(issue.id);
      onDeleted(issue.id);
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to delete issue');
    }
  };

  const handleSendComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() && commentAttachments.length === 0) return;

    try {
      setSendingComment(true);
      const commentData = {
        userName: currentUser?.displayName || currentUser?.username || 'QA User',
        userEmail: currentUser?.email || null,
        comment: newComment.trim(),
        attachments: commentAttachments
      };
      await addComment(issue.id, commentData);
      setNewComment('');
      setCommentAttachments([]);
      fetchComments();
      if (onUpdated) onUpdated({ ...issue, commentCount: (issue.commentCount || 0) + 1 });
    } catch (err) {
      alert(err.message || 'Failed to post comment');
    } finally {
      setSendingComment(false);
    }
  };

  const handleCommentFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const compressedUrl = await compressImage(file);
        setCommentAttachments(prev => [
          ...prev,
          {
            id: `comm_img_${Date.now()}`,
            url: compressedUrl,
            name: file.name,
            annotated: false
          }
        ]);
      } catch (err) {
        console.error('Error reading comment attachment:', err);
      }
    }
    if (commentFileInputRef.current) commentFileInputRef.current.value = '';
  };

  const handleSaveAnnotatedImage = async (annotatedData) => {
    if (annotatingIndex >= 0 && issue.attachments) {
      const updatedAttachments = issue.attachments.map((att, idx) => {
        if (idx === annotatingIndex) {
          return {
            ...att,
            url: annotatedData.url,
            originalUrl: annotatedData.originalUrl,
            annotated: true
          };
        }
        return att;
      });

      try {
        const updated = await updateIssue(issue.id, { attachments: updatedAttachments });
        onUpdated(updated);
      } catch (err) {
        console.error('Error updating annotated attachment in ticket:', err);
      }
    }
  };

  if (!isOpen || !issue) return null;

  const statusStyle = STATUS_COLORS[issue.status] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
  const priorityStyle = PRIORITY_COLORS[issue.priority] || { bg: '#64748b', text: '#fff' };

  return (
    <>
      <div 
        className="modal-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(5px)',
          zIndex: 9980,
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
            maxWidth: '860px',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            animation: 'modalAppear 0.2s ease-out'
          }}
        >
          {/* Top Bar */}
          <div 
            style={{
              padding: '1.25rem 1.75rem',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', background: '#e2e8f0', padding: '0.2rem 0.55rem', borderRadius: '6px' }}>
                  #{issue.id}
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '0.2rem 0.55rem', borderRadius: '6px' }}>
                  {issue.type || 'Bug'}
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: priorityStyle.text, background: priorityStyle.bg, padding: '0.2rem 0.55rem', borderRadius: '6px' }}>
                  {issue.priority} Priority
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#334155', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.2rem 0.55rem', borderRadius: '6px' }}>
                  {issue.module || 'General'}
                </span>
              </div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0f172a', margin: 0, lineHeight: 1.3 }}>
                {issue.title}
              </h2>
            </div>

            {/* Top Right Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => onEdit(issue)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#334155',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
                title="Edit Ticket"
              >
                <Edit3 size={14} /> Edit
              </button>

              <button
                type="button"
                onClick={handleDelete}
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #fecaca',
                  background: '#fef2f2',
                  color: '#ef4444',
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
                title="Delete Ticket"
              >
                <Trash2 size={15} />
              </button>

              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '0.45rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex'
                }}
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Workflow Status Bar */}
          <div 
            style={{
              padding: '0.65rem 1.75rem',
              background: '#f1f5f9',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.6rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>
              <span>Status:</span>
              <span style={{ 
                padding: '0.2rem 0.65rem', 
                borderRadius: '6px', 
                backgroundColor: statusStyle.bg, 
                color: statusStyle.text, 
                border: `1px solid ${statusStyle.border}`,
                fontWeight: 700
              }}>
                {issue.status}
              </span>
            </div>

            {/* Quick Status Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', marginRight: '0.2rem' }}>Move to:</span>
              {ISSUE_STATUSES.map(st => {
                if (st === issue.status) return null;
                const style = STATUS_COLORS[st] || { bg: '#fff', text: '#334155', border: '#cbd5e1' };
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleStatusChange(st)}
                    style={{
                      padding: '0.25rem 0.55rem',
                      borderRadius: '6px',
                      border: `1px solid ${style.border}`,
                      background: '#fff',
                      color: style.text,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = style.bg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#fff';
                    }}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div style={{ overflowY: 'auto', padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Meta Row: Reporter, Assignee, Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', background: '#f8fafc', padding: '0.85rem 1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Reporter</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1e293b', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <User size={14} color="#64748b" /> {issue.reporterName || 'Unknown'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Assignee</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: issue.assigneeName ? '#1e293b' : '#94a3b8', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <ShieldCheck size={14} color="#64748b" /> {issue.assigneeName || 'Unassigned'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Created</div>
                <div style={{ fontSize: '0.85rem', color: '#334155', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Clock size={14} color="#64748b" /> {new Date(issue.createdAt).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>
                Description & Reproduction Steps
              </h3>
              <div 
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '1rem 1.25rem',
                  fontSize: '0.9rem',
                  lineHeight: '1.6',
                  color: '#334155',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {issue.description}
              </div>
            </div>

            {/* Environment Information (if available) */}
            {issue.environment && Object.keys(issue.environment).length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Monitor size={16} /> Environment Captured
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {issue.environment.browser && (
                    <span style={{ fontSize: '0.78rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', color: '#334155' }}>
                      🌐 Browser: <strong>{issue.environment.browser}</strong>
                    </span>
                  )}
                  {issue.environment.os && (
                    <span style={{ fontSize: '0.78rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', color: '#334155' }}>
                      💻 OS: <strong>{issue.environment.os}</strong>
                    </span>
                  )}
                  {issue.environment.screen && (
                    <span style={{ fontSize: '0.78rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', color: '#334155' }}>
                      🖥️ Screen: <strong>{issue.environment.screen}</strong>
                    </span>
                  )}
                  {issue.environment.url && (
                    <span style={{ fontSize: '0.78rem', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', color: '#334155' }}>
                      🔗 URL: <strong>{issue.environment.url}</strong>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Attachments Section */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ImageIcon size={16} /> Attached Screenshots ({issue.attachments?.length || 0})
              </h3>

              {(!issue.attachments || issue.attachments.length === 0) ? (
                <div style={{ padding: '1rem', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' }}>
                  No screenshots attached to this ticket.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.85rem' }}>
                  {issue.attachments.map((att, idx) => (
                    <div
                      key={att.id || idx}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        backgroundColor: '#fff',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      {/* Thumbnail with click to view */}
                      <div
                        style={{ height: '130px', position: 'relative', background: '#0f172a', cursor: 'pointer' }}
                        onClick={() => {
                          setViewerImages(issue.attachments);
                          setViewingIndex(idx);
                        }}
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
                      <div style={{ padding: '0.5rem 0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' }}>
                          {att.name || `Image ${idx + 1}`}
                        </span>

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
                        >
                          <Edit3 size={12} /> {att.annotated ? 'Edit Highlight' : 'Add Highlight'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Retest & Discussion Comments Thread */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <MessageSquare size={16} /> Retest & Comments ({comments.length})
              </h3>

              {/* Comments List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {comments.length === 0 ? (
                  <div style={{ padding: '1rem', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>
                    No comments yet. QA and developers can post retest updates and discussion below.
                  </div>
                ) : (
                  comments.map((comm) => (
                    <div
                      key={comm.id}
                      style={{
                        padding: '0.85rem 1rem',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <User size={13} color="#4f46e5" /> {comm.userName || comm.userEmail || 'Anonymous'}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          {new Date(comm.createdAt).toLocaleString()}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.86rem', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {comm.comment}
                      </div>

                      {/* Comment Attachments */}
                      {comm.attachments && comm.attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {comm.attachments.map((cAtt, cIdx) => (
                            <img
                              key={cIdx}
                              src={cAtt.url}
                              alt=""
                              onClick={() => {
                                setViewerImages(comm.attachments);
                                setViewingIndex(cIdx);
                              }}
                              style={{
                                width: '80px',
                                height: '60px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                cursor: 'pointer'
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Add Comment Box with Ctrl+V Support */}
              <form onSubmit={handleSendComment} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Post an update, re-test note, or feedback (Press Ctrl+V to attach a screenshot)..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />

                {/* Comment Attached Thumbnails */}
                {commentAttachments.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {commentAttachments.map((cAtt, idx) => (
                      <div key={idx} style={{ position: 'relative', width: '60px', height: '45px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                        <img src={cAtt.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button
                          type="button"
                          onClick={() => setCommentAttachments(prev => prev.filter((_, i) => i !== idx))}
                          style={{
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '50%',
                            width: '16px',
                            height: '16px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px'
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => commentFileInputRef.current?.click()}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#475569',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      <ImageIcon size={13} /> Attach Image
                    </button>
                    <input
                      ref={commentFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleCommentFileUpload}
                      style={{ display: 'none' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      (or press Ctrl+V to paste)
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={sendingComment || (!newComment.trim() && commentAttachments.length === 0)}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#4f46e5',
                      color: '#fff',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: (sendingComment || (!newComment.trim() && commentAttachments.length === 0)) ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)'
                    }}
                  >
                    <Send size={13} /> Post Comment
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Image Lightbox Viewer Modal */}
      {viewingIndex >= 0 && (
        <ImageViewerModal
          isOpen={viewingIndex >= 0}
          images={viewerImages}
          initialIndex={viewingIndex}
          onClose={() => setViewingIndex(-1)}
          onOpenAnnotator={(img, idx) => {
            setViewingIndex(-1);
            setAnnotatingImg(img);
            setAnnotatingIndex(idx);
          }}
        />
      )}

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
    </>
  );
}

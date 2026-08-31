'use client';

/**
 * Rubrics and Setup — Per-Program Category (Kinder, Junior, Coder) Rubric Management.
 *
 * Allows viewing, editing, adding, and reordering competencies and descriptors 1–5
 * for each program category independently.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardList, Plus, Edit3, Check, RotateCcw, Trash2, ArrowLeft,
  ArrowRight, Sparkles, AlertCircle, Info, X, Palette, HelpCircle
} from 'lucide-react';

import { useToast } from '../components/ui/Toast';
import { useAuth } from '../contexts/AuthContext';
import {
  getRubricCompetencies,
  createRubricCompetency,
  updateRubricCompetency,
  reorderRubricCompetencies,
  deleteRubricCompetency
} from '../services/rubricCompetenciesService';
import { COMPETENCIES as DEFAULT_COMPETENCIES, RUBRIC_LEVELS as DEFAULT_RUBRIC_LEVELS } from '../lib/reportCardRubric';

const CATEGORIES = ['Kinder', 'Junior', 'Coder'];
const RATINGS = [5, 4, 3, 2, 1];

const COLOR_PALETTE = [
  '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899',
  '#06b6d4', '#eab308', '#64748b', '#6366f1', '#14b8a6'
];

export default function NewRubricSetupPage() {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [activeCategory, setActiveCategory] = useState('Kinder');
  const [data, setData] = useState({
    categories: CATEGORIES,
    competencies: { Kinder: [], Junior: [], Coder: [] },
    usingFallback: { Kinder: true, Junior: true, Coder: true },
    maxPerCategory: 8,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Add Competency Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [newDescriptors, setNewDescriptors] = useState({
    5: 'Excellent performance and independence',
    4: 'Good understanding with minor support',
    3: 'Capable with guided questions',
    2: 'Needs frequent guidance',
    1: 'Beginning with step-by-step assistance',
  });
  const [addError, setAddError] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  // Reset Modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Delete Target
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCompetencies = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getRubricCompetencies({ includeInactive: false });
      setData(res);
    } catch (err) {
      setError(err.message || 'Unable to load rubric competencies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompetencies();
  }, [fetchCompetencies]);

  const currentList = useMemo(() => {
    return data.competencies[activeCategory] || [];
  }, [data.competencies, activeCategory]);

  const isUsingFallback = Boolean(data.usingFallback?.[activeCategory]);

  // Initialise drafts when entering edit mode or changing category
  const initDrafts = useCallback((list) => {
    const draftMap = {};
    list.forEach((c) => {
      const draftKey = c.id ? String(c.id) : c.key;
      draftMap[draftKey] = {
        id: c.id,
        key: c.key,
        label: c.label,
        color: c.color || '#3b82f6',
        descriptors: {
          5: c.descriptors?.[5] ?? c.descriptors?.['5'] ?? DEFAULT_RUBRIC_LEVELS[c.key]?.[5] ?? '',
          4: c.descriptors?.[4] ?? c.descriptors?.['4'] ?? DEFAULT_RUBRIC_LEVELS[c.key]?.[4] ?? '',
          3: c.descriptors?.[3] ?? c.descriptors?.['3'] ?? DEFAULT_RUBRIC_LEVELS[c.key]?.[3] ?? '',
          2: c.descriptors?.[2] ?? c.descriptors?.['2'] ?? DEFAULT_RUBRIC_LEVELS[c.key]?.[2] ?? '',
          1: c.descriptors?.[1] ?? c.descriptors?.['1'] ?? DEFAULT_RUBRIC_LEVELS[c.key]?.[1] ?? '',
        },
      };
    });
    setDrafts(draftMap);
  }, []);

  useEffect(() => {
    if (currentList.length > 0) {
      initDrafts(currentList);
    }
  }, [currentList, initDrafts]);

  const handleCategoryChange = (cat) => {
    if (isEditing) {
      if (!window.confirm('You have unsaved changes in this category. Switch tab anyway?')) {
        return;
      }
      setIsEditing(false);
    }
    setActiveCategory(cat);
  };

  const handleUpdateDraft = (draftKey, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: {
        ...prev[draftKey],
        [field]: value,
      },
    }));
  };

  const handleUpdateDescriptor = (draftKey, rating, text) => {
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: {
        ...prev[draftKey],
        descriptors: {
          ...prev[draftKey]?.descriptors,
          [rating]: text,
        },
      },
    }));
  };

  // Save a single competency card
  const handleSaveCard = async (c) => {
    const draftKey = c.id ? String(c.id) : c.key;
    const draft = drafts[draftKey];
    if (!draft) return;

    if (!draft.label?.trim()) {
      showToast({ title: 'Label cannot be empty', variant: 'error' });
      return;
    }
    for (const r of RATINGS) {
      if (!draft.descriptors?.[r]?.trim()) {
        showToast({ title: `Rating ${r} descriptor cannot be empty`, variant: 'error' });
        return;
      }
    }

    try {
      setSavingKey(draftKey);
      if (c.id) {
        // Update existing row
        await updateRubricCompetency(c.id, {
          label: draft.label.trim(),
          color: draft.color,
          descriptors: draft.descriptors,
        });
      } else {
        // Fallback row being modified -> create first custom entry (which seeds the rest)
        await createRubricCompetency({
          category: activeCategory,
          key: draft.key,
          label: draft.label.trim(),
          color: draft.color,
          descriptors: draft.descriptors,
        });
      }
      showToast({ title: `Saved "${draft.label}" for ${activeCategory}`, variant: 'success' });
      await fetchCompetencies();
    } catch (err) {
      showToast({ title: 'Could not save competency', message: err.message, variant: 'error' });
    } finally {
      setSavingKey(null);
    }
  };

  // Save all modified competencies in active category
  const handleSaveAll = async () => {
    // Validate all drafts
    for (const c of currentList) {
      const draftKey = c.id ? String(c.id) : c.key;
      const draft = drafts[draftKey];
      if (!draft?.label?.trim()) {
        showToast({ title: `Label for "${c.label}" cannot be empty`, variant: 'error' });
        return;
      }
      for (const r of RATINGS) {
        if (!draft?.descriptors?.[r]?.trim()) {
          showToast({ title: `Rating ${r} in "${draft.label}" cannot be empty`, variant: 'error' });
          return;
        }
      }
    }

    setIsSavingAll(true);
    try {
      for (const c of currentList) {
        const draftKey = c.id ? String(c.id) : c.key;
        const draft = drafts[draftKey];
        if (c.id) {
          await updateRubricCompetency(c.id, {
            label: draft.label.trim(),
            color: draft.color,
            descriptors: draft.descriptors,
          });
        } else {
          await createRubricCompetency({
            category: activeCategory,
            key: draft.key,
            label: draft.label.trim(),
            color: draft.color,
            descriptors: draft.descriptors,
          });
        }
      }
      showToast({ title: `All ${activeCategory} competencies saved!`, variant: 'success' });
      setIsEditing(false);
      await fetchCompetencies();
    } catch (err) {
      showToast({ title: 'Error saving changes', message: err.message, variant: 'error' });
    } finally {
      setIsSavingAll(false);
    }
  };

  // Reorder competencies
  const handleMove = async (index, direction) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= currentList.length) return;

    // If using fallback, we must first ensure rows are materialized
    if (isUsingFallback) {
      showToast({ title: 'Save your customized rubric before reordering', variant: 'warning' });
      return;
    }

    const reordered = [...currentList];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, moved);

    const ids = reordered.map((c) => c.id).filter(Boolean);
    try {
      await reorderRubricCompetencies(ids);
      await fetchCompetencies();
    } catch (err) {
      showToast({ title: 'Could not reorder', message: err.message, variant: 'error' });
    }
  };

  // Add Competency Submission
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAddError(null);

    const cleanKey = newKey.trim();
    const cleanLabel = newLabel.trim();

    if (!cleanKey) {
      setAddError('Key is required.');
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(cleanKey)) {
      setAddError('Key must start with a letter and contain only letters and digits (no spaces).');
      return;
    }
    if (!cleanLabel) {
      setAddError('Display label is required.');
      return;
    }
    for (const r of RATINGS) {
      if (!newDescriptors[r]?.trim()) {
        setAddError(`Descriptor for rating ${r} is required.`);
        return;
      }
    }

    setIsAdding(true);
    try {
      await createRubricCompetency({
        category: activeCategory,
        key: cleanKey,
        label: cleanLabel,
        color: newColor,
        descriptors: newDescriptors,
      });
      showToast({ title: `Added "${cleanLabel}" to ${activeCategory} rubric`, variant: 'success' });
      setShowAddModal(false);
      setNewKey('');
      setNewLabel('');
      await fetchCompetencies();
    } catch (err) {
      setAddError(err.message || 'Could not add competency');
    } finally {
      setIsAdding(false);
    }
  };

  // Delete / Retire
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.id) {
        await deleteRubricCompetency(deleteTarget.id, { hard: true });
      }
      showToast({ title: `Removed "${deleteTarget.label}" from ${activeCategory}`, variant: 'success' });
      setDeleteTarget(null);
      await fetchCompetencies();
    } catch (err) {
      showToast({ title: 'Could not remove competency', message: err.message, variant: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  // Reset to Defaults
  const handleResetConfirm = async () => {
    setIsResetting(true);
    try {
      // Hard delete all custom rows in this category so fallback is active
      for (const c of currentList) {
        if (c.id) {
          await deleteRubricCompetency(c.id, { hard: true });
        }
      }
      showToast({ title: `Reset ${activeCategory} rubric to default standards`, variant: 'success' });
      setShowResetModal(false);
      setIsEditing(false);
      await fetchCompetencies();
    } catch (err) {
      showToast({ title: 'Could not reset rubric', message: err.message, variant: 'error' });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <section className="dashboard-view active">
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <ClipboardList size={20} /> Rubrics and Setup
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Customize competencies and 1–5 scoring rating descriptors per program curriculum (Kinder, Junior, Coder).
            </p>
          </div>

          {/* Program Category Switcher Tabs */}
          <div style={{
            display: 'flex', background: 'var(--bg-color)', padding: '0.25rem', borderRadius: '10px',
            border: '1px solid var(--border-color)', gap: '0.25rem',
          }}>
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat;
              const count = data.competencies[cat]?.length || 5;
              const isFallback = Boolean(data.usingFallback?.[cat]);

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleCategoryChange(cat)}
                  style={{
                    padding: '0.4rem 0.9rem',
                    fontSize: '0.82rem',
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? 'var(--panel-bg, white)' : 'transparent',
                    color: isActive ? 'var(--primary-blue)' : 'var(--text-secondary)',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{cat}</span>
                  <span style={{
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    padding: '0.05rem 0.35rem',
                    borderRadius: '99px',
                    background: isActive ? 'var(--primary-blue-light)' : 'rgba(0,0,0,0.06)',
                    color: isActive ? 'var(--primary-blue)' : 'var(--text-muted)',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Category Header & Controls Toolbar ──────────────────── */}
      <div className="panel" style={{ marginBottom: '1.25rem', background: 'var(--panel-bg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '1rem 1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                {activeCategory} Scoring Guidelines
              </h3>
              {isUsingFallback ? (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: '99px',
                  background: 'rgba(59,130,246,0.1)', color: 'var(--primary-blue)', border: '1px solid rgba(59,130,246,0.25)',
                }}>
                  Standard Default Rubric
                </span>
              ) : (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: '99px',
                  background: 'rgba(16,185,129,0.12)', color: 'var(--success, #059669)', border: '1px solid rgba(16,185,129,0.3)',
                }}>
                  Customized Rubric ({currentList.length} Competencies)
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: 0 }}>
              The rating wording used when evaluating students enrolled in {activeCategory} programs.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
                >
                  <Edit3 size={15} /> Edit Rubric
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewKey('');
                    setNewLabel('');
                    setNewColor(COLOR_PALETTE[currentList.length % COLOR_PALETTE.length]);
                    setAddError(null);
                    setShowAddModal(true);
                  }}
                  disabled={currentList.length >= (data.maxPerCategory || 8)}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
                  title={currentList.length >= 8 ? 'Maximum 8 competencies reached' : 'Add a new competency'}
                >
                  <Plus size={15} /> Add Competency
                </button>
                {!isUsingFallback && (
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    className="btn btn-secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.45rem 0.75rem', color: 'var(--text-muted)' }}
                    title="Reset this category to standard defaults"
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    initDrafts(currentList);
                    setIsEditing(false);
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={isSavingAll}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.45rem 1rem' }}
                >
                  <Check size={15} /> {isSavingAll ? 'Saving All…' : 'Done & Save All'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem',
          padding: '0.8rem 1rem', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
        }}>
          <AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* ── Competencies Grid ─────────────────────────────────────── */}
      {loading ? (
        <div className="panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading rubric guidelines for {activeCategory}…
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
          alignItems: 'stretch',
        }}>
          {currentList.map((c, idx) => {
            const draftKey = c.id ? String(c.id) : c.key;
            const draft = drafts[draftKey] || {
              label: c.label,
              color: c.color || '#3b82f6',
              descriptors: c.descriptors || DEFAULT_RUBRIC_LEVELS[c.key] || {},
            };
            const cardColor = draft.color || c.color || '#3b82f6';
            const isSavingThis = savingKey === draftKey;

            return (
              <article
                key={draftKey}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  background: 'var(--panel-bg, white)',
                  padding: '1.1rem 1.25rem',
                  borderTop: `4px solid ${cardColor}`,
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {/* Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  {!isEditing ? (
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: cardColor }}>
                        {c.label}
                      </h4>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        key: {c.key}
                      </span>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        value={draft.label}
                        onChange={(e) => handleUpdateDraft(draftKey, 'label', e.target.value)}
                        className="modal-input-field"
                        style={{ fontSize: '0.9rem', fontWeight: 700, padding: '0.35rem 0.5rem', width: '100%', marginBottom: '0.35rem' }}
                        placeholder="Competency Label"
                      />
                      {/* Color swatch picker */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {COLOR_PALETTE.map((swatch) => (
                          <button
                            key={swatch}
                            type="button"
                            onClick={() => handleUpdateDraft(draftKey, 'color', swatch)}
                            style={{
                              width: '18px', height: '18px', borderRadius: '50%', background: swatch, border: draft.color === swatch ? '2px solid #000' : '1px solid rgba(0,0,0,0.15)',
                              cursor: 'pointer', padding: 0, transform: draft.color === swatch ? 'scale(1.2)' : 'scale(1)',
                            }}
                            title={swatch}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions in Edit Mode */}
                  {isEditing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, -1)}
                        disabled={idx === 0 || isUsingFallback}
                        style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', padding: '0.2rem' }}
                        title="Move left"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === currentList.length - 1 || isUsingFallback}
                        style={{ background: 'transparent', border: 'none', cursor: idx === currentList.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', padding: '0.2rem' }}
                        title="Move right"
                      >
                        <ArrowRight size={14} />
                      </button>
                      {currentList.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(c)}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.2rem' }}
                          title="Delete / Retire competency"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Rating Descriptors List */}
                <dl style={{ margin: '0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1 }}>
                  {RATINGS.map((rating) => {
                    const text = draft.descriptors?.[rating] ?? '';

                    return (
                      <div key={rating} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                        <dt style={{
                          flexShrink: 0,
                          width: '1.5rem',
                          height: '1.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          color: cardColor,
                          border: `1.5px solid ${cardColor}`,
                          background: 'rgba(0,0,0,0.02)',
                          marginTop: isEditing ? '0.2rem' : 0,
                        }}>
                          {rating}
                        </dt>
                        <dd style={{ margin: 0, flex: 1 }}>
                          {!isEditing ? (
                            <span style={{ fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--text-secondary)', display: 'block' }}>
                              {text || '—'}
                            </span>
                          ) : (
                            <textarea
                              rows={2}
                              value={text}
                              onChange={(e) => handleUpdateDescriptor(draftKey, rating, e.target.value)}
                              className="modal-input-field"
                              style={{
                                fontSize: '0.76rem',
                                padding: '0.35rem 0.5rem',
                                width: '100%',
                                resize: 'vertical',
                                lineHeight: 1.35,
                              }}
                              placeholder={`Descriptor for Rating ${rating}`}
                            />
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>

                {/* Single card Save in edit mode */}
                {isEditing && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => handleSaveCard(c)}
                      disabled={isSavingThis}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.74rem', padding: '0.3rem 0.7rem' }}
                    >
                      {isSavingThis ? 'Saving…' : 'Save Competency'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* ── Add Competency Modal ──────────────────────────────────── */}
      {showAddModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ width: '90%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '14px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={18} style={{ color: 'var(--primary-blue)' }} /> Add Competency for {activeCategory}
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit}>
              {addError && (
                <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: 'var(--danger)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                  {addError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label className="modal-form-label">Key (Slug) *</label>
                  <input
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                    placeholder="e.g. logicCode"
                    className="modal-input-field"
                    required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Immutable identifier</span>
                </div>
                <div>
                  <label className="modal-form-label">Display Label *</label>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Logic & Code"
                    className="modal-input-field"
                    required
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Heading on reports</span>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="modal-form-label">Theme Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                  {COLOR_PALETTE.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setNewColor(swatch)}
                      style={{
                        width: '24px', height: '24px', borderRadius: '50%', background: swatch,
                        border: newColor === swatch ? '2px solid #000' : '1px solid rgba(0,0,0,0.15)',
                        cursor: 'pointer', padding: 0, transform: newColor === swatch ? 'scale(1.15)' : 'scale(1)',
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0, background: 'transparent' }}
                    title="Custom hex color"
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label className="modal-form-label">Rating Descriptors (5 down to 1) *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.4rem' }}>
                  {RATINGS.map((r) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{
                        width: '1.5rem', height: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '6px', border: `1.5px solid ${newColor}`, color: newColor, fontWeight: 700, fontSize: '0.75rem',
                      }}>
                        {r}
                      </span>
                      <input
                        type="text"
                        value={newDescriptors[r] || ''}
                        onChange={(e) => setNewDescriptors((prev) => ({ ...prev, [r]: e.target.value }))}
                        className="modal-input-field"
                        style={{ flex: 1, fontSize: '0.78rem' }}
                        placeholder={`Descriptor for score ${r}`}
                        required
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
                  Cancel
                </button>
                <button type="submit" disabled={isAdding} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
                  {isAdding ? 'Adding…' : 'Add Competency'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────── */}
      {deleteTarget && (
        <div className="modal-overlay" role="dialog" aria-modal="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ width: '90%', maxWidth: '440px', borderRadius: '14px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--danger)' }}>
              Remove Competency?
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
              Are you sure you want to remove <strong>&ldquo;{deleteTarget.label}&rdquo;</strong> from the {activeCategory} rubric?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
                Cancel
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={isDeleting} className="btn btn-danger" style={{ fontSize: '0.82rem' }}>
                {isDeleting ? 'Removing…' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Confirmation Modal ─────────────────────────────── */}
      {showResetModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ width: '90%', maxWidth: '460px', borderRadius: '14px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
              Reset {activeCategory} Rubric to Defaults?
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
              This will discard any custom competencies and descriptors for <strong>{activeCategory}</strong>, reverting it back to the standard 5 competencies (Concept, Building, Problem Solving, Focus, Attitude).
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={() => setShowResetModal(false)} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
                Cancel
              </button>
              <button type="button" onClick={handleResetConfirm} disabled={isResetting} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
                {isResetting ? 'Resetting…' : 'Yes, Reset to Default'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

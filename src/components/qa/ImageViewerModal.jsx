'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Download, 
  Edit3,
  Layers,
  Sparkles
} from 'lucide-react';

export default function ImageViewerModal({
  isOpen,
  images = [],
  initialIndex = 0,
  onClose,
  onOpenAnnotator
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setZoom(1);
    setShowOriginal(false);
  }, [initialIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, images.length]);

  if (!isOpen || !images || images.length === 0) return null;

  const currentImage = images[currentIndex] || images[0];
  const total = images.length;

  const handlePrev = () => {
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : total - 1));
    setZoom(1);
    setShowOriginal(false);
  };

  const handleNext = () => {
    setCurrentIndex(prev => (prev < total - 1 ? prev + 1 : 0));
    setZoom(1);
    setShowOriginal(false);
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.3, 3.5));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.3, 0.5));
  const handleResetZoom = () => setZoom(1);

  const displayUrl = (showOriginal && currentImage.originalUrl) 
    ? currentImage.originalUrl 
    : currentImage.url;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = displayUrl;
    a.download = currentImage.name || `qa_attachment_${currentIndex + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 15, 29, 0.94)',
        backdropFilter: 'blur(10px)',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem',
        userSelect: 'none'
      }}
    >
      {/* Top Header Controls */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#f8fafc',
          zIndex: 10
        }}
      >
        {/* Left: Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {currentImage.name || `Attachment ${currentIndex + 1}`}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', background: '#1e293b', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            {currentIndex + 1} / {total}
          </span>
          {currentImage.annotated && (
            <span style={{ fontSize: '0.75rem', background: '#0284c7', color: '#fff', padding: '0.2rem 0.5rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Sparkles size={12} /> Highlighted
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {currentImage.originalUrl && currentImage.annotated && (
            <button
              type="button"
              onClick={() => setShowOriginal(!showOriginal)}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: showOriginal ? '#eab308' : '#334155',
                color: showOriginal ? '#0f172a' : '#fff',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Layers size={14} /> {showOriginal ? 'Viewing Original' : 'Show Original'}
            </button>
          )}

          {onOpenAnnotator && (
            <button
              type="button"
              onClick={() => onOpenAnnotator(currentImage, currentIndex)}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: '#4f46e5',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Edit3 size={14} /> Add / Edit Highlight
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', background: '#1e293b', borderRadius: '6px', padding: '2px', border: '1px solid #334155' }}>
            <button
              type="button"
              onClick={handleZoomIn}
              style={{ padding: '0.4rem', border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
              title="Zoom In"
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              style={{ padding: '0.4rem', border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
              title="Zoom Out"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              style={{ padding: '0.4rem', border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
              title="Reset Zoom"
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            style={{
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#cbd5e1',
              cursor: 'pointer'
            }}
            title="Download Image"
          >
            <Download size={16} />
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#ef4444',
              color: '#fff',
              cursor: 'pointer'
            }}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Image Area with Left/Right arrows */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          margin: '1rem 0'
        }}
      >
        {total > 1 && (
          <button
            type="button"
            onClick={handlePrev}
            style={{
              position: 'absolute',
              left: '1rem',
              zIndex: 10,
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #475569',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              transition: 'background 0.2s'
            }}
          >
            <ChevronLeft size={24} />
          </button>
        )}

        <img
          src={displayUrl}
          alt={currentImage.name || 'QA Attachment'}
          style={{
            maxWidth: '90vw',
            maxHeight: '75vh',
            objectFit: 'contain',
            transform: `scale(${zoom})`,
            transition: 'transform 0.15s ease-out',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            borderRadius: '8px'
          }}
        />

        {total > 1 && (
          <button
            type="button"
            onClick={handleNext}
            style={{
              position: 'absolute',
              right: '1rem',
              zIndex: 10,
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #475569',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              transition: 'background 0.2s'
            }}
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Bottom Thumbnails */}
      {total > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            overflowX: 'auto',
            padding: '0.5rem 1rem',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            borderRadius: '12px',
            border: '1px solid #334155',
            maxWidth: '80vw'
          }}
        >
          {images.map((img, idx) => (
            <button
              key={img.id || idx}
              type="button"
              onClick={() => {
                setCurrentIndex(idx);
                setZoom(1);
                setShowOriginal(false);
              }}
              style={{
                width: '56px',
                height: '42px',
                borderRadius: '6px',
                overflow: 'hidden',
                border: currentIndex === idx ? '2px solid #38bdf8' : '1px solid #334155',
                padding: 0,
                background: '#0f172a',
                cursor: 'pointer',
                opacity: currentIndex === idx ? 1 : 0.6,
                transform: currentIndex === idx ? 'scale(1.05)' : 'scale(1)',
                transition: 'all 0.15s'
              }}
            >
              <img
                src={img.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

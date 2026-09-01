'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Square, 
  ArrowUpRight, 
  PenTool, 
  Circle, 
  Type, 
  RotateCcw, 
  RotateCw, 
  Trash2, 
  Check, 
  X, 
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

const COLORS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'White', hex: '#ffffff' }
];

const STROKE_WIDTHS = [
  { label: 'S', value: 3 },
  { label: 'M', value: 6 },
  { label: 'L', value: 12 }
];

export default function ImageAnnotatorModal({
  isOpen,
  imageSrc,
  imageName = 'attachment.jpg',
  onSave,
  onClose
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tool, setTool] = useState('box'); // 'box' | 'arrow' | 'pen' | 'circle' | 'text'
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fillHighlight, setFillHighlight] = useState(true);
  const [scale, setScale] = useState(1);
  const [badgeNumber, setBadgeNumber] = useState(1);

  // History for Undo / Redo
  const [shapes, setShapes] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentShape, setCurrentShape] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [baseImage, setBaseImage] = useState(null);

  // Load Base Image
  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setBaseImage(img);
      setShapes([]);
      setHistoryIndex(-1);
      setBadgeNumber(1);
      setScale(1);
    };
    img.src = imageSrc;
  }, [isOpen, imageSrc]);

  // Redraw Canvas whenever shapes or baseImage change
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImage) return;

    const ctx = canvas.getContext('2d');
    canvas.width = baseImage.width;
    canvas.height = baseImage.height;

    // Draw background image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);

    // Draw saved shapes up to historyIndex
    const visibleShapes = shapes.slice(0, historyIndex + 1);
    const allShapes = currentShape ? [...visibleShapes, currentShape] : visibleShapes;

    allShapes.forEach(shape => {
      ctx.save();
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = shape.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (shape.type === 'box') {
        if (shape.fillHighlight) {
          ctx.fillStyle = shape.color + '33'; // 20% opacity fill
          ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        }
        ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      } else if (shape.type === 'circle') {
        ctx.beginPath();
        const rx = Math.abs(shape.w) / 2;
        const ry = Math.abs(shape.h) / 2;
        const cx = shape.x + shape.w / 2;
        const cy = shape.y + shape.h / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        if (shape.fillHighlight) {
          ctx.fillStyle = shape.color + '33';
          ctx.fill();
        }
        ctx.stroke();
      } else if (shape.type === 'arrow') {
        // Draw Arrow line
        const headLength = Math.max(16, shape.strokeWidth * 3);
        const dx = shape.x2 - shape.x1;
        const dy = shape.y2 - shape.y1;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();

        // Draw Arrow head
        ctx.beginPath();
        ctx.moveTo(shape.x2, shape.y2);
        ctx.lineTo(
          shape.x2 - headLength * Math.cos(angle - Math.PI / 6),
          shape.y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          shape.x2 - headLength * Math.cos(angle + Math.PI / 6),
          shape.y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      } else if (shape.type === 'pen') {
        if (shape.points && shape.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (let i = 1; i < shape.points.length; i++) {
            ctx.lineTo(shape.points[i].x, shape.points[i].y);
          }
          ctx.stroke();
        }
      } else if (shape.type === 'text') {
        const radius = Math.max(18, shape.strokeWidth * 3.5);
        // Draw circular badge
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = shape.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw badge number or label
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${radius * 1.1}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shape.text || '1', shape.x, shape.y + 1);
      }
      ctx.restore();
    });
  }, [baseImage, shapes, historyIndex, currentShape]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Convert client coordinates to image canvas coordinates
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e) => {
    if (!baseImage) return;
    const { x, y } = getCanvasCoords(e);
    setIsDrawing(true);

    if (tool === 'box' || tool === 'circle') {
      setCurrentShape({
        type: tool,
        x,
        y,
        w: 0,
        h: 0,
        color,
        strokeWidth,
        fillHighlight
      });
    } else if (tool === 'arrow') {
      setCurrentShape({
        type: 'arrow',
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        color,
        strokeWidth
      });
    } else if (tool === 'pen') {
      setCurrentShape({
        type: 'pen',
        points: [{ x, y }],
        color,
        strokeWidth
      });
    } else if (tool === 'text') {
      const newShape = {
        type: 'text',
        x,
        y,
        text: String(badgeNumber),
        color,
        strokeWidth
      };
      const nextShapes = [...shapes.slice(0, historyIndex + 1), newShape];
      setShapes(nextShapes);
      setHistoryIndex(nextShapes.length - 1);
      setBadgeNumber(prev => prev + 1);
      setIsDrawing(false);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !currentShape) return;
    const { x, y } = getCanvasCoords(e);

    if (currentShape.type === 'box' || currentShape.type === 'circle') {
      setCurrentShape(prev => ({
        ...prev,
        w: x - prev.x,
        h: y - prev.y
      }));
    } else if (currentShape.type === 'arrow') {
      setCurrentShape(prev => ({
        ...prev,
        x2: x,
        y2: y
      }));
    } else if (currentShape.type === 'pen') {
      setCurrentShape(prev => ({
        ...prev,
        points: [...prev.points, { x, y }]
      }));
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentShape) return;
    setIsDrawing(false);

    // Commit shape to history
    const nextShapes = [...shapes.slice(0, historyIndex + 1), currentShape];
    setShapes(nextShapes);
    setHistoryIndex(nextShapes.length - 1);
    setCurrentShape(null);
  };

  const handleUndo = () => {
    if (historyIndex >= 0) {
      setHistoryIndex(prev => prev - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < shapes.length - 1) {
      setHistoryIndex(prev => prev + 1);
    }
  };

  const handleClear = () => {
    if (window.confirm('Clear all highlight annotations?')) {
      setShapes([]);
      setHistoryIndex(-1);
      setBadgeNumber(1);
    }
  };

  const handleSaveAnnotated = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const annotatedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    onSave({
      url: annotatedDataUrl,
      originalUrl: imageSrc,
      name: `annotated_${imageName || 'image.jpg'}`,
      annotated: true,
      hasAnnotations: shapes.length > 0
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="qa-annotator-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      {/* Top Toolbar */}
      <div 
        style={{
          width: '100%',
          maxWidth: '1100px',
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '0.65rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.75rem',
          color: '#f8fafc',
          boxShadow: '0 10px 25px rgba(0,0,0,0.4)'
        }}
      >
        {/* Left Tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginRight: '0.25rem' }}>
            TOOL:
          </span>
          <button
            type="button"
            onClick={() => setTool('box')}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              border: tool === 'box' ? '2px solid #38bdf8' : '1px solid #475569',
              background: tool === 'box' ? '#0369a1' : '#334155',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 500
            }}
            title="Highlight Box (Rectangle)"
          >
            <Square size={15} /> Highlight Box
          </button>

          <button
            type="button"
            onClick={() => setTool('arrow')}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              border: tool === 'arrow' ? '2px solid #38bdf8' : '1px solid #475569',
              background: tool === 'arrow' ? '#0369a1' : '#334155',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 500
            }}
            title="Arrow Pointer"
          >
            <ArrowUpRight size={16} /> Arrow
          </button>

          <button
            type="button"
            onClick={() => setTool('circle')}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              border: tool === 'circle' ? '2px solid #38bdf8' : '1px solid #475569',
              background: tool === 'circle' ? '#0369a1' : '#334155',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 500
            }}
            title="Circle Outline"
          >
            <Circle size={15} /> Circle
          </button>

          <button
            type="button"
            onClick={() => setTool('pen')}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              border: tool === 'pen' ? '2px solid #38bdf8' : '1px solid #475569',
              background: tool === 'pen' ? '#0369a1' : '#334155',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 500
            }}
            title="Freehand Marker"
          >
            <PenTool size={15} /> Marker
          </button>

          <button
            type="button"
            onClick={() => setTool('text')}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              border: tool === 'text' ? '2px solid #38bdf8' : '1px solid #475569',
              background: tool === 'text' ? '#0369a1' : '#334155',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 500
            }}
            title="Click to place step numbers (1, 2, 3...)"
          >
            <Type size={15} /> Badge #{badgeNumber}
          </button>
        </div>

        {/* Middle: Color & Options */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Colors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {COLORS.map(c => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setColor(c.hex)}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: c.hex,
                  border: color === c.hex ? '2px solid #fff' : '2px solid transparent',
                  cursor: 'pointer',
                  outline: color === c.hex ? '2px solid #38bdf8' : 'none',
                  transition: 'transform 0.1s'
                }}
                title={c.name}
              />
            ))}
          </div>

          {/* Stroke Width */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: '#334155', borderRadius: '6px', padding: '2px' }}>
            {STROKE_WIDTHS.map(w => (
              <button
                key={w.label}
                type="button"
                onClick={() => setStrokeWidth(w.value)}
                style={{
                  padding: '0.2rem 0.45rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  borderRadius: '4px',
                  border: 'none',
                  background: strokeWidth === w.value ? '#0284c7' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                {w.label}
              </button>
            ))}
          </div>

          {/* Fill Highlight Checkbox */}
          {(tool === 'box' || tool === 'circle') && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={fillHighlight}
                onChange={(e) => setFillHighlight(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Fill Tint
            </label>
          )}
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex < 0}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#334155',
              color: historyIndex < 0 ? '#64748b' : '#fff',
              cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.8rem'
            }}
            title="Undo"
          >
            <RotateCcw size={14} />
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= shapes.length - 1}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#334155',
              color: historyIndex >= shapes.length - 1 ? '#64748b' : '#fff',
              cursor: historyIndex >= shapes.length - 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.8rem'
            }}
            title="Redo"
          >
            <RotateCw size={14} />
          </button>

          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #ef4444',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.8rem'
            }}
            title="Clear All Annotations"
          >
            <Trash2 size={14} />
          </button>

          <button
            type="button"
            onClick={handleSaveAnnotated}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              background: '#10b981',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.82rem',
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)'
            }}
          >
            <Check size={16} /> Save Highlight
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#334155',
              color: '#cbd5e1',
              cursor: 'pointer'
            }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Canvas Workspace Area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '1100px',
          maxHeight: 'calc(100vh - 160px)',
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          position: 'relative',
          padding: '1rem',
          userSelect: 'none'
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            cursor: tool === 'pen' ? 'crosshair' : 'crosshair',
            borderRadius: '6px'
          }}
        />
      </div>

      {/* Bottom Hint */}
      <div style={{ marginTop: '0.5rem', color: '#94a3b8', fontSize: '0.75rem' }}>
        Tip: Select a tool, click and drag on the image to draw highlights, arrows, or badges. Click &quot;Save Highlight&quot; to apply.
      </div>
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ui/Toast';
import { Terminal, Copy, Check, Database } from 'lucide-react';

const METHOD_COLORS = {
  GET: { color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  POST: { color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  PUT: { color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  DELETE: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
};

// New Operations REST API — backed by PostgreSQL, consumable by Hermes.
const RESOURCES = [
  {
    name: 'Schedule',
    path: '/api/new/schedule',
    table: 'internal_classes',
    description: 'Operational classes (day/time/program/student/teacher).',
    fields: 'day, time, program, student, teacher, branchName, classType, remarks',
    required: 'day, time, program, student, teacher, branchName',
    example: {
      day: 'Monday',
      time: '1.00 pm - 3.00 pm',
      program: 'JF1.5',
      student: 'Dave Kingsley',
      teacher: 'Angel',
      branchName: 'Gading Serpong',
      classType: 'Regular',
      remarks: '',
    },
  },
  {
    name: 'Students',
    path: '/api/new/students',
    table: 'internal_students',
    description: 'Student registry across all branches.',
    fields: 'name, level, branchName, parentName, contact, status, remarks',
    required: 'name, level, branchName',
    example: {
      name: 'Dave Kingsley',
      level: 'Coder Advance 1',
      branchName: 'Gading Serpong',
      parentName: 'Jane Doe',
      contact: '+62 812-3456-789',
      status: 'Active',
      remarks: '',
    },
  },
  {
    name: 'Instructors',
    path: '/api/new/instructors',
    table: 'internal_instructors',
    description: 'Instructor registry with teaching level and branch allocations.',
    fields: 'name, level, branches[], contact, status, remarks',
    required: 'name, level, branches, contact',
    example: {
      name: 'Angel',
      level: 'Kinder and Junior',
      branches: ['Gading Serpong', 'Puri Indah'],
      contact: '+62 812-9166-5690',
      status: 'Active',
      remarks: '',
    },
  },
  {
    name: 'CRM Leads',
    path: '/api/new/crm',
    table: 'new_crm_leads',
    description: 'CRM pipeline leads (trial interest and follow-ups).',
    fields: 'name, phone, message, status, branch, trialDate, notes',
    required: 'name, phone',
    example: {
      name: 'Mom Eny (Parent of Budi)',
      phone: '628123456789',
      message: 'WhatsApp lead',
      status: 'interest_trial',
      branch: 'Bekasi',
      trialDate: '2026-07-18',
      notes: '',
    },
  },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px',
        padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: copied ? 'var(--success, #059669)' : 'var(--text-secondary)',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function MethodBadge({ method }) {
  const c = METHOD_COLORS[method] || METHOD_COLORS.GET;
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: c.color, background: c.bg, padding: '0.12rem 0.45rem', borderRadius: '5px', letterSpacing: '0.03em' }}>
      {method}
    </span>
  );
}

export default function NewApiDocsPage() {
  const { showToast } = useToast();
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setBaseUrl(window.location.origin);
  }, []);

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Terminal size={20} /> New Operations API
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            REST endpoints (PostgreSQL-backed) for Hermes and other integrations. All return JSON.
          </p>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Base URL */}
          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Base URL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <code style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{baseUrl || 'https://your-deployment'}</code>
              <CopyButton text={baseUrl} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Convention: <code>GET</code> list · <code>POST</code> create · <code>PUT</code> update (body needs <code>id</code>) · <code>DELETE ?id=</code>. Send JSON with header <code>Content-Type: application/json</code>.
            </div>
          </div>

          {RESOURCES.map((res) => (
            <div key={res.path} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Database size={15} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
                    <strong style={{ fontSize: '0.95rem' }}>{res.name}</strong>
                    <code style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{res.path}</code>
                  </div>
                  <CopyButton text={`${baseUrl}${res.path}`} />
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{res.description}</div>
              </div>

              <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {/* Method rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {[
                    { m: 'GET', d: `List all ${res.name.toLowerCase()}` },
                    { m: 'POST', d: `Create — required: ${res.required}` },
                    { m: 'PUT', d: 'Update — body must include id' },
                    { m: 'DELETE', d: `Delete — ${res.path}?id={id}` },
                  ].map((row) => (
                    <div key={row.m} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem' }}>
                      <span style={{ width: '58px', flexShrink: 0 }}><MethodBadge method={row.m} /></span>
                      <code style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{res.path}</code>
                      <span style={{ color: 'var(--text-muted)' }}>· {row.d}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Fields</div>
                  <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{res.fields}</code>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Example POST body</div>
                    <CopyButton text={JSON.stringify(res.example, null, 2)} />
                  </div>
                  <pre style={{ margin: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.75rem', overflowX: 'auto', color: 'var(--text-main)' }}>
{JSON.stringify(res.example, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}

          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '0.85rem 1rem', fontSize: '0.78rem', color: '#92400e' }}>
            <strong>Security note:</strong> these endpoints are currently open (no API key). If Hermes will call them over the public internet, add an auth token/key before sharing. Ask to enable API-key protection when ready.
          </div>
        </div>
      </div>
    </section>
  );
}

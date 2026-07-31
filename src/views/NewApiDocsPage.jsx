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
      level: 'Coder Advance',
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
  {
    name: 'Operationals',
    path: '/api/new/operationals',
    table: 'internal_operationals',
    description: 'Per branch/day rules: open days, operating hours, and the Class Operation slot plan that drives schedule recommendations.',
    fields: 'branchName, day, isOpen, openTime, closeTime, slots[] ({ type, start, end, label })',
    required: 'branchName, day',
    notes: 'slots[].type: kinder | junior | coder | any | break | training | meeting. Times are 24h "HH:MM". POST upserts on (branchName, day).',
    methods: [
      { m: 'GET', d: 'List rules — filters: ?branch=&day=&openOnly=true' },
      { m: 'POST', d: 'Create or update a branch/day rule (upsert)' },
      { m: 'PUT', d: 'Update by id — body must include id' },
      { m: 'DELETE', d: '?id={id} or ?branch={name}&day={day}' },
    ],
    example: {
      branchName: 'Bekasi',
      day: 'Monday',
      isOpen: true,
      openTime: '11:00',
      closeTime: '18:30',
      slots: [
        { type: 'kinder', start: '11:00', end: '12:30', label: '' },
        { type: 'break', start: '12:30', end: '13:00', label: 'Lunch' },
        { type: 'junior', start: '13:00', end: '15:00', label: '' },
        { type: 'coder', start: '15:00', end: '17:00', label: '' },
      ],
    },
  },
  {
    name: 'Activity Log',
    path: '/api/new/activity',
    table: 'internal_activity',
    description: 'Shared audit trail of schedule and CRM changes. Replaces the per-device localStorage history.',
    fields: 'action, summary, count, userEmail, source',
    required: 'action, summary',
    notes: 'action: add | edit | delete | bulk. source: schedule | crm | students | instructors.',
    methods: [
      { m: 'GET', d: 'Newest first — filters: ?source=&action=&limit= (max 500)' },
      { m: 'POST', d: 'Record an entry — required: action, summary' },
      { m: 'DELETE', d: '?id={id}, ?source={source}, or ?all=true' },
    ],
    example: {
      action: 'add',
      summary: 'Added Dave Kingsley — JF1.5 · Monday 1.00 pm - 3.00 pm @ Gading Serpong',
      count: 1,
      userEmail: 'admin@thelab.id',
      source: 'schedule',
    },
  },
  {
    name: 'Student Branch History',
    path: '/api/new/student-history',
    table: 'internal_student_history',
    description: 'Timeline of branch assignments per student, shown in the student edit panel.',
    fields: 'studentId, studentName, branchName, note',
    required: 'studentId, branchName',
    notes: 'GET returns oldest first so it reads as a timeline.',
    methods: [
      { m: 'GET', d: 'Filters: ?studentId=&branch=' },
      { m: 'POST', d: 'Append an assignment — required: studentId, branchName' },
      { m: 'DELETE', d: '?id={id} or ?studentId={id} to clear a student' },
    ],
    example: {
      studentId: 12,
      studentName: 'Dave Kingsley',
      branchName: 'Gading Serpong',
      note: 'Moved from Bekasi',
    },
  },
  {
    name: 'Leave Management',
    path: '/api/new/leave',
    table: 'internal_leaves',
    description: 'Instructor leave by date range, used to exclude them from availability and substitute suggestions.',
    fields: 'name, startDate, endDate, reason, status',
    required: 'name, startDate, endDate',
    notes: 'Dates are "YYYY-MM-DD". status: Approved | Pending | Rejected. Posting an identical range for the same instructor returns 409.',
    methods: [
      { m: 'GET', d: 'Filters: ?instructor=&from=&to=&status= (from/to match overlapping leave)' },
      { m: 'POST', d: 'Record leave — required: name, startDate, endDate' },
      { m: 'PUT', d: 'Update — body must include id' },
      { m: 'DELETE', d: '?id={id}' },
    ],
    example: {
      name: 'Angel',
      startDate: '2026-08-03',
      endDate: '2026-08-07',
      reason: 'Annual leave',
      status: 'Approved',
    },
  },
  {
    name: 'Workload',
    path: '/api/new/workload',
    table: 'derived from internal_classes',
    readOnly: true,
    description: 'Instructor hours derived from the schedule. Slots where every student is on leave (izin) are reported as leaveSessions and excluded from taught hours.',
    fields: 'Response: { instructorCount, totalHours, data[] } — each entry has instructor, branches[], totalSessions, leaveSessions, totalHours, hoursByDay, sessions[]',
    methods: [
      { m: 'GET', d: 'Filters: ?branch=&day=&instructor=' },
    ],
  },
  {
    name: 'Trial Availability',
    path: '/api/new/trial-availability',
    table: 'derived from operationals + instructors + classes',
    readOnly: true,
    description: 'Which planned slots can still take a trial student, and why the rest cannot. Honours slot types, instructor capability, existing bookings and per-program seat limits (Kinder 4, Junior/Coder 6).',
    fields: 'Response: { total, availableCount, data[] } — each entry has branchName, day, start, end, slotType, available, reason, freeInstructors[], joinableClasses[]',
    methods: [
      { m: 'GET', d: 'Filters: ?branch=&day=&category=Kinder|Junior|Coder' },
    ],
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
            REST endpoints (PostgreSQL-backed) for Hermes and other integrations. Every New Operations feature is covered. All return JSON.
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
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              List endpoints accept <code>?search=</code> (partial, case-insensitive) plus <code>?limit=</code> and per-resource filters. Always set a limit for chat replies — omitting it returns every match.
            </div>
          </div>

          {/* Machine-readable spec for agent platforms */}
          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
              OpenAPI specs (for Hermes)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {[
                { label: 'New Operations (PostgreSQL)', path: '/api/new/openapi.json' },
                { label: 'Old Operations (Google Sheets)', path: '/api/old/openapi.json' },
                { label: 'Index — lists both', path: '/api/openapi.json' },
              ].map((s) => (
                <div key={s.path} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', minWidth: '190px' }}>{s.label}</span>
                  <code style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>{baseUrl}{s.path}</code>
                  <CopyButton text={`${baseUrl}${s.path}`} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Point an agent platform at a spec URL and it discovers every operation on its own — no hand-written tool definitions. Specs are public (no key) so discovery works before authenticating.
              The two sets are kept separate on purpose: a student in New Operations is <strong>not</strong> the same record as a student in Old Operations, and merging the specs would invite an agent to mix them.
            </div>
          </div>

          {/* Old Operations namespace */}
          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
              Old Operations endpoints
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Google Sheets backed, namespaced under <code>/api/old/*</code>. Each is mirrored at its original URL without the prefix, so existing Qontak integrations keep working.
            </div>
            <div className="table-wrapper">
              <table id="schedule-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '175px' }}>Endpoint</th>
                    <th style={{ minWidth: '130px' }}>Methods</th>
                    <th style={{ minWidth: '160px' }}>Auth</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { path: '/api/old/schedule', methods: ['GET'], auth: 'None' },
                    { path: '/api/old/slots', methods: ['GET'], auth: 'CHATBOT_API_KEY' },
                    { path: '/api/old/instructors', methods: ['GET'], auth: 'CHATBOT or CRM key' },
                    { path: '/api/old/book-trial', methods: ['POST'], auth: 'None' },
                    { path: '/api/old/chatbot-book', methods: ['POST'], auth: 'CHATBOT_API_KEY' },
                    { path: '/api/old/crm', methods: ['GET', 'POST', 'PATCH'], auth: 'CRM_API_KEY' },
                    { path: '/api/old/config', methods: ['GET', 'POST'], auth: 'None' },
                  ].map((r) => (
                    <tr key={r.path}>
                      <td><code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.path}</code></td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {r.methods.map((m) => <MethodBadge key={m} method={m} />)}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.76rem', color: r.auth === 'None' ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {r.auth}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              The three endpoints marked <strong>None</strong> are unauthenticated, including <code>/api/old/config</code> which can write branch settings. The <code>NEW_OPS_API_KEY</code> gate does not cover <code>/api/old/*</code>, since these routes carry their own keys and adding a second layer would break the existing chatbot.
            </div>
          </div>

          {/* Auth */}
          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
              Authentication
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Set <code>NEW_OPS_API_KEY</code> in the environment to lock these routes down, then send it on every call:
            </div>
            <pre style={{ margin: '0.5rem 0 0', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 0.75rem', fontSize: '0.74rem', overflowX: 'auto', color: 'var(--text-main)' }}>
{`Authorization: Bearer <NEW_OPS_API_KEY>
# or, if your client can't set Authorization:
x-api-key: <NEW_OPS_API_KEY>`}
            </pre>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Requests from this app&apos;s own pages are allowed without the key (same-origin). While the variable is unset the routes stay open, so nothing breaks before you configure it. This is a single shared secret, not per-user access control — anyone holding it has full read and write, including delete.
            </div>
          </div>

          {/* Index of every endpoint */}
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
              <strong style={{ fontSize: '0.95rem' }}>All Endpoints</strong>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {RESOURCES.length} resources covering every New Operations feature.
              </div>
            </div>
            <div className="table-wrapper">
              <table id="schedule-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '150px' }}>Feature</th>
                    <th style={{ minWidth: '210px' }}>Endpoint</th>
                    <th style={{ minWidth: '150px' }}>Methods</th>
                    <th style={{ minWidth: '190px' }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map((res) => {
                    const methods = (res.methods || [{ m: 'GET' }, { m: 'POST' }, { m: 'PUT' }, { m: 'DELETE' }]).map((x) => x.m);
                    return (
                      <tr key={`idx-${res.path}`}>
                        <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>{res.name}</td>
                        <td><code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{res.path}</code></td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {methods.map((m) => <MethodBadge key={m} method={m} />)}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{res.table}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                    {res.readOnly && (
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#0891b2', background: 'rgba(8,145,178,0.12)', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                        READ-ONLY
                      </span>
                    )}
                  </div>
                  <CopyButton text={`${baseUrl}${res.path}`} />
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{res.description}</div>
              </div>

              <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {/* Method rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {(res.methods || [
                    { m: 'GET', d: `List all ${res.name.toLowerCase()}` },
                    { m: 'POST', d: `Create — required: ${res.required}` },
                    { m: 'PUT', d: 'Update — body must include id' },
                    { m: 'DELETE', d: `Delete — ${res.path}?id={id}` },
                  ]).map((row) => (
                    <div key={row.m} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem' }}>
                      <span style={{ width: '58px', flexShrink: 0 }}><MethodBadge method={row.m} /></span>
                      <code style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{res.path}</code>
                      <span style={{ color: 'var(--text-muted)' }}>· {row.d}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                    {res.readOnly ? 'Response shape' : 'Fields'}
                  </div>
                  <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{res.fields}</code>
                </div>

                {res.notes && (
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 0.7rem' }}>
                    {res.notes}
                  </div>
                )}

                {res.example && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Example POST body</div>
                      <CopyButton text={JSON.stringify(res.example, null, 2)} />
                    </div>
                    <pre style={{ margin: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.75rem', overflowX: 'auto', color: 'var(--text-main)' }}>
{JSON.stringify(res.example, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '0.85rem 1rem', fontSize: '0.78rem', color: '#92400e' }}>
            <strong>Security note:</strong> these endpoints are currently open (no API key). If Hermes will call them over the public internet, add an auth token/key before sharing. Ask to enable API-key protection when ready.
          </div>

          <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.85rem 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-main)' }}>New tables:</strong> Operationals, Activity Log and Student Branch History need their tables created. Run <code>init_db.sql</code> on the VPS (it is idempotent — existing tables are left alone):
            <pre style={{ margin: '0.5rem 0 0', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 0.75rem', fontSize: '0.74rem', overflowX: 'auto', color: 'var(--text-main)' }}>
psql &quot;$DATABASE_URL&quot; -f init_db.sql
            </pre>
            <span style={{ display: 'block', marginTop: '0.5rem' }}>
              The Operationals page still reads and writes its settings through the shared branch config. These endpoints expose the same rules to Hermes; migrating the UI to read from Postgres is a separate step.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

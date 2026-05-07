'use client';

import { Terminal, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export default function ApiDocsPage() {
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-vercel-domain.com';

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="dashboard-view active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>API Documentation</h2>
            <span className="subtext">Endpoints available for external integrations (e.g., Qontak Chatbot)</span>
          </div>
        </div>
        
        <div className="panel-body" style={{ padding: '1.5rem' }}>
          
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-main)' }}>
              <Terminal size={20} className="text-primary" />
              Chatbot Slots API
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              Use this endpoint to retrieve available 1-hour trial slots for a specific day and program. 
              It automatically filters out busy instructors, instructors on leave, and honors the Trial Priority settings.
            </p>
            
            <div style={{ background: 'var(--bg-dashboard)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ background: '#2563eb', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>GET</span>
                  <code style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>/api/slots</code>
                </div>
                <button 
                  onClick={() => handleCopy(`${baseUrl}/api/slots?day=Saturday&program=Trial%20Kinder`)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                  <span style={{ fontSize: '0.85rem' }}>{copied ? 'Copied' : 'Copy URL'}</span>
                </button>
              </div>
              
              <div style={{ padding: '1.5rem', background: 'var(--bg-panel)' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Headers</h4>
                <div style={{ background: 'var(--bg-dashboard)', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  Authorization: Bearer &lt;YOUR_CHATBOT_API_KEY&gt;
                </div>

                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Query Parameters</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0', color: 'var(--text-main)', width: '20%' }}>Param</th>
                      <th style={{ padding: '0.5rem 0', color: 'var(--text-main)', width: '15%' }}>Required</th>
                      <th style={{ padding: '0.5rem 0', color: 'var(--text-main)' }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 0', fontFamily: 'monospace' }}>day</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>Yes</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>e.g., "Monday", "Saturday"</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 0', fontFamily: 'monospace' }}>program</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>No*</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>e.g., "Trial Kinder". *Required if age is missing.</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.75rem 0', fontFamily: 'monospace' }}>age</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>No*</td>
                      <td style={{ padding: '0.75rem 0', color: 'var(--text-muted)' }}>e.g., "5". Automatically sets program. *Required if program missing.</td>
                    </tr>
                  </tbody>
                </table>

                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Success Response (200 OK)</h4>
                <pre style={{ background: 'var(--bg-dashboard)', padding: '1rem', borderRadius: '6px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-main)' }}>
{`{
  "success": true,
  "day": "Saturday",
  "program": "Trial Kinder",
  "availableSlots": [
    "10.00 - 11.00 am",
    "10.30 - 11.30 am",
    "11.00 am - 12.00 pm"
  ]
}`}
                </pre>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-main)' }}>
              <Terminal size={20} className="text-primary" />
              Chatbot Booking API
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              Use this endpoint at the end of the Chatbot flow to finalize and save the booking into the Trial Leads Google Sheet. It automatically finds an available instructor. Note: Requires Google Service Account configured in Vercel.
            </p>
            
            <div style={{ background: 'var(--bg-dashboard)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ background: '#059669', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>POST</span>
                  <code style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>/api/chatbot-book</code>
                </div>
                <button 
                  onClick={() => handleCopy(`${baseUrl}/api/chatbot-book`)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                >
                  <Copy size={16} />
                  <span style={{ fontSize: '0.85rem' }}>Copy URL</span>
                </button>
              </div>
              
              <div style={{ padding: '1.5rem', background: 'var(--bg-panel)' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Headers</h4>
                <div style={{ background: 'var(--bg-dashboard)', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  Authorization: Bearer &lt;YOUR_CHATBOT_API_KEY&gt;<br />
                  Content-Type: application/json
                </div>

                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>JSON Body payload</h4>
                <pre style={{ background: 'var(--bg-dashboard)', padding: '1rem', borderRadius: '6px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-main)', marginBottom: '1.5rem' }}>
{`{
  "student": "Sky Rianto",
  "age": 8,
  "day": "Monday",
  "date": "2026-05-15",
  "time": "3.00 - 4.00 pm",
  "remarks": "Parent phone: 12345"
}`}
                </pre>

                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Success Response (200 OK)</h4>
                <pre style={{ background: 'var(--bg-dashboard)', padding: '1rem', borderRadius: '6px', overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-main)' }}>
{`{
  "success": true,
  "message": "Booking successfully saved",
  "data": {
    "student": "Sky Rianto",
    "program": "Trial Junior",
    "instructor": "Teacher Sarah",
    "day": "Monday",
    "date": "2026-05-15",
    "time": "3.00 - 4.00 pm"
  }
}`}
                </pre>
              </div>
            </div>
          </div>

          {/* New Postman Guide Section */}
          <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--border-color)' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--text-main)' }}>How to test these APIs in Postman</h3>
            <div style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <ol style={{ paddingLeft: '1.5rem', color: 'var(--text-muted)', lineHeight: '1.8' }}>
                <li style={{ marginBottom: '0.5rem' }}>Open Postman and create a new request.</li>
                <li style={{ marginBottom: '0.5rem' }}>Set the method to <strong>GET</strong> (for slots) or <strong>POST</strong> (for booking).</li>
                <li style={{ marginBottom: '0.5rem' }}>Paste the full URL (e.g., <code>https://weekly-schedule-filter.vercel.app/api/slots?day=Saturday&program=Trial%20Kinder</code>).</li>
                <li style={{ marginBottom: '0.5rem' }}>
                  Click the <strong>Authorization</strong> tab right below the URL bar.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  Change the Type to <strong>Bearer Token</strong>.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  In the <strong>Token</strong> field, paste your API key (e.g., <code>qontak-secure-key-12345</code>).
                </li>
                <li>Click <strong>Send</strong>! You should see the JSON response appear at the bottom.</li>
              </ol>
            </div>
          </div>
          
        </div>
      </div>
    </section>
  );
}

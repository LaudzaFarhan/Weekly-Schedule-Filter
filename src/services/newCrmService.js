/**
 * API client service for New Operations CRM (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/crm';

/**
 * Fetch all CRM leads once
 */
export async function getAllLeads() {
  try {
    const res = await fetch(API_PATH);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch leads');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching CRM leads:', error);
    throw error;
  }
}

/**
 * Listen to all CRM leads using polling (simulates real-time snapshot listener)
 */
export function listenToLeads(callback) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllLeads();
      if (active) {
        callback(data);
      }
    } catch (error) {
      console.warn('[crmService] Polling retry on next interval:', error?.message || error);
    }
  };

  poll();
  const interval = setInterval(poll, 3000); // Poll database every 3 seconds

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Create a new CRM lead
 */
export async function createLead(leadData) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create lead');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating CRM lead:', error);
    throw error;
  }
}

/**
 * Update an existing CRM lead
 */
export async function updateLead(leadId, updates) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, ...updates })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update lead');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating CRM lead:', error);
    throw error;
  }
}

/**
 * Delete a CRM lead
 */
export async function deleteLead(leadId) {
  try {
    const res = await fetch(`${API_PATH}?id=${leadId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete lead');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting CRM lead:', error);
    throw error;
  }
}

/**
 * Fetch CRM Performance Analytics (Leads, Profiling, Trial Scheduled, Junk Leads, Monthly Trends, Cross-branch)
 */
export async function getCrmPerformance({
  year = '2026',
  branch = 'all',
  month = null,
  includeLeads = false,
} = {}) {
  try {
    const params = new URLSearchParams();
    if (year) params.set('year', year);
    if (branch) params.set('branch', branch);
    if (month) params.set('month', month);
    if (includeLeads) params.set('includeLeads', 'true');

    const res = await fetch(`/api/new/crm/performance?${params.toString()}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to fetch CRM performance analytics');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching CRM performance analytics:', error);
    throw error;
  }
}

/**
 * Fetch a single CRM lead by ID
 */
export async function getLeadById(leadId) {
  try {
    const res = await fetch(`${API_PATH}?id=${leadId}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Lead not found');
    }
    return await res.json();
  } catch (error) {
    console.error(`Error fetching CRM lead ${leadId}:`, error);
    throw error;
  }
}

/**
 * Ingest an inbound lead via webhook simulation
 */
export async function ingestWebhookLead(leadData) {
  try {
    const res = await fetch('/api/new/crm/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadData),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to ingest lead via webhook');
    }
    return await res.json();
  } catch (error) {
    console.error('Error ingesting lead via webhook:', error);
    throw error;
  }
}


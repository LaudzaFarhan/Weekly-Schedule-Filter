/**
 * Workload history — daily per-branch snapshots stored in Firestore.
 *
 * Document shape (collection: `workloadSnapshots`):
 *   id: `${branch}_${YYYY-MM-DD}`     ← stable, idempotent
 *   {
 *     date:         "2026-05-17",
 *     branch:       "Default Branch",
 *     capturedAt:   serverTimestamp,
 *     capturedBy:   "admin@example.com",
 *     rows: [
 *       { teacher, branchTag, hours, hoursClipped, sessions,
 *         students, avgGroupSize, activeDays, utilization }
 *     ],
 *   }
 *
 * Retention: 90 days, enforced by `cleanupOldSnapshots()` which is called
 * right after every save (cleanup-on-write).
 */

import { db } from './firebase';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, serverTimestamp, orderBy,
} from 'firebase/firestore';

const COLLECTION = 'workloadSnapshots';
export const RETENTION_DAYS = 90;

/** YYYY-MM-DD in local time (Jakarta is +07, but we just use local). */
export function todayKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Build the firestore document ID for a branch + date. */
export function snapshotId(branchName, dateKey) {
  // Branch names can contain spaces — replace with underscore so the ID is safe.
  const safeBranch = branchName.replace(/[\s/]+/g, '_');
  return `${safeBranch}_${dateKey}`;
}

/** Compute the date key N days before `dateKey`. */
function daysAgoKey(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return todayKey(d);
}

/**
 * Reduce a workload report row to the minimum fields we want in history.
 * Keep this lean — Firestore docs have a 1MB cap and we want fast reads.
 */
function compactRow(r, branchTag) {
  return {
    teacher: r.teacher,
    branchTag: branchTag || null,
    hours: round2(r.weekly.hours),
    hoursClipped: round2(r.weekly.hoursClipped),
    sessions: r.weekly.sessions,
    students: r.weekly.students,
    avgGroupSize: round2(r.weekly.avgGroupSize),
    activeDays: r.weekly.activeDays,
    utilization: round1(r.weekly.utilization),
  };
}

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const round1 = (n) => Math.round((n || 0) * 10) / 10;

/**
 * Save a snapshot for `branch` on `dateKey` (defaults to today).
 * Overwrites any existing doc for the same key (idempotent).
 */
export async function saveSnapshot({
  branch,
  report,           // array of { teacher, weekly, byDay } from buildWorkloadReport
  instructorTagMap, // Map<teacher, branchTag>
  dateKey = todayKey(),
  capturedBy = null,
}) {
  if (!branch) throw new Error('saveSnapshot: branch is required');
  const id = snapshotId(branch, dateKey);
  const rows = (report || []).map((r) =>
    compactRow(r, instructorTagMap?.get?.(r.teacher) || null)
  );

  await setDoc(doc(db, COLLECTION, id), {
    date: dateKey,
    branch,
    capturedAt: serverTimestamp(),
    capturedBy: capturedBy || null,
    rows,
  });

  return { id, count: rows.length };
}

/** Does a snapshot exist for this branch + date? */
export async function snapshotExists(branch, dateKey = todayKey()) {
  const id = snapshotId(branch, dateKey);
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists();
}

/** Fetch a single snapshot. Returns null when missing. */
export async function getSnapshot(branch, dateKey) {
  const id = snapshotId(branch, dateKey);
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * List snapshots for a branch within the last `days` days (default 90).
 * Returns an array sorted by date ascending.
 *
 * Uses only single-field queries (no composite index needed). Branch
 * filtering happens client-side — fine because retention caps the volume
 * at ~90 days × few branches × few hundred fields.
 */
export async function listBranchSnapshots(branch, days = RETENTION_DAYS) {
  const fromDate = daysAgoKey(days);
  const q = query(
    collection(db, COLLECTION),
    where('date', '>=', fromDate),
    orderBy('date', 'asc'),
  );
  const querySnap = await getDocs(q);
  const out = [];
  querySnap.forEach((d) => {
    const data = d.data();
    if (!branch || data.branch === branch) {
      out.push({ id: d.id, ...data });
    }
  });
  return out;
}

/**
 * Delete docs older than the retention window. Safe to call on every save.
 * Runs at most one query + N deletes; for low-volume use this is fine.
 */
export async function cleanupOldSnapshots() {
  const cutoff = daysAgoKey(RETENTION_DAYS);
  const q = query(collection(db, COLLECTION), where('date', '<', cutoff));
  const querySnap = await getDocs(q);
  const deletions = [];
  querySnap.forEach((d) => {
    deletions.push(deleteDoc(doc(db, COLLECTION, d.id)));
  });
  await Promise.all(deletions);
  return deletions.length;
}

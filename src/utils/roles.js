/**
 * Role Resolution Utilities
 *
 * One place to answer "what role does this signed-in email hold?", so a
 * role-gated control can never disagree with the sidebar or the header about
 * the answer.
 *
 * `users` is the email → role map exposed by `ScheduleContext` (persisted in
 * localStorage). Its keys are stored lowercase, which is why the lookup folds
 * the email before reading it — the same thing `Sidebar.jsx` and `Header.jsx`
 * already do inline with `user?.email?.toLowerCase()`.
 *
 * Pure module: no React, no context, no storage access.
 */

/** The only role allowed to run destructive bulk actions. */
export const ADMIN_ROLE = 'Admin';

/**
 * The role assumed when nothing is recorded. Deliberately not `ADMIN_ROLE`:
 * an unknown user must never fall into the privileged branch.
 */
export const DEFAULT_ROLE = 'Instructor';

/**
 * Resolve an email to a role, with the fallback the sidebar and header use.
 *
 * @param {Object<string, string>|null|undefined} users - email → role map
 * @param {string|null|undefined} email - the signed-in account's email
 * @returns {string} the recorded role, or `DEFAULT_ROLE` when none is recorded
 */
export function resolveUserRole(users, email) {
  if (!email) return DEFAULT_ROLE;
  return users?.[String(email).toLowerCase()] || DEFAULT_ROLE;
}

/**
 * Whether the email holds the Admin role.
 *
 * @param {Object<string, string>|null|undefined} users - email → role map
 * @param {string|null|undefined} email - the signed-in account's email
 * @returns {boolean} true only when a recorded role equals `ADMIN_ROLE`
 */
export function isAdmin(users, email) {
  return resolveUserRole(users, email) === ADMIN_ROLE;
}

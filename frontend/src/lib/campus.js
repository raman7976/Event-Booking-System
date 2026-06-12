// Campus identity rules — mirrors backend/src/services/authService.js.
// LNMIIT student addresses embed the roll number as the local part
// (23ucs689@lnmiit.ac.in -> 23UCS689); staff addresses (admin@) don't match.
export const CAMPUS_DOMAIN = 'lnmiit.ac.in';

const ROLL_LOCAL_RE = /^\d{2}[a-z]{2,4}\d{1,4}$/i;

export function deriveRollFromEmail(email) {
  const [local = '', domain = ''] = String(email).trim().toLowerCase().split('@');
  if (domain !== CAMPUS_DOMAIN) return null;
  return ROLL_LOCAL_RE.test(local) ? local.toUpperCase() : null;
}

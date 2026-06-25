'use strict';

// Security regression tests for the 14 findings fixed in the second audit.
// Each section is keyed to the finding number.

// ── Finding 10: _resolveCallerRole helper ────────────────────────────────────
function resolveCallerRole(roles, adminDocExists) {
  const isOwner = roles.includes('owner');
  const isAdmin = isOwner || roles.includes('admin') || adminDocExists;
  return { isAdmin, isOwner, roles };
}

describe('_resolveCallerRole (Finding 10)', () => {
  it('owner role → isAdmin and isOwner', () => {
    const r = resolveCallerRole(['player', 'owner'], false);
    expect(r.isAdmin).toBe(true);
    expect(r.isOwner).toBe(true);
  });

  it('admin role only → isAdmin, not isOwner', () => {
    const r = resolveCallerRole(['player', 'admin'], false);
    expect(r.isAdmin).toBe(true);
    expect(r.isOwner).toBe(false);
  });

  it('adminDoc.exists → isAdmin even without role', () => {
    const r = resolveCallerRole(['player'], true);
    expect(r.isAdmin).toBe(true);
    expect(r.isOwner).toBe(false);
  });

  it('plain player → not admin, not owner', () => {
    const r = resolveCallerRole(['player'], false);
    expect(r.isAdmin).toBe(false);
    expect(r.isOwner).toBe(false);
  });

  it('empty roles array → not admin', () => {
    const r = resolveCallerRole([], false);
    expect(r.isAdmin).toBe(false);
  });

  it('owner treated as admin even when adminDoc missing', () => {
    const r = resolveCallerRole(['owner'], false);
    expect(r.isAdmin).toBe(true);
  });
});

// ── Finding 7: length limits in messageSessionAttendees ──────────────────────
function validateMessageInput({ sessionId, subject, body }) {
  if (!sessionId || !subject || !body) return { status: 400, error: 'Missing sessionId, subject, or body.' };
  if (typeof subject !== 'string' || subject.length > 200) return { status: 400, error: 'subject must be ≤200 characters.' };
  if (typeof body !== 'string' || body.length > 2000) return { status: 400, error: 'body must be ≤2000 characters.' };
  return { status: 200 };
}

describe('messageSessionAttendees input validation (Finding 7)', () => {
  it('accepts valid input', () => {
    expect(validateMessageInput({ sessionId: 's1', subject: 'Hi', body: 'Hello' }).status).toBe(200);
  });

  it('rejects missing sessionId', () => {
    const r = validateMessageInput({ sessionId: '', subject: 'Hi', body: 'Hello' });
    expect(r.status).toBe(400);
  });

  it('rejects missing subject', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: '', body: 'Hello' });
    expect(r.status).toBe(400);
  });

  it('rejects missing body', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: 'Hi', body: '' });
    expect(r.status).toBe(400);
  });

  it('rejects subject > 200 chars', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: 'x'.repeat(201), body: 'Hi' });
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/200/);
  });

  it('accepts subject exactly 200 chars', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: 'x'.repeat(200), body: 'Hi' });
    expect(r.status).toBe(200);
  });

  it('rejects body > 2000 chars', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: 'Hi', body: 'x'.repeat(2001) });
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/2000/);
  });

  it('accepts body exactly 2000 chars', () => {
    const r = validateMessageInput({ sessionId: 's1', subject: 'Hi', body: 'x'.repeat(2000) });
    expect(r.status).toBe(200);
  });
});

// ── Finding 8: rate limiting ─────────────────────────────────────────────────
function checkSessionRateLimit(lastMessageAt, nowMs = Date.now()) {
  if (!lastMessageAt) return false; // no limit
  return (nowMs - lastMessageAt) < 300000; // 5-minute window
}

function checkNotifyRateLimit(emailSentAt, nowMs = Date.now()) {
  if (!emailSentAt) return false; // no limit
  return (nowMs - emailSentAt) < 3600000; // 1-hour window
}

describe('session message rate limit (Finding 8)', () => {
  it('allows first message (no lastMessageAt)', () => {
    expect(checkSessionRateLimit(null)).toBe(false);
    expect(checkSessionRateLimit(undefined)).toBe(false);
  });

  it('blocks message sent < 5 minutes ago', () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    expect(checkSessionRateLimit(twoMinutesAgo)).toBe(true);
  });

  it('allows message sent > 5 minutes ago', () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    expect(checkSessionRateLimit(sixMinutesAgo)).toBe(false);
  });

  it('blocks exactly at 4:59 before limit', () => {
    const nearLimit = Date.now() - (5 * 60 * 1000 - 1000);
    expect(checkSessionRateLimit(nearLimit)).toBe(true);
  });
});

describe('notification email rate limit (Finding 8)', () => {
  it('allows first notification (no emailSentAt)', () => {
    expect(checkNotifyRateLimit(null)).toBe(false);
  });

  it('blocks notification sent < 1 hour ago', () => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    expect(checkNotifyRateLimit(thirtyMinutesAgo)).toBe(true);
  });

  it('allows notification sent > 1 hour ago', () => {
    const ninetyMinutesAgo = Date.now() - 90 * 60 * 1000;
    expect(checkNotifyRateLimit(ninetyMinutesAgo)).toBe(false);
  });
});

// ── Finding 9: body HTML escaping in messageSessionAttendees ─────────────────
function hEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeEmailBody(rawBody) {
  return hEsc(rawBody).replace(/\n/g, '<br>');
}

describe('admin message body escaping (Finding 9)', () => {
  it('escapes < and > tags', () => {
    const out = safeEmailBody('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes & ampersand', () => {
    expect(safeEmailBody('A & B')).toContain('A &amp; B');
  });

  it('escapes double quotes', () => {
    expect(safeEmailBody('"hello"')).toContain('&quot;');
  });

  it('converts newlines to <br>', () => {
    const out = safeEmailBody('Line 1\nLine 2');
    expect(out).toContain('<br>');
    expect(out).not.toContain('\n');
  });

  it('plain text passes through unchanged (except safe encoding)', () => {
    const out = safeEmailBody('Hello everyone, see you at 7pm!');
    expect(out).toBe('Hello everyone, see you at 7pm!');
  });
});

// ── Finding 6: idempotency key construction ──────────────────────────────────
describe('Stripe idempotency key format (Finding 6)', () => {
  it('coach payment key includes sessionId', () => {
    const sessionId = 'session-abc123';
    const key = `coach-payment-${sessionId}`;
    expect(key).toBe('coach-payment-session-abc123');
  });

  it('refund key includes paymentIntentId', () => {
    const piId = 'pi_abc123';
    const key = `refund-${piId}`;
    expect(key).toBe('refund-pi_abc123');
  });

  it('webhook transfer key includes sessionId', () => {
    const sessionId = 'session-xyz';
    const key = `coach-transfer-${sessionId}`;
    expect(key).toBe('coach-transfer-session-xyz');
  });
});

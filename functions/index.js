'use strict';

// HTTP functions use Gen 1 to avoid Cloud Run IAM org-policy (allUsers).
// Firestore triggers use Gen 2 (Eventarc) — required for eur3 multi-region DB.
const functions = require('firebase-functions/v1');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp }            = require('firebase-admin/app');
const { getAuth }                  = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const STRIPE_SECRET_KEY     = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const GMAIL_APP_PASSWORD    = defineSecret('GMAIL_APP_PASSWORD');
const REGION          = 'europe-west2'; // HTTP functions
const REGION_FIRESTORE = 'europe-west1'; // must match Firestore eur3 multi-region

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

async function verifyAuth(req) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Error('Unauthenticated');
  return getAuth().verifyIdToken(token);
}

let _stripe;
function getStripe() {
  if (!_stripe) {
    _stripe = require('stripe')(STRIPE_SECRET_KEY.value(), {
      apiVersion: '2026-05-27.dahlia',
    });
  }
  return _stripe;
}

let _transporter;
function getMailer() {
  if (!_transporter) {
    _transporter = require('nodemailer').createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'edu.pignatelli@gmail.com', pass: GMAIL_APP_PASSWORD.value() },
    });
  }
  return _transporter;
}

async function sendEmail(to, subject, html) {
  if (!to) return;
  const text = html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  try {
    await getMailer().sendMail({
      from: '"KQOTC" <edu.pignatelli@gmail.com>',
      to, subject, html, text,
    });
    console.log('sendEmail ok:', subject, '->', to);
  } catch (e) {
    console.error('sendEmail failed:', e.message);
  }
}

// ── createCheckoutSession ───────────────────────────────────────────────────
exports.createCheckoutSession = functions
  .region(REGION)
  .runWith({ secrets: [STRIPE_SECRET_KEY] })
  .https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST')    return res.status(405).end();

    let decoded;
    try { decoded = await verifyAuth(req); }
    catch (e) { return res.status(401).json({ error: e.message }); }

    const { sessionId, successUrl, cancelUrl, positions } = req.body;
    if (!sessionId || !successUrl || !cancelUrl)
      return res.status(400).json({ error: 'Missing required fields.' });

    const db  = getFirestore();
    const uid = decoded.uid;

    const [sessionSnap, attendeeSnap] = await Promise.all([
      db.collection('sessions').doc(sessionId).get(),
      db.collection('sessions').doc(sessionId).collection('attendees').doc(uid).get(),
    ]);

    if (!sessionSnap.exists)
      return res.status(404).json({ error: 'Session not found.' });
    if (attendeeSnap.exists && attendeeSnap.data().paid)
      return res.status(409).json({ error: 'Already registered and paid.' });

    const session     = sessionSnap.data();
    const playerPrice = session.absorbFee ? (session.cost || 0) : _playerPrice(session.cost || 0);
    if (playerPrice <= 0)
      return res.status(400).json({ error: 'This session is free.' });

    let checkout;
    try {
      checkout = await getStripe().checkout.sessions.create({
        mode: 'payment',
        billing_address_collection: 'required',
        line_items: [{
          price_data: {
            currency: 'gbp',
            product_data: {
              name: [session.venue, _formatDate(session.date)].filter(Boolean).join(' — ') || 'Volleyball session',
            },
            unit_amount: Math.round(playerPrice * 100),
          },
          quantity: 1,
        }],
        customer_email: decoded.email || undefined,
        metadata: {
          sessionId,
          uid,
          refundAmountPence: String(Math.round((session.cost || 0) * 100)),
          positions: JSON.stringify(positions || []),
        },
        success_url: successUrl,
        cancel_url:  cancelUrl,
      });
    } catch (e) {
      console.error('Stripe checkout error:', e.message);
      return res.status(500).json({ error: `Payment setup failed: ${e.message}` });
    }

    return res.json({ url: checkout.url });
  });

// ── stripeWebhook ───────────────────────────────────────────────────────────
exports.stripeWebhook = functions
  .region(REGION)
  .runWith({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, GMAIL_APP_PASSWORD] })
  .https.onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (e) {
      console.error('Webhook signature error:', e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const checkout        = event.data.object;
      const { sessionId, uid, refundAmountPence, positions: positionsMeta } = checkout.metadata;
      const sessionPositions = positionsMeta ? JSON.parse(positionsMeta) : [];
      const paymentIntentId = checkout.payment_intent;

      const db          = getFirestore();
      const sessionRef  = db.collection('sessions').doc(sessionId);
      const attendeeRef = sessionRef.collection('attendees').doc(uid);
      const userDoc     = await db.collection('users').doc(uid).get();
      const u           = userDoc.exists ? userDoc.data() : {};

      const sessionSnap = await sessionRef.get();
      const session     = sessionSnap.exists ? sessionSnap.data() : {};

      await db.runTransaction(async t => {
        const existing = await t.get(attendeeRef);
        if (existing.exists && existing.data().paid) return;

        const isNew = !existing.exists;
        t.set(attendeeRef, {
          name:              u.name  || checkout.customer_details?.name  || '',
          email:             u.email || checkout.customer_details?.email || '',
          address:           checkout.customer_details?.address || null,
          gender:            u.gender    || null,
          positions:         sessionPositions.length ? sessionPositions : (u.positions || []),
          present:           false,
          paid:              true,
          feeWaived:         false,
          paymentIntentId,
          refundAmountPence: parseInt(refundAmountPence, 10) || 0,
          paidAt:            FieldValue.serverTimestamp(),
          joinedAt:          existing.exists ? existing.data().joinedAt : FieldValue.serverTimestamp(),
        }, { merge: true });

        if (isNew) t.update(sessionRef, { attendeeCount: FieldValue.increment(1) });
      });

      const email    = u.email || checkout.customer_details?.email;
      const name     = u.name  || checkout.customer_details?.name || 'there';
      const amount   = ((checkout.amount_total || parseInt(refundAmountPence, 10)) / 100).toFixed(2);
      const dateStr  = _formatDate(session.date);
      const venue    = session.venue || 'the session';
      await sendEmail(email,
        `Payment confirmed — ${venue}${dateStr ? ` · ${dateStr}` : ''}`,
        _emailHtml(`Hi ${name},`, [
          `Your payment of <strong>£${amount}</strong> has been confirmed.`,
          `You're registered for <strong>${venue}</strong>${dateStr ? ` on <strong>${dateStr}</strong>` : ''}.`,
          `See you on the court!`,
        ])
      );
    }

    res.json({ received: true });
  });

// ── cancelAttendeeAndRefund ─────────────────────────────────────────────────
exports.cancelAttendeeAndRefund = functions
  .region(REGION)
  .runWith({ secrets: [STRIPE_SECRET_KEY, GMAIL_APP_PASSWORD] })
  .https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST')    return res.status(405).end();

    let decoded;
    try { decoded = await verifyAuth(req); }
    catch (e) { return res.status(401).json({ error: e.message }); }

    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId.' });

    const uid = decoded.uid;
    const db  = getFirestore();

    const [sessionSnap, attendeeSnap] = await Promise.all([
      db.collection('sessions').doc(sessionId).get(),
      db.collection('sessions').doc(sessionId).collection('attendees').doc(uid).get(),
    ]);

    if (!sessionSnap.exists)  return res.status(404).json({ error: 'Session not found.' });
    if (!attendeeSnap.exists) return res.status(404).json({ error: 'Registration not found.' });

    const session  = sessionSnap.data();
    const attendee = attendeeSnap.data();

    if (session.date) {
      const sessionDate = session.date.toDate ? session.date.toDate() : new Date(session.date);
      if ((sessionDate - Date.now()) / 36e5 < 24)
        return res.status(403).json({ error: 'Cancellations are not allowed within 24 hours of the session.' });
    }

    let refunded = false;
    if (attendee.paid && attendee.paymentIntentId) {
      const refundPence = attendee.refundAmountPence || 0;
      if (refundPence > 0) {
        await getStripe().refunds.create({
          payment_intent: attendee.paymentIntentId,
          amount:         refundPence,
        });
        refunded = true;
      }
    }

    const sessionRef  = db.collection('sessions').doc(sessionId);
    const attendeeRef = sessionRef.collection('attendees').doc(uid);
    await db.runTransaction(async t => {
      t.delete(attendeeRef);
      t.update(sessionRef, { attendeeCount: FieldValue.increment(-1) });
    });

    const email   = decoded.email || attendee.email;
    const name    = attendee.name || 'there';
    const venue   = session.venue || 'the session';
    const dateStr = _formatDate(session.date);
    const refundNote = refunded
      ? `A refund of <strong>£${(attendee.refundAmountPence / 100).toFixed(2)}</strong> has been issued and should appear within 5–10 business days.`
      : '';
    await sendEmail(email,
      `Registration cancelled — ${venue}${dateStr ? ` · ${dateStr}` : ''}`,
      _emailHtml(`Hi ${name},`, [
        `Your registration for <strong>${venue}</strong>${dateStr ? ` on <strong>${dateStr}</strong>` : ''} has been cancelled.`,
        refundNote,
      ].filter(Boolean))
    );

    return res.json({ refunded });
  });

// ── onSessionCancelled — notify all attendees when admin cancels a session ──
exports.onSessionCancelled = onDocumentUpdated({
  document:  'sessions/{sessionId}',
  region:    REGION_FIRESTORE,
  secrets:   [GMAIL_APP_PASSWORD],
}, async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (before.status === after.status || after.status !== 'cancelled') return;

  const db        = getFirestore();
  const venue     = after.venue || 'the session';
  const dateStr   = _formatDate(after.date);
  const attendees = await db
    .collection('sessions').doc(event.params.sessionId)
    .collection('attendees').get();

  await Promise.all(attendees.docs.map(doc => {
    const a = doc.data();
    if (!a.email) return;
    return sendEmail(a.email,
      `Session cancelled — ${venue}${dateStr ? ` · ${dateStr}` : ''}`,
      _emailHtml(`Hi ${a.name || 'there'},`, [
        `Unfortunately <strong>${venue}</strong>${dateStr ? ` on <strong>${dateStr}</strong>` : ''} has been cancelled.`,
        a.paid && a.refundAmountPence > 0
          ? `A refund of <strong>£${(a.refundAmountPence / 100).toFixed(2)}</strong> will be processed automatically.`
          : '',
        `Apologies for the inconvenience.`,
      ].filter(Boolean))
    );
  }));
});

// ── onAttendeeJoined — registration confirmation for free sessions ───────────
exports.onAttendeeJoined = onDocumentCreated({
  document:  'sessions/{sessionId}/attendees/{uid}',
  region:    REGION_FIRESTORE,
  secrets:   [GMAIL_APP_PASSWORD],
}, async (event) => {
  const attendee = event.data.data();
  if (attendee.paid) return; // paid sessions get confirmation from stripeWebhook
  if (!attendee.email) return;

  const db         = getFirestore();
  const sessionDoc = await db.collection('sessions').doc(event.params.sessionId).get();
  if (!sessionDoc.exists) return;
  const session = sessionDoc.data();

  const venue   = session.venue || 'the session';
  const dateStr = _formatDate(session.date);
  await sendEmail(attendee.email,
    `You're in — ${venue}${dateStr ? ` · ${dateStr}` : ''}`,
    _emailHtml(`Hi ${attendee.name || 'there'},`, [
      `You're registered for <strong>${venue}</strong>${dateStr ? ` on <strong>${dateStr}</strong>` : ''}.`,
      `See you on the court!`,
    ])
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function _playerPrice(adminPrice) {
  if (!adminPrice || adminPrice <= 0) return 0;
  const gross = (adminPrice + 0.20) / (1 - 0.015);
  return Math.ceil(gross / 0.50) * 0.50;
}

function _formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _emailHtml(greeting, paragraphs) {
  const body = paragraphs.map(p => `<p style="margin:0 0 12px">${p}</p>`).join('');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#111;max-width:480px;margin:0 auto;padding:24px">
<p style="margin:0 0 12px">${greeting}</p>
${body}
<p style="margin:24px 0 0;font-size:12px;color:#888">KQOTC Volleyball</p>
</body></html>`;
}

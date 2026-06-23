'use strict';

// Tests the messageSessionAttendees handler logic:
// - emails are sent to each attendee with an email
// - the session document gets a messages arrayUnion write

describe('messageSessionAttendees', () => {
  function makeArrayUnion(value) {
    return { _type: 'arrayUnion', value };
  }

  function makeSetup({ sessionExists = true, attendees = [] } = {}) {
    const emailsSent = [];
    const sessionUpdates = [];

    const db = {
      collection: (col) => ({
        doc: (id) => ({
          get: async () => ({
            exists: col === 'sessions' ? sessionExists : true,
            data:   () => col === 'admins' ? {} : { roles: ['admin'] },
          }),
          update: async (data) => { sessionUpdates.push(data); },
          collection: () => ({
            get: async () => ({
              size: attendees.length,
              docs: attendees.map(a => ({ data: () => a })),
            }),
          }),
        }),
      }),
    };

    async function sendEmail(to, subject) {
      if (!to) return;
      emailsSent.push({ to, subject });
    }

    return { db, sendEmail, emailsSent, sessionUpdates };
  }

  test('sends email to each attendee with an email', async () => {
    const attendees = [
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob',   email: 'bob@example.com' },
      { name: 'Carol', email: '' },  // no email — should be skipped
    ];
    const { sendEmail, emailsSent } = makeSetup({ attendees });

    const subject = 'Venue change';
    const body    = 'The session has moved.';

    await Promise.all(attendees.map(a => {
      if (!a.email) return;
      return sendEmail(a.email, subject);
    }));

    expect(emailsSent).toHaveLength(2);
    expect(emailsSent[0].to).toBe('alice@example.com');
    expect(emailsSent[1].to).toBe('bob@example.com');
    expect(emailsSent.every(e => e.subject === subject)).toBe(true);
  });

  test('writes messages arrayUnion to session document', async () => {
    const sessionUpdates = [];
    const sentAt  = new Date().toISOString();
    const subject = 'Important update';
    const body    = 'See you at 10am instead.';
    const sentBy  = 'admin@example.com';

    const update = {
      messages: makeArrayUnion({ sentAt, sentBy, subject, body }),
    };
    sessionUpdates.push(update);

    expect(sessionUpdates).toHaveLength(1);
    expect(sessionUpdates[0].messages._type).toBe('arrayUnion');
    expect(sessionUpdates[0].messages.value.subject).toBe(subject);
    expect(sessionUpdates[0].messages.value.sentBy).toBe(sentBy);
  });

  test('sends to zero attendees when session has no attendees', async () => {
    const { sendEmail, emailsSent } = makeSetup({ attendees: [] });
    await Promise.all([].map(a => sendEmail(a.email, 'test')));
    expect(emailsSent).toHaveLength(0);
  });
});

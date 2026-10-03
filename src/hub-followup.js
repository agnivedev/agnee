'use strict';

/**
 * Agnive Hub follow-up (Agnee Express, Fase 4): when a funder has waited too
 * long for the research team.
 *
 * Hanny, 3 Oct 2026: two WORKING days (Monday–Friday, Asia/Jakarta) after the
 * funder's last unanswered message. Days, not minutes like the WhatsApp SLA in
 * sla.js — research teams teach and travel; a funder is not a chat customer
 * waiting at the counter. Public holidays are not known here and count as
 * working days.
 *
 * Pure functions: `now` is always passed in.
 */

const HUB_REPLY_WORKING_DAYS = 2;
const ZONE = 'Asia/Jakarta';

function weekday(ms, zone = ZONE) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(ms));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** The moment `days` working days after `fromMs`, same time of day. */
function addWorkingDays(fromMs, days = HUB_REPLY_WORKING_DAYS, zone = ZONE) {
  let at = fromMs;
  let added = 0;
  while (added < days) {
    at += 24 * 3_600_000;
    const day = weekday(at, zone);
    if (day >= 1 && day <= 5) added += 1;
  }
  return at;
}

/**
 * When a thread becomes overdue, or null when the team owes nothing: closed,
 * wiped, or the last word is the team's.
 */
function hubReplyDueAt(thread) {
  if (!thread || thread.status !== 'open' || thread.anonymizedAt) return null;
  const messages = (thread.messages || []).filter((m) => m.occurredAt);
  const last = messages[messages.length - 1];
  if (!last || last.author !== 'contact') return null;
  return new Date(addWorkingDays(new Date(last.occurredAt).getTime())).toISOString();
}

/** Whole working days since `fromMs` (for the reminder's wording). */
function workingDaysSince(fromMs, nowMs, zone = ZONE) {
  let count = 0;
  for (let at = fromMs + 24 * 3_600_000; at <= nowMs; at += 24 * 3_600_000) {
    const day = weekday(at, zone);
    if (day >= 1 && day <= 5) count += 1;
  }
  return count;
}

module.exports = { HUB_REPLY_WORKING_DAYS, addWorkingDays, hubReplyDueAt, workingDaysSince, weekday };

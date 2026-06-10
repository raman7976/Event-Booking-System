// Sends confirmation / waitlist emails. With no SMTP_* configured it auto-creates
// an Ethereal test inbox and logs a preview URL.
import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { bullConnection } from '../config/redis.js';
import { QUEUE_NAMES } from '../config/queues.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transporterPromise = null;
async function getTransporter() {
  if (transporterPromise) return transporterPromise;
  transporterPromise = (async () => {
    if (config.mail.host) {
      logger.info(`[email] SMTP transport ${config.mail.host}:${config.mail.port}`);
      return nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port || 587,
        secure: config.mail.port === 465,
        auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      });
    }
    const acc = await nodemailer.createTestAccount();
    logger.info(`[email] no SMTP set — using Ethereal test inbox (${acc.user})`);
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: acc.user, pass: acc.pass },
    });
  })();
  return transporterPromise;
}

function buildEmail(data) {
  const {
    to,
    type = 'confirmation',
    userName = 'Guest',
    eventName = 'your event',
    venue = '',
    seats = [],
    total = 0,
    transactionId = '',
  } = data;

  if (type === 'waitlist') {
    const subject = `A seat just opened up for ${eventName}`;
    const text = `Hi ${userName}, a seat for ${eventName}${venue ? ` at ${venue}` : ''} is now available. Head back and grab it before it's gone!`;
    const html = `<h2>A seat opened up! 🎉</h2><p>Hi ${userName}, a seat for <b>${eventName}</b>${venue ? ` at ${venue}` : ''} just became available.</p><p>Head back to the event and grab it before someone else does.</p>`;
    return { to, subject, html, text };
  }

  const seatList = seats.map((s) => `${s.row}${s.number} (${s.category}) — $${s.price}`).join(', ') || '—';
  const subject = `Booking confirmed: ${eventName}`;
  const text = `Hi ${userName}, your booking for ${eventName}${venue ? ` at ${venue}` : ''} is confirmed.\nSeats: ${seatList}\nTotal: $${total}\nTransaction: ${transactionId}`;
  const html = `<h2>Booking confirmed 🎟️</h2>
    <p>Hi ${userName}, your booking for <b>${eventName}</b>${venue ? ` at ${venue}` : ''} is confirmed.</p>
    <p><b>Seats:</b> ${seatList}</p>
    <p><b>Total:</b> $${total}</p>
    <p><b>Transaction:</b> ${transactionId}</p>`;
  return { to, subject, html, text };
}

export async function processEmail(job) {
  const { to, subject, html, text } = buildEmail(job.data);
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from: config.mail.from, to, subject, html, text });
  const preview = nodemailer.getTestMessageUrl(info) || null;
  logger.info(`[email] sent to=${to} id=${info.messageId}${preview ? ` preview=${preview}` : ''}`);
  return { messageId: info.messageId, preview };
}

export function startEmailWorker() {
  const worker = new Worker(QUEUE_NAMES.email, processEmail, {
    connection: bullConnection,
    concurrency: 5,
  });
  worker.on('failed', (job, err) => logger.error(`[email] job ${job?.id} failed:`, err.message));
  return worker;
}

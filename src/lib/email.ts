import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'NowNow <noreply@nownow.co.za>';

interface SendEmailOptions {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: { filename: string; content: Buffer }[];
}

/**
 * Send an email via Resend.
 * In dev (no RESEND_API_KEY), logs to console instead.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ id: string } | null> {
    if (!resend) {
        console.log(`[Email] (dev) To: ${options.to} | Subject: ${options.subject}`);
        return null;
    }

    const { data, error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        ...(options.text ? { text: options.text } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.cc ? { cc: Array.isArray(options.cc) ? options.cc : [options.cc] } : {}),
        ...(options.bcc ? { bcc: Array.isArray(options.bcc) ? options.bcc : [options.bcc] } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {}),
    });

    if (error) {
        console.error(`[Email] Failed to send to ${options.to}: ${error.message}`);
        throw new Error(`Email delivery failed: ${error.message}`);
    }

    console.log(`[Email] Sent to ${options.to} | id: ${data!.id}`);
    return data;
}

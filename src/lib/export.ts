import { toCSV } from './csv.js';
import { sendEmail } from './email.js';

interface ExportOptions {
    to: string;
    subject: string;
    filename: string;
    rows: Record<string, any>[];
    columns?: { key: string; label: string }[];
    message?: string;
}

/**
 * Generate a CSV from rows and email it as an attachment.
 */
export async function emailCSVExport(options: ExportOptions): Promise<void> {
    const csv = toCSV(options.rows, options.columns);

    if (options.rows.length === 0) {
        await sendEmail({
            to: options.to,
            subject: options.subject,
            html: `
                <h2>${options.subject}</h2>
                <p>${options.message || 'Your export is ready, but no data matched the criteria.'}</p>
                <p>No records found for the selected filters.</p>
            `,
        });
        return;
    }

    await sendEmail({
        to: options.to,
        subject: options.subject,
        html: `
            <h2>${options.subject}</h2>
            <p>${options.message || 'Your export is ready.'}</p>
            <p><strong>${options.rows.length}</strong> records exported.</p>
            <p>The CSV file is attached to this email.</p>
        `,
        attachments: [{
            filename: options.filename,
            content: Buffer.from(csv, 'utf-8'),
        }],
    });
}

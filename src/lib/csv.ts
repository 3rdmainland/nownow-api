/**
 * Convert an array of objects to a CSV string.
 * Handles commas, quotes, and newlines in values.
 */
export function toCSV(rows: Record<string, any>[], columns?: { key: string; label: string }[]): string {
    if (rows.length === 0) return '';

    const cols = columns || Object.keys(rows[0]).map(key => ({ key, label: key }));
    const header = cols.map(c => escapeCSV(c.label)).join(',');

    const body = rows.map(row =>
        cols.map(c => {
            const val = row[c.key];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') return escapeCSV(JSON.stringify(val));
            return escapeCSV(String(val));
        }).join(',')
    ).join('\n');

    return header + '\n' + body;
}

function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

/**
 * Parse NoBugDB wire responses.
 *
 * Success shapes (from server Protocol::format_response / special cases):
 * - ERROR|<message>\n
 * - PONG\n
 * - OK|\n                         (DML / DDL / empty success)
 * - OK|authenticated\n
 * - OK|Goodbye\n
 * - OK|col1\tcol2\n               (SELECT, 0 rows)
 * - OK|col1\tcol2\nrow...\n       (SELECT with rows)
 */

export type ParsedResponse =
  | { kind: 'pong' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok';
      message: string;
      columns: string[];
      rows: string[][];
    };

const STATUS_MESSAGES = new Set(['authenticated', 'Goodbye']);

/**
 * Returns true when `buffer` contains a complete wire response.
 * Result-set responses may span multiple lines; caller must also wait for socket idle.
 */
export function isCompleteResponse(buffer: string): boolean {
  if (!buffer.includes('\n')) {
    return false;
  }

  if (buffer.startsWith('ERROR|') || buffer === 'PONG\n' || buffer.startsWith('PONG\n')) {
    return buffer.includes('\n');
  }

  if (!buffer.startsWith('OK|')) {
    return false;
  }

  const firstLineEnd = buffer.indexOf('\n');
  const firstLine = buffer.slice(0, firstLineEnd);
  const payload = firstLine.slice(3); // after "OK|"

  if (payload === '' || STATUS_MESSAGES.has(payload)) {
    return true;
  }

  // Result set: complete only when buffer ends with newline (last row or header-only).
  return buffer.endsWith('\n');
}

/**
 * True when the response is a multi-line result set that may still receive more TCP chunks
 * after the first complete newline (caller uses idle timeout).
 */
export function needsIdleFlush(buffer: string): boolean {
  if (!buffer.startsWith('OK|') || !buffer.includes('\n')) {
    return false;
  }

  const firstLineEnd = buffer.indexOf('\n');
  const payload = buffer.slice(3, firstLineEnd);

  if (payload === '' || STATUS_MESSAGES.has(payload)) {
    return false;
  }

  // Tabular / column-header OK — may fragment across packets.
  return true;
}

export function parseResponse(buffer: string): ParsedResponse {
  if (buffer.startsWith('PONG')) {
    return { kind: 'pong' };
  }

  if (buffer.startsWith('ERROR|')) {
    const lineEnd = buffer.indexOf('\n');
    const line = lineEnd === -1 ? buffer : buffer.slice(0, lineEnd);
    return { kind: 'error', message: line.slice('ERROR|'.length) };
  }

  if (!buffer.startsWith('OK|')) {
    throw new Error(`Unrecognized response: ${buffer.slice(0, 64)}`);
  }

  const firstLineEnd = buffer.indexOf('\n');
  if (firstLineEnd === -1) {
    throw new Error('Incomplete OK response');
  }

  const payload = buffer.slice(3, firstLineEnd);

  if (payload === '') {
    return { kind: 'ok', message: '', columns: [], rows: [] };
  }

  if (STATUS_MESSAGES.has(payload)) {
    return { kind: 'ok', message: payload, columns: [], rows: [] };
  }

  const columns = payload.length === 0 ? [] : payload.split('\t');
  const rest = buffer.slice(firstLineEnd + 1);
  const rows: string[][] = [];

  if (rest.length > 0) {
    const lines = rest.split('\n');
    for (const line of lines) {
      if (line === '') {
        continue;
      }
      rows.push(line.split('\t'));
    }
  }

  return { kind: 'ok', message: '', columns, rows };
}

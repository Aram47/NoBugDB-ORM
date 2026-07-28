/**
 * Encode NoBugDB wire requests (UTF-8, newline-framed).
 * Format: TYPE|payload\n
 */

export function encodeAuth(user: string, password: string): string {
  return `AUTH|${user}|${password}\n`;
}

export function encodeQuery(sql: string): string {
  return `QUERY|${sql}\n`;
}

export function encodePing(): string {
  return 'PING|\n';
}

export function encodeQuit(): string {
  return 'QUIT|\n';
}

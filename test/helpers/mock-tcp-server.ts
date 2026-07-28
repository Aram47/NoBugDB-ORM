import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

export interface MockServer {
  host: string;
  port: number;
  close: () => Promise<void>;
  readonly requestLog: string[];
}

export async function startMockServer(
  handler: (request: string, socket: Socket) => void,
): Promise<MockServer> {
  const requestLog: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const request = buffer.slice(0, newline + 1);
        buffer = buffer.slice(newline + 1);
        requestLog.push(request);
        handler(request, socket);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    host: '127.0.0.1',
    port: address.port,
    requestLog,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export function replyOk(socket: Socket, message = ''): void {
  socket.write(`OK|${message}\n`);
}

export function replyQueryOk(socket: Socket, columns: string[] = [], rows: string[][] = []): void {
  const header = columns.length > 0 ? columns.join('\t') : 'n';
  const body = rows.map((row) => row.join('\t')).join('\n');
  socket.write(body ? `OK|${header}\n${body}\n` : `OK|${header}\n1\n`);
}

export function replyError(socket: Socket, message: string): void {
  socket.write(`ERROR|${message}\n`);
}

export function sqlFromQuery(request: string): string {
  return request.slice('QUERY|'.length, -1);
}

export function handleDefaultQuery(request: string, socket: Socket): void {
  if (request.startsWith('PING|')) {
    socket.write('PONG\n');
    return;
  }

  if (request.startsWith('QUIT|')) {
    replyOk(socket, 'Goodbye');
    return;
  }

  if (!request.startsWith('QUERY|')) {
    return;
  }

  const sql = sqlFromQuery(request).trim().toUpperCase();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
    replyOk(socket);
    return;
  }

  replyQueryOk(socket, ['n'], [['1']]);
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

import net from 'node:net';
import tls from 'node:tls';
import { LEAF_KEY, VALID_LEAF } from './tlsTestCerts.js';

/**
 * A small mail server on the loopback address, for the tests of the mail client. It speaks enough SMTP for
 * nodemailer: the greeting, EHLO, STARTTLS, AUTH PLAIN and LOGIN, one message at a time, and it keeps what it was
 * sent. `tls` is implicit TLS, `starttls` offers the upgrade, `plain` offers none. Its certificate is the test one
 * for `localhost` (tlsTestCerts.ts), so a client has to be told to trust TEST_CA and to expect that name.
 */

export interface FakeSmtpOptions {
  mode: 'tls' | 'starttls' | 'plain';
  /** When set, a login is needed before a message and is checked against this. */
  login?: { user: string; pass: string };
  /** Recipients the server answers with 550. */
  refuse?: string[];
  /** Never says a word: for the tests of a client that gives up. */
  silent?: boolean;
  /** Greets, then ignores every command: for the test of a check that must not wait out the long send timeout. */
  ignoreCommands?: boolean;
  /** Does not offer STARTTLS although the mode is `starttls`: for the test of a client that insists on it. */
  withholdStarttls?: boolean;
}

export interface Received {
  from: string;
  to: string[];
  raw: string;
  encrypted: boolean;
}

export interface LoginAttempt {
  user: string;
  pass: string;
  ok: boolean;
  encrypted: boolean;
}

export interface FakeSmtp {
  port: number;
  messages: Received[];
  logins: LoginAttempt[];
  /** The client's lines before any encryption: a password sent in the clear would show here. */
  clearText: string[];
  close(): Promise<void>;
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const unb64 = (text: string) => Buffer.from(text, 'base64').toString('utf8');

export async function startFakeSmtp(options: FakeSmtpOptions): Promise<FakeSmtp> {
  const messages: Received[] = [];
  const logins: LoginAttempt[] = [];
  const clearText: string[] = [];
  const sockets = new Set<net.Socket>();

  function serve(socket: net.Socket, encrypted: boolean, greet = true): void {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = '';
    let inData = false;
    let from = '';
    let to: string[] = [];
    let waiting: 'plain' | 'user' | 'pass' | null = null;
    let loginUser = '';
    let signedIn = !options.login;
    const send = (line: string) => socket.write(`${line}\r\n`);

    const attempt = (user: string, pass: string) => {
      const ok = user === options.login?.user && pass === options.login?.pass;
      logins.push({ user, pass, ok, encrypted });
      signedIn = ok;
      send(ok ? '235 2.7.0 Accepted' : '535 5.7.8 Username and Password not accepted');
    };

    const handle = (line: string) => {
      if (!encrypted) clearText.push(line);
      if (options.ignoreCommands) return;
      if (waiting === 'plain') {
        waiting = null;
        const [, user = '', pass = ''] = unb64(line).split('\0');
        return attempt(user, pass);
      }
      if (waiting === 'user') {
        loginUser = unb64(line);
        waiting = 'pass';
        return send(`334 ${b64('Password:')}`);
      }
      if (waiting === 'pass') {
        waiting = null;
        return attempt(loginUser, unb64(line));
      }
      const [verb = '', ...rest] = line.split(' ');
      const command = verb.toUpperCase();
      if (command === 'EHLO' || command === 'HELO') {
        const offers = ['250-fake.example'];
        if (options.mode === 'starttls' && !encrypted && !options.withholdStarttls) offers.push('250-STARTTLS');
        const mayLogIn = options.login && (encrypted || options.mode === 'plain');
        if (mayLogIn) offers.push('250-AUTH PLAIN LOGIN');
        offers.push('250 8BITMIME');
        return offers.forEach(send);
      }
      if (command === 'STARTTLS') {
        if (options.mode !== 'starttls' || encrypted || options.withholdStarttls) return send('454 4.7.0 TLS not available');
        send('220 2.0.0 Ready to start TLS');
        socket.removeAllListeners('data');
        const secure = new tls.TLSSocket(socket, { isServer: true, key: LEAF_KEY, cert: VALID_LEAF });
        return serve(secure, true, false);
      }
      if (command === 'AUTH') {
        const [mechanism = '', initial] = rest;
        if (mechanism.toUpperCase() === 'PLAIN') {
          if (initial) {
            const [, user = '', pass = ''] = unb64(initial).split('\0');
            return attempt(user, pass);
          }
          waiting = 'plain';
          return send('334 ');
        }
        if (mechanism.toUpperCase() === 'LOGIN') {
          waiting = 'user';
          return send(`334 ${b64('Username:')}`);
        }
        return send('504 5.5.4 Unrecognized authentication type');
      }
      if (command === 'MAIL') {
        if (!signedIn) return send('530 5.7.0 Authentication required');
        from = /<([^>]*)>/.exec(line)?.[1] ?? '';
        to = [];
        return send('250 2.1.0 OK');
      }
      if (command === 'RCPT') {
        const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
        if (options.refuse?.includes(address)) return send('550 5.1.1 No such user here');
        to.push(address);
        return send('250 2.1.5 OK');
      }
      if (command === 'DATA') {
        inData = true;
        return send('354 End data with <CR><LF>.<CR><LF>');
      }
      if (command === 'QUIT') {
        send('221 2.0.0 Bye');
        return socket.end();
      }
      return send('250 2.0.0 OK');
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push({ from, to, raw: buffer.slice(0, end), encrypted });
          buffer = buffer.slice(end + 5);
          inData = false;
          send('250 2.0.0 Queued');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol < 0) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        handle(line);
      }
    });

    if (greet && !options.silent) send('220 fake.example ESMTP ready');
  }

  const server =
    options.mode === 'tls'
      ? tls.createServer({ key: LEAF_KEY, cert: VALID_LEAF }, (socket) => serve(socket, true))
      : net.createServer((socket) => serve(socket, false));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    messages,
    logins,
    clearText,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port nothing listens on: bind one, note its number, let it go. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Print an scrypt hash for a portal password, to paste into PORTAL_USERS as the password part
 * (name:HASH:role) or into PORTAL_PASS.
 *
 *   printf '%s' 'the password' | npx tsx scripts/hash-password.ts     (from server/)
 *   npx tsx scripts/hash-password.ts                                   (asks twice, hidden)
 *
 * The password comes from standard input, never from an argument, so it stays out of the shell
 * history and the process list. One trailing newline is dropped. Each run prints a different hash
 * for the same password (a fresh salt) and any of them signs in. Only the hash goes to standard
 * output; prompts and errors go to standard error.
 */
import { hashPassword } from '../src/security/passwords.js';

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** A line typed at the keyboard with nothing echoed. Enter ends it, Ctrl-C stops the script. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin } = process;
    let typed: string[] = [];
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          return resolve(typed.join(''));
        }
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else typed.push(ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden('Password: ');
    if (password !== (await readHidden('Again: '))) {
      process.stderr.write('The two entries differ. Nothing printed.\n');
      process.exit(1);
    }
  } else {
    password = await readPiped();
  }
  if (!password) {
    process.stderr.write('No password given. Nothing printed.\n');
    process.exit(1);
  }
  process.stdout.write(`${await hashPassword(password)}\n`);
}

await main();

import { createHash } from 'node:crypto';

export function shortHash(input: string, length = 16): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

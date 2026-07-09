// Module augmentation: expose the internal numeric user id (as a string) on the
// session/JWT so server code can look up household-scoped data by user later,
// without widening next-auth's User/Session with fields we don't otherwise need.
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}

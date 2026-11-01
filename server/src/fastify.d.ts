import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from './domain.js';
import type { Services } from './container.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    services: Services;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (required: string | string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

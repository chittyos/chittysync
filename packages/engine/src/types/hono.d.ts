/**
 * Hono type declarations (placeholder until package is installed)
 */
declare module "hono" {
  export interface Context<E = unknown> {
    env: E extends { Bindings: infer B } ? B : unknown;
    req: {
      query(): Record<string, string>;
      param(name: string): string;
      json<T = unknown>(): Promise<T>;
      header(name: string): string | undefined;
      path: string;
    };
    json(data: unknown, status?: number): Response;
  }

  export class Hono<E = unknown> {
    use(path: string, ...middleware: unknown[]): this;
    get(path: string, handler: (c: Context<E>) => Response | Promise<Response>): this;
    post(path: string, handler: (c: Context<E>) => Response | Promise<Response>): this;
    put(path: string, handler: (c: Context<E>) => Response | Promise<Response>): this;
    delete(path: string, handler: (c: Context<E>) => Response | Promise<Response>): this;
    route(path: string, app: Hono<E>): this;
    notFound(handler: (c: Context<E>) => Response | Promise<Response>): this;
    onError(handler: (err: Error, c: Context<E>) => Response | Promise<Response>): this;
    fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>;
  }

  export { Context };
}

declare module "hono/cors" {
  export function cors(options?: {
    origin?: string | string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
    credentials?: boolean;
  }): unknown;
}

declare module "hono/logger" {
  export function logger(): unknown;
}

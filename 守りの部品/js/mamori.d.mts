// 守りの部品の型(TypeScript から mamori.mjs を使うとき用)。中身の説明は mamori.mjs。
import type { IncomingMessage, ServerResponse, Server, RequestListener } from 'node:http';

export interface HttpError extends Error { status: number; publicMessage: string }
export function httpError(status: number, publicMessage: string): HttpError;

export function listenLocal(server: Server, port?: number): Promise<Server>;

export function isLoopback(req: IncomingMessage): boolean;
export function allowedHosts(port: number, hosts?: string[]): Set<string>;
export function checkRequest(req: IncomingMessage, opts: { port: number; hosts?: string[]; allowRemote?: boolean }):
  null | { status: number; reason: string };

export const DEFAULT_CSP: string;
export function securityHeaders(opts?: { csp?: string }): Record<string, string>;
export function setSecurityHeaders(res: ServerResponse, opts?: { csp?: string }): void;
export function sendText(res: ServerResponse, status: number, text: string): void;

export function createLocalServer(
  handler: (req: IncomingMessage, res: ServerResponse) => unknown | Promise<unknown>,
  opts?: { port?: number; hosts?: string[]; csp?: string; secrets?: Array<string | undefined>; log?: (msg: string) => void },
): Promise<Server>;

export function readBody(req: IncomingMessage, opts?: { limit?: number }): Promise<string>;
export function parseJsonSafe(text: string): unknown;
export function readJson(req: IncomingMessage, opts?: { limit?: number }): Promise<unknown>;

export function safeJoin(root: string, userPath: string): string | null;
export function urlToFile(root: string, reqUrl: string): string | null;

export function redact(text: unknown, opts?: { secrets?: Array<string | undefined> }): string;
export function escapeHtml(v: unknown): string;
export function csvCell(v: unknown): string;

export function newToken(bytes?: number): string;
export function sameToken(a: unknown, b: unknown): boolean;

export function writeFileAtomic(file: string, data: string | Uint8Array): void;
export function rateLimiter(opts?: { max?: number; perMs?: number }): (key?: string) => boolean;

export function checkUrl(url: string | URL, opts?: { hosts?: string[] }): URL | null;
export function safeFetch(url: string | URL, opts: RequestInit & { hosts: string[]; timeoutMs?: number; maxBytes?: number }):
  Promise<{ ok: boolean; status: number; headers: Headers; text: string; json: () => unknown }>;

export type { RequestListener };

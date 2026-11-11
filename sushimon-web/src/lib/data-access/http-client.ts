import type { DataClient } from './types';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function createHttpClient(baseUrl: string): DataClient {
  return {
    kind: 'http',
    async get<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, { signal: init?.signal, cache: 'no-store' });
      if (!res.ok) throw new HttpError(res.status, `GET ${path} → ${res.status}`);
      return (await res.json()) as T;
    },
  };
}

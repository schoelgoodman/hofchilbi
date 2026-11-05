/** Talks to the editor API. Every write carries X-Hofchilbi-Editor (CSRF guard on the server). */

export class ApiError extends Error {
  status: number;
  details: Record<string, string> | undefined;
  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { "X-Hofchilbi-Editor": "1", ...headers }, credentials: "same-origin" };
  if (body instanceof Blob) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Keine Verbindung zum Server. Ist das Internet da?");
  }
  if (res.status === 401 || (res.redirected && !res.url.includes(location.host))) {
    throw new ApiError(401, "Die Anmeldung ist abgelaufen. Bitte Seite neu laden und wieder anmelden.");
  }
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new ApiError(res.status, `Fehler ${res.status}`);
  }
  if (!res.ok) {
    const d = data as { error?: string; details?: Record<string, string> };
    throw new ApiError(res.status, d.error ?? `Fehler ${res.status}`, d.details);
  }
  return data as T;
}

export interface Versioned<T> {
  data: T;
  version: string;
}
export interface NewsEntry {
  slug: string;
  meta: { title: string; date: string; image?: string; imageAlt?: string; ctaLabel?: string; ctaUrl?: string; draft?: boolean };
  body: string;
  version: string;
}
export interface PageEntry {
  meta: { title?: string; description?: string };
  body: string;
  version: string;
}
export interface State {
  docs: Record<"site" | "sponsors" | "anzapfer" | "team" | "galleries" | "timeline", Versioned<any>>;
  news: NewsEntry[];
  pages: Record<string, PageEntry>;
  publicUrl: string;
  build: { ok: boolean; at?: string; error?: string } | null;
  immich: ImmichStatus;
}
export interface ImmichStatus {
  enabled: boolean;
  interval: number;
  running: boolean;
  lastRun?: string;
  lastError?: string;
  albums: { year: number; name: string; images: number }[];
}

export const api = {
  state: () => call<State>("GET", "/api/state"),
  putDoc: (name: string, data: unknown, base: string) => call<{ version: string }>("PUT", `/api/doc/${name}`, { data, base }),
  createNews: (title: string) => call<{ slug: string }>("POST", "/api/news", { title }),
  putNews: (slug: string, meta: unknown, body: string, base: string) => call<{ version: string }>("PUT", `/api/news/${slug}`, { meta, body, base }),
  deleteNews: (slug: string, base: string) => call<object>("DELETE", `/api/news/${slug}?base=${encodeURIComponent(base)}`),
  putPage: (name: string, meta: unknown, body: string, base: string) => call<{ version: string }>("PUT", `/api/page/${name}`, { meta, body, base }),
  upload: (dir: string, file: File) =>
    call<{ path: string }>("POST", `/api/upload?dir=${encodeURIComponent(dir)}`, file, { "X-Filename": encodeURIComponent(file.name) }),
  history: () => call<{ hash: string; date: string; message: string }[]>("GET", "/api/history"),
  restore: (hash: string) => call<{ date: string }>("POST", "/api/restore", { hash }),
  immichSync: () => call<ImmichStatus>("POST", "/api/immich/sync", {}),
};

export function thumb(src: string | undefined, w = 320): string {
  return src ? `/api/thumb?w=${w}&src=${encodeURIComponent(src)}` : "";
}

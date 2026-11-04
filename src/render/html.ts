/**
 * Tiny HTML templating: every interpolated value is escaped unless it is a Raw (output of html``
 * or raw()). Arrays are joined. null/undefined/false render nothing.
 */
export class Raw {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export const raw = (s: string): Raw => new Raw(s);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

type Value = Raw | string | number | boolean | null | undefined | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Raw(out);
}

/** JSON for <script type="application/ld+json">: "<" escaped so it can't close the tag. */
export function jsonLd(data: unknown): Raw {
  return raw(JSON.stringify(data).replace(/</g, "\\u003c"));
}

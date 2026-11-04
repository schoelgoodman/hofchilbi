import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

/**
 * Milkdown (Crepe) for free text: news and Geschichte. Only what the site can show is enabled:
 * paragraphs, bold/italic, links, lists, quotes, subheadings. No code, math, tables or images
 * inside the text (news have their own image field).
 */
export interface MarkdownEditor {
  get(): string;
  destroy(): Promise<void>;
}

export async function markdownEditor(root: HTMLElement, value: string, onChange: (md: string) => void, placeholder = "Text schreiben …"): Promise<MarkdownEditor> {
  const crepe = new Crepe({
    root,
    defaultValue: value,
    features: {
      [Crepe.Feature.CodeMirror]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.Table]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.TopBar]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: placeholder, mode: "doc" },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: "Text",
          text: { label: "Absatz" },
          h1: { label: "Zwischentitel" },
          h2: { label: "Kleiner Zwischentitel" },
          h3: null,
          h4: null,
          h5: null,
          h6: null,
          quote: { label: "Zitat" },
          divider: { label: "Trennlinie" },
        },
        listGroup: { label: "Listen", bulletList: { label: "Aufzählung" }, orderedList: { label: "Nummerierte Liste" }, taskList: null },
        advancedGroup: null,
      },
    },
  });
  let last = value;
  crepe.on((l) =>
    l.markdownUpdated((_ctx, md) => {
      if (md !== last) {
        last = md;
        onChange(md);
      }
    }),
  );
  await crepe.create();
  return { get: () => crepe.getMarkdown(), destroy: () => crepe.destroy().then(() => undefined) };
}

import type { Field } from '@shared/frontmatter'

const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g

/** A property value as the collapsed properties line shows it: links by name, lists joined, long text cut short. */
export function summary(value: Field['value']): string {
  const text = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'boolean'
      ? value
        ? 'yes'
        : 'no'
      : value === null
        ? '—'
        : String(value)
  const plain = text.replace(WIKILINK, (_, target: string, _heading: unknown, label: string | undefined) =>
    (label === undefined ? target : label.slice(1)).trim(),
  )
  return plain.length > 32 ? `${plain.slice(0, 31)}…` : plain
}

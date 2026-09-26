/**
 * Callout headers: the type's icon and colour group, and the title.
 */

import { WidgetType } from '@codemirror/view'
import { renderInline } from './rich-widgets'

/** Obsidian's callout types and their aliases, grouped by the colour they share. */
const CALLOUT_GROUPS: Record<string, string[]> = {
  note: ['note'],
  abstract: ['abstract', 'summary', 'tldr'],
  info: ['info', 'todo'],
  tip: ['tip', 'hint', 'important'],
  success: ['success', 'check', 'done'],
  question: ['question', 'help', 'faq'],
  warning: ['warning', 'caution', 'attention'],
  failure: ['failure', 'fail', 'missing'],
  danger: ['danger', 'error', 'bug'],
  example: ['example'],
  quote: ['quote', 'cite'],
}

const ICONS: Record<string, string> = {
  note: '✎',
  abstract: '☰',
  info: 'ℹ',
  tip: '✦',
  success: '✓',
  question: '?',
  warning: '⚠',
  failure: '✕',
  danger: '⚡',
  example: '≡',
  quote: '❝',
}

/** The colour group for a callout type; unknown types look like `note`, as in Obsidian. */
export function calloutGroup(type: string): string {
  const lower = type.toLowerCase()
  for (const [group, names] of Object.entries(CALLOUT_GROUPS)) if (names.includes(lower)) return group
  return 'note'
}

export class CalloutHeader extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly title: string,
  ) {
    super()
  }

  override eq(other: CalloutHeader): boolean {
    return other.type === this.type && other.title === this.title
  }

  override toDOM(): HTMLElement {
    const group = calloutGroup(this.type)
    const head = document.createElement('span')
    head.className = 'cm-callout-title'
    const icon = document.createElement('span')
    icon.className = 'cm-callout-icon'
    icon.textContent = ICONS[group] ?? '✎'
    const text = document.createElement('span')
    // No title given: Obsidian uses the type, capitalised.
    const title = this.title !== '' ? this.title : this.type.charAt(0).toUpperCase() + this.type.slice(1).toLowerCase()
    renderInline(title, text)
    head.append(icon, text)
    return head
  }

  override ignoreEvent(): boolean {
    return false
  }
}

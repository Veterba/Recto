/**
 * Whether live preview is on, as editor state the decorations read.
 */

import { StateField, StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export const livePreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setLivePreview)) return effect.value
    }
    return value
  },
})

export const setLivePreview = StateEffect.define<boolean>()

export const isLivePreviewOn = (view: EditorView): boolean => view.state.field(livePreviewEnabled, false) ?? false

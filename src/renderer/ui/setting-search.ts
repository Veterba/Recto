import { createContext, useContext } from 'react'

/**
 * Searching Settings: what was typed, handed down to every setting row, so a
 * row can hide itself when it does not match and mark the words that do.
 * Empty when nobody is searching.
 */
export const SettingSearchContext = createContext('')

export const useSettingSearch = (): string => useContext(SettingSearchContext)

const words = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')

/** Whether every word of the query is somewhere in the text, ignoring case. */
export function matchesQuery(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  return words(query).every((word) => lower.includes(word))
}

/** The text cut into runs, each a match of a query word or not: what gets marked. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const found = words(query)
  if (found.length === 0) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const hit = new Array<boolean>(text.length).fill(false)
  for (const word of found)
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) hit.fill(true, at, at + word.length)
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1]
    if (last !== undefined && last.hit === hit[i]) last.text += text[i]
    else parts.push({ text: text[i]!, hit: hit[i]! })
  }
  return parts
}

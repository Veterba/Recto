/** The archive: deleted notes kept for a while before the OS trash. */

/** One archived item. `originalPath` is where restore puts it back. */
export type ArchiveEntry = {
  id: string
  originalPath: string
  name: string
  kind: 'file' | 'folder'
  deletedAt: number
  size: number
}

export type ArchiveState = {
  /** Days before an archived item goes to the OS trash. 0 means keep forever. */
  retentionDays: number
  entries: ArchiveEntry[]
}

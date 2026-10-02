import { botThreadFolder, type BotMessage } from '@shared/bots'
import { appendTurns, createdStamp, parseTopic, topicFile, topicFileName, type ChatTopicMeta, type TopicMessage } from '@shared/chat-topics'
import { IPC } from '@shared/ipc'
import type { FileNode } from '@shared/vault'
import { api } from '../../app/api'
import { noteIndexChanged } from '../../app/note-bus'

/**
 * A bot's conversation as chat topics: which topic files there are, which of
 * them are loaded into the scroll, and which one is current - the one new
 * messages go into, and the only one the model sees.
 *
 * A plain object the view subscribes to, not React state: writing, renaming
 * and deleting files are async steps with side effects, and side effects do
 * not belong in state updaters (an answer saved from one landed twice).
 */

export type LoadedTopic = { path: string; meta: ChatTopicMeta; extra: string[]; body: string; messages: TopicMessage[] }

/** What a topic file's name says, before it is read: when it began, and its title. */
export function fromFileName(name: string): { created: string; title: string } {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})(?: — (.*?))?(?: \(\d+\))?\.md$/i.exec(name)
  if (match === null) return { created: '', title: name.replace(/\.md$/i, '') }
  return { created: `${match[1]}T${match[2]}:${match[3]}`, title: match[4] ?? 'Topic' }
}

/** The title a topic has until its first exchange is over. */
export const UNTITLED = 'New topic'

/** How many topics the scroll shows at first, and how many more each time it reaches the top. */
const PAGE = 3

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** A bot's topic files in the tree, newest first (the name starts with when the topic began). */
export function topicPaths(tree: readonly FileNode[], botId: string): string[] {
  const [chats, folder] = botThreadFolder(botId).split('/')
  const bot = tree.find((n) => n.path === chats)?.children?.find((n) => n.kind === 'folder' && n.name === folder)
  return (bot?.children ?? [])
    .filter((n) => n.kind === 'file' && n.name.toLowerCase().endsWith('.md'))
    .map((n) => n.path)
    .sort((a, b) => order(b) - order(a) || basename(b).localeCompare(basename(a)))
}

/**
 * When a topic began, from its file name, as a number to sort by - with the
 * " (2)" a second topic of the same minute and title gets counting as later.
 */
function order(path: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2}).*?(?: \((\d+)\))?\.md$/i.exec(basename(path))
  if (match === null) return 0
  const minutes = Number(`${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`)
  return minutes * 100 + Number(match[6] ?? 1)
}

export class ChatTopics {
  /** Newest first. */
  files: string[] = []
  loaded = new Map<string, LoadedTopic>()
  /** How many of the newest topics are in the scroll. */
  shown = PAGE
  /** The topic new messages go into; null is a new topic, not written to disk until its first message. */
  current: string | null = null
  ready = false
  private readonly listeners = new Set<() => void>()
  /** Bumped on every change, so a subscriber can tell one state from the next. */
  version = 0

  constructor(
    readonly bot: { id: string; name: string },
    /** The headings an assistant's turn may be under: the bot's name, and for Recto the old main chat's. */
    readonly assistants: readonly string[],
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  private get folder(): string {
    return botThreadFolder(this.bot.id)
  }

  /** Read the list of topics again (on open, and after a change made elsewhere). */
  async refresh(): Promise<void> {
    this.files = topicPaths(await api.invoke(IPC.fsTree), this.bot.id)
    if (!this.ready) this.current = this.files[0] ?? null
    else if (this.current !== null && !this.files.includes(this.current)) this.current = this.files[0] ?? null
    this.ready = true
    await Promise.all(this.visible().map((path) => this.load(path)))
    this.emit()
  }

  /** The topics in the scroll, oldest first: the newest `shown`, and the current one wherever it is. */
  visible(): string[] {
    const index = this.current === null ? -1 : this.files.indexOf(this.current)
    return this.files.slice(0, Math.max(this.shown, index + 1)).reverse()
  }

  hasOlder(): boolean {
    return this.visible().length < this.files.length
  }

  async load(path: string): Promise<LoadedTopic | null> {
    const cached = this.loaded.get(path)
    if (cached !== undefined) return cached
    const read = await api.invoke(IPC.fsRead, path)
    if (!read.ok) return null
    const parsed = parseTopic(read.content, this.assistants)
    const fromName = fromFileName(basename(path))
    const topic: LoadedTopic = {
      path,
      meta: {
        bot: parsed.meta.bot ?? this.bot.id,
        created: parsed.meta.created ?? fromName.created,
        title: parsed.meta.title ?? fromName.title,
      },
      extra: parsed.extra,
      body: parsed.body,
      messages: parsed.messages,
    }
    this.loaded.set(path, topic)
    return topic
  }

  /** Every topic read, for searching their text in History. */
  async loadAll(): Promise<LoadedTopic[]> {
    const all = await Promise.all(this.files.map((path) => this.load(path)))
    return all.filter((t): t is LoadedTopic => t !== null)
  }

  async loadOlder(): Promise<void> {
    this.shown += PAGE
    await Promise.all(this.visible().map((path) => this.load(path)))
    this.emit()
  }

  /** ⌘N: the next message starts a topic of its own. Nothing is written until it is sent. */
  startNew(): void {
    if (this.current === null) return
    this.current = null
    this.emit()
  }

  /** Continue an existing topic: it becomes current, and is loaded into the scroll if it was not. */
  async select(path: string): Promise<void> {
    this.current = path
    await Promise.all(this.visible().map((p) => this.load(p)))
    this.emit()
  }

  currentTopic(): LoadedTopic | null {
    return this.current === null ? null : (this.loaded.get(this.current) ?? null)
  }

  /** Add a turn to the current topic - creating its file first if it is new - and save it. Returns the topic's path. */
  async append(turn: BotMessage): Promise<string | null> {
    let topic = this.currentTopic()
    if (topic === null) {
      const meta: ChatTopicMeta = { bot: this.bot.id, created: createdStamp(new Date()), title: UNTITLED }
      const created = await api.invoke(IPC.fsCreate, this.folder, topicFileName(meta.created, meta.title), 'file')
      if (!created.ok) return null
      topic = { path: created.path, meta, extra: [], body: '', messages: [] }
      this.loaded.set(topic.path, topic)
      this.files = [topic.path, ...this.files]
      this.current = topic.path
    }
    topic.body = appendTurns(topic.body, [turn], this.bot.name)
    topic.messages = [...topic.messages, turn]
    await api.invoke(IPC.fsWrite, topic.path, topicFile(topic.meta, topic.extra, topic.body))
    noteIndexChanged()
    this.emit()
    return topic.path
  }

  /** A new title: in the frontmatter and in the file name, which is renamed to match. */
  async retitle(path: string, title: string): Promise<string> {
    const topic = await this.load(path)
    const clean = title.trim()
    if (topic === null || clean === '' || clean === topic.meta.title) return path
    topic.meta = { ...topic.meta, title: clean }
    await api.invoke(IPC.fsWrite, path, topicFile(topic.meta, topic.extra, topic.body))
    // A name already taken - two topics begun in the same minute, on the same
    // subject - gets a number, as the migration does.
    let next = path
    for (let n = 1; n <= 20 && next === path; n++) {
      const name = topicFileName(topic.meta.created, clean).replace(/\.md$/, n === 1 ? '.md' : ` (${n}).md`)
      const renamed = await api.invoke(IPC.fsRename, path, name)
      if (renamed.ok && 'path' in renamed && typeof renamed.path === 'string') next = renamed.path
    }
    if (next !== path) {
      this.loaded.delete(path)
      this.loaded.set(next, { ...topic, path: next })
      this.files = this.files.map((p) => (p === path ? next : p))
      if (this.current === path) this.current = next
    }
    noteIndexChanged()
    this.emit()
    return next
  }

  /**
   * Delete a topic: its file goes to the system trash. Returns an undo that
   * writes it back exactly, for the few seconds the view offers it.
   */
  async remove(path: string): Promise<() => Promise<void>> {
    const read = await api.invoke(IPC.fsRead, path)
    const content = read.ok ? read.content : null
    await api.invoke(IPC.fsTrash, path)
    this.loaded.delete(path)
    this.files = this.files.filter((p) => p !== path)
    if (this.current === path) this.current = this.files[0] ?? null
    noteIndexChanged()
    this.emit()
    return async () => {
      if (content === null) return
      const restored = await api.invoke(IPC.fsCreate, this.folder, basename(path), 'file')
      if (!restored.ok) return
      await api.invoke(IPC.fsWrite, restored.path, content)
      await this.refresh()
    }
  }

  /** "Clear all": every topic of this bot goes to the system trash. */
  async clearAll(): Promise<void> {
    for (const path of this.files) await api.invoke(IPC.fsTrash, path)
    this.files = []
    this.loaded.clear()
    this.current = null
    noteIndexChanged()
    this.emit()
  }
}

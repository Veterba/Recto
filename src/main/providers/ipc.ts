import { BrowserWindow, shell } from 'electron'
import { IPC, IPC_EVENT, type IpcApi } from '../../shared/ipc'
import { PROBLEM_TEXT } from '../../shared/providers'
import * as bots from '../bots'
import { saveThread } from '../bots/answers'
import { sendEvent } from '../events'
import { chatgpt, setOpenAiKey, statuses } from '.'
import { forgetAuth, INSTALL_URL } from './cli'
import { cancelQuickAsk, quickAsk } from './quick-ask'
import { ProviderError } from './run'

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

/** The only pages a provider link may open: the providers' own. */
const ALLOWED = [...Object.values(INSTALL_URL), 'https://chatgpt.com/settings/usage', 'https://platform.openai.com/api-keys', 'https://console.anthropic.com/']

export function registerProvidersIpc(handle: Handle): void {
  handle(IPC.providers, async () => {
    // Asked again each time Settings or the picker opens: a CLI just installed or signed in shows up.
    forgetAuth()
    const local = async (): Promise<{ id: string; label: string }[]> =>
      (await bots.models()).local.filter((m) => m.installed).map((m) => ({ id: m.name, label: m.name.replace(':', ' · ') }))
    return statuses(local)
  })
  handle(IPC.providersSetOpenAiKey, (key) => setOpenAiKey(key))
  handle(IPC.providersChatGptSignIn, async () => {
    try {
      const done = await chatgpt.signIn()
      return { ok: true as const, ...done }
    } catch (err) {
      console.error('[providers] ChatGPT sign-in', err)
      // A failure Recto did not foresee still says what it was: the sign-in cannot be debugged from "failed".
      return { ok: false as const, error: err instanceof ProviderError ? err.message : `${PROBLEM_TEXT.failed} (${err instanceof Error ? err.message : String(err)})` }
    }
  })
  handle(IPC.providersChatGptCancel, () => {
    chatgpt.cancel()
    return { ok: true }
  })
  handle(IPC.providersChatGptSignOut, async () => ({ ok: true, ...(await chatgpt.signOut()) }))
  handle(IPC.providersOpenUrl, (url) => {
    if (!ALLOWED.some((allowed) => url === allowed)) return { ok: false }
    void shell.openExternal(url)
    return { ok: true }
  })
  handle(IPC.quickAskSend, (request) => {
    const window = BrowserWindow.getAllWindows()[0]
    void quickAsk(request, bots.localProvider(), (event) => {
      if (window !== undefined && !window.isDestroyed()) sendEvent(window, IPC_EVENT.quickAskEvent, event)
    })
    return { ok: true }
  })
  handle(IPC.quickAskCancel, (thread) => {
    cancelQuickAsk(thread)
    return { ok: true }
  })
  handle(IPC.botsSaveThread, (request) => saveThread(request))
}

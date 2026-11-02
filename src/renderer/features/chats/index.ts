// The chats feature's public entry: the Chats panel on the right, the floating bot and Quick ask.

import './styles/chats.css'

export { ChatsPanel } from './components/ChatsPanel'
export { openChats, setChatsOpener, setChatsPanel, toggleChats, useChatsOpen, useShownChat } from './chats-store'
export { FloatingBot } from './components/FloatingBot'
export { QuickAsk } from './components/QuickAsk'

import { BrowserWindow, screen, session, shell, type Session } from 'electron'
import { IPC, type IpcApi, type PlayerItem } from '../shared/ipc'
import { resolveInVault } from './paths'
import { vaultResponse } from './vault-protocol'
import { currentVault } from './vault'

/**
 * The mini-player: a small window, always on top, that plays what a canvas
 * points at - a YouTube video or a video from the vault - so the canvas only
 * holds its preview. One window, reused: playing another thing replaces what
 * it plays. It is a plain sandboxed page with no bridge to Recto, in its own
 * storage that is gone when Recto quits; a link out of it goes to the browser.
 *
 * A YouTube video plays in YouTube's own embed with its controls off, under
 * Recto's few (play, time, sound, YouTube's logo, full screen) that fade a
 * second after the mouse stops - driven through the embed's published
 * messages, as YouTube's IFrame API does. A layer over the video takes the
 * mouse, so YouTube's title and buttons do not come back on hover; when it is
 * not playing, the video's thumbnail is in front (youTubePage). A Vimeo video
 * plays in Vimeo's embed as it is.
 */

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

const WIDTH = 480
/** YouTube's embed refuses to play without a referrer saying where it is embedded. */
const REFERRER = 'https://recto.app/'

let player: BrowserWindow | null = null

/** The player's storage, set up once: YouTube told where it is embedded, and only full screen allowed. */
let ready: Session | null = null
function playerSession(): Session {
  if (ready !== null) return ready
  const ses = session.fromPartition('recto-player')
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.youtube-nocookie.com/*', 'https://*.youtube.com/*', 'https://player.vimeo.com/*'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Referer: REFERRER } })
    },
  )
  // A video from the vault, loaded as the canvas loads it.
  ses.protocol.handle('recto-file', vaultResponse)
  ses.setPermissionRequestHandler((_c, permission, callback) => callback(permission === 'fullscreen'))
  ses.setPermissionCheckHandler((_c, permission) => permission === 'fullscreen')
  ready = ses
  return ses
}

/** Line icons for the controls (Lucide's, as the app's own), drawn white. */
const ICON = (paths: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
const ICONS = {
  play: ICON('<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>'),
  pause: ICON('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>'),
  again: ICON('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  sound: ICON('<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>'),
  muted: ICON('<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'),
  full: ICON('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  settings: ICON('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  small: ICON('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
}
/** YouTube's logo, as its brand guidelines draw it: the red play button and the name. */
const YOUTUBE_LOGO = `<svg viewBox="0 0 90 20" height="16" aria-hidden="true"><rect x="0" y="0" width="28" height="20" rx="5" fill="#FF0000"/><polygon points="11,5.5 19,10 11,14.5" fill="#fff"/><text x="31" y="15.5" fill="#fff" font-family="-apple-system,system-ui,sans-serif" font-size="15" font-weight="600" letter-spacing="-.4">YouTube</text></svg>`

/**
 * A YouTube video under Recto's own controls (see above), its title and
 * channel above them, both Recto's. The embed's own title and "More videos"
 * are drawn at the edges of its box, which reach past the window's (see the
 * style). Before it starts and at the end the video's thumbnail is in front, with
 * ▶. YouTube's logo in the bar opens the video on YouTube, in the browser,
 * where it is.
 */
const youTubePage = (id: string, title: string, by: string | undefined): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font:12px -apple-system,system-ui,sans-serif;color:#fff}
/* The embed's box taller than the window by a band above and below: the video, fitted to the width,
   fills the window exactly, and what YouTube draws at its box's edges - its title, "More videos" - is
   in the bands, out of sight. */
:root{--band:max(110px,32vh)}
iframe{position:absolute;left:0;width:100%;top:calc(-1 * var(--band));height:calc(100% + 2 * var(--band));border:0}
/* Subtitles on and playing quietly: the box back to the window's, as YouTube draws them at its bottom. */
body.open iframe{top:0;height:100%}
#poster{position:absolute;inset:0;background:#000 url("https://i.ytimg.com/vi/${id}/hqdefault.jpg") center/cover no-repeat;display:grid;place-items:center}
#poster.gone{display:none}
#big{all:unset;cursor:pointer;width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.55);display:grid;place-items:center;backdrop-filter:blur(6px)}
#big svg{width:28px;height:28px;margin-left:3px}
#big.again svg{margin-left:0}
#cover{position:absolute;inset:0;cursor:pointer}
#cover.idle{cursor:none}
#bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:22px 10px 8px;background:linear-gradient(transparent,rgba(0,0,0,.7));transition:opacity .3s}
#cover.idle #bar,#cover.idle #head{opacity:0}
#head{position:absolute;left:0;right:0;top:0;padding:10px 14px 26px;background:linear-gradient(rgba(0,0,0,.7),transparent);transition:opacity .3s;pointer-events:none}
#title{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.5)}
#by{margin-top:2px;font-size:12.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;opacity:.92}
button:hover{opacity:1;background:rgba(255,255,255,.12)}
#seek{flex:1;min-width:40px;accent-color:#fff;height:4px;cursor:pointer}
#time{font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.9}
#menu{position:absolute;right:10px;bottom:46px;min-width:200px;max-width:calc(100% - 20px);max-height:calc(100% - 60px);overflow-y:auto;padding:6px;border-radius:10px;background:rgba(24,24,24,.94);backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px;display:none;cursor:default}
#menu.on{display:block}
#menu .row{display:flex;align-items:center;gap:12px;padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}
#menu .row:hover{background:rgba(255,255,255,.1)}
#menu .row .value{margin-left:auto;opacity:.7;overflow:hidden;text-overflow:ellipsis}
#menu .row .tick{width:14px;flex:none}
#menu .head{font-weight:600;border-bottom:1px solid rgba(255,255,255,.12);border-radius:6px 6px 0 0;margin-bottom:4px}
#menu .none{padding:7px 10px;opacity:.6;white-space:normal}
#yt{display:flex;align-items:center;padding:0 4px;height:28px;border-radius:6px;opacity:.92}
#yt:hover{opacity:1;background:rgba(255,255,255,.12)}
</style>
<iframe id="video" allow="autoplay; fullscreen" src="https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&controls=0&autoplay=1&rel=0&iv_load_policy=3&playsinline=1&disablekb=1&fs=0"></iframe>
<div id="poster"><button id="big" aria-label="Play">${ICONS.play}</button></div>
<div id="cover">
  <div id="head"><div id="title"></div><div id="by"></div></div>
  <div id="bar">
    <button id="play" aria-label="Play or pause">${ICONS.pause}</button>
    <span id="time">0:00</span>
    <input id="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Where in the video">
    <button id="sound" aria-label="Mute or unmute">${ICONS.sound}</button>
    <button id="gear" aria-label="Settings">${ICONS.settings}</button>
    <a id="yt" href="https://www.youtube.com/watch?v=${id}" title="Watch on YouTube" aria-label="Watch on YouTube">${YOUTUBE_LOGO}</a>
    <button id="full" aria-label="Full screen">${ICONS.full}</button>
  </div>
  <div id="menu" role="menu"></div>
</div>
<script>
var I=${JSON.stringify(ICONS)};
document.getElementById('title').textContent=${JSON.stringify(title).replace(/</g, '\u003c')};
document.getElementById('by').textContent=${JSON.stringify(by ?? '').replace(/</g, '\u003c')};
var video=document.getElementById('video'),cover=document.getElementById('cover'),poster=document.getElementById('poster'),big=document.getElementById('big'),seek=document.getElementById('seek'),yt=document.getElementById('yt');
var s={time:0,length:0,state:-1,muted:false,rate:1,rates:[0.25,0.5,0.75,1,1.25,1.5,1.75,2]},played=false,dragging=false,idle;
// For about 4 s after it starts playing or jumps, YouTube shows its title and "More videos" at its
// edges (and its own sign in the middle): the bands hide them (see the style).
var QUIET=4500,quiet=0;
// Subtitles: YouTube's own, as its captions module lists them; null while it has not said.
var cc={tracks:null,translations:[],track:null,translate:null,size:0},loop=false,menu=document.getElementById('menu'),page=null;
function send(func,args){video.contentWindow.postMessage(JSON.stringify({event:'command',func:func,args:args||[],id:1,channel:'widget'}),'*')}
function clock(t){t=Math.max(0,Math.floor(t));var h=Math.floor(t/3600),m=Math.floor(t%3600/60),x=t%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')}
function draw(){
  var playing=s.state===1||(s.state===3&&played);
  document.getElementById('play').innerHTML=playing?I.pause:s.state===0?I.again:I.play;
  document.getElementById('sound').innerHTML=s.muted?I.muted:I.sound;
  document.getElementById('full').innerHTML=document.fullscreenElement?I.small:I.full;
  document.getElementById('time').textContent=clock(s.time)+(s.length?' / '+clock(s.length):'');
  if(!dragging){seek.max=String(s.length||1);seek.value=String(s.time)}
  // The thumbnail before it has started and at the end, when the embed shows its title and suggestions all over.
  poster.classList.toggle('gone',played&&s.state!==0);
  big.innerHTML=s.state===0?I.again:I.play;big.classList.toggle('again',s.state===0);
  document.body.classList.toggle('open',playing&&cc.track!==null&&Date.now()>=quiet);
  yt.href='https://www.youtube.com/watch?v=${id}'+(s.time>=1?'&t='+Math.floor(s.time)+'s':'');
  if(!playing)cover.classList.remove('idle');
}
// YouTube about to draw at its edges: the bands back, for a few seconds.
function stir(){quiet=Date.now()+QUIET;draw();setTimeout(draw,QUIET+50)}
// Told when its options change (the captions' track list); the list read once, then subtitles off as they start.
var asked=false;
function ready(){
  if(asked)return;asked=true;
  ['onApiChange','onPlaybackRateChange'].forEach(function(e){send('addEventListener',[e])});
  send('loadModule',['captions']);
  setTimeout(listed,6000);
}
// The list in (or not coming): subtitles off again unless one was picked meanwhile.
var off=false;
function listed(){if(off)return;off=true;if(cc.track===null)send('unloadModule',['captions']);if(cc.tracks===null)cc.tracks=[]}
function setTrack(track,translate){
  cc.track=track;cc.translate=translate||null;stir();
  if(track===null){send('unloadModule',['captions']);return}
  send('loadModule',['captions']);
  var t={languageCode:track.languageCode};if(cc.translate)t.translationLanguage={languageCode:cc.translate.languageCode};
  send('setOption',['captions','track',t]);
  send('setOption',['captions','fontSize',cc.size]);
}
var SIZES=[[-1,'Small'],[0,'Normal'],[1,'Large'],[2,'Larger'],[3,'Largest']];
function rateName(r){return r===1?'Normal':r+'×'}
function ccName(){return cc.track===null?'Off':cc.track.displayName+(cc.translate?' → '+cc.translate.languageName:'')}
function row(label,value,run,ticked){
  var d=document.createElement('div');d.className='row';d.setAttribute('role','menuitem');
  if(ticked!==undefined){var t=document.createElement('span');t.className='tick';t.textContent=ticked?'✓':'';d.append(t)}
  var l=document.createElement('span');l.textContent=label;d.append(l);
  if(value){var v=document.createElement('span');v.className='value';v.textContent=value;d.append(v)}
  d.onclick=function(e){e.stopPropagation();run()};menu.append(d);return d;
}
function show(which){
  page=which;menu.textContent='';menu.classList.toggle('on',which!==null);
  if(which===null)return;
  var back=function(){show('main')};
  if(which==='main'){
    row('Speed',rateName(s.rate),function(){show('speed')});
    row('Subtitles',ccName(),function(){show('cc')});
    if(cc.track!==null)row('Subtitle size',SIZES.filter(function(z){return z[0]===cc.size})[0][1],function(){show('size')});
    row('Loop',loop?'On':'Off',function(){loop=!loop;show('main')});
  }else if(which==='speed'){
    row('‹ Speed','',back).classList.add('head');
    s.rates.forEach(function(r){row(rateName(r),'',function(){send('setPlaybackRate',[r]);s.rate=r;show('main')},r===s.rate)});
  }else if(which==='cc'){
    row('‹ Subtitles','',back).classList.add('head');
    row('Off','',function(){setTrack(null);show('main')},cc.track===null);
    if(cc.tracks===null){var n=document.createElement('div');n.className='none';n.textContent='Asking YouTube…';menu.append(n);setTimeout(function(){if(page==='cc')show('cc')},700)}
    else if(cc.tracks.length===0){var n2=document.createElement('div');n2.className='none';n2.textContent='This video has no subtitles.';menu.append(n2)}
    else{
      cc.tracks.forEach(function(t){row(t.displayName,'',function(){setTrack(t);show('main')},cc.track!==null&&cc.track.languageCode===t.languageCode&&!cc.translate)});
      if(cc.translations.length)row('Auto-translate',cc.translate?cc.translate.languageName:'',function(){show('translate')});
    }
  }else if(which==='translate'){
    row('‹ Auto-translate','',function(){show('cc')}).classList.add('head');
    var from=cc.track||(cc.tracks&&cc.tracks[0]);
    cc.translations.forEach(function(l){row(l.languageName,'',function(){setTrack(from,l);show('main')},cc.translate!==null&&cc.translate.languageCode===l.languageCode)});
  }else if(which==='size'){
    row('‹ Subtitle size','',back).classList.add('head');
    SIZES.forEach(function(z){row(z[1],'',function(){cc.size=z[0];send('setOption',['captions','fontSize',z[0]]);show('main')},z[0]===cc.size)});
  }
}
function wake(){cover.classList.remove('idle');clearTimeout(idle);idle=setTimeout(function(){if(s.state===1&&page===null)cover.classList.add('idle')},1000)}
function toggle(){if(s.state===1||s.state===3){quiet=Infinity;draw();send('pauseVideo')}else{if(s.state===0)send('seekTo',[0,true]);send('playVideo')}}
function jump(by){stir();send('seekTo',[Math.max(0,Math.min(s.length||0,s.time+by)),true])}
function full(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen()}
window.addEventListener('message',function(e){
  if(e.source!==video.contentWindow)return;
  var m;try{m=JSON.parse(e.data)}catch(x){return}
  var i=m.info||{};
  if('currentTime' in i)s.time=i.currentTime;
  if('duration' in i)s.length=i.duration;
  if('playerState' in i){
    var was=s.state===1||(s.state===3&&played);
    // Paused or ended by YouTube itself: the bands back at once.
    if(i.playerState!==1&&i.playerState!==3)quiet=Infinity;
    s.state=i.playerState;if(s.state===1)played=true;
    // Into playing from not (buffering first, as often as not).
    if((s.state===1||(s.state===3&&played))&&!was)stir();
    // Looped: from the start again.
    if(s.state===0&&loop){stir();send('seekTo',[0,true]);send('playVideo')}
  }
  if('playbackRate' in i)s.rate=i.playbackRate;
  if(Array.isArray(i.availablePlaybackRates)&&i.availablePlaybackRates.length)s.rates=i.availablePlaybackRates;
  if(m.event==='apiInfoDelivery'&&i.captions){
    var c=i.captions;
    if(Array.isArray(c.tracklist))cc.tracks=c.tracklist;
    if(Array.isArray(c.translationLanguages))cc.translations=c.translationLanguages;
    listed();
  }
  if(m.event==='onReady')ready();
  if('muted' in i)s.muted=i.muted;
  draw();
});
// The embed starts telling its state once asked.
video.addEventListener('load',function(){var n=0,t=setInterval(function(){video.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*');if(++n>=20)clearInterval(t)},250)});
cover.addEventListener('mousemove',wake);
cover.addEventListener('click',function(e){if(menu.contains(e.target))return;if(page!==null){show(null);return}if(!document.getElementById('bar').contains(e.target))toggle();wake()});
document.getElementById('gear').onclick=function(e){e.stopPropagation();show(page===null?'main':null)};
menu.addEventListener('mousemove',function(){clearTimeout(idle)});
cover.addEventListener('dblclick',function(e){if(!document.getElementById('bar').contains(e.target))full()});
big.onclick=function(e){e.stopPropagation();toggle()};
document.getElementById('play').onclick=toggle;
document.getElementById('sound').onclick=function(){send(s.muted?'unMute':'mute');s.muted=!s.muted;draw()};
document.getElementById('full').onclick=full;
document.addEventListener('fullscreenchange',draw);
// Out to YouTube: the video goes on there, so it stops here.
yt.addEventListener('click',function(){send('pauseVideo')});
seek.addEventListener('input',function(){dragging=true;document.getElementById('time').textContent=clock(+seek.value)+' / '+clock(s.length)});
seek.addEventListener('change',function(){dragging=false;stir();send('seekTo',[+seek.value,true])});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&page!==null){show(null);return}
  if(e.key===' '||e.key==='k'){e.preventDefault();toggle()}
  else if(e.key==='ArrowLeft')jump(-5);else if(e.key==='ArrowRight')jump(5);
  else if(e.key==='m'){send(s.muted?'unMute':'mute');s.muted=!s.muted;draw()}
  else if(e.key==='f')full();
  wake();
});
draw();wake();
</script>`)}`

/** Where a video from the vault is served from: the vault protocol, as the canvas loads it. */
const fileUrl = (relative: string): string => `recto-file://vault/${relative.split('/').map(encodeURIComponent).join('/')}`

/** A page with only the video in it. */
const videoPage = (src: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain;display:block}</style><video src="${src}" controls autoplay></video>`,
  )}`

function open(): BrowserWindow {
  if (player !== null && !player.isDestroyed()) return player
  const area = screen.getPrimaryDisplay().workArea
  const height = Math.round((WIDTH * 9) / 16)
  const win = new BrowserWindow({
    width: WIDTH,
    height,
    // Bottom right, out of the way, as a picture-in-picture player sits.
    x: area.x + area.width - WIDTH - 24,
    y: area.y + area.height - height - 24,
    minWidth: 240,
    minHeight: 135,
    alwaysOnTop: true,
    fullscreenable: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: playerSession() },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Nothing opens in-app from the player: out to the browser, or nowhere.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  win.on('closed', () => {
    player = null
  })
  player = win
  return win
}

export function play(item: PlayerItem): { ok: true } | { ok: false; error: string } {
  if (item.kind === 'file') {
    const vault = currentVault()
    if (vault === null) return { ok: false, error: 'No vault is open.' }
    try {
      resolveInVault(vault.path, item.path)
    } catch {
      return { ok: false, error: 'That file is not in the vault.' }
    }
  } else if (item.kind === 'youtube' && !/^[\w-]{11}$/.test(item.id)) return { ok: false, error: 'That is not a YouTube video.' }
  else if (item.kind === 'vimeo' && !/^\d{6,12}$/.test(item.id)) return { ok: false, error: 'That is not a Vimeo video.' }

  const win = open()
  win.setTitle(item.title)
  const ratio = item.ratio !== undefined && item.ratio > 0 ? item.ratio : 16 / 9
  win.setAspectRatio(ratio)
  const [width] = win.getSize()
  win.setSize(width ?? WIDTH, Math.round((width ?? WIDTH) / ratio))
  const load =
    item.kind === 'youtube'
      ? win.loadURL(youTubePage(item.id, item.title, item.by))
      : item.kind === 'vimeo'
        ? win.loadURL(`https://player.vimeo.com/video/${item.id}?autoplay=1&dnt=1`, { httpReferrer: REFERRER })
        : win.loadURL(videoPage(fileUrl(item.path)))
  void load.catch(() => {})
  win.show()
  return { ok: true }
}

export function registerPlayer(handle: Handle): void {
  handle(IPC.playerOpen, (item) => play(item))
}

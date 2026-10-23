/* GitHub Pages 側通知設定・同期。許可後のみ端末からCloudflareへ送信します。 */
(() => {
  'use strict';
  const API = String(window.DAILY_BOARD_PUSH_API || '').replace(/\/$/, '');
  const READY = /^https:\/\/[^\s/]+\.workers\.dev$/.test(API) && !API.includes('YOUR-');
  const KEY_ENABLED = 'daily-board-push-enabled-v1';
  const KEY_TOKEN = 'daily-board-push-token-v1';
  const GAME_KEY = 'daily-board-games-v1';
  let timer = null, busy = false;
  const $ = id => document.getElementById(id);
  const enabled = () => localStorage.getItem(KEY_ENABLED) === '1';
  const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const token = () => {
    let t = localStorage.getItem(KEY_TOKEN);
    if (!t || !/^[a-f0-9]{64}$/i.test(t)) {
      const random = crypto.getRandomValues(new Uint8Array(32));
      t = Array.from(random,x=>x.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(KEY_TOKEN,t);
    }
    return t;
  };
  function base64Bytes(base64url) {
    const value = base64url.replace(/-/g,'+').replace(/_/g,'/');
    const raw = atob(value.padEnd(Math.ceil(value.length/4)*4,'='));
    return Uint8Array.from(raw, c=>c.charCodeAt(0));
  }
  function gamesSnapshot() {
    const source = JSON.parse(localStorage.getItem(GAME_KEY) || '{"games":[]}');
    return (Array.isArray(source.games)?source.games:[]).map(g=>({
      id: String(g.id || '').slice(0,150), name: String(g.name||'ゲーム').slice(0,70),
      resetTime: g.resetTime || '05:00', reminderTime: g.reminderTime || '',
      weeklyDay: Number(g.weeklyDay ?? 1),
      tasks: (Array.isArray(g.tasks)?g.tasks:[]).map(t=>({
        title: String(t.title||'日課').slice(0,130), repeat:t.repeat||'daily',
        doneKeys: (Array.isArray(t.doneKeys)?t.doneKeys:[])
          .filter(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)).slice(-70),
      })),
    }));
  }
  async function req(path,method='GET',data=null) {
    if (!READY) throw Error('先に push-config.js の Worker URL を設定してください');
    const res = await fetch(API+path, {
      method, headers: { 'Content-Type':'application/json', 'X-Device-Token':token() },
      ...(data ? {body:JSON.stringify(data)} : {}),
      cache: 'no-store',
    });
    let result;
    try {result=await res.json();} catch {throw Error('通知サーバーの応答を読み取れませんでした');}
    if (!res.ok) throw Error(result.error || `通知サーバーのエラー (${res.status})`);
    return result;
  }
  function status(message,problem=false) {
    const node = $('pushStatus');
    if (node) { node.textContent=message;node.style.color=problem?'#ffbdbd':'#a1f0d5'; }
  }
  function renderButtons() {
    const toggle = $('pushToggleButton'), test = $('pushTestButton');
    if (toggle) {
      toggle.textContent=enabled()?'🔕 通知を停止':'🔔 通知を有効にする';
      toggle.disabled=busy || !READY || !supportsPush();
    }
    if (test) { test.hidden=!enabled();test.disabled=busy; }
    if (!READY) status('CloudflareのWorker URLを設定すると使えます。',true);
    else if (!supportsPush()) status('iPhoneではSafariからホーム画面に追加したアプリで操作してください。',true);
    else if (Notification.permission==='denied') status('iPhoneの設定からデイリーボードの通知を許可してください。',true);
    else status(enabled()?'通知は有効です。未完了の日課をサーバーと同期します。':'通知は無効です。');
  }
  async function currentSubscription() {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  }
  async function syncNow() {
    if (!enabled() || !READY || !supportsPush() || !navigator.onLine) return;
    const subscription = await currentSubscription();
    if (!subscription) { localStorage.removeItem(KEY_ENABLED);renderButtons();return; }
    await req('/api/sync','POST',{
      subscription: subscription.toJSON(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
      games: gamesSnapshot(),
    });
  }
  function scheduleSync() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(e=>console.warn('通知同期に失敗',e)),600);
  }
  async function enable() {
    if (!READY) return status('Cloudflareの設定が完了していません。',true);
    if (!supportsPush()) return status('ホーム画面のPWAで通知を有効にしてください。',true);
    // iPhoneの要求: ユーザー操作の中で、awaitより前に許可ダイアログを呼ぶ。
    const permissionPromise = Notification.permission === 'default'
      ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    busy = true; renderButtons();
    try {
      const permission = await permissionPromise;
      if (permission !== 'granted') throw Error('通知が許可されていません。iPhoneの設定を確認してください。');
      const {vapidPublicKey} = await req('/api/config');
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) subscription = await reg.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:base64Bytes(vapidPublicKey),
      });
      await req('/api/sync','POST',{
        subscription:subscription.toJSON(),
        timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Tokyo',
        games:gamesSnapshot(),
      });
      localStorage.setItem(KEY_ENABLED,'1');
      status('✅ 通知を有効にしました。テスト通知で確認できます。');
    } catch(e) { status('通知の設定に失敗：'+e.message,true); }
    finally {busy=false;renderButtons();}
  }
  async function disable() {
    busy=true;renderButtons();
    try {
      // サーバー側を先に削除。ここで失敗したら端末の購読を保持し、再操作可能にする。
      await req('/api/disable','POST');
      const sub = await currentSubscription();
      if (sub) await sub.unsubscribe();
      localStorage.removeItem(KEY_ENABLED);
      status('🔕 未完了通知を停止しました。');
    } catch(e) { status('通知を停止できませんでした：'+e.message,true); }
    finally {busy=false;renderButtons();}
  }
  async function test() {
    busy=true;renderButtons();
    try {await req('/api/test','POST');status('テスト通知を送信しました。iPhone側で確認してください。');}
    catch(e) {status('テスト送信に失敗：'+e.message,true);}
    finally {busy=false;renderButtons();}
  }
  document.addEventListener('click',ev=>{
    if (ev.target.closest('#pushToggleButton')) {enabled()?disable():enable();return;}
    if (ev.target.closest('#pushTestButton')) {test();return;}
    if (ev.target.closest('#settingsButton,#backupFooter')) queueMicrotask(renderButtons);
  });
  window.addEventListener('daily-board:changed',scheduleSync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync();});
  window.addEventListener('focus',scheduleSync);
  window.addEventListener('online',scheduleSync);
  setInterval(scheduleSync,10*60*1000);
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',scheduleSync);
  else scheduleSync();
})();

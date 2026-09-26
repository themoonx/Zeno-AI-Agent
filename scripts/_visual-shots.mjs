


import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3322';
const OUT = path.join(process.cwd(), 'scripts', '_shots');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chromium browser found'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const PORT = 9600 + Math.floor(Math.random() * 200);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-vis-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,960', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {  }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 30000);
    });
  }
}

async function main() {
  const browser = new CDP(await connect(await debuggerUrl()));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => browser.send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');

  const evaluate = async (expression) => {
    const res = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'eval failed');
    return res.result.value;
  };
  const shot = async (name) => {
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log('shot', name);
  };
  const goto = async (url) => {
    await S('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const ready = await evaluate('document.readyState === "complete" && (!!document.querySelector(".auth-card") || !!document.querySelector(".sidebar"))').catch(() => false);
      if (ready) break;
    }
    await sleep(1000);
  };
  const login = async () => {
    const email = `vis_${Date.now()}@test.dev`;
    await evaluate(`(() => {
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      document.querySelector('.auth-switch button').click();
      set('#auth-email', ${JSON.stringify(email)});
      set('#auth-name', 'Visual Pass');
      set('#auth-password', 'testpass123');
      return true;
    })()`);
    await sleep(300);
    await evaluate('document.querySelector(".auth-card form button[type=submit]").click()');
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (await evaluate('!!document.querySelector(".sidebar")').catch(() => false)) break;
    }
    await sleep(800);
  };

  
  await goto(BASE);
  await sleep(600);
  await shot('20-auth-dark');

  await login();

  
  await goto(`${BASE}/#/chat`);
  await sleep(600);
  await shot('21-chat-hero');

  
  await evaluate('document.querySelector(".sidebar-link .kbd") && [...document.querySelectorAll(".sidebar-link")].find(b => b.textContent.includes("Search"))?.click()');
  await sleep(500);
  await shot('22-palette');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(300);

  
  for (const [route, name] of [['projects', '23-projects'], ['memory', '24-memory'], ['files', '25-files']]) {
    await goto(`${BASE}/#/${route}`);
    await sleep(700);
    await shot(name);
  }

  
  await goto(`${BASE}/#/chat`);
  await sleep(500);
  await evaluate("document.documentElement.dataset.theme = 'light'");
  await sleep(500);
  await shot('26-chat-hero-light');
  await goto(`${BASE}/#/settings`);
  await sleep(800);
  await shot('27-settings-light');
  await evaluate("document.documentElement.dataset.theme = 'dark'");

  
  await goto(`${BASE}/#/chat`);
  await sleep(600);
  await evaluate('document.querySelector(".composer-bar .perm-chip")?.click()');
  await sleep(500);
  await shot('28-perm-menu');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto(`${BASE}/#/chat`);
  await sleep(700);
  await shot('29-mobile-chat');
  await S('Emulation.clearDeviceMetricsOverride');

  chrome.kill();
  process.exit(0);
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return ws;
}

main().catch((err) => { console.error('visual shots crashed:', err); chrome.kill(); process.exit(1); });

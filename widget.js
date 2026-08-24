/* AIB Support Widget — embeddable AI chat (c) AInfluencer Blueprint */
(function () {
  'use strict';

  var CFG = window.__AIB_WIDGET_CONFIG__;
  if (!CFG || !CFG.clientId) return;
  if (document.getElementById('aib-widget-host')) return;

  var ENDPOINT = CFG.endpoint;
  var STORE_KEY = 'aib_chat_' + CFG.clientId;

  /* ---------- state ---------- */
  var messages = [];
  try {
    var saved = sessionStorage.getItem(STORE_KEY);
    if (saved) messages = JSON.parse(saved);
  } catch (e) { messages = []; }
  var busy = false;
  var open = false;

  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40))); } catch (e) {}
  }

  /* ---------- host + shadow DOM ---------- */
  var host = document.createElement('div');
  host.id = 'aib-widget-host';
  host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483000;';
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var accent = CFG.accent || '#F97316';
  var accent2 = CFG.accentDark || accent;

  var style = document.createElement('style');
  style.textContent =
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif}' +
    '.launcher{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;' +
      'background:linear-gradient(135deg,' + accent + ',' + accent2 + ');box-shadow:0 6px 24px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;justify-content:center;transition:transform .15s ease}' +
    '.launcher:hover{transform:scale(1.07)}' +
    '.launcher svg{width:28px;height:28px;fill:#fff}' +
    '.badge{position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid #fff}' +
    '.panel{position:fixed;bottom:92px;right:20px;width:372px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 120px);' +
      'background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.open{display:flex}' +
    '@media (max-width:480px){.panel{bottom:0;right:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}}' +
    '.head{background:linear-gradient(135deg,' + accent + ',' + accent2 + ');color:#fff;padding:16px;display:flex;align-items:center;gap:12px}' +
    '.head .av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto}' +
    '.head .t{font-size:15px;font-weight:700;line-height:1.2}' +
    '.head .s{font-size:12px;opacity:.9;margin-top:2px}' +
    '.head .x{margin-left:auto;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;padding:4px 8px;line-height:1}' +
    '.body{flex:1;overflow-y:auto;padding:14px;background:#F8FAFC;display:flex;flex-direction:column;gap:8px}' +
    '.msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.msg.bot{background:#fff;color:#1F2937;border:1px solid #E5E7EB;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.msg.user{background:' + accent + ';color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
    '.msg a{color:' + accent + ';font-weight:600}' +
    '.msg.user a{color:#fff;text-decoration:underline}' +
    '.quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px;background:#F8FAFC}' +
    '.quick button{border:1px solid ' + accent + ';color:' + accent + ';background:#fff;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}' +
    '.quick button:hover{background:' + accent + ';color:#fff}' +
    '.human{padding:0 14px 8px;background:#F8FAFC}' +
    '.human button{border:none;background:none;color:#64748B;font-size:12.5px;cursor:pointer;text-decoration:underline;padding:2px}' +
    '.human button:hover{color:' + accent + '}' +
    '.hform{background:#fff;border:1px solid #E5E7EB;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;' +
      'padding:12px;max-width:92%;display:flex;flex-direction:column;gap:8px;width:100%}' +
    '.hform .ht{font-size:13.5px;color:#1F2937;line-height:1.4}' +
    '.hform input,.hform textarea{width:100%;border:1px solid #D1D5DB;border-radius:8px;padding:8px 10px;font-size:13.5px;font-family:inherit;resize:none}' +
    '.hform input:focus,.hform textarea:focus{outline:none;border-color:' + accent + '}' +
    '.hform .hb{background:' + accent + ';color:#fff;border:none;border-radius:8px;padding:9px 0;font-size:13.5px;font-weight:700;cursor:pointer}' +
    '.hform .hb:disabled{opacity:.5}' +
    '.hform .herr{color:#DC2626;font-size:12px;min-height:0}' +
    '.typing{display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.typing span{width:7px;height:7px;border-radius:50%;background:#9CA3AF;animation:aibB 1.2s infinite}' +
    '.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes aibB{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}' +
    '.foot{display:flex;gap:8px;padding:12px;border-top:1px solid #E5E7EB;background:#fff}' +
    '.foot textarea{flex:1;resize:none;border:1px solid #D1D5DB;border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.4;max-height:96px;outline:none}' +
    '.foot textarea:focus{border-color:' + accent + '}' +
    '.foot button{width:42px;height:42px;border:none;border-radius:10px;background:' + accent + ';cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;align-self:flex-end}' +
    '.foot button:disabled{opacity:.5;cursor:default}' +
    '.foot button svg{width:20px;height:20px;fill:#fff}' +
    '.pow{text-align:center;font-size:10px;color:#9CA3AF;padding:0 0 8px;background:#fff}';
  root.appendChild(style);

  /* ---------- launcher ---------- */
  var launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', CFG.title || 'Chat');
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5.1 3.7 6.7-.1 1-.6 2.5-1.6 3.6 0 0 2.9-.4 4.9-1.7 1 .3 2 .4 3 .4 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>' +
    '<span class="badge" id="aib-badge"></span>';
  root.appendChild(launcher);

  /* ---------- panel ---------- */
  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="head">' +
      '<div class="av">' + (CFG.avatar || '🦷') + '</div>' +
      '<div><div class="t">' + esc(CFG.title || 'Chat') + '</div>' +
      '<div class="s">' + esc(CFG.subtitle || '') + '</div></div>' +
      '<button class="x" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="body" id="aib-body"></div>' +
    '<div class="quick" id="aib-quick"></div>' +
    '<div class="human"><button id="aib-human">' + esc(CFG.humanLabel || 'Talk to a human') + '</button></div>' +
    '<div class="foot">' +
      '<textarea id="aib-in" rows="1" placeholder="' + esc(CFG.placeholder || 'Write a message…') + '"></textarea>' +
      '<button id="aib-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></button>' +
    '</div>' +
    '<div class="pow">' + esc(CFG.powered || 'AI assistant') + '</div>';
  root.appendChild(panel);

  var body = panel.querySelector('#aib-body');
  var quick = panel.querySelector('#aib-quick');
  var input = panel.querySelector('#aib-in');
  var sendBtn = panel.querySelector('#aib-send');
  var badge = launcher.querySelector('#aib-badge');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* linkify plain URLs and tel numbers in bot messages */
  function fmt(s) {
    var out = esc(s);
    out = out.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return out;
  }

  function addBubble(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    d.innerHTML = role === 'user' ? esc(text) : fmt(text);
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  function renderAll() {
    body.innerHTML = '';
    hformEl = null;
    if (!messages.length && CFG.greeting) addBubble('assistant', CFG.greeting);
    for (var i = 0; i < messages.length; i++) addBubble(messages[i].role, messages[i].content);
    renderQuick();
  }

  function renderQuick() {
    quick.innerHTML = '';
    if (messages.length || !CFG.quickReplies) return;
    CFG.quickReplies.forEach(function (q) {
      var b = document.createElement('button');
      b.textContent = q;
      b.onclick = function () { send(q); };
      quick.appendChild(b);
    });
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(typingEl);
    body.scrollTop = body.scrollHeight;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function send(text) {
    text = (text || input.value).trim();
    if (!text || busy) return;
    input.value = '';
    autoGrow();
    busy = true;
    sendBtn.disabled = true;
    messages.push({ role: 'user', content: text });
    persist();
    addBubble('user', text);
    renderQuick();
    showTyping();

    var payload = {
      client: CFG.clientId,
      session: sessionId(),
      page: location.href,
      messages: messages.slice(-16)
    };

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hideTyping();
        var reply = (data && data.reply) || CFG.errorMessage || 'Sorry, something went wrong.';
        messages.push({ role: 'assistant', content: reply });
        persist();
        addBubble('assistant', reply);
      })
      .catch(function () {
        hideTyping();
        addBubble('assistant', CFG.errorMessage || 'Sorry, something went wrong.');
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  function sessionId() {
    try {
      var k = 'aib_sid_' + CFG.clientId;
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 's_anonymous'; }
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  }

  /* ---------- human handoff ---------- */
  var hformEl = null;
  function openHumanForm() {
    if (hformEl) { hformEl.scrollIntoView(); return; }
    hformEl = document.createElement('div');
    hformEl.className = 'hform';
    hformEl.innerHTML =
      '<div class="ht">' + esc(CFG.humanIntro || 'Leave your contact info. A real person will get back to you.') + '</div>' +
      '<input id="aib-hname" placeholder="' + esc(CFG.humanNamePh || 'Your name') + '">' +
      '<input id="aib-hcontact" placeholder="' + esc(CFG.humanContactPh || 'Phone or email (required)') + '">' +
      '<textarea id="aib-hmsg" rows="2" placeholder="' + esc(CFG.humanMsgPh || 'How can we help?') + '"></textarea>' +
      '<div class="herr" id="aib-herr"></div>' +
      '<button class="hb" id="aib-hsend">' + esc(CFG.humanSend || 'Request a call back') + '</button>';
    body.appendChild(hformEl);
    body.scrollTop = body.scrollHeight;
    hformEl.querySelector('#aib-hsend').onclick = sendHandoff;
  }

  function sendHandoff() {
    var nameV = hformEl.querySelector('#aib-hname').value.trim();
    var contactV = hformEl.querySelector('#aib-hcontact').value.trim();
    var msgV = hformEl.querySelector('#aib-hmsg').value.trim();
    var errEl = hformEl.querySelector('#aib-herr');
    if (!contactV) { errEl.textContent = CFG.humanContactPh || 'Phone or email is required.'; return; }
    var btn = hformEl.querySelector('#aib-hsend');
    btn.disabled = true;
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'handoff',
        client: CFG.clientId,
        session: sessionId(),
        page: location.href,
        name: nameV,
        contact: contactV,
        message: msgV
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var reply = (data && data.reply) || CFG.humanThanks || 'Thank you! We will contact you soon.';
        hformEl.remove(); hformEl = null;
        messages.push({ role: 'assistant', content: reply });
        persist();
        addBubble('assistant', reply);
      })
      .catch(function () {
        btn.disabled = false;
        errEl.textContent = CFG.errorMessage || 'Something went wrong. Please try again.';
      });
  }

  /* ---------- events ---------- */
  panel.querySelector('#aib-human').onclick = openHumanForm;
  launcher.onclick = function () {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) {
      badge.style.display = 'none';
      renderAll();
      setTimeout(function () { input.focus(); }, 50);
    }
  };
  panel.querySelector('.x').onclick = function () {
    open = false;
    panel.classList.remove('open');
  };
  sendBtn.onclick = function () { send(); };
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', autoGrow);
})();

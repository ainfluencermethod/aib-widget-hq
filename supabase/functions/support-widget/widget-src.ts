export const WIDGET_JS = `/* AIB Support Widget — embeddable AI chat (c) AInfluencer Blueprint */
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

  /* live takeover state: a human agent replaces the AI for this session */
  var liveMode = false;
  var liveAgent = '';
  var lastMsgId = 0;
  var pollTimer = null;
  try { lastMsgId = parseInt(sessionStorage.getItem('aib_last_' + CFG.clientId) || '0', 10) || 0; } catch (e) {}

  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40))); } catch (e) {}
  }
  function persistLast() {
    try { sessionStorage.setItem('aib_last_' + CFG.clientId, String(lastMsgId)); } catch (e) {}
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
    '.launcher img{width:48px;height:48px;object-fit:contain;pointer-events:none}' +
    '.badge{position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid #fff}' +
    '.panel{position:fixed;bottom:92px;right:20px;width:372px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 120px);' +
      'background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.open{display:flex}' +
    '@media (max-width:480px){.panel{bottom:0;right:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}}' +
    '.head{background:linear-gradient(135deg,' + accent + ',' + accent2 + ');color:#fff;padding:16px;display:flex;align-items:center;gap:12px}' +
    '.head .av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto;overflow:hidden}' +
    '.head .av.pic{background:#FAF8F3}' +
    '.head .av img{width:32px;height:32px;object-fit:contain}' +
    '.head .t{font-size:15px;font-weight:700;line-height:1.2;display:flex;align-items:center;gap:5px}' +
    '.head .t svg{width:16px;height:16px;flex:0 0 auto}' +
    '.head .s{font-size:12px;opacity:.9;margin-top:2px;display:flex;align-items:center}' +
    '.ldot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ADE80;margin-right:6px;animation:aibP 1.6s infinite}' +
    '@keyframes aibP{0%,100%{opacity:1}50%{opacity:.35}}' +
    '.head .n{margin-left:auto;background:none;border:none;color:#fff;cursor:pointer;padding:4px 6px;display:flex;align-items:center;opacity:.85}' +
    '.head .n:hover{opacity:1}' +
    '.head .n svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round}' +
    '.head .x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;padding:4px 8px;line-height:1}' +
    '.body{flex:1;overflow-y:auto;padding:14px;background:#F8FAFC;display:flex;flex-direction:column;gap:8px}' +
    '.msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.msg.bot{background:#fff;color:#1F2937;border:1px solid #E5E7EB;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.who{display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px}' +
    '.who svg{width:14px;height:14px;flex:0 0 auto}' +
    '.msg.user{background:' + accent + ';color:#fff;border-bottom-right-radius:4px;align-self:flex-end}' +
    '.msg a{color:' + accent + ';font-weight:600}' +
    '.msg.user a{color:#fff;text-decoration:underline}' +
    '.quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px;background:#F8FAFC}' +
    '.quick button{border:1px solid ' + accent + ';color:' + accent + ';background:#fff;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer}' +
    '.quick button:hover{background:' + accent + ';color:#fff}' +
    '.human{display:flex;gap:16px;padding:0 14px 8px;background:#F8FAFC}' +
    '.hl{display:flex;flex-direction:column}' +
    '.hitem{display:block;width:100%;text-align:left;border:1px solid #E5E7EB;background:#F8FAFC;border-radius:8px;' +
      'padding:8px 10px;font-size:13px;color:#1F2937;cursor:pointer;margin-top:6px;line-height:1.4}' +
    '.hitem:hover{border-color:' + accent + '}' +
    '.hitem b{color:' + accent + '}' +
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
    '.fb{display:flex;gap:8px;margin-top:6px}' +
    '.fb button{border:none;background:none;cursor:pointer;font-size:13px;opacity:.4;padding:0;line-height:1}' +
    '.fb button:hover{opacity:1}' +
    '.fb button.sel{opacity:1;transform:scale(1.15)}' +
    '.fb button:disabled{cursor:default}' +
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
    (CFG.launcherUrl
      ? '<img src="' + esc(CFG.launcherUrl) + '" alt="">'
      : '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5.1 3.7 6.7-.1 1-.6 2.5-1.6 3.6 0 0 2.9-.4 4.9-1.7 1 .3 2 .4 3 .4 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>') +
    '<span class="badge" id="aib-badge"></span>';
  root.appendChild(launcher);

  /* ---------- panel ---------- */
  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="head">' +
      (CFG.avatarUrl
        ? '<div class="av pic"><img src="' + esc(CFG.avatarUrl) + '" alt=""></div>'
        : '<div class="av">' + (CFG.avatar || '🦷') + '</div>') +
      '<div><div class="t">' + esc(CFG.title || 'Chat') + '</div>' +
      '<div class="s">' + esc(CFG.subtitle || '') + '</div></div>' +
      '<button class="n" id="aib-new" title="' + esc(CFG.newChatLabel || 'New chat') + '" aria-label="' + esc(CFG.newChatLabel || 'New chat') + '">' +
        '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>' +
      '<button class="x" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="body" id="aib-body"></div>' +
    '<div class="quick" id="aib-quick"></div>' +
    '<div class="human"><button id="aib-human">' + esc(CFG.humanLabel || 'Talk to a human') + '</button>' +
    '<button id="aib-hist">' + esc(CFG.historyLabel || '🕘 Previous chats') + '</button></div>' +
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
  var titleEl = panel.querySelector('.head .t');
  var subEl = panel.querySelector('.head .s');
  var humanRow = panel.querySelector('.human');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* light markdown for bot messages: **bold**, "- " bullets, links */
  function fmt(s) {
    var out = esc(s);
    out = out.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
    out = out.replace(/^- /gm, '• ');
    out = out.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return out;
  }

  /* blue verified seal (staff badge) */
  var VERIFIED_SVG = '<svg viewBox="0 0 24 24" aria-label="verified"><path fill="#1D9BF0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/><path fill="#fff" d="M10.54 16.2 6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>';

  function staffDisplay() {
    return CFG.staffName || liveAgent || 'Staff';
  }

  function addBubble(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    if (role === 'agent') {
      d.innerHTML = '<div class="who">' + esc(staffDisplay()) + VERIFIED_SVG + '</div>' + fmt(text);
    } else {
      d.innerHTML = role === 'user' ? esc(text) : fmt(text);
    }
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  function renderAll() {
    body.innerHTML = '';
    hformEl = null;
    histEl = null;
    if (!messages.length && CFG.greeting) addBubble('assistant', CFG.greeting);
    for (var i = 0; i < messages.length; i++) addBubble(messages[i].role, messages[i].content);
    renderQuick();
  }

  function renderQuick() {
    quick.innerHTML = '';
    if (liveMode || messages.length || !CFG.quickReplies) return;
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
    if (!liveMode) showTyping();

    var payload = {
      client: CFG.clientId,
      session: sessionId(),
      visitor: visitorId(),
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
        if (data && data.live) {
          // a human agent has this conversation; their reply arrives via sync()
          enterLive(data.agent || '');
          unlock();
          return;
        }
        var reply = (data && data.reply) || CFG.errorMessage || 'Sorry, something went wrong.';
        // messenger style: one blank-line-separated paragraph = one small bubble
        var parts = reply.split(/\\n\\s*\\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (!parts.length) parts = [reply];
        if (parts.length > 4) parts = parts.slice(0, 3).concat(parts.slice(3).join('\\n\\n'));
        parts.forEach(function (p) { messages.push({ role: 'assistant', content: p }); });
        persist();
        showParts(parts, 0, reply);
      })
      .catch(function () {
        hideTyping();
        if (!liveMode) addBubble('assistant', CFG.errorMessage || 'Sorry, something went wrong.');
        unlock();
      });

    function unlock() {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }

    function showParts(parts, i, full) {
      if (i >= parts.length) {
        addFeedback(full);
        unlock();
        return;
      }
      addBubble('assistant', parts[i]);
      if (i + 1 < parts.length) {
        showTyping();
        var pause = Math.min(450 + parts[i + 1].length * 9, 1700);
        setTimeout(function () {
          hideTyping();
          showParts(parts, i + 1, full);
        }, pause);
      } else {
        showParts(parts, i + 1, full);
      }
    }
  }

  /* ---------- answer feedback (thumbs on fresh AI answers) ---------- */
  function addFeedback(answerText) {
    var d = body.lastElementChild;
    if (!d || d.className.indexOf('bot') === -1) return;
    var row = document.createElement('div');
    row.className = 'fb';
    row.innerHTML = '<button data-v="up" aria-label="Helpful">👍</button>' +
                    '<button data-v="down" aria-label="Not helpful">👎</button>';
    d.appendChild(row);
    row.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        row.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
        b.className = 'sel';
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'feedback',
            client: CFG.clientId,
            session: sessionId(),
            vote: b.getAttribute('data-v'),
            answer: String(answerText).slice(0, 400)
          })
        }).catch(function () {});
      };
    });
  }

  /* ---------- notification sound ---------- */
  /* Browsers allow audio only after a user gesture; ensureAudio() runs on
     clicks, chime() then plays a short two-tone ping for agent replies. */
  var audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }
  function chime() {
    if (CFG.soundOff) return;
    try {
      if (!audioCtx || audioCtx.state !== 'running') return;
      var t = audioCtx.currentTime;
      [880, 1174.66].forEach(function (f, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.1, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.35);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(t + i * 0.12);
        o.stop(t + i * 0.12 + 0.4);
      });
    } catch (e) {}
  }

  /* ---------- live takeover ---------- */
  /* While a human talks, the widget wears the human's identity: the header
     shows the verified staff name + a live pulse, and the AI extras
     (quick replies, handoff/history links) step aside. */
  function setLiveUI(on) {
    if (on) {
      titleEl.innerHTML = esc(staffDisplay()) + VERIFIED_SVG;
      subEl.innerHTML = '<span class="ldot"></span>' + esc(CFG.liveStatus || 'Support is live');
      humanRow.style.display = 'none';
      quick.innerHTML = '';
    } else {
      titleEl.textContent = CFG.title || 'Chat';
      subEl.textContent = CFG.subtitle || '';
      humanRow.style.display = '';
      renderQuick();
    }
  }

  function enterLive(agent) {
    if (liveMode) return;
    liveMode = true;
    liveAgent = agent || '';
    setLiveUI(true);
    var who = CFG.staffName || liveAgent;
    var note = (who ? who + ' ' : '') + (CFG.liveJoined || 'from our team joined the chat.');
    messages.push({ role: 'assistant', content: note });
    persist();
    addBubble('assistant', note);
  }

  function exitLive() {
    if (!liveMode) return;
    liveMode = false;
    setLiveUI(false);
  }

  /* Tell the portal the visitor is typing (throttled; live chats only). */
  var lastTypingPing = 0;
  function pingTyping() {
    if (!liveMode) return;
    var now = Date.now();
    if (now - lastTypingPing < 2500) return;
    lastTypingPing = now;
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'typing', client: CFG.clientId, session: sessionId() })
    }).catch(function () {});
  }

  function sync() {
    fetch(ENDPOINT + '?sync=1&client=' + encodeURIComponent(CFG.clientId) +
          '&session=' + encodeURIComponent(sessionId()) + '&after=' + lastMsgId)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data) return;
        if (data.live) enterLive(data.agent || '');
        else exitLive();
        var msgs = data.messages || [];
        var added = false;
        msgs.forEach(function (m) {
          if (m.id <= lastMsgId) return;
          lastMsgId = m.id;
          messages.push({ role: 'agent', content: m.content });
          addBubble('agent', m.content);
          added = true;
        });
        if (added) { persist(); persistLast(); chime(); }
      })
      .catch(function () {});
  }

  function startPoll() {
    if (pollTimer) return;
    sync();
    pollTimer = setInterval(sync, 4000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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

  /* persistent per-browser visitor id: ties old chats together across visits */
  function visitorId() {
    try {
      var k = 'aib_vid_' + CFG.clientId;
      var v = localStorage.getItem(k);
      if (!v) {
        v = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'v_anonymous'; }
  }

  /* ---------- previous chats ---------- */
  var histEl = null;
  function openHistory() {
    if (histEl) { histEl.remove(); histEl = null; }
    histEl = document.createElement('div');
    histEl.className = 'hform';
    histEl.innerHTML = '<div class="ht">' + esc(CFG.historyTitle || CFG.historyLabel || 'Previous chats') + '</div>' +
      '<div class="hl">' + esc(CFG.historyLoading || '…') + '</div>';
    body.appendChild(histEl);
    body.scrollTop = body.scrollHeight;
    var box = histEl.querySelector('.hl');
    fetch(ENDPOINT + '?history=1&client=' + encodeURIComponent(CFG.clientId) +
          '&visitor=' + encodeURIComponent(visitorId()))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = (data && data.sessions) || [];
        var current = sessionId();
        list = list.filter(function (s) { return s.session !== current; });
        if (!list.length) { box.textContent = CFG.historyEmpty || 'No previous chats yet.'; return; }
        box.innerHTML = '';
        list.forEach(function (s) {
          var b = document.createElement('button');
          b.className = 'hitem';
          b.innerHTML = '<b>' + esc(new Date(s.last).toLocaleString()) + '</b><br>' +
            esc((s.preview || '').slice(0, 70));
          b.onclick = function () { loadOldChat(s.session); };
          box.appendChild(b);
        });
      })
      .catch(function () { box.textContent = CFG.errorMessage || 'Could not load chats.'; });
  }

  function loadOldChat(sid) {
    fetch(ENDPOINT + '?history=1&client=' + encodeURIComponent(CFG.clientId) +
          '&visitor=' + encodeURIComponent(visitorId()) + '&session=' + encodeURIComponent(sid))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var msgs = (data && data.messages) || [];
        if (!msgs.length) return;
        messages = msgs.map(function (m) {
          return { role: m.role === 'user' ? 'user' : (m.role === 'agent' ? 'agent' : 'assistant'), content: m.content };
        });
        var maxId = 0;
        msgs.forEach(function (m) { if (m.id > maxId) maxId = m.id; });
        lastMsgId = maxId;
        exitLive();
        try { sessionStorage.setItem('aib_sid_' + CFG.clientId, sid); } catch (e) {}
        persist();
        persistLast();
        renderAll();
      })
      .catch(function () {});
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
  panel.querySelector('#aib-hist').onclick = openHistory;
  panel.querySelector('#aib-new').onclick = function () {
    if (busy) return;
    messages = [];
    exitLive();
    liveAgent = '';
    lastMsgId = 0;
    try {
      sessionStorage.removeItem(STORE_KEY);
      sessionStorage.removeItem('aib_sid_' + CFG.clientId); // next send gets a fresh session id
      sessionStorage.removeItem('aib_last_' + CFG.clientId);
    } catch (e) {}
    renderAll();
    input.value = '';
    autoGrow();
    input.focus();
  };
  launcher.onclick = function () {
    ensureAudio();
    open = !open;
    panel.classList.toggle('open', open);
    if (open) {
      badge.style.display = 'none';
      renderAll();
      startPoll();
      setTimeout(function () { input.focus(); }, 50);
    } else {
      stopPoll();
    }
  };
  panel.querySelector('.x').onclick = function () {
    open = false;
    panel.classList.remove('open');
    stopPoll();
  };
  sendBtn.onclick = function () { ensureAudio(); send(); };
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', function () { autoGrow(); pingTyping(); });
})();
`;

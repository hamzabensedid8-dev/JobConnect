/* ==========================================================================
   JobConnect — messagerie (style Telegram) + notifications
   Réservé aux comptes candidat et recruteur. L'administration ne se fait
   que depuis l'application Android.
   ========================================================================== */
(function () {
  if (typeof currentUser === "undefined" || typeof api !== "function") return;

  var state = { list: [], active: null, messages: [], timer: null, lastId: 0 };
  var notifTimer = null;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("");
  }

  function timeOf(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) +
          " " +
          d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /* ------------------------------------------------------------- launcher */

  function buildLauncher() {
    if (document.getElementById("jcLauncher")) return;
    if (!currentUser) return;
    var wrap = el("div");
    wrap.id = "jcLauncher";
    wrap.className = "jc-launcher";
    wrap.innerHTML =
      '<button class="jc-fab jc-fab-bell" id="jcBell" title="Notifications">🔔<span class="jc-badge hidden" id="jcBellBadge"></span></button>' +
      '<button class="jc-fab jc-fab-chat" id="jcChatBtn" title="Messages">💬<span class="jc-badge hidden" id="jcChatBadge"></span></button>';
    document.body.appendChild(wrap);

    document.getElementById("jcBell").onclick = openNotifications;
    document.getElementById("jcChatBtn").onclick = openChat;
  }

  /* -------------------------------------------------------- notifications */

  async function pollNotifications() {
    if (!token) return;
    try {
      var d = await api("/api/notifications");
      var badge = document.getElementById("jcBellBadge");
      if (badge) {
        badge.textContent = d.unread_count > 99 ? "99+" : d.unread_count;
        badge.classList.toggle("hidden", !d.unread_count);
      }
      window.__jcNotifications = d.notifications || [];
    } catch (e) {
      /* silencieux : ne casse pas la page si hors ligne */
    }
  }

  function openNotifications() {
    var items = window.__jcNotifications || [];
    var overlay = el("div", "jc-overlay");
    overlay.innerHTML =
      '<div class="jc-sheet">' +
      '<div class="jc-sheet-head"><b>Notifications</b><button class="jc-x" aria-label="Close">×</button></div>' +
      '<div class="jc-notif-list" id="jcNotifList"></div>' +
      "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.classList.contains("jc-x")) overlay.remove();
    });
    document.body.appendChild(overlay);

    var list = overlay.querySelector("#jcNotifList");
    if (!items.length) {
      list.innerHTML = '<p class="jc-empty">No notifications yet.</p>';
      return;
    }
    list.innerHTML = items
      .map(function (n) {
        return (
          '<div class="jc-notif' + (n.read_at ? "" : " unread") + '" data-conv="' + (n.conversation_id || "") + '">' +
          "<b>" + escapeHtml(n.title) + "</b>" +
          "<p>" + escapeHtml(n.body || "") + "</p>" +
          '<small>' + timeOf(n.created_at) + "</small></div>"
        );
      })
      .join("");

    list.addEventListener("click", function (e) {
      var card = e.target.closest(".jc-notif");
      if (!card) return;
      var conv = card.dataset.conv;
      overlay.remove();
      api("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true })
      }).then(pollNotifications).catch(function () {});
      if (conv) openChat(parseInt(conv, 10));
    });

    api("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true })
    }).then(pollNotifications).catch(function () {});
  }

  /* ---------------------------------------------------------------- chat */

  function peersLabel(conv) {
    if (conv.kind === "admin_candidate") {
      return currentUser.role === "candidate"
        ? { name: "JobConnect Support", sub: "Official team" }
        : { name: conv.candidate ? conv.candidate.name : "Candidate", sub: "Candidate" };
    }
    if (conv.kind === "admin_recruiter") {
      return currentUser.role === "recruiter"
        ? { name: "JobConnect Support", sub: "Official team" }
        : { name: conv.recruiter ? conv.recruiter.name : "Recruiter",
            sub: conv.recruiter && conv.recruiter.company ? conv.recruiter.company : "Recruiter" };
    }
    if (currentUser.role === "recruiter") {
      return { name: conv.candidate ? conv.candidate.name : "Candidate", sub: "Candidate" };
    }
    return {
      name: conv.recruiter ? conv.recruiter.name : "Recruiter",
      sub: conv.recruiter && conv.recruiter.company ? conv.recruiter.company : "Recruiter"
    };
  }

  async function openChat(convId) {
    if (document.getElementById("jcChat")) return;
    var overlay = el("div", "jc-chat-overlay");
    overlay.id = "jcChat";
    overlay.innerHTML =
      '<div class="jc-chat">' +
      '<aside class="jc-chat-side">' +
      '<div class="jc-side-head"><b>Chats</b><button class="jc-x" aria-label="Close">×</button></div>' +
      '<div class="jc-conv-list" id="jcConvList"><p class="jc-empty">Loading…</p></div>' +
      '<div class="jc-side-foot" id="jcNewChats"></div>' +
      "</aside>" +
      '<section class="jc-chat-main">' +
      '<header class="jc-chat-top" id="jcChatTop"><div class="jc-avatar">JC</div><div><b>Select a chat</b><small>Choose a conversation</small></div></header>' +
      '<div class="jc-messages" id="jcMessages"><p class="jc-empty">No chat selected.</p></div>' +
      '<form class="jc-composer" id="jcComposer"><input id="jcInput" placeholder="Write a message…" autocomplete="off"><button class="jc-send" type="submit" aria-label="Send">➤</button></form>' +
      "</section>" +
      "</div>";
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.classList.contains("jc-x")) {
        closeChat();
      }
    });

    overlay.querySelector("#jcComposer").addEventListener("submit", async function (e) {
      e.preventDefault();
      var input = e.target.querySelector("#jcInput");
      var text = input.value.trim();
      if (!text || !state.active) return;
      input.value = "";
      try {
        var d = await api("/api/chat/conversations/" + state.active + "/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text })
        });
        state.messages.push(d.message);
        renderMessages();
      } catch (err) {
        toast(err.message);
      }
    });

    await loadConversations();
    if (convId) selectConversation(convId);
    state.timer = setInterval(function () {
      if (state.active) pollMessages();
    }, 4000);
  }

  function closeChat() {
    var node = document.getElementById("jcChat");
    if (node) node.remove();
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.active = null;
    state.messages = [];
    state.lastId = 0;
    pollNotifications();
  }

  async function loadConversations() {
    var d = await api("/api/chat/conversations");
    state.list = d.conversations || [];
    renderConversations();
    updateChatBadge();
  }

  function updateChatBadge() {
    var total = state.list.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    var badge = document.getElementById("jcChatBadge");
    if (badge) {
      badge.textContent = total > 99 ? "99+" : total;
      badge.classList.toggle("hidden", !total);
    }
  }

  function renderConversations() {
    var list = document.getElementById("jcConvList");
    if (!list) return;
    if (!state.list.length) {
      list.innerHTML = '<p class="jc-empty">No conversations yet. Message the JobConnect team or a recruiter.</p>';
    } else {
      list.innerHTML = state.list
        .map(function (c) {
          var p = peersLabel(c);
          var last = c.last_message ? c.last_message.body : "No message yet";
          var mine = c.last_message && c.last_message.sender_role === currentUser.role;
          return (
            '<button class="jc-conv' + (state.active === c.id ? " active" : "") + '" data-id="' + c.id + '">' +
            '<span class="jc-avatar">' + initials(p.name) + "</span>" +
            '<span class="jc-conv-body"><b>' + escapeHtml(p.name) + "</b>" +
            '<small>' + escapeHtml((mine ? "You: " : "") + last).slice(0, 60) + "</small></span>" +
            (c.unread ? '<span class="jc-unread">' + c.unread + "</span>" : "") +
            "</button>"
          );
        })
        .join("");
    }

    list.querySelectorAll(".jc-conv").forEach(function (b) {
      b.onclick = function () { selectConversation(parseInt(b.dataset.id, 10)); };
    });

    var foot = document.getElementById("jcNewChats");
    if (foot) {
      foot.innerHTML =
        currentUser.role === "candidate" || currentUser.role === "recruiter"
          ? '<button class="btn light jc-new" id="jcNewAdmin">Message JobConnect</button>'
          : "";
      var btn = document.getElementById("jcNewAdmin");
      if (btn) {
        btn.onclick = async function () {
          try {
            var d = await api("/api/chat/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "admin" })
            });
            await loadConversations();
            selectConversation(d.conversation.id);
          } catch (e) { toast(e.message); }
        };
      }
    }
  }

  async function selectConversation(id) {
    state.active = id;
    state.messages = [];
    state.lastId = 0;
    var conv = state.list.filter(function (c) { return c.id === id; })[0];
    var p = conv ? peersLabel(conv) : { name: "Chat", sub: "" };
    var top = document.getElementById("jcChatTop");
    if (top) {
      top.innerHTML =
        '<div class="jc-avatar">' + initials(p.name) + "</div>" +
        "<div><b>" + escapeHtml(p.name) + "</b><small>" + escapeHtml(p.sub) + "</small></div>";
    }
    renderConversations();
    document.getElementById("jcMessages").innerHTML = '<p class="jc-empty">Loading…</p>';
    await pollMessages(true);
    api("/api/chat/conversations/" + id + "/read", { method: "POST" }).then(loadConversations).catch(function () {});
  }

  async function pollMessages(reset) {
    if (!state.active) return;
    try {
      var q = state.lastId && !reset ? "?after=" + state.lastId : "";
      var d = await api("/api/chat/conversations/" + state.active + "/messages" + q);
      var msgs = d.messages || [];
      if (reset) state.messages = msgs;
      else state.messages = state.messages.concat(msgs);
      if (msgs.length) state.lastId = msgs[msgs.length - 1].id;
      renderMessages();
    } catch (e) {
      if (reset) {
        var box = document.getElementById("jcMessages");
        if (box) box.innerHTML = '<p class="jc-empty">' + escapeHtml(e.message) + "</p>";
      }
    }
  }

  function renderMessages() {
    var box = document.getElementById("jcMessages");
    if (!box) return;
    if (!state.messages.length) {
      box.innerHTML = '<p class="jc-empty">No messages yet. Say hello 👋</p>';
      return;
    }
    var lastDate = null;
    box.innerHTML = state.messages
      .map(function (m) {
        var mine = m.sender_id === currentUser.id;
        var stamp = timeOf(m.created_at);
        var day = new Date(m.created_at).toDateString();
        var sep = day !== lastDate ? '<div class="jc-day">' + new Date(m.created_at).toLocaleDateString() + "</div>" : "";
        lastDate = day;
        return (
          sep +
          '<div class="jc-bubble-row ' + (mine ? "mine" : "theirs") + '">' +
          '<div class="jc-bubble">' + escapeHtml(m.body) +
          '<span class="jc-time">' + stamp + (mine ? " ✓" : "") + "</span></div></div>"
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  /* ------------------------------------------------------------- wiring */

  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".msg-job");
    if (!btn) return;
    if (!token) { openModal("login"); return; }
    if (currentUser.role !== "candidate") { toast("Only candidate accounts can contact a recruiter."); return; }
    try {
      var d = await api("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "recruiter", job_id: btn.dataset.job })
      });
      await openChat();
      await loadConversations();
      selectConversation(d.conversation.id);
    } catch (err) { toast(err.message); }
  });

  window.JCRefreshChatWidget = function () {
    var old = document.getElementById("jcLauncher");
    if (old) old.remove();
    if (currentUser && currentUser.role !== "admin") {
      buildLauncher();
      pollNotifications();
      api("/api/chat/conversations").then(function (d) {
        state.list = d.conversations || [];
        updateChatBadge();
      }).catch(function () {});
    }
  };

  setTimeout(function () { window.JCRefreshChatWidget(); }, 600);
  notifTimer = setInterval(pollNotifications, 30000);
})();

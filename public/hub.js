/*
 * Advanced Aluminum Hub: sign-in and the connection to Supabase.
 *
 * The Job Costing app was first built as a Claude artifact, where Claude
 * provided storage ("db"), file storage ("assets"), downloads, the viewer's
 * identity ("user") and Claude itself ("sample"). This file provides those
 * same pieces on our own Supabase project, so the app code stays almost
 * unchanged. The app waits for `window.aaReady`, which resolves once a team
 * member has signed in.
 */
(function () {
  "use strict";

  var cfg = window.AA_CONFIG || {};
  var configured = cfg.supabaseUrl && !/YOUR-PROJECT-ID/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/YOUR-ANON/.test(cfg.supabaseAnonKey);
  var resolveReady;
  window.aaReady = new Promise(function (r) { resolveReady = r; });

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ------------------------------------------------------------------ */
  /* Sign-in screen                                                       */
  /* ------------------------------------------------------------------ */
  var gate = $("#signin");
  function showGate(html) {
    gate.innerHTML = '<div class="si-card"><img src="logo-sm.png" alt="Advanced Aluminum" width="600" height="249"><h1 class="si-title">AA <span>Hub</span></h1>' + html + "</div>";
    gate.hidden = false;
    document.body.classList.add("signed-out");
  }
  function hideGate() { gate.hidden = true; gate.innerHTML = ""; document.body.classList.remove("signed-out"); }

  if (!configured) {
    document.addEventListener("DOMContentLoaded", function () {
      showGate('<p class="si-text">This copy of the app isn\'t connected to a database yet. Add your Supabase address and public key to <code>config.js</code> (see the setup guide).</p>');
    });
    return;
  }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.aaSupabase = sb;
  var me = null; // {id, email, name, role}

  function emailForm(msg) {
    showGate(
      '<p class="si-text">Sign in with your work email. We\'ll email you a sign-in link and a 6-digit code.</p>' +
      '<form class="si-form" id="siEmailForm" novalidate>' +
      '<label for="siEmail">Email</label><input id="siEmail" type="email" autocomplete="email" inputmode="email" required placeholder="you@advancedaluminum.com">' +
      '<button class="btn primary" type="submit">Email me a sign-in code</button></form>' +
      '<p class="si-msg" id="siMsg" role="status">' + esc(msg || "") + "</p>"
    );
    var f = $("#siEmailForm"), input = $("#siEmail");
    try { input.value = localStorage.getItem("aa-last-email") || ""; } catch (e) {}
    input.focus();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("#siMsg").textContent = "Enter a valid email address."; return; }
      try { localStorage.setItem("aa-last-email", email); } catch (e2) {}
      var btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Sending…";
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (res) {
        if (res.error) {
          btn.disabled = false; btn.textContent = "Email me a sign-in code";
          $("#siMsg").textContent = /rate|seconds/i.test(res.error.message) ? "A code was sent a moment ago. Wait a minute, then try again." : "We couldn't send the email: " + res.error.message;
          return;
        }
        codeForm(email);
      });
    });
  }

  function codeForm(email) {
    showGate(
      '<p class="si-text">We sent an email to <b>' + esc(email) + '</b>. Click the link in it, or type the 6-digit code here.</p>' +
      '<form class="si-form" id="siCodeForm" novalidate>' +
      '<label for="siCode">Code</label><input id="siCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">' +
      '<button class="btn primary" type="submit">Sign in</button></form>' +
      '<p class="si-msg" id="siMsg" role="status"></p>' +
      '<button class="linkbtn" type="button" id="siBack">Use a different email</button>'
    );
    $("#siCode").focus();
    $("#siBack").addEventListener("click", function () { emailForm(); });
    $("#siCodeForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = $("#siCode").value.replace(/\s/g, "");
      if (!/^\d{6,10}$/.test(token)) { $("#siMsg").textContent = "Enter the code from the email."; return; }
      var btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…";
      sb.auth.verifyOtp({ email: email, token: token, type: "email" }).then(function (res) {
        if (res.error) { btn.disabled = false; btn.textContent = "Sign in"; $("#siMsg").textContent = "That code didn't work. Check it, or send a new one."; }
        // a successful sign-in arrives through onAuthStateChange below
      });
    });
  }

  function notOnTeam(email) {
    showGate(
      '<p class="si-text">You\'re signed in as <b>' + esc(email) + '</b>, but that email isn\'t on the Advanced Aluminum team list yet.</p>' +
      '<p class="si-text">Ask an admin to add you, then sign in again.</p>' +
      '<button class="btn" type="button" id="siOut">Sign out</button>'
    );
    $("#siOut").addEventListener("click", function () { sb.auth.signOut(); });
  }

  var started = false;
  function onSession(session) {
    if (!session) { me = null; if (started) location.reload(); else emailForm(); return; }
    if (me && me.id === session.user.id) return;
    var email = String(session.user.email || "").toLowerCase();
    sb.from("members").select("email,name,role").eq("email", email).maybeSingle().then(function (res) {
      if (res.error || !res.data) { notOnTeam(email); return; }
      me = { id: session.user.id, email: email, name: res.data.name || "", role: res.data.role };
      hideGate();
      renderUserMenu();
      if (!started) { started = true; resolveReady(); }
    });
  }
  sb.auth.onAuthStateChange(function (event, session) {
    // let Supabase finish its own work before we query
    setTimeout(function () { onSession(session); }, 0);
  });

  /* ------------------------------------------------------------------ */
  /* Signed-in header: who you are, Team (admins), Sign out               */
  /* ------------------------------------------------------------------ */
  function renderUserMenu() {
    var box = $("#userMenu"); if (!box) return;
    box.innerHTML = '<span class="um-who" title="' + esc(me.email) + '">' + esc(me.name || me.email) + (me.role === "viewer" ? " · view only" : "") + "</span>" +
      (me.role === "admin" ? '<button class="btn ghost sm" type="button" id="umTeam">Team</button>' : "") +
      '<button class="btn ghost sm" type="button" id="umOut">Sign out</button>';
    $("#umOut").addEventListener("click", function () { sb.auth.signOut(); });
    var t = $("#umTeam"); if (t) t.addEventListener("click", toggleTeam);
  }

  function toggleTeam() {
    var p = $("#teamPanel");
    if (!p.hidden) { p.hidden = true; return; }
    p.hidden = false;
    loadTeam();
  }
  function loadTeam(msg) {
    var p = $("#teamPanel");
    sb.from("members").select("email,name,role,created_at").order("created_at").then(function (res) {
      var rows = res.data || [];
      p.innerHTML = '<h3>Team</h3><p class="sub">People on this list can sign in with their email. Editors can add and change jobs and bills; viewers can only look. Admins can also manage this list.</p>' +
        '<div class="table-scroll"><table class="bills"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th></th></tr></thead><tbody>' +
        rows.map(function (m) {
          var self = m.email === me.email;
          return "<tr><td>" + esc(m.name || "—") + "</td><td>" + esc(m.email) + "</td><td>" +
            (self ? esc(m.role) + " (you)" : '<div class="input" style="max-width:130px"><select data-role="' + esc(m.email) + '">' +
              ["editor", "viewer", "admin"].map(function (r) { return '<option value="' + r + '"' + (r === m.role ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select></div>") +
            '</td><td class="rowacts">' + (self ? "" : '<button class="xbtn" type="button" data-remove="' + esc(m.email) + '">Remove</button>') + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<form class="tm-add" id="tmAdd" novalidate>' +
          '<div class="field"><label for="tmName">Name</label><div class="input"><input class="text" id="tmName" autocomplete="off" placeholder="Jane Smith"></div></div>' +
          '<div class="field"><label for="tmEmail">Email</label><div class="input"><input class="text" id="tmEmail" type="email" autocomplete="off" placeholder="jane@advancedaluminum.com"></div></div>' +
          '<div class="field"><label for="tmRole">Access</label><div class="input"><select id="tmRole"><option value="editor">editor</option><option value="viewer">viewer</option><option value="admin">admin</option></select></div></div>' +
          '<button class="btn primary" type="submit">Add to team</button></form>' +
        '<p class="help" id="tmMsg" role="status">' + esc(msg || "Once added, tell them to go to this site and sign in with that email.") + "</p>" +
        '<div class="tm-import"><h3>Move data from the Claude app</h3>' +
          '<p class="sub">Choose the backup file (<code>aa-job-costing-backup-….json</code>) and all the bill PDFs from the <code>bill-files</code> folder together. Jobs that are already here are updated, not duplicated, so it\'s safe to run again.</p>' +
          '<input type="file" id="tmImportFiles" multiple accept=".json,application/json,application/pdf,image/*">' +
          '<p class="help" id="tmImportMsg" role="status"></p></div>' +
        '<button class="btn ghost" type="button" id="tmClose">Close</button>';
      $("#tmClose").addEventListener("click", function () { p.hidden = true; });
      $("#tmImportFiles").addEventListener("change", function () { importFromClaude(this.files); });
      $("#tmAdd").addEventListener("submit", function (e) {
        e.preventDefault();
        var email = $("#tmEmail").value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("#tmMsg").textContent = "Enter a valid email address."; return; }
        sb.from("members").upsert({ email: email, name: $("#tmName").value.trim() || null, role: $("#tmRole").value }).then(function (r) {
          loadTeam(r.error ? "Couldn't add them: " + r.error.message : "Added " + email + ". Tell them to sign in at " + location.host + " with that email.");
        });
      });
      p.querySelectorAll("[data-role]").forEach(function (s) {
        s.addEventListener("change", function () {
          sb.from("members").update({ role: s.value }).eq("email", s.dataset.role).then(function (r) { loadTeam(r.error ? "Couldn't change access: " + r.error.message : "Access updated."); });
        });
      });
      p.querySelectorAll("[data-remove]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirm"; return; }
          sb.from("members").delete().eq("email", b.dataset.remove).then(function (r) { loadTeam(r.error ? "Couldn't remove them: " + r.error.message : "Removed " + b.dataset.remove + "."); });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* One-time move from the Claude app: backup JSON + bill files          */
  /* ------------------------------------------------------------------ */
  function importFromClaude(fileList) {
    var out = $("#tmImportMsg");
    var say = function (t) { out.textContent = t; };
    var files = Array.prototype.slice.call(fileList || []);
    var backup = files.find(function (f) { return /\.json$/i.test(f.name); });
    if (!backup) { say("Include the backup .json file in your selection."); return; }
    var byAsset = {};
    files.forEach(function (f) { var m = f.name.match(/^([0-9a-f]{32})\./i); if (m) byAsset[m[1].toLowerCase()] = f; });
    say("Reading the backup…");
    new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = function () { rej(new Error("Couldn't read the backup file.")); }; fr.readAsText(backup); }).then(function (txt) {
      var data = JSON.parse(txt);
      if (!data || !Array.isArray(data.jobs)) throw new Error("That file isn't a Job Costing backup.");
      var jobs = data.jobs, moved = 0, missing = 0;
      // 1. bill files
      var tasks = [];
      jobs.forEach(function (j) {
        (j.bills || []).forEach(function (b) {
          if (!b.fileId || String(b.fileUrl || "").indexOf("bill:") === 0) return;
          var f = byAsset[String(b.fileId).toLowerCase()];
          if (!f) { missing++; delete b.fileId; delete b.fileUrl; return; }
          tasks.push(function () {
            var safe = String(b.fileName || f.name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-60);
            var path = "imported/" + String(b.fileId).toLowerCase() + "-" + safe;
            return sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/pdf", upsert: false }).then(function (r) {
              if (r.error && !/exists|duplicate/i.test(r.error.message)) throw new Error("Couldn't upload " + f.name + ": " + r.error.message);
              b.fileId = path; b.fileUrl = "bill:" + path; moved++;
              say("Uploading bill files… " + moved + " of " + tasks.length);
            });
          });
        });
      });
      return tasks.reduce(function (p, t) { return p.then(t); }, Promise.resolve()).then(function () {
        // 2. jobs, 50 at a time
        say("Saving " + jobs.length + " jobs…");
        var rows = jobs.map(function (j) { var d = Object.assign({}, j); var id = d.id; delete d.id; return { id: id, data: d }; });
        var chunks = []; for (var i = 0; i < rows.length; i += 50) chunks.push(rows.slice(i, i + 50));
        return chunks.reduce(function (p, c) {
          return p.then(function () { return sb.from("jobs").upsert(c).then(function (r) { if (r.error) throw new Error("Couldn't save jobs: " + r.error.message); }); });
        }, Promise.resolve());
      }).then(function () {
        // 3. rates
        var rt = data.settings && data.settings.rates;
        if (!rt) return;
        return sb.from("settings").upsert({ id: "rates", data: { teamRate: Number(rt.teamRate), overheadRate: Number(rt.overheadRate) } }).then(function (r) { if (r.error) throw new Error("Couldn't save rates: " + r.error.message); });
      }).then(function () {
        say("Done: " + jobs.length + " jobs and " + moved + " bill files moved" + (missing ? ". " + missing + " bill file" + (missing === 1 ? " wasn't" : "s weren't") + " in your selection, so " + (missing === 1 ? "that bill keeps" : "those bills keep") + " its details without the file." : "."));
      });
    }).catch(function (e) { say(e && e.message ? e.message : "The import didn't finish. Try again."); });
  }

  /* ------------------------------------------------------------------ */
  /* Storage ("db"): the same calls the app used inside Claude            */
  /* ------------------------------------------------------------------ */
  function dbError(err) {
    var code = err && err.code;
    // 42501 = blocked by the security rules (e.g. a viewer trying to save)
    if (code === "42501" || /row-level security|permission/i.test((err && err.message) || "")) return { code: "invalid_argument", message: "Your access doesn't allow changes." };
    return { code: "unavailable", message: (err && err.message) || "Couldn't reach the database." };
  }
  function newId() {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", s = "";
    var buf = new Uint8Array(20); (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 20; i++) s += a[buf[i] % a.length];
    return s;
  }
  function snapDoc(id, data) { return { id: id, exists: !!data, data: function () { return data || undefined; }, metadata: { fromCache: false, hasPendingWrites: false } }; }

  function docRef(table, id) {
    return {
      id: id, path: table + "/" + id,
      get: function () {
        return sb.from(table).select("id,data").eq("id", id).maybeSingle().then(function (r) {
          if (r.error) throw dbError(r.error);
          return snapDoc(id, r.data ? r.data.data : null);
        });
      },
      set: function (body) {
        return sb.from(table).upsert({ id: id, data: body }).then(function (r) { if (r.error) throw dbError(r.error); });
      },
      update: function (patch) {
        return this.get().then(function (s) {
          if (!s.exists) throw { code: "invalid_argument", message: "Document doesn't exist." };
          var merged = Object.assign({}, s.data(), patch);
          return sb.from(table).update({ data: merged }).eq("id", id).then(function (r) { if (r.error) throw dbError(r.error); });
        });
      },
      delete: function () {
        return sb.from(table).delete().eq("id", id).then(function (r) { if (r.error) throw dbError(r.error); });
      },
      onSnapshot: function (next, onError) {
        var stopped = false;
        var load = function () {
          sb.from(table).select("id,data").eq("id", id).maybeSingle().then(function (r) {
            if (stopped) return;
            if (r.error) { if (onError) onError(dbError(r.error)); return; }
            next(snapDoc(id, r.data ? r.data.data : null));
          });
        };
        load();
        var ch = sb.channel("doc-" + table + "-" + id + "-" + newId().slice(0, 6))
          .on("postgres_changes", { event: "*", schema: "public", table: table, filter: "id=eq." + id }, function (p) {
            if (stopped) return;
            if (p.eventType === "DELETE") next(snapDoc(id, null)); else next(snapDoc(id, p.new.data));
          })
          .subscribe(function (status) { if (status === "SUBSCRIBED") load(); });
        return function () { stopped = true; sb.removeChannel(ch); };
      }
    };
  }

  function collectionRef(table) {
    return {
      path: table,
      doc: function (id) { return docRef(table, id || newId()); },
      add: function (data) { var ref = docRef(table, newId()); return ref.set(data).then(function () { return ref; }); },
      onSnapshot: function (next, onError) {
        var stopped = false, rows = new Map(), timer = null;
        var emit = function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            if (stopped) return;
            var docs = Array.from(rows.keys()).sort().map(function (k) { return snapDoc(k, rows.get(k)); });
            next({ docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: function () { return []; } });
          }, 30);
        };
        var loadAll = function () {
          // read in pages so a large job history still loads completely
          var all = [], page = 0, size = 1000;
          var step = function () {
            return sb.from(table).select("id,data").order("id").range(page * size, page * size + size - 1).then(function (r) {
              if (r.error) throw r.error;
              all = all.concat(r.data || []);
              if ((r.data || []).length === size) { page++; return step(); }
            });
          };
          step().then(function () {
            if (stopped) return;
            rows = new Map(all.map(function (x) { return [x.id, x.data]; }));
            emit();
          }).catch(function (err) { if (!stopped && onError) onError(dbError(err)); });
        };
        loadAll();
        var ch = sb.channel("col-" + table + "-" + newId().slice(0, 6))
          .on("postgres_changes", { event: "*", schema: "public", table: table }, function (p) {
            if (stopped) return;
            if (p.eventType === "DELETE") { if (p.old && p.old.id) rows.delete(p.old.id); }
            else if (p.new && p.new.id) rows.set(p.new.id, p.new.data);
            emit();
          })
          .subscribe(function (status) { if (status === "SUBSCRIBED") loadAll(); });
        // catch up after a laptop wakes or a phone comes back to the app
        var onVis = function () { if (document.visibilityState === "visible") loadAll(); };
        document.addEventListener("visibilitychange", onVis);
        return function () { stopped = true; document.removeEventListener("visibilitychange", onVis); sb.removeChannel(ch); };
      }
    };
  }

  var dbApi = {
    collection: function (path) { return collectionRef(path); },
    doc: function (path) { var p = String(path).split("/"); return docRef(p[0], p[1]); }
  };

  /* ------------------------------------------------------------------ */
  /* Who is signed in ("user")                                            */
  /* ------------------------------------------------------------------ */
  var userApi = {
    isOwner: function () { return !!me && me.role === "admin"; },
    canEdit: function () { return !!me && me.role !== "viewer"; },
    can: function (name) { return name === "data.write" ? (!!me && me.role !== "viewer") : null; },
    id: function () { return Promise.resolve(me ? me.id : null); },
    me: function () { return Promise.resolve(me ? { id: me.id, name: me.name || me.email, email: me.email } : null); }
  };

  /* ------------------------------------------------------------------ */
  /* Bill files ("assets"): private storage, opened with short-lived links */
  /* ------------------------------------------------------------------ */
  var BUCKET = "bills";
  var assetsApi = {
    upload: function (blob) {
      var name = String(blob.name || "bill").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-60) || "bill";
      var path = new Date().getFullYear() + "/" + newId() + "-" + name;
      return sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: false }).then(function (r) {
        if (r.error) throw { code: "unavailable", message: r.error.message };
        return { id: path, url: "bill:" + path, sizeBytes: blob.size, contentType: blob.type };
      });
    },
    delete: function (path) {
      return sb.storage.from(BUCKET).remove([path]).then(function (r) { if (r.error) throw { code: "unavailable", message: r.error.message }; return { deleted: true }; });
    },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };
  // Bill links in the app point at "bill:<path>". Open them with a link that works for 10 minutes.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="bill:"]');
    if (!a) return;
    e.preventDefault();
    var path = a.getAttribute("href").slice(5);
    var win = window.open("", "_blank");
    sb.storage.from(BUCKET).createSignedUrl(path, 600).then(function (r) {
      if (r.error || !r.data) { if (win) win.close(); alert("That bill file couldn't be opened. It may have been removed."); return; }
      if (win) win.location = r.data.signedUrl; else location.href = r.data.signedUrl;
    });
  }, true);

  /* ------------------------------------------------------------------ */
  /* Downloads: an ordinary browser download                              */
  /* ------------------------------------------------------------------ */
  var downloadsApi = {
    save: function (req) {
      return new Promise(function (resolve) {
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = req.filename || "download"; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        resolve({ status: "saved" });
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Claude ("sample"): bill reading and insights, through our server     */
  /* function so the company's Claude key never reaches the browser.     */
  /* ------------------------------------------------------------------ */
  function shrinkImage(blob) {
    // send at most ~1600px per side as JPEG to keep requests small
    if (!window.createImageBitmap) return blobToBase64(blob).then(function (d) { return { media_type: blob.type || "image/png", data: d }; });
    return createImageBitmap(blob).then(function (bmp) {
      var scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.85); });
    }).then(function (jpg) { return blobToBase64(jpg).then(function (d) { return { media_type: "image/jpeg", data: d }; }); });
  }
  function blobToBase64(blob) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1]); }; fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  function parseJsonLoose(text) {
    var t = String(text || "").trim();
    try { return JSON.parse(t); } catch (e) {}
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
    var s = t.search(/[\[{]/), end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (s >= 0 && end > s) { try { return JSON.parse(t.slice(s, end + 1)); } catch (e) {} }
    throw { code: "invalid_json", message: "Claude's answer wasn't valid JSON.", text: t };
  }
  function callClaude(input, opts, wantJson) {
    opts = opts || {};
    var prompt = typeof input === "string" ? input : (input || []).map(function (m) { return m.content; }).join("\n\n");
    var imgs = opts.images ? Array.prototype.slice.call(opts.images instanceof Blob ? [opts.images] : opts.images, 0, 5) : [];
    return Promise.all(imgs.map(shrinkImage)).then(function (images) {
      return sb.auth.getSession().then(function (s) {
        var token = s.data && s.data.session && s.data.session.access_token;
        if (!token) throw { code: "session_expired", message: "Sign in again." };
        return fetch(cfg.supabaseUrl + "/functions/v1/claude", {
          method: "POST", signal: opts.signal,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: cfg.supabaseAnonKey },
          body: JSON.stringify({ prompt: prompt, images: images, tier: opts.modelTier || "default", json: !!wantJson })
        });
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var code = res.status === 401 ? "session_expired" : res.status === 403 ? "not_granted" : res.status === 429 ? "rate_limited" : (body.code || "upstream_error");
          throw { code: code, message: body.error || ("Request failed (" + res.status + ")") };
        }
        return body.text || "";
      });
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "Stopped." };
      if (e && e.code) throw e;
      throw { code: "upstream_error", message: (e && e.message) || "Couldn't reach Claude." };
    });
  }
  var sampleApi = function (input, opts) {
    return callClaude(input, opts, false).then(function (text) {
      if (opts && typeof opts.onText === "function") { try { opts.onText({ text: text, delta: text }); } catch (e) {} }
      return { text: text, truncated: false, modelTierApplied: (opts && opts.modelTier) || "default" };
    });
  };
  sampleApi.json = function (input, opts) { return callClaude(input, opts, true).then(parseJsonLoose); };
  sampleApi.limits = function () {
    return Promise.resolve({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
  };

  /* ------------------------------------------------------------------ */
  /* Hand the pieces to the app the same way Claude did                   */
  /* ------------------------------------------------------------------ */
  var api = { db: dbApi, user: userApi, assets: assetsApi, downloads: downloadsApi, sample: sampleApi };
  window.claude = {
    use: function (name) {
      // viewers can't upload bill files
      if (name === "assets" && me && me.role === "viewer") return Promise.resolve(null);
      return Promise.resolve(api[name] || null);
    }
  };
})();

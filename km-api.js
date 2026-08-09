/* Kinomad API client — talks to the Go backend at /api */
(function () {
  var API = '/api';

  var flags = { fail: false, latency: 0 };
  var SESSION_KEY = 'kinomad_admin_token';

  function readStoredSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (s.exp && s.exp < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (_) { return null; }
  }

  function storeSession(user, token) {
    var sess = {
      email: user.email,
      name: user.name,
      token: token || '',
      exp: Date.now() + 30 * 86400000,
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch (_) {}
    return sess;
  }

  function clearStoredSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  function authHeaders() {
    var s = readStoredSession();
    if (s && s.token) return { Authorization: 'Bearer ' + s.token };
    return {};
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms == null ? flags.latency : ms); });
  }

  function fail(status, message, extra) {
    var e = new Error(message);
    e.status = status;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    return e;
  }

  function parseError(res, body) {
    var msg = 'Request failed.';
    var extra = {};
    if (body && body.error) {
      msg = body.error.message || msg;
      if (body.error.missing) extra.missing = body.error.missing;
      if (body.error.fields) extra.fields = body.error.fields;
    }
    throw fail(res.status, msg, extra);
  }

  function jsonFetch(method, path, body, auth) {
    return wait().then(function () {
      if (flags.fail) throw fail(503, 'Network request failed — the studio API did not respond.');
      var opts = {
        method: method,
        headers: Object.assign({ Accept: 'application/json' }, authHeaders()),
      };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return fetch(API + path, opts);
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401 && path.indexOf('/admin') === 0) {
            clearStoredSession();
            try { window.dispatchEvent(new Event('km-auth-expired')); } catch (_) {}
          }
          parseError(res, data);
        }
        return data;
      });
    });
  }

  function uploadWithProgress(method, path, file, onProgress, extraFields) {
    return wait().then(function () {
      if (flags.fail) throw fail(503, 'Upload failed — the studio API did not respond.');
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, API + path, true);
        xhr.responseType = 'json';
        var auth = authHeaders();
        if (auth.Authorization) xhr.setRequestHeader('Authorization', auth.Authorization);
        xhr.upload.onprogress = function (ev) {
          if (onProgress && ev.lengthComputable) onProgress(ev.loaded / ev.total);
        };
        xhr.onload = function () {
          var data = xhr.response;
          if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (_) { data = null; }
          }
          if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
          if (xhr.status === 401 && path.indexOf('/admin') === 0) {
            clearStoredSession();
            try { window.dispatchEvent(new Event('km-auth-expired')); } catch (_) {}
          }
          try { parseError({ status: xhr.status }, data); } catch (e) { reject(e); }
        };
        xhr.onerror = function () { reject(fail(503, 'Upload failed — connection lost.')); };
        var fd = new FormData();
        fd.append('file', file);
        if (extraFields) {
          Object.keys(extraFields).forEach(function (k) {
            if (extraFields[k] != null && extraFields[k] !== '') fd.append(k, extraFields[k]);
          });
        }
        xhr.send(fd);
      });
    });
  }

  /* ---------- timezone helpers (client-side display only) ---------- */
  var ZONES = [
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
    'Europe/London', 'Europe/Lisbon', 'Europe/Berlin', 'Europe/Paris', 'Europe/Warsaw', 'Europe/Athens',
    'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
    'Australia/Sydney', 'Pacific/Auckland', 'UTC',
  ];
  function part(zone, style) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(new Date());
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    } catch (_) {}
    return '';
  }
  function city(zone) { return String(zone).split('/').pop().replace(/_/g, ' '); }
  function tzOffsetLabel(zone) {
    var v = part(zone, 'shortOffset') || part(zone, 'short') || 'UTC';
    return v.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0');
  }
  function tzAbbr(zone) {
    var v = part(zone, 'short') || '';
    return /^GMT|^UTC|[+-]/.test(v) ? '' : v;
  }
  function tzLabel(zone) {
    var ab = tzAbbr(zone), off = tzOffsetLabel(zone);
    return (ab ? ab + ' (' + off + ')' : off) + ' · ' + city(zone);
  }
  function tzOffsetMin(zone, at) {
    try {
      var d = at || new Date();
      var s = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
      var m = s.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
      if (!m) return 0;
      var asUTC = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4] % 24, +m[5], +m[6]);
      return Math.round((asUTC - d.getTime()) / 60000);
    } catch (_) { return 0; }
  }

  function defaultAvail() {
    return {
      types: [{ name: 'Intro call', min: 30 }, { name: 'Project deep-dive', min: 60 }],
      tz: 'Asia/Dubai',
      days: [true, true, true, true, true, false, false],
      start: '10:00', end: '18:00',
      interval: 30, buffer: 15, notice: 12,
      blocked: [],
    };
  }
  function normaliseAvail(a) {
    var d = defaultAvail(), o = Object.assign({}, d, a || {});
    if (/[()]| /.test(o.tz || '')) o.tz = 'Asia/Dubai';
    o.blocked = (o.blocked || []).map(function (b) {
      return typeof b === 'string' ? { from: b, to: b } : { from: b.from || '', to: b.to || b.from || '' };
    }).filter(function (b) { return b.from; });
    o.buffer = Number(o.buffer) || 0;
    return o;
  }
  function blockedOn(avail, iso) {
    return (avail.blocked || []).some(function (b) {
      var to = b.to || b.from;
      return iso >= b.from && iso <= to;
    });
  }
  function slotsFor(avail, iso, minutes) {
    var a = normaliseAvail(avail);
    var dt = new Date(iso + 'T00:00:00');
    var dow = (dt.getDay() + 6) % 7;
    if (!a.days[dow] || blockedOn(a, iso)) return [];
    var toMin = function (t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var s0 = toMin(a.start), e0 = toMin(a.end), step = Number(a.interval) || 30;
    var dur = (Number(minutes) || 30) + (Number(a.buffer) || 0);
    var out = [];
    for (var t = s0; t + dur <= e0; t += step) out.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60));
    return out;
  }

  function slugify(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function assetRef(assets, key) {
    var a = assets && assets[key];
    if (!a) return '';
    if (typeof a === 'string') return a;
    return a.id || a.assetId || '';
  }

  /** Asset id from CRM state — never send /api/assets/… URLs to the backend. */
  function extractAssetId(ref) {
    if (!ref) return '';
    if (typeof ref === 'object') return ref.id || ref.assetId || '';
    var s = String(ref);
    var m = /\/api\/assets\/([^/?#]+)/.exec(s);
    if (m) return m[1];
    return s;
  }

  function shotRatio(s) {
    if (s.ratio === 'custom') {
      var w = Number(s.cw) || 3;
      var h = Number(s.ch) || 2;
      return w + '/' + h;
    }
    return s.ratio || '16/9';
  }

  function normalizeAssets(assets) {
    if (!assets) return {};
    var out = {};
    ['hero', 'card', 'reel', 'poster'].forEach(function (k) {
      var v = assets[k];
      if (!v) return;
      if (typeof v === 'string') {
        out[k] = { id: v, url: assetUrl(v), name: 'Uploaded image', w: 0, h: 0 };
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function normalizeProject(p) {
    if (!p) return p;
    var copy = Object.assign({}, p);
    copy.assets = normalizeAssets(copy.assets);
    if (copy.shots) {
      copy.shots = copy.shots.map(function (s) {
        var aid = extractAssetId(s.assetId || s.img);
        return Object.assign({}, s, {
          assetId: aid,
          img: aid ? assetUrl(aid) : (s.img || ''),
        });
      });
    }
    return copy;
  }

  /** CRM editor state → partial PATCH body the Go API expects. */
  function toPatchBody(p) {
    var assets = p.assets || {};
    var body = {
      name: p.name,
      year: p.year,
      industry: p.industry,
      meta: p.meta,
      statement: p.statement,
      background: p.background,
      concept: p.concept,
      hosting: p.hosting,
      liveUrl: p.liveUrl,
      fill: p.fill,
      // Opaque CSS position strings ("40% 25%"). Passed straight through —
      // parsing and re-serialising them would break the shape both the crop
      // preview and the public pages expect.
      heroFocus: p.heroFocus,
      cardFocus: p.cardFocus,
    };
    var heroKey = p.type === 'three' ? 'card' : 'hero';
    var heroId = assetRef(assets, heroKey);
    if (heroId) body.heroAssetId = heroId;
    var reelId = assetRef(assets, 'reel');
    if (reelId) body.reelAssetId = reelId;
    var posterId = assetRef(assets, 'poster');
    if (posterId) body.posterAssetId = posterId;
    if (p.credits) {
      body.credits = p.credits.map(function (c) { return { who: c.who, role: c.role }; });
    }
    if (p.shots) {
      body.shots = p.shots
        .filter(function (s) { return extractAssetId(s.assetId || s.img); })
        .map(function (s, i) {
          return {
            id: s.id || '',
            assetId: extractAssetId(s.assetId || s.img),
            span: s.span || 6,
            ratio: shotRatio(s),
            order: s.order != null ? s.order : i,
          };
        });
    }
    return body;
  }

  function hasAsset(assets, key) {
    return !!assetRef(assets, key);
  }

  function requirements(p) {
    var assets = p.assets || {};
    var need = [
      { key: 'name', label: 'Project name', ok: !!p.name },
      { key: 'year', label: 'Year', ok: /^\d{4}$/.test(String(p.year || '')) },
      { key: 'industry', label: 'Industry', ok: !!p.industry },
      { key: 'meta', label: p.type === 'website' ? 'Category' : p.type === 'brand' ? 'Deliverable' : 'Format', ok: !!p.meta },
      { key: 'statement', label: 'Statement', ok: !!p.statement },
      { key: 'copy', label: 'Background & concept', ok: !!p.background && !!p.concept },
      { key: 'credits', label: 'At least one credit', ok: (p.credits || []).some(function (c) { return c.who && c.role; }) },
    ];
    var shots = (p.shots || []).filter(function (s) { return extractAssetId(s.assetId || s.img); });
    if (p.type === 'website') {
      if (p.hosting === 'hosted') need.push({ key: 'bundle', label: 'Site bundle unpacked', ok: (p.bundle || {}).status === 'ready' });
      else need.push({ key: 'liveUrl', label: 'Live website URL', ok: /^https?:\/\/\S+\.\S+/.test(p.liveUrl || '') });
      need.push({ key: 'hero', label: 'Hero image', ok: hasAsset(assets, 'hero') });
    }
    if (p.type === 'brand') {
      need.push({ key: 'hero', label: 'Hero image', ok: hasAsset(assets, 'hero') });
      need.push({ key: 'shots', label: 'At least one shot', ok: shots.length >= 1 });
    }
    if (p.type === 'three') {
      var reel = hasAsset(assets, 'reel');
      need.push({ key: 'shots', label: reel ? 'Shots (optional with a reel)' : 'At least one shot', ok: reel || shots.length >= 1 });
      need.push({ key: 'poster', label: reel ? 'Poster frame' : 'Poster frame (reel only)', ok: hasAsset(assets, 'poster') || !reel });
      need.push({ key: 'card', label: 'Card image', ok: hasAsset(assets, 'card') });
    }
    return need;
  }

  var session = {
    local: readStoredSession,
    current: function () {
      var local = readStoredSession();
      if (!local || !local.token) {
        clearStoredSession();
        return Promise.resolve(null);
      }
      return Promise.resolve(local);
    },
    login: function (email, password) {
      return jsonFetch('POST', '/session', { email: email, password: password }).then(function (data) {
        if (!data || !data.user || !data.token) {
          throw fail(502, 'Sign-in failed — the API did not return a token.');
        }
        return storeSession(data.user, data.token);
      });
    },
    logout: function () {
      clearStoredSession();
      return Promise.resolve(true);
    },
  };

  var projects = {
    list: function () {
      return jsonFetch('GET', '/admin/projects').then(function (data) {
        return (data.projects || []).map(normalizeProject);
      });
    },
    get: function (id) {
      return jsonFetch('GET', '/admin/projects/' + encodeURIComponent(id)).then(function (data) {
        return normalizeProject(data.project);
      });
    },
    create: function (body) {
      return jsonFetch('POST', '/admin/projects', { type: (body || {}).type || 'website' }).then(function (data) {
        return normalizeProject(data.project);
      });
    },
    patch: function (id, body) {
      return jsonFetch('PATCH', '/admin/projects/' + encodeURIComponent(id), toPatchBody(body)).then(function (data) {
        return normalizeProject(data.project);
      });
    },
    remove: function (id) {
      return jsonFetch('DELETE', '/admin/projects/' + encodeURIComponent(id)).then(function () { return true; });
    },
    publish: function (id) {
      return jsonFetch('POST', '/admin/projects/' + encodeURIComponent(id) + '/publish').then(function (data) {
        return normalizeProject(data.project);
      });
    },
    unpublish: function (id) {
      return jsonFetch('POST', '/admin/projects/' + encodeURIComponent(id) + '/unpublish').then(function (data) {
        return normalizeProject(data.project);
      });
    },
    reorder: function (type, ids) {
      return jsonFetch('PATCH', '/admin/projects/reorder', { type: type, ids: ids }).then(function () { return true; });
    },
    requirements: requirements,
    toPatchBody: toPatchBody,
    normalize: normalizeProject,
  };

  var assets = {
    upload: function (projectId, file, onProgress, slot) {
      return uploadWithProgress('POST', '/admin/projects/' + encodeURIComponent(projectId) + '/assets', file, onProgress, slot ? { slot: slot } : null);
    },
  };

  var bundle = {
    upload: function (projectId, file, onProgress) {
      return uploadWithProgress('POST', '/admin/projects/' + encodeURIComponent(projectId) + '/bundle', file, onProgress);
    },
    status: function (projectId) {
      return jsonFetch('GET', '/admin/projects/' + encodeURIComponent(projectId) + '/bundle');
    },
  };

  var cachedAvail = null;
  var availability = {
    get: function () {
      return jsonFetch('GET', '/public/availability').then(function (data) {
        cachedAvail = normaliseAvail(data);
        return cachedAvail;
      });
    },
    save: function (cfg) {
      return jsonFetch('PUT', '/admin/availability', normaliseAvail(cfg)).then(function (data) {
        cachedAvail = normaliseAvail(data);
        return cachedAvail;
      });
    },
  };
  function loadAvail() { return cachedAvail || defaultAvail(); }

  var bookings = {
    list: function () {
      return jsonFetch('GET', '/admin/bookings');
    },
    setStatus: function (id, status) {
      return jsonFetch('PATCH', '/admin/bookings/' + encodeURIComponent(id), { status: status });
    },
    remove: function (id) {
      return jsonFetch('DELETE', '/admin/bookings/' + encodeURIComponent(id)).then(function () { return true; });
    },
    busy: function (dateIso) {
      return jsonFetch('GET', '/public/busy?date=' + encodeURIComponent(dateIso));
    },
    create: function (payload) {
      return jsonFetch('POST', '/public/bookings', payload);
    },
  };

  function assetUrl(assetId) {
    return assetId ? '/api/assets/' + encodeURIComponent(assetId) + '/file' : '';
  }

  function padNum(n, i) {
    var v = n != null && n !== '' ? n : i + 1;
    return String(v).padStart(2, '0');
  }

  function assetDim(assets, key, dim) {
    var a = assets && assets[key];
    return (a && typeof a === 'object' && a[dim]) || 0;
  }

  function projectToCase(p, i) {
    var slug = p.slug || p.id;
    var hero = assetRef(p.assets, 'hero') || assetRef(p.assets, 'card') || '';
    var poster = assetRef(p.assets, 'poster') || hero;
    var reel = assetRef(p.assets, 'reel') || '';
    var live = p.liveUrl || (p.bundle && p.bundle.url) || '#';
    var heroKey = p.assets && p.assets.hero ? 'hero' : 'card';
    return {
      // The hero's own pixel size, so a page that must not crop can take the
      // image's ratio instead of imposing one.
      heroW: assetDim(p.assets, heroKey, 'w'),
      heroH: assetDim(p.assets, heroKey, 'h'),
      heroFocus: p.heroFocus || '',
      cardFocus: p.cardFocus || '',
      hasHeroAsset: !!assetRef(p.assets, 'hero'),
      hasCardAsset: !!assetRef(p.assets, 'card'),
      id: slug,
      slug: slug,
      num: padNum(p.position, i),
      name: p.name || '',
      industry: p.industry || '',
      year: p.year || '',
      meta: p.meta || '',
      fill: p.fill || '',
      url: live,
      statement: p.statement || '',
      background: p.background || '',
      concept: p.concept || '',
      heroId: hero || ('hero-' + slug),
      heroSrc: assetUrl(hero) || assetUrl(poster),
      heroPh: (p.name || 'Project') + ', hero',
      reelSrc: assetUrl(reel),
      credits: (p.credits || []).filter(function (c) { return c.who || c.role; }),
      shots: (p.shots || []).map(function (s, j) {
        return {
          imgId: s.id || ('shot-' + slug + '-' + j),
          src: assetUrl(s.assetId || s.img),
          ph: (p.name || 'Project') + ', shot ' + (j + 1),
          span: s.span || 6,
          ratio: s.ratio || '16/9',
        };
      }),
    };
  }

  /* Works asks for websites, brands and 3D in the same tick, and each one reads
     the same /public/projects response. Share the in-flight request so that is
     one round trip, not three. Cleared on settle — no stale cache. */
  var listInFlight = null;

  var publicApi = {
    list: function () {
      if (listInFlight) return listInFlight;
      var req = jsonFetch('GET', '/public/projects').then(function (data) { return data.projects || []; });
      var clear = function () { if (listInFlight === req) listInFlight = null; };
      req.then(clear, clear);
      listInFlight = req;
      return req;
    },
    get: function (slug) {
      return jsonFetch('GET', '/public/projects/' + encodeURIComponent(slug)).then(function (data) { return data.project; });
    },
    listByType: function (type) {
      return publicApi.list().then(function (list) {
        return list.filter(function (p) { return p.type === type; }).map(projectToCase);
      });
    },
    matchCase: function (cases, pid) {
      if (!cases || !cases.length) return null;
      return cases.find(function (x) { return x.slug === pid || x.id === pid; }) || cases[0];
    },
    assetUrl: assetUrl,
    toCase: projectToCase,
  };

  window.KMAPI = {
    flags: flags,
    zones: ZONES,
    tzLabel: tzLabel,
    tzOffsetLabel: tzOffsetLabel,
    tzCity: city,
    tzOffsetMin: tzOffsetMin,
    defaultAvail: defaultAvail,
    normaliseAvail: normaliseAvail,
    loadAvail: loadAvail,
    slotsFor: slotsFor,
    blockedOn: blockedOn,
    slugify: slugify,
    session: session,
    projects: projects,
    assets: assets,
    bundle: bundle,
    availability: availability,
    bookings: bookings,
    public: publicApi,
  };
})();

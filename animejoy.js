/*
 * AnimeJoy (animejoya.ru) — источник «Онлайн» для Lampa
 * Аниме с русскими субтитрами. Плееры: CDA, AllVideo, Sibnet.
 * Требуется учётная запись animejoya.ru (логин/пароль в настройках плагина).
 */
(function () {
  'use strict';

  if (window.animejoy_plugin_loaded) return;
  window.animejoy_plugin_loaded = true;

  var PLUGIN_TITLE = 'AnimeJoy';
  var DEFAULT_DOMAIN = 'https://animejoya.ru';

  /* ============================ НАСТРОЙКИ ============================ */

  function domain() {
    var d = (Lampa.Storage.get('animejoy_domain') || DEFAULT_DOMAIN).trim();
    d = d.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
    return d;
  }

  function loginVal() { return (Lampa.Storage.get('animejoy_login') || '').trim(); }
  function passVal()  { return (Lampa.Storage.get('animejoy_password') || '').trim(); }

  function playerPriority() {
    var p = Lampa.Storage.get('animejoy_player', 'cda');
    var all = [p, 'cda', 'allvideo', 'sibnet'];
    return all.filter(function (v, i) { return all.indexOf(v) === i; });
  }

  function qualityPref() {
    return Lampa.Storage.get('animejoy_quality', '1080p');
  }

  /* ============================ СЕТЬ ============================ */

  function request(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: url,
        method: opts.method || 'GET',
        data: opts.data,
        timeout: 20000,
        crossDomain: true,
        headers: opts.headers || {},
        xhrFields: { withCredentials: true },
        success: function (data, status, xhr) { resolve({ data: data, xhr: xhr }); },
        error: function (xhr, status) { reject(new Error('HTTP ' + (xhr && xhr.status ? xhr.status : status))); }
      });
    });
  }

  function parseMaybeJson(data) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (e) { return null; }
    }
    return data;
  }

  /* ============================ АВТОРИЗАЦИЯ (DLE) ============================ */

  function isLogged(html) {
    if (!html || typeof html !== 'string') return false;
    var g = /dle_group\s*=\s*(\d+)/.exec(html);
    if (g) return g[1] !== '5'; // 5 — гости
    return /action=logout|href="[^"]*logout/i.test(html);
  }

  function doLogin() {
    return new Promise(function (resolve, reject) {
      if (!loginVal() || !passVal()) {
        reject(new Error('Укажите логин и пароль animejoya.ru в настройках плагина (Настройки → AnimeJoy)'));
        return;
      }
      request(domain() + '/', {
        method: 'POST',
        data: { login_name: loginVal(), login_password: passVal(), login: 'submit' }
      }).then(function () {
        // после логина DLE выставляет куки; проверяем отдельным запросом
        return request(domain() + '/').then(function (res2) {
          if (isLogged(res2.data)) resolve();
          else reject(new Error('Авторизация не удалась: проверьте логин/пароль'));
        });
      }).catch(function (e) {
        reject(new Error('Ошибка авторизации: ' + e.message));
      });
    });
  }

  var authPromise = null;

  function ensureAuth() {
    if (authPromise) return authPromise;
    authPromise = request(domain() + '/').then(function (res) {
      if (isLogged(res.data)) return true;
      return doLogin().then(function () { return true; });
    }).catch(function (e) {
      authPromise = null; // при ошибке даём повторить попытку
      throw e;
    });
    return authPromise;
  }


  /* ============================ ПОИСК ТАЙТЛА ============================ */

  function normTitle(t) {
    return (t || '')
      .toLowerCase()
      .replace(/\[.*?\]/g, ' ')
      .replace(/\(.*?\)/g, ' ')
      .replace(/[^a-zа-яё0-9]+/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function seasonOf(t) {
    var m = /(\d+)\s*сезон/i.exec(t || '');
    if (m) return parseInt(m[1], 10);
    m = /тв[\s-]*(\d+)/i.exec(t || '');
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function searchSite(query) {
    var body = 'do=search&subaction=search&search_start=0&full_search=0&result_from=1&story=' + encodeURIComponent(query);
    return request(domain() + '/index.php?do=search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      data: body
    }).then(function (res) {
      return parseSearchResults(res.data);
    });
  }

  function parseSearchResults(html) {
    var results = [];
    if (!html) return results;
    var re = /<a[^>]+href="(https?:\/\/[^"]*?\/(?:[a-z-]+\/)?(\d+)-[^"]*?\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    var seen = {};
    while ((m = re.exec(html))) {
      var url = m[1];
      var id = m[2];
      var text = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || seen[id]) continue;
      seen[id] = true;
      results.push({ id: id, url: url, title: text });
    }
    return results;
  }

  function scoreResult(item, query, wantSeason) {
    var a = normTitle(item.title);
    var b = normTitle(query);
    if (!a || !b) return 0;
    var score = 0;
    if (a === b) score = 100;
    else if (a.indexOf(b) !== -1) score = Math.max(30, 70 - (a.length - b.length));
    else if (b.indexOf(a) !== -1) score = Math.max(25, 60 - (b.length - a.length));
    else {
      var wa = a.split(' '), wb = b.split(' '), hit = 0;
      wb.forEach(function (w) { if (w && wa.indexOf(w) !== -1) hit++; });
      score = Math.round(40 * hit / Math.max(wa.length, wb.length));
    }
    var s = seasonOf(item.title);
    if (wantSeason && s) score += (s === wantSeason) ? 25 : -25;
    return score;
  }

  function findTitle(movie) {
    var queries = [];
    if (movie.name) queries.push(movie.name);
    if (movie.title && movie.title !== movie.name) queries.push(movie.title);
    if (movie.original_name) queries.push(movie.original_name);
    if (movie.original_title && movie.original_title !== movie.original_name) queries.push(movie.original_title);

    var wantSeason = seasonOf(movie.name || '') || seasonOf(movie.title || '');

    var chain = Promise.resolve([]);
    queries.forEach(function (q) {
      chain = chain.then(function (found) {
        if (found && found.length) return found;
        return searchSite(q).then(function (list) {
          if (!list.length) return [];
          list.forEach(function (it) { it._score = scoreResult(it, q, wantSeason); });
          list.sort(function (x, y) { return y._score - x._score; });
          return list.filter(function (it) { return it._score >= 25; });
        });
      });
    });
    return chain;
  }

  /* ==================== СТРАНИЦА ТАЙТЛА / ПЛЕЙЛИСТ ==================== */

  function getTitleInfo(url) {
    return request(url).then(function (res) {
      var html = res.data || '';
      var id = /data-news_id="(\d+)"/.exec(html);
      var xf = /data-xfname="([^"]+)"/.exec(html);
      if (!id) throw new Error('Не удалось получить ID тайтла (возможно, нет доступа — проверьте авторизацию)');
      return { news_id: id[1], xfield: xf ? xf[1] : 'playlist' };
    });
  }

  function getPlaylist(info) {
    return request(domain() + '/engine/ajax/playlists.php?news_id=' + info.news_id + '&xfield=' + encodeURIComponent(info.xfield), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      var json = parseMaybeJson(res.data);
      if (!json || !json.success || !json.response) throw new Error('Плейлист не найден');
      return parsePlaylist(json.response);
    });
  }

  function parsePlaylist(html) {
    var out = { groups: [], players: [], videos: [] };
    var listsBlock = /<div class="playlists-lists">([\s\S]*?)<div class="playlists-iframe">/.exec(html);
    if (listsBlock) {
      var items = listsBlock[1].match(/<div class="playlists-items">[\s\S]*?<\/div>/g) || [];
      items.forEach(function (block, idx) {
        var lis = block.match(/<li[^>]*data-id="([^"]+)"[^>]*>[\s\S]*?<\/li>/g) || [];
        lis.forEach(function (li) {
          var m = /<li[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/.exec(li);
          if (!m) return;
          var name = m[2].replace(/<[^>]+>/g, '').trim();
          if (idx === 0) out.groups.push({ id: m[1], name: name });
          else if (idx === 1) out.players.push({ id: m[1], name: name });
        });
      });
    }
    var vids = html.match(/<li[^>]*data-file="([^"]+)"[^>]*data-id="([^"]+)"[^>]*>[\s\S]*?<\/li>/g) || [];
    vids.forEach(function (li) {
      var m = /<li[^>]*data-file="([^"]+)"[^>]*data-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/.exec(li);
      if (!m) return;
      out.videos.push({
        file: m[1].indexOf('//') === 0 ? 'https:' + m[1] : m[1],
        dataId: m[2],
        name: m[3].replace(/<[^>]+>/g, '').trim() || 'Видео'
      });
    });
    return out;
  }

  // определить тип плеера по имени или по ссылке
  function playerKind(name, url) {
    var s = ((name || '') + ' ' + (url || '')).toLowerCase();
    if (s.indexOf('ebd.cda.pl') !== -1 || s.indexOf('cda.pl') !== -1 || /\bcda\b/.test(s)) return 'cda';
    if (s.indexOf('allvideo') !== -1 || s.indexOf('fsst.') !== -1 || s.indexOf('incvideo') !== -1) return 'allvideo';
    if (s.indexOf('sibnet') !== -1) return 'sibnet';
    if (s.indexOf('kodik') !== -1) return 'kodik';
    return 'other';
  }


  /* ==================== ИЗВЛЕЧЕНИЕ ПРЯМЫХ ССЫЛОК ==================== */

  // ---- CDA: публичный API отдаёт все качества с прямыми mp4 ----
  function extractCda(embedUrl) {
    var m = /ebd\.cda\.pl\/\d+x\d+\/([0-9a-z]+)/i.exec(embedUrl) || /cda\.pl\/video\/([0-9a-z]+)/i.exec(embedUrl);
    if (!m) return Promise.reject(new Error('CDA: не распознан ID видео'));
    return request('https://api.cda.pl/video/' + m[1], {
      headers: { 'Accept': 'application/vnd.cda.public+json' }
    }).then(function (res) {
      var json = parseMaybeJson(res.data);
      var qs = json && json.video && json.video.qualities;
      if (!qs || !qs.length) throw new Error('CDA: нет доступных качеств');
      var quality = {};
      qs.forEach(function (q) { if (q.file) quality[q.name] = q.file; });
      return { quality: quality };
    });
  }

  // ---- AllVideo (fsst.online / incvideoN.online): file:"[360p]url,[720p]url" ----
  function extractAllVideo(embedUrl) {
    return request(embedUrl, { headers: { 'Referer': domain() + '/' } }).then(function (res) {
      var html = res.data || '';
      var m = /file:\s*"([^"]+)"/.exec(html);
      if (!m) throw new Error('AllVideo: ссылка не найдена');
      var quality = {};
      m[1].split(',').forEach(function (part) {
        var q = /\[(\d+p)\]\s*(https?:[^\s,]+)/.exec(part.trim());
        if (q) quality[q[1]] = q[2];
      });
      if (!Object.keys(quality).length) throw new Error('AllVideo: не удалось разобрать ссылки');
      return { quality: quality };
    });
  }

  // ---- Sibnet: player.src([{src: "..."}]) ----
  function extractSibnet(embedUrl) {
    return request(embedUrl, { headers: { 'Referer': domain() + '/' } }).then(function (res) {
      var html = res.data || '';
      var m = /player\.src\(\s*\[\s*\{\s*src:\s*"([^"]+)"/.exec(html) || /src:\s*"(\/v\/[^"]+\.mp4[^"]*)"/.exec(html);
      if (!m) throw new Error('Sibnet: ссылка не найдена (возможно, требуется VPN/РФ-IP)');
      var url = m[1];
      if (url.indexOf('//') === 0) url = 'https:' + url;
      else if (url.charAt(0) === '/') url = 'https://iv.sibnet.ru' + url;
      return { url: url, quality: {} };
    });
  }

  function pickQuality(quality) {
    var keys = Object.keys(quality || {});
    if (!keys.length) return null;
    var pref = qualityPref();
    var order = ['1080p', '720p', '480p', '360p'];
    if (pref !== 'auto') {
      if (quality[pref]) return quality[pref];
      // берём ближайшее не выше предпочтительного
      var idx = order.indexOf(pref);
      for (var i = idx; i < order.length; i++) if (quality[order[i]]) return quality[order[i]];
    }
    for (var j = 0; j < order.length; j++) if (quality[order[j]]) return quality[order[j]];
    return quality[keys[0]];
  }

  // Возвращает Promise -> {url, quality:{...}}
  function streamFromEntry(entry) {
    var kind = entry.kind;
    if (kind === 'cda') return extractCda(entry.file);
    if (kind === 'allvideo') return extractAllVideo(entry.file);
    if (kind === 'sibnet') return extractSibnet(entry.file);
    if (kind === 'kodik') return Promise.reject(new Error('Kodik пока не поддерживается — выберите другой плеер (CDA/AllVideo/Sibnet)'));
    return Promise.reject(new Error('Неизвестный плеер'));
  }


  /* ==================== КОМПОНЕНТ (СПИСОК СЕРИЙ) ==================== */

  var ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor"/></svg>';

  function AnimeJoyComponent(object) {
    var movie = object.movie || {};
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 200 });
    var body = $('<div class="animejoy-body"></div>');
    var html = $('<div class="animejoy"></div>');
    var last = null;

    var state = {
      titles: [],
      title: null,
      players: [],
      playerIdx: 0
    };

    this.create = function () {
      this.activity.loader(true);
      html.append(scroll.render());
      scroll.append(body);
      this.load();
      return this.render();
    };

    this.load = function () {
      var self = this;
      ensureAuth()
        .then(function () { return findTitle(movie); })
        .then(function (titles) {
          if (!titles.length) throw new Error('Тайтл «' + (movie.name || movie.title || '') + '» не найден на ' + domain());
          state.titles = titles;
          state.title = titles[0];
          return self.loadTitle();
        })
        .catch(function (e) { self.empty(e.message || String(e)); });
    };

    this.loadTitle = function () {
      var self = this;
      this.activity.loader(true);
      return getTitleInfo(state.title.url)
        .then(getPlaylist)
        .then(function (pl) {
          state.players = self.buildPlayers(pl);
          if (!state.players.length) throw new Error('В плейлисте нет серий');
          state.playerIdx = self.defaultPlayerIdx();
          self.activity.loader(false);
          self.renderList();
        })
        .catch(function (e) { self.empty(e.message || String(e)); });
    };

    // Собрать структуру: плееры -> серии
    this.buildPlayers = function (pl) {
      var byPlayer = {};
      pl.videos.forEach(function (v) {
        var parts = v.dataId.split('_');
        var pIdx = parseInt(parts[parts.length - 1], 10);
        if (!byPlayer[pIdx]) byPlayer[pIdx] = [];
        byPlayer[pIdx].push(v);
      });
      var players = [];
      Object.keys(byPlayer).forEach(function (k) {
        var pIdx = parseInt(k, 10);
        var meta = pl.players[pIdx] || { name: 'Плеер ' + (pIdx + 1) };
        var eps = byPlayer[k];
        var kind = playerKind(meta.name, eps[0] && eps[0].file);
        eps.sort(function (a, b) {
          var na = parseInt(a.name, 10), nb = parseInt(b.name, 10);
          if (isNaN(na) || isNaN(nb)) return a.name.localeCompare(b.name);
          return na - nb;
        });
        players.push({ name: meta.name, kind: kind, episodes: eps });
      });
      return players;
    };

    this.defaultPlayerIdx = function () {
      var prio = playerPriority();
      for (var i = 0; i < prio.length; i++) {
        for (var j = 0; j < state.players.length; j++) {
          if (state.players[j].kind === prio[i]) return j;
        }
      }
      return 0;
    };

    this.episodeHash = function (ep) {
      return Lampa.Utils.hash(['animejoy', state.title ? state.title.id : 0, ep.file].join('_'));
    };

    this.renderList = function () {
      var self = this;
      body.empty();
      scroll.clear();
      scroll.append(body);

      // строка: найденный тайтл (ручной выбор, если вариантов несколько)
      var titleRow = $(
        '<div class="animejoy-row selector">' +
          '<div class="animejoy-row__label">Тайтл</div>' +
          '<div class="animejoy-row__value">' + $('<div/>').text(state.title.title).html() + '</div>' +
        '</div>'
      );
      titleRow.on('hover:enter', function () { self.chooseTitle(); });
      titleRow.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
      body.append(titleRow);

      // строка: плеер
      var player = state.players[state.playerIdx];
      var unsupported = (player.kind === 'kodik' || player.kind === 'other') ? ' (не поддерживается)' : '';
      var playerRow = $(
        '<div class="animejoy-row selector">' +
          '<div class="animejoy-row__label">Плеер</div>' +
          '<div class="animejoy-row__value">' + $('<div/>').text(player.name + unsupported).html() + '</div>' +
        '</div>'
      );
      playerRow.on('hover:enter', function () { self.choosePlayer(); });
      playerRow.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
      body.append(playerRow);

      // серии
      player.episodes.forEach(function (ep, idx) {
        var hash = self.episodeHash(ep);
        var view = Lampa.Timeline.view(hash);
        var badge = '';
        if (view.percent > 0 && view.percent < 100) badge = '<div class="animejoy-item__badge">' + view.percent + '%</div>';
        else if (view.percent >= 100) badge = '<div class="animejoy-item__badge animejoy-item__badge--done">✓</div>';

        var item = $(
          '<div class="animejoy-item selector">' +
            '<div class="animejoy-item__num">' + (idx + 1) + '</div>' +
            '<div class="animejoy-item__body">' +
              '<div class="animejoy-item__title">' + $('<div/>').text(ep.name).html() + '</div>' +
              '<div class="animejoy-item__info">' + $('<div/>').text(player.name).html() + ' · субтитры</div>' +
            '</div>' + badge +
          '</div>'
        );
        item.on('hover:enter', function () { self.play(idx); });
        item.on('hover:focus', function (e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        body.append(item);
      });
    };

    this.chooseTitle = function () {
      var self = this;
      if (state.titles.length < 2) {
        Lampa.Noty.show('Других вариантов не найдено');
        return;
      }
      Lampa.Select.show({
        title: 'Выберите тайтл',
        items: state.titles.map(function (t, i) {
          return { title: t.title, selected: state.title === t, index: i };
        }),
        onSelect: function (item) {
          state.title = state.titles[item.index];
          self.loadTitle();
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    };

    this.choosePlayer = function () {
      var self = this;
      Lampa.Select.show({
        title: 'Выберите плеер',
        items: state.players.map(function (p, i) {
          var extra = (p.kind === 'kodik' || p.kind === 'other') ? ' — не поддерживается' : '';
          return { title: p.name + extra, selected: i === state.playerIdx, index: i };
        }),
        onSelect: function (item) {
          state.playerIdx = item.index;
          self.renderList();
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    };

    this.play = function (idx) {
      var self = this;
      var player = state.players[state.playerIdx];
      var eps = player.episodes;

      if (player.kind === 'kodik' || player.kind === 'other') {
        Lampa.Noty.show('Этот плеер пока не поддерживается, выберите другой');
        return;
      }

      Lampa.Loading.start(function () {
        Lampa.Loading.stop();
        Lampa.Controller.toggle('content');
      });

      var buildOne = function (i) {
        var ep = eps[i];
        return streamFromEntry({ kind: player.kind, file: ep.file }).then(function (r) {
          var url = r.url || pickQuality(r.quality);
          if (!url) throw new Error('no url');
          return {
            title: (movie.name || movie.title || state.title.title) + ' — ' + ep.name,
            url: url,
            quality: (r.quality && Object.keys(r.quality).length > 1) ? r.quality : undefined,
            timeline: Lampa.Timeline.view(self.episodeHash(ep))
          };
        }).catch(function () { return null; });
      };

      // если серий немного — собираем полный плейлист для перемотки в плеере
      var indices = [];
      if (eps.length <= 30) { for (var i = 0; i < eps.length; i++) indices.push(i); }
      else indices.push(idx);

      Promise.all(indices.map(buildOne)).then(function (items) {
        Lampa.Loading.stop();
        var playlist = items.filter(Boolean);
        var current = items[indices.indexOf(idx)];
        if (!current) {
          Lampa.Noty.show('Не удалось получить ссылку на видео');
          return;
        }
        Lampa.Player.play(current);
        if (playlist.length > 1) Lampa.Player.playlist(playlist);
      });
    };

    this.empty = function (msg) {
      this.activity.loader(false);
      body.empty();
      scroll.clear();
      scroll.append(body);
      var box = $(
        '<div class="animejoy-empty selector">' +
          '<div class="animejoy-empty__title">' + PLUGIN_TITLE + '</div>' +
          '<div class="animejoy-empty__descr">' + $('<div/>').text(msg || 'Ничего не найдено').html() + '</div>' +
          '<div class="animejoy-empty__hint">Нажмите OK, чтобы повторить</div>' +
        '</div>'
      );
      var self = this;
      box.on('hover:enter', function () { self.load(); });
      box.on('hover:focus', function (e) { last = e.target; });
      body.append(box);
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        right: function () { if (Navigator.canmove('right')) Navigator.move('right'); },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
        back: this.back
      });
      Lampa.Controller.toggle('content');
    };

    this.pause = function () {};
    this.stop = function () {};
    this.render = function () { return html; };
    this.destroy = function () {
      scroll.destroy();
      body.remove();
      html.remove();
    };
    this.back = function () { Lampa.Activity.backward(); };
  }


  /* ==================== СТИЛИ ==================== */

  function injectCss() {
    var css = [
      '.animejoy-body{padding:0 2em 2em 2em}',
      '.animejoy-row{display:flex;align-items:baseline;background:rgba(255,255,255,.06);border-radius:.4em;padding:.9em 1.2em;margin-bottom:.6em}',
      '.animejoy-row__label{opacity:.5;min-width:5em;margin-right:1em;flex-shrink:0}',
      '.animejoy-row__value{font-size:1.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.animejoy-item{display:flex;align-items:center;background:rgba(255,255,255,.06);border-radius:.4em;padding:.8em 1.2em;margin-bottom:.5em;position:relative}',
      '.animejoy-item__num{min-width:2em;text-align:center;font-size:1.4em;opacity:.55;margin-right:.8em;flex-shrink:0}',
      '.animejoy-item__body{flex-grow:1;min-width:0}',
      '.animejoy-item__title{font-size:1.15em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.animejoy-item__info{opacity:.5;font-size:.85em;margin-top:.2em}',
      '.animejoy-item__badge{margin-left:1em;background:rgba(255,255,255,.15);border-radius:.3em;padding:.15em .5em;font-size:.85em;flex-shrink:0}',
      '.animejoy-item__badge--done{background:#2e7d32}',
      '.animejoy-row.focus,.animejoy-item.focus{background:#fff;color:#000}',
      '.animejoy-row.focus .animejoy-row__label,.animejoy-item.focus .animejoy-item__info,.animejoy-item.focus .animejoy-item__num{opacity:.6}',
      '.animejoy-item.focus .animejoy-item__badge{background:rgba(0,0,0,.2)}',
      '.animejoy-item.focus .animejoy-item__badge--done{background:#2e7d32;color:#fff}',
      '.animejoy-empty{padding:2em;text-align:center;opacity:.85}',
      '.animejoy-empty__title{font-size:1.6em;margin-bottom:.5em}',
      '.animejoy-empty__descr{margin-bottom:.8em;line-height:1.4}',
      '.animejoy-empty__hint{opacity:.5;font-size:.9em}',
      '.animejoy-empty.focus{background:rgba(255,255,255,.1);border-radius:.4em}'
    ].join('\n');
    var style = document.createElement('style');
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* ==================== НАСТРОЙКИ ==================== */

  function resetAuth() { authPromise = null; }

  function initSettings() {
    if (!Lampa.SettingsApi) return;

    Lampa.SettingsApi.addComponent({
      component: 'animejoy',
      name: PLUGIN_TITLE,
      icon: ICON_SVG
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: { name: 'animejoy_domain', type: 'input', values: '', default: DEFAULT_DOMAIN, placeholder: DEFAULT_DOMAIN },
      field: { name: 'Домен / зеркало', description: 'Актуальное зеркало AnimeJoy, например ' + DEFAULT_DOMAIN },
      onChange: resetAuth
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: { name: 'animejoy_login', type: 'input', values: '', default: '', placeholder: 'Логин' },
      field: { name: 'Логин', description: 'Логин от animejoya.ru' },
      onChange: resetAuth
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: { name: 'animejoy_password', type: 'input', values: '', default: '', placeholder: 'Пароль' },
      field: { name: 'Пароль', description: 'Пароль от animejoya.ru' },
      onChange: resetAuth
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: { name: 'animejoy_auth_test', type: 'button' },
      field: { name: 'Проверить вход', description: 'Авторизоваться и проверить доступ к сайту' },
      onChange: function () {
        resetAuth();
        Lampa.Noty.show(PLUGIN_TITLE + ': авторизация...');
        ensureAuth().then(function () {
          Lampa.Noty.show(PLUGIN_TITLE + ': вход выполнен');
        }).catch(function (e) {
          Lampa.Noty.show(PLUGIN_TITLE + ': ' + (e.message || 'ошибка входа'));
        });
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: {
        name: 'animejoy_player', type: 'select', default: 'cda',
        values: { auto: 'Авто', cda: 'CDA', allvideo: 'AllVideo', sibnet: 'Sibnet' }
      },
      field: { name: 'Приоритет плеера', description: 'Какой плеер выбирать по умолчанию (Sibnet может требовать РФ-IP)' }
    });

    Lampa.SettingsApi.addParam({
      component: 'animejoy',
      param: {
        name: 'animejoy_quality', type: 'select', default: '1080p',
        values: { '1080p': '1080p', '720p': '720p', '480p': '480p', '360p': '360p', auto: 'Максимальное' }
      },
      field: { name: 'Качество видео', description: 'Предпочитаемое качество (если доступно)' }
    });
  }

  /* ==================== КНОПКА В КАРТОЧКЕ ==================== */

  function injectButton(e) {
    var render = e.object.activity.render();
    if (!render || render.find('.view--animejoy').length) return;

    var btn = $('<div class="full-start__button selector view--animejoy">' + ICON_SVG + '<span>' + PLUGIN_TITLE + '</span></div>');
    btn.on('hover:enter', function () {
      Lampa.Activity.push({
        url: '',
        component: 'animejoy_online',
        title: PLUGIN_TITLE,
        movie: e.data.movie,
        page: 1
      });
    });

    var anchor = render.find('.view--online');
    if (anchor.length) anchor.after(btn);
    else {
      var box = render.find('.full-start__buttons').first();
      if (box.length) box.append(btn);
    }
  }

  /* ==================== ИНИЦИАЛИЗАЦИЯ ==================== */

  function startPlugin() {
    injectCss();
    initSettings();
    Lampa.Component.add('animejoy_online', AnimeJoyComponent);
    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') injectButton(e);
    });
  }

  if (window.appready) startPlugin();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') startPlugin();
    });
  }

  // отладочный доступ к парсерам (используется автотестами)
  window.animejoy_debug = {
    parsePlaylist: parsePlaylist,
    parseSearchResults: parseSearchResults,
    playerKind: playerKind,
    pickQuality: pickQuality,
    normTitle: normTitle,
    seasonOf: seasonOf,
    scoreResult: scoreResult
  };

})();



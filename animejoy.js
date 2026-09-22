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
  var PLUGIN_VERSION = '1.8.0';
  var DEFAULT_DOMAIN = 'https://animejoya.ru';

  // безопасный доступ к хранилищу (совместимость со старыми сборками Lampa)
  function storageRaw(key, def) {
    var v;
    try {
      if (Lampa.Storage && typeof Lampa.Storage.get === 'function') v = Lampa.Storage.get(key, def);
      else v = localStorage.getItem(key);
    } catch (e) {
      v = def;
    }
    if (v === null || v === undefined) return def;
    return v;
  }

  function storageGet(key, def) {
    var v = storageRaw(key, def);
    return typeof v === 'string' ? v : String(v);
  }

  function storageSet(key, val) {
    try {
      if (Lampa.Storage && typeof Lampa.Storage.set === 'function') { Lampa.Storage.set(key, val); return; }
    } catch (e) {}
    try { localStorage.setItem(key, String(val)); } catch (e) {}
  }

  function storageMap(key) {
    try {
      var value = storageRaw(key, {});
      if (typeof value === 'string') value = JSON.parse(value || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (e) {
      return {};
    }
  }

  function storageSetMap(key, value) {
    try {
      if (Lampa.Storage && typeof Lampa.Storage.set === 'function') {
        Lampa.Storage.set(key, value);
        return;
      }
    } catch (e) {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function movieKey(movie) {
    var type = movie && (movie.media_type || (movie.first_air_date ? 'tv' : 'movie')) || 'media';
    var id = movie && movie.id;
    return type + '_' + (id || Lampa.Utils.hash([
      movie && (movie.original_name || movie.original_title || movie.name || movie.title) || ''
    ].join('')));
  }

  function savedTitleFor(movie) {
    return storageMap('animejoy_title_choices')[movieKey(movie)] || null;
  }

  function saveTitleFor(movie, title, manual) {
    if (!title || !title.id || !title.url) return;
    var choices = storageMap('animejoy_title_choices');
    var previous = choices[movieKey(movie)];
    choices[movieKey(movie)] = {
      id: title.id,
      url: title.url,
      title: title.title,
      manual: Boolean(manual || (previous && previous.manual && String(previous.id) === String(title.id)))
    };
    storageSetMap('animejoy_title_choices', choices);
  }

  function savedPlaybackFor(movie, titleId) {
    var saved = storageMap('animejoy_last_playback')[movieKey(movie)];
    return saved && String(saved.titleId) === String(titleId) ? saved : null;
  }

  function savePlaybackFor(movie, title, player, episode) {
    var playback = storageMap('animejoy_last_playback');
    playback[movieKey(movie)] = {
      titleId: title.id,
      title: title.title,
      url: title.url,
      playerKind: player.kind,
      episode: episode.name
    };
    storageSetMap('animejoy_last_playback', playback);
    saveTitleFor(movie, title, false);
  }

  /* ============================ НАСТРОЙКИ ============================ */

  function domain() {
    var d = (storageGet('animejoy_domain') || DEFAULT_DOMAIN).trim();
    d = d.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
    return d;
  }

  function loginVal() { return (storageGet('animejoy_login') || '').trim(); }
  function passVal()  { return (storageGet('animejoy_password') || '').trim(); }

  function playerPriority() {
    var p = storageGet('animejoy_player', 'cda');
    var all = [p, 'cda', 'allvideo', 'kodik', 'mail', 'sibnet'];
    return all.filter(function (v, i) { return all.indexOf(v) === i; });
  }

  function qualityPref() {
    return storageGet('animejoy_quality', '1080p');
  }

  /* ============================ СЕТЬ ============================ */

  function proxyPrefix() { return (storageGet('animejoy_proxy') || '').trim(); }

  function wrapUrl(url) {
    var p = proxyPrefix();
    if (!p) return url;
    return p + encodeURIComponent(url);
  }

  function request(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: wrapUrl(url),
        method: opts.method || 'GET',
        data: opts.data,
        timeout: 20000,
        crossDomain: true,
        headers: opts.headers || {},
        xhrFields: { withCredentials: true },
        success: function (data, status, xhr) { resolve({ data: data, xhr: xhr }); },
        error: function (xhr, status) {
          var code = xhr && xhr.status;
          var msg;
          if (!code) msg = 'Сетевая ошибка (CORS или нет соединения). В браузере на lampa.mx задайте CORS-прокси в настройках плагина; в приложении Lampa на ТВ прокси не нужен';
          else msg = 'HTTP ' + code;
          reject(new Error(msg));
        }
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

  // AnimeJoy часто пишет названия латинскими двойниками кириллицы (Pacxититeль),
  // поэтому приводим похожие латинские буквы к кириллице
  var HOMOGLYPHS = {
    a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к',
    m: 'м', t: 'т', h: 'н', b: 'в', g: 'г', n: 'п', u: 'и', s: 'ѕ'
  };

  function homoglyph(t) {
    return String(t || '').replace(/[aceopxykmthbgnus]/g, function (ch) { return HOMOGLYPHS[ch] || ch; });
  }

  function normTitle(t) {
    return homoglyph(String(t || '').toLowerCase())
      .replace(/\[.*?\]/g, ' ')
      .replace(/\(.*?\)/g, ' ')
      .replace(/[^a-zа-яё0-9]+/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var CYR_TO_LAT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'yu', я: 'ya', ѕ: 's'
  };

  // Дополнительная форма для карточек с латинским названием (Naruto) при
  // кириллической выдаче AnimeJoy (Наруто). Для смешанных названий сначала
  // исправляем латинские двойники букв.
  function romanTitle(t) {
    var raw = String(t || '').toLowerCase()
      .replace(/\[.*?\]/g, ' ')
      .replace(/\(.*?\)/g, ' ')
      .replace(/ナルト/g, ' naruto ')
      .replace(/疾風伝/g, ' shippuden ');
    if (/[а-яё]/i.test(raw)) raw = homoglyph(raw);
    return raw.replace(/[а-яёѕ]/g, function (ch) { return CYR_TO_LAT[ch] || ch; })
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleForms(t) {
    var forms = [normTitle(t), romanTitle(t)];
    var source = String(t || '').toLowerCase();
    if ((/疾風伝|shippu+den/.test(source)) && (/ナルト|naruto/.test(source))) {
      forms.push('naruto uragannye hroniki');
    }
    return forms.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  function exactTitle(a, b) {
    var af = titleForms(a);
    var bf = titleForms(b);
    return af.some(function (x) { return bf.indexOf(x) !== -1; });
  }

  // производные запросы: без первого слова и по хвосту названия
  // («Великий расхититель гробниц» -> «расхититель гробниц»)
  function derivedQueries(title) {
    var out = [];
    var clean = String(title || '').replace(/[\(\[].*?[\)\]]/g, ' ').replace(/\s+/g, ' ').trim();
    var words = clean.split(' ').filter(Boolean);
    if (words.length > 1) out.push(words.slice(1).join(' '));
    if (words.length > 2) out.push(words.slice(-2).join(' '));
    if (words.length > 3) out.push(words.slice(-3).join(' '));
    return out;
  }


  function seasonOf(t) {
    var m = /(\d+)\s*сезон/i.exec(t || '');
    if (m) return parseInt(m[1], 10);
    m = /тв[\s-]*(\d+)/i.exec(t || '');
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function searchSitePage(query, page) {
    // В DLE первая страница имеет search_start=0, следующие — 2, 3, ...
    // result_from — порядковый номер первого результата на странице.
    var searchStart = page === 1 ? 0 : page;
    var resultFrom = (page - 1) * 10 + 1;
    var body = 'do=search&subaction=search&search_start=' + searchStart +
      '&full_search=0&result_from=' + resultFrom + '&story=' + encodeURIComponent(query);
    return request(domain() + '/index.php?do=search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      data: body
    }).then(function (res) {
      return parseSearchResults(res.data);
    });
  }

  function searchSite(query) {
    var all = [];
    var seen = {};
    var page = 1;
    var maxPages = 6;

    function next() {
      return searchSitePage(query, page).then(function (list) {
        var added = 0;
        list.forEach(function (item) {
          if (seen[item.id]) return;
          seen[item.id] = true;
          all.push(item);
          added++;
        });

        // Некоторые сборки DLE игнорируют неверную пагинацию и снова отдают
        // первую страницу. Остановка по отсутствию новых ID защищает от цикла.
        if (!list.length || !added || page >= maxPages) return all;
        page++;
        return next();
      });
    }

    return next();
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
      if (/\/news\//.test(url)) continue; // новости — не тайтлы
      seen[id] = true;
      results.push({ id: id, url: url, title: text });
    }
    return results;
  }

  function scoreResult(item, query, wantSeason) {
    function scorePair(a, b) {
      if (!a || !b) return 0;
      var pairScore = 0;
      if (a === b) pairScore = 100;
      else if (a.indexOf(b) !== -1) pairScore = Math.max(30, 70 - (a.length - b.length));
      else if (b.indexOf(a) !== -1) pairScore = Math.max(25, 60 - (b.length - a.length));
      else {
        var wa = a.split(' '), wb = b.split(' '), hit = 0;
        wb.forEach(function (w) { if (w && wa.indexOf(w) !== -1) hit++; });
        var coverage = wb.length ? hit / wb.length : 0;
        pairScore = Math.round(80 * coverage) - (wa.length - wb.length > 6 ? 5 : 0);
      }
      return pairScore;
    }

    var itemForms = titleForms(item.title);
    var queryForms = titleForms(query);
    var score = 0;
    itemForms.forEach(function (a) {
      queryForms.forEach(function (b) { score = Math.max(score, scorePair(a, b)); });
    });
    if (!itemForms.length || !queryForms.length) return 0;
    var s = seasonOf(item.title);
    if (wantSeason && s) score += (s === wantSeason) ? 25 : -25;

    // Отдельные «части» длинных сериалов не должны вытеснять основную запись.
    // Если пользователь сам искал конкретную часть, штраф не применяется.
    var partPattern = /(?:^|[\s:—-])част[ьи]\s*\d+(?:\s|$)/i;
    if (partPattern.test(item.title) && !partPattern.test(query)) score -= 30;

    // Завершённая полная запись полезнее обрезанных и ещё выходящих вариантов.
    // Бонус намеренно небольшой: близость названия остаётся главным сигналом.
    var episodes = episodeProgress(item.title);
    if (episodes.complete) score += Math.min(12, Math.round(Math.log(episodes.total + 1) * 2));
    return score;
  }

  function episodeProgress(title) {
    var m = /\[\s*(\d+)\s+из\s+(\d+)\s*\]/i.exec(title || '');
    if (!m) return { current: 0, total: 0, complete: false };
    var current = parseInt(m[1], 10) || 0;
    var total = parseInt(m[2], 10) || 0;
    return { current: current, total: total, complete: total > 0 && current === total };
  }

  function rankSearchResults(list, query, wantSeason, wantEpisodes) {
    return (list || []).map(function (item) {
      item._score = scoreResult(item, query, wantSeason);
      item._exact = exactTitle(item.title, query);
      var progress = episodeProgress(item.title);
      item._episodeMatch = Boolean(wantEpisodes && progress.total === wantEpisodes);
      if (item._episodeMatch) item._score += 60;
      return item;
    }).sort(function (x, y) {
      // Полное совпадение всегда выше продолжений, OVA и фильмов — независимо
      // от порядка, в котором DLE вернул результаты.
      if (x._exact !== y._exact) return x._exact ? -1 : 1;
      if (x._episodeMatch !== y._episodeMatch) return x._episodeMatch ? -1 : 1;
      if (y._score !== x._score) return y._score - x._score;
      var xe = episodeProgress(x.title);
      var ye = episodeProgress(y.title);
      if (ye.complete !== xe.complete) return ye.complete ? 1 : -1;
      return ye.total - xe.total;
    });
  }

  // Альтернативные названия через Shikimori (russian / romaji / синонимы)
  function shikimoriQueries(movie) {
    var q = movie.original_name || movie.original_title || movie.name || movie.title || '';
    if (!q) return Promise.resolve([]);

    return request('https://shikimori.one/api/animes?limit=5&search=' + encodeURIComponent(q))
      .then(function (res) {
        var list = parseMaybeJson(res.data);
        if (!list || !list.length) return [];

        // выбираем самого близкого по году (если он есть в карточке)
        var year = parseInt((movie.release_date || movie.first_air_date || '').slice(0, 4), 10) || 0;
        if (year) {
          list.sort(function (x, y) {
            var dx = Math.abs((parseInt((x.aired_on || '').slice(0, 4), 10) || 0) - year);
            var dy = Math.abs((parseInt((y.aired_on || '').slice(0, 4), 10) || 0) - year);
            return dx - dy;
          });
        }

        var best = list[0];
        return request('https://shikimori.one/api/animes/' + best.id)
          .then(function (dres) {
            var d = parseMaybeJson(dres.data) || {};
            var out = [d.russian, d.name, d.english].concat(Array.isArray(d.synonyms) ? d.synonyms : []);
            return out.filter(Boolean);
          })
          .catch(function () {
            return [best.russian, best.name].filter(Boolean);
          });
      })
      .catch(function () { return []; });
  }


  function findTitle(movie) {
    var names = [movie.name, movie.title, movie.original_name, movie.original_title]
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });

    var wantSeason = seasonOf(movie.name || '') || seasonOf(movie.title || '');
    var wantEpisodes = parseInt(movie.number_of_episodes, 10) || 0;

    var queryList = [];
    names.forEach(function (n) {
      queryList.push(n);
      derivedQueries(n).forEach(function (d) { queryList.push(d); });
    });
    queryList = queryList.filter(function (v, i, a) { return v && a.indexOf(v) === i; });

    var fallback = []; // результаты без уверенного совпадения — предложим вручную

    function searchWith(query) {
      return searchSite(query).then(function (list) {
        if (!list.length) return [];
        rankSearchResults(list, query, wantSeason, wantEpisodes);
        var good = list.filter(function (it) { return it._score >= 25; });
        if (!good.length && !fallback.length) fallback = list.slice(0, 5);
        return good;
      }).catch(function () { return []; });
    }

    function searchSequence(queries) {
      var chain = Promise.resolve([]);
      (queries || []).forEach(function (q) {
        chain = chain.then(function (found) {
          if (found && found.length) return found;
          return searchWith(q);
        });
      });
      return chain;
    }

    return searchSequence(queryList)
      .then(function (found) {
        if (found.length) return found;
        // не нашли по названию карточки — пробуем синонимы из Shikimori
        return shikimoriQueries(movie).then(function (alt) {
          var altList = [];
          alt.forEach(function (n) {
            altList.push(n);
            derivedQueries(n).forEach(function (d) { altList.push(d); });
          });
          return searchSequence(altList.filter(function (v, i, a) { return v && a.indexOf(v) === i; }));
        });
      })
      .then(function (found) {
        return found.length ? found : fallback;
      });
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
    if (s.indexOf('my.mail.ru') !== -1 || /(?:^|\s)mail(?:\s|$)/.test(s) || s.indexOf('наш плеер') !== -1) return 'mail';
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

  // ---- «Наш плеер» AnimeJoy (Mail.ru): публичный meta API -> mp4 ----
  function extractMail(embedUrl) {
    var m = /my\.mail\.ru\/video\/embed\/(\d+)/i.exec(embedUrl || '');
    if (!m) return Promise.reject(new Error('Наш плеер: не распознан ID видео'));
    return request('https://my.mail.ru/+/video/meta/' + m[1], {
      headers: { 'Referer': embedUrl }
    }).then(function (res) {
      var json = parseMaybeJson(res.data);
      var videos = json && json.videos;
      if (!videos || !videos.length) throw new Error('Наш плеер: потоки не найдены');
      var quality = {};
      videos.forEach(function (video) {
        if (!video.url) return;
        var url = video.url.indexOf('//') === 0 ? 'https:' + video.url : video.url;
        var key = String(video.key || '').replace(/p$/i, '') + 'p';
        quality[key] = url;
      });
      if (!Object.keys(quality).length) throw new Error('Наш плеер: ссылки не найдены');
      return { quality: quality };
    });
  }

  // ---- Kodik: страница сериала -> ID серий -> /ftor -> HLS ----
  function attrValue(tag, name) {
    var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\\\']([^"\\\']*)["\\\']', 'i');
    var m = re.exec(tag || '');
    return m ? m[1] : '';
  }

  function kodikOrigin(url) {
    var m = /^(https?:\/\/[^/]+)/i.exec(url || '');
    return m ? m[1] : 'https://kodikplayer.com';
  }

  function parseKodikPage(html, embedUrl, endpoint) {
    html = String(html || '');
    var paramsMatch = /var\s+urlParams\s*=\s*'([^']+)'/i.exec(html);
    var params = {};
    if (paramsMatch) {
      try { params = JSON.parse(paramsMatch[1]); } catch (e) {}
    }
    if (!params.d_sign || !params.pd_sign || !params.ref_sign) {
      throw new Error('Kodik: не удалось получить параметры сессии');
    }

    var episodes = [];
    var seen = {};
    var sourceAt = html.search(/class=["'][^"']*series-options/i);
    var source = sourceAt >= 0 ? html.slice(sourceAt) : html;
    var tokenRe = /<div[^>]+class=["'][^"']*season-(\d+)[^"']*["'][^>]*>|<option\b[^>]*>/gi;
    var token;
    var season = 0;
    while ((token = tokenRe.exec(source))) {
      if (token[1]) {
        season = parseInt(token[1], 10) || 0;
        continue;
      }
      var tag = token[0];
      var id = attrValue(tag, 'data-id');
      var hash = attrValue(tag, 'data-hash');
      if (!id || !hash || seen[id]) continue;
      seen[id] = true;
      episodes.push({
        id: id,
        hash: hash,
        season: season,
        name: attrValue(tag, 'data-title') || ('Серия ' + (episodes.length + 1))
      });
    }

    // Фильмы и некоторые старые embed не содержат списка серий.
    if (!episodes.length) {
      var idMatch = /vInfo\.id\s*=\s*['"](\d+)['"]/i.exec(html);
      var hashMatch = /vInfo\.hash\s*=\s*['"]([^'"]+)['"]/i.exec(html);
      if (idMatch && hashMatch) {
        episodes.push({ id: idMatch[1], hash: hashMatch[1], season: 0, name: 'Видео' });
      }
    }
    if (!episodes.length) throw new Error('Kodik: список серий не найден');

    var seasons = {};
    episodes.forEach(function (ep) { if (ep.season) seasons[ep.season] = true; });
    var manySeasons = Object.keys(seasons).length > 1;
    var origin = kodikOrigin(embedUrl);
    var context = {
      endpoint: /^https?:\/\//i.test(endpoint || '') ? endpoint : origin + (endpoint || '/ftor'),
      params: params,
      referer: embedUrl
    };

    return episodes.map(function (ep) {
      return {
        file: origin + '/seria/' + ep.id + '/' + ep.hash + '/720p',
        name: (manySeasons ? ('Сезон ' + ep.season + ' · ') : '') + ep.name,
        kodikId: ep.id,
        kodikHash: ep.hash,
        kodikContext: context
      };
    });
  }

  var kodikEndpointCache = {};

  function discoverKodikEndpoint(html, embedUrl) {
    var script = /<script[^>]+src=["']([^"']*\/assets\/js\/app\.(?:serial|video)[^"']+\.js)["']/i.exec(html || '');
    if (!script) return Promise.resolve('/ftor');
    var scriptUrl = script[1];
    if (scriptUrl.indexOf('//') === 0) scriptUrl = 'https:' + scriptUrl;
    else if (scriptUrl.charAt(0) === '/') scriptUrl = kodikOrigin(embedUrl) + scriptUrl;
    if (kodikEndpointCache[scriptUrl]) return kodikEndpointCache[scriptUrl];

    kodikEndpointCache[scriptUrl] = request(scriptUrl).then(function (res) {
      var match = /url\s*:\s*atob\(["']([^"']+)["']\)/i.exec(String(res.data || ''));
      if (!match) return '/ftor';
      try { return window.atob(match[1]) || '/ftor'; } catch (e) { return '/ftor'; }
    }).catch(function () { return '/ftor'; });
    return kodikEndpointCache[scriptUrl];
  }

  function hydrateKodikPlayer(player) {
    var embedUrl = player.episodes[0] && player.episodes[0].file;
    if (!embedUrl) return Promise.resolve(player);
    return request(embedUrl).then(function (res) {
      var html = String(res.data || '');
      return discoverKodikEndpoint(html, embedUrl).then(function (endpoint) {
        player.episodes = parseKodikPage(html, embedUrl, endpoint);
        player.supported = true;
        return player;
      });
    }).catch(function (e) {
      player.supported = false;
      player.loadError = e.message || 'не удалось загрузить серии';
      return player;
    });
  }

  function hydrateKodikPlayers(players) {
    return Promise.all((players || []).map(function (player) {
      return player.kind === 'kodik' ? hydrateKodikPlayer(player) : Promise.resolve(player);
    }));
  }

  function decodeKodikSource(source) {
    var shifted = String(source || '').replace(/[a-zA-Z]/g, function (ch) {
      var code = ch.charCodeAt(0) + 18;
      var max = ch <= 'Z' ? 90 : 122;
      return String.fromCharCode(code <= max ? code : code - 26);
    });
    try { return window.atob(shifted); } catch (e) { return ''; }
  }

  function extractKodik(entry) {
    var context = entry.kodikContext;
    if (!context || !entry.kodikId || !entry.kodikHash) {
      return Promise.reject(new Error('Kodik: данные серии не найдены'));
    }
    var data = {};
    Object.keys(context.params || {}).forEach(function (key) { data[key] = context.params[key]; });
    data.type = 'seria';
    data.id = entry.kodikId;
    data.hash = entry.kodikHash;
    data.bad_user = false;
    data.cdn_is_working = true;

    function load() {
      return request(context.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        data: data
      }).then(function (res) {
        var parsed = parseMaybeJson(res.data);
        if (!parsed || (!parsed.links && !parsed.link)) throw new Error('Kodik: пустой ответ');
        return parsed;
      });
    }

    function withRetry() {
      return load().catch(function () {
        // Kodik иногда ограничивает частые обращения к /ftor.
        return new Promise(function (resolve) { setTimeout(resolve, 900); }).then(load);
      });
    }

    return withRetry().then(function (json) {
      var quality = {};
      Object.keys(json.links || {}).forEach(function (key) {
        var sources = json.links[key] || [];
        if (!sources.length || !sources[0].src) return;
        var src = sources[0].src;
        if (src.indexOf('//') !== 0 && !/^https?:\/\//i.test(src)) src = decodeKodikSource(src);
        if (src.indexOf('//') === 0) src = 'https:' + src;
        if (src) quality[String(key).replace(/p$/i, '') + 'p'] = src;
      });
      var direct = json.link || '';
      if (direct.indexOf('//') === 0) direct = 'https:' + direct;
      if (!Object.keys(quality).length && !direct) throw new Error('Kodik: ссылки на видео не найдены');
      return { url: direct || null, quality: quality };
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
    if (kind === 'kodik') return extractKodik(entry);
    if (kind === 'mail') return extractMail(entry.file);
    return Promise.reject(new Error('Неизвестный плеер'));
  }


/* ==================== КОМПОНЕНТ (СПИСОК СЕРИЙ) ==================== */

  var ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor"/></svg>';

  // элементы в стиле встроенного «Онлайн» (стили ядра Lampa)
  try {
    Lampa.Template.add('animejoy_item', '<div class="online selector">' +
      '<div class="online__body">' +
        '<div style="position: absolute;left: 0;top: -0.3em;width: 2.4em;height: 2.4em">' + ICON_SVG.replace('<svg ', '<svg style="height: 2.4em; width: 2.4em;" ') + '</div>' +
        '<div class="online__title" style="padding-left: 2.1em;">{title}</div>' +
        '<div class="online__quality" style="padding-left: 3.4em;">{quality}</div>' +
      '</div>' +
    '</div>');

    Lampa.Template.add('animejoy_row', '<div class="online selector">' +
      '<div class="online__body">' +
        '<div class="online__title">{title}</div>' +
        '<div class="online__quality">{quality}</div>' +
      '</div>' +
    '</div>');
  } catch (e) { console.log('AnimeJoy', 'template error:', e.message); }

  var KIND_NAMES = { cda: 'CDA', allvideo: 'AllVideo', sibnet: 'Sibnet', kodik: 'Kodik', mail: 'Наш плеер (Mail.ru)' };

  // Группировка плейлиста в список плееров.
  // data-id у animejoy: у группы "0_0", у видео "0_0_1" (последний сегмент — плеер),
  // у плеера в списке — тот же id, что и у видео.
  function buildPlayersFromPlaylist(pl) {
    var groups = pl.groups || [];
    var playersMeta = pl.players || [];
    // В старых длинных сериалах первый уровень содержит сразу источники
    // (Sibnet/Mail/Kodik), а следующий — диапазоны серий 1-10, 11-20...
    var sourceMeta = groups.concat(playersMeta).filter(function (item) {
      return playerKind(item.name, '') !== 'other';
    });
    var translationGroups = groups.filter(function (item) {
      return playerKind(item.name, '') === 'other';
    });

    function groupOf(dataId) {
      var found = null;
      var id = String(dataId || '');
      translationGroups.forEach(function (g) {
        var gid = String(g.id || '');
        if (!gid) return;
        if (id === gid || id.indexOf(gid + '_') === 0) {
          if (!found || gid.length > String(found.id).length) found = g;
        }
      });
      return found;
    }

    function sourceOf(dataId) {
      var id = String(dataId || '');
      var found = null;
      sourceMeta.forEach(function (p) {
        var pid = String(p.id || '');
        if (id === pid || id.indexOf(pid + '_') === 0) {
          if (!found || pid.length > String(found.id).length) found = p;
        }
      });
      return found;
    }

    var byKey = {};
    var order = [];
    (pl.videos || []).forEach(function (v) {
      var source = sourceOf(v.dataId);
      var key = source ? ('source:' + source.id) : String(v.dataId || '');
      if (!byKey[key]) {
        byKey[key] = { eps: [], sample: v, meta: source || {} };
        order.push(key);
      }
      byKey[key].eps.push(v);
    });

    var players = [];
    order.forEach(function (key) {
      var bucket = byKey[key];
      var eps = bucket.eps;
      var meta = bucket.meta;
      var kind = playerKind(meta.name, eps[0] && eps[0].file);
      var name = KIND_NAMES[kind] || meta.name || ('Плеер ' + (order.indexOf(key) + 1));
      var group = groupOf(bucket.sample.dataId);
      if (group && translationGroups.length > 1) name = group.name + ' · ' + name;

      eps.sort(function (a, b) {
        var na = parseInt(a.name, 10), nb = parseInt(b.name, 10);
        if (isNaN(na) || isNaN(nb)) return String(a.name).localeCompare(String(b.name));
        return na - nb;
      });

      players.push({
        name: name,
        kind: kind,
        episodes: eps,
        supported: kind !== 'other'
      });
    });

    // поддерживаемые — вперёд (ничего не выбрасываем)
    players.sort(function (a, b) { return (b.supported ? 1 : 0) - (a.supported ? 1 : 0); });

    console.log('AnimeJoy', 'players:', players.map(function (p) { return p.name + '(' + p.kind + ')'; }).join(', '));

    return players;
  }

  function AnimeJoyComponent(object) {
    var movie = object.movie || {};
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Files(object);
    var last = null;

    var state = {
      titles: [],
      title: null,
      players: [],
      playerIdx: 0
    };

    scroll.body().addClass('torrent-list');

    function minus() {
      scroll.minus(window.innerWidth > 580 ? false : files.render().find('.files__left'));
    }
    window.addEventListener('resize', minus, false);
    minus();

    this.create = function () {
      this.activity.loader(true);
      files.append(scroll.render());
      this.load();
      return this.render();
    };

    this.load = function () {
      var self = this;
      var savedTitle = savedTitleFor(movie);
      ensureAuth()
        .then(function () { return findTitle(movie); })
        .then(function (titles) {
          if (savedTitle && (savedTitle.manual || !titles.length)) {
            titles = titles.filter(function (title) { return String(title.id) !== String(savedTitle.id); });
            titles.unshift(savedTitle);
          }
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
          return hydrateKodikPlayers(self.buildPlayers(pl));
        })
        .then(function (players) {
          state.players = players;
          if (!state.players.length) throw new Error('В плейлисте нет серий');
          state.playerIdx = self.defaultPlayerIdx();
          var saved = savedPlaybackFor(movie, state.title.id);
          if (saved && saved.playerKind) {
            for (var i = 0; i < state.players.length; i++) {
              if (state.players[i].kind === saved.playerKind && state.players[i].supported) {
                state.playerIdx = i;
                break;
              }
            }
          }
          self.renderList();
          self.activity.loader(false);
          self.activity.toggle();
        })
        .catch(function (e) { self.empty(e.message || String(e)); });
    };

    // Собрать структуру: плееры -> серии
    this.buildPlayers = function (pl) {
      return buildPlayersFromPlaylist(pl);
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
      // Прогресс должен быть общим для одной серии при переключении плеера,
      // поэтому ссылка CDN (разная у CDA/Kodik/Sibnet) в хеш не входит.
      return Lampa.Utils.hash([
        'animejoy',
        state.title ? state.title.id : 0,
        String(ep.name || '').toLowerCase().replace(/\s+/g, ' ').trim()
      ].join('_'));
    };

    this.appendItem = function (item) {
      item.on('hover:focus', function (e) {
        last = e.target;
        scroll.update($(e.target), true);
      });
      scroll.append(item);
    };

    this.resumeEpisodeIndex = function (player) {
      var episodes = player.episodes || [];
      var saved = savedPlaybackFor(movie, state.title.id);
      var index = -1;

      if (saved && saved.episode) {
        for (var i = 0; i < episodes.length; i++) {
          if (String(episodes[i].name) === String(saved.episode)) {
            index = i;
            break;
          }
        }
      }

      // Если локальная запись выбора отсутствует, восстанавливаемся по Timeline.
      if (index < 0) {
        for (var j = 0; j < episodes.length; j++) {
          var progress = Lampa.Timeline.view(this.episodeHash(episodes[j]));
          if (progress.percent > 0) index = j;
        }
      }

      if (index >= 0) {
        var current = Lampa.Timeline.view(this.episodeHash(episodes[index]));
        if (current.percent >= 90 && index + 1 < episodes.length) index++;
      }
      return index;
    };

this.renderList = function () {
      var self = this;
      var player = state.players[state.playerIdx];
      var unsupported = !player.supported ? ' — ' + (player.loadError || 'не поддерживается') : '';
      var resumeIndex = self.resumeEpisodeIndex(player);
      var resumeItem = null;

      scroll.render().find('.empty').remove();
      scroll.clear();
      last = null;

      // строка: выбор тайтла
      var titleRow = $(Lampa.Template.get('animejoy_row', {
        title: 'Тайтл',
        quality: state.title.title
      }));
      titleRow.on('hover:enter', function () { self.chooseTitle(); });
      self.appendItem(titleRow);

      // строка: выбор плеера
      var playerRow = $(Lampa.Template.get('animejoy_row', {
        title: 'Плеер',
        quality: player.name + unsupported
      }));
      playerRow.on('hover:enter', function () { self.choosePlayer(); });
      self.appendItem(playerRow);

      // строка: ручной поиск (если название на сайте отличается)
      var searchRow = $(Lampa.Template.get('animejoy_row', {
        title: 'Поиск вручную',
        quality: 'Введите название, как оно на animejoy'
      }));
      searchRow.on('hover:enter', function () { self.searchManual(); });
      self.appendItem(searchRow);

      // серии
      player.episodes.forEach(function (ep, idx) {
        var item = $(Lampa.Template.get('animejoy_item', {
          title: ep.name,
          quality: player.name + ' · субтитры'
        }));

        var view = Lampa.Timeline.view(self.episodeHash(ep));
        item.append(Lampa.Timeline.render(view));

        item.on('hover:enter', function () { self.play(idx); });
        self.appendItem(item);
        if (idx === resumeIndex) {
          resumeItem = item;
          last = item[0];
        }
      });
      if (resumeItem) scroll.update(resumeItem, true);
    };

    this.searchManual = function () {
      var self = this;
      var current = state.title ? state.title.title.replace(/\s*\[[^\]]*\]\s*$/, '') : '';

      var run = function (query) {
        if (!query || !query.trim()) return;
        query = query.trim();
        self.activity.loader(true);
        searchSite(query).then(function (list) {
          self.activity.loader(false);
          if (!list.length) {
            Lampa.Noty.show('По запросу «' + query + '» ничего не найдено');
            return;
          }
          rankSearchResults(list, query, 0);
          state.titles = list;
          state.title = list[0];
          saveTitleFor(movie, state.title, true);
          self.loadTitle();
        }).catch(function (e) {
          self.activity.loader(false);
          Lampa.Noty.show('Ошибка поиска: ' + (e.message || ''));
        });
      };

      if (Lampa.Input && Lampa.Input.edit) {
        Lampa.Input.edit({ free: true, nosave: true, value: current, title: 'Поиск на ' + domain() }, function (value) {
          Lampa.Controller.toggle('content');
          run(value);
        });
      } else {
        Lampa.Noty.show('Ручной поиск недоступен в этой версии Lampa');
      }
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
          saveTitleFor(movie, state.title, true);
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
          var extra = !p.supported ? ' — ' + (p.loadError || 'не поддерживается') : '';
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

      if (!player.supported) {
        Lampa.Noty.show(player.loadError || 'Этот плеер не поддерживается');
        return;
      }

      Lampa.Loading.start(function () {
        Lampa.Loading.stop();
        Lampa.Controller.toggle('content');
      });

      var buildOne = function (i) {
        var ep = eps[i];
        return streamFromEntry({
          kind: player.kind,
          file: ep.file,
          kodikId: ep.kodikId,
          kodikHash: ep.kodikHash,
          kodikContext: ep.kodikContext
        }).then(function (r) {
          var url = r.url || pickQuality(r.quality);
          if (!url) throw new Error('no url');
          return {
            title: (movie.name || movie.title || state.title.title) + ' — ' + ep.name,
            url: url,
            quality: (r.quality && Object.keys(r.quality).length > 1) ? r.quality : undefined,
            timeline: Lampa.Timeline.view(self.episodeHash(ep))
          };
        }).catch(function (e) {
          if (!self._lastPlayError) self._lastPlayError = e;
          return null;
        });
      };

      // если серий немного — собираем полный плейлист для перемотки в плеере
      var indices = [];
      // Kodik ограничивает параллельные запросы к резолверу, поэтому для него
      // выбранную и следующую серии загружаем последовательно.
      if (player.kind !== 'kodik' && eps.length <= 30) { for (var i = 0; i < eps.length; i++) indices.push(i); }
      else {
        indices.push(idx);
        if (player.kind === 'kodik' && idx + 1 < eps.length) indices.push(idx + 1);
      }

      self._lastPlayError = null;
      var itemsPromise;
      if (player.kind === 'kodik') {
        itemsPromise = Promise.resolve([]);
        indices.forEach(function (episodeIndex) {
          itemsPromise = itemsPromise.then(function (items) {
            return buildOne(episodeIndex).then(function (item) {
              items.push(item);
              return items;
            });
          });
        });
      } else {
        itemsPromise = Promise.all(indices.map(buildOne));
      }

      itemsPromise.then(function (items) {
        Lampa.Loading.stop();
        var playlist = items.filter(Boolean);
        var current = items[indices.indexOf(idx)];
        if (!current) {
          Lampa.Noty.show(self._lastPlayError ? self._lastPlayError.message : 'Не удалось получить ссылку на видео');
          return;
        }
        // Timeline сохраняет позицию серии, а Favorite.history отвечает за
        // появление самой карточки в разделах «История» / «Продолжить».
        try {
          if (Lampa.Favorite && typeof Lampa.Favorite.add === 'function' && movie && movie.id) {
            Lampa.Favorite.add('history', movie, 100);
          }
        } catch (e) {
          console.log('AnimeJoy', 'history error:', e.message);
        }
        savePlaybackFor(movie, state.title, player, eps[idx]);
        Lampa.Player.play(current);
        if (playlist.length > 1) Lampa.Player.playlist(playlist);
      });
    };

    this.empty = function (msg) {
      this.activity.loader(false);
      scroll.clear();
      var empty;
      try {
        empty = Lampa.Template.get('list_empty');
        if (msg) empty.find('.empty__descr').text(msg);
      } catch (e) {
        empty = $('<div class="empty selector"><div class="empty__title">' + PLUGIN_TITLE + '</div><div class="empty__descr"></div><div class="empty__descr" style="opacity:.5">Нажмите OK, чтобы повторить</div></div>');
        if (msg) empty.find('.empty__descr').first().text(msg);
        var self = this;
        empty.on('hover:enter', function () { self.load(); });
      }
      scroll.append(empty);
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;

      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
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
        down: function () { Navigator.move('down'); },
        back: this.back
      });

      Lampa.Controller.toggle('content');
    };

    this.render = function () { return files.render(); };
    this.pause = function () {};
    this.stop = function () {};
    this.back = function () { Lampa.Activity.backward(); };
    this.destroy = function () {
      scroll.destroy();
      files.destroy();
      window.removeEventListener('resize', minus);
    };
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
    if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addComponent !== 'function') return;

    function safeParam(data) {
      try { Lampa.SettingsApi.addParam(data); } catch (e) { console.log('AnimeJoy', 'addParam failed:', e.message); }
    }

    try {
      Lampa.SettingsApi.addComponent({
        component: 'animejoy',
        name: PLUGIN_TITLE + ' ' + PLUGIN_VERSION,
        icon: ICON_SVG
      });
    } catch (e) { console.log('AnimeJoy', 'addComponent failed:', e.message); return; }

    safeParam({
      component: 'animejoy',
      param: { name: 'animejoy_domain', type: 'input', values: '', default: DEFAULT_DOMAIN, placeholder: DEFAULT_DOMAIN },
      field: { name: 'Домен / зеркало', description: 'Актуальное зеркало AnimeJoy, например ' + DEFAULT_DOMAIN },
      onChange: resetAuth
    });

    safeParam({
      component: 'animejoy',
      param: { name: 'animejoy_login', type: 'input', values: '', default: '', placeholder: 'Логин' },
      field: { name: 'Логин', description: 'Логин от animejoya.ru' },
      onChange: resetAuth
    });

    safeParam({
      component: 'animejoy',
      param: { name: 'animejoy_password', type: 'input', values: '', default: '', placeholder: 'Пароль' },
      field: { name: 'Пароль', description: 'Пароль от animejoya.ru' },
      onChange: resetAuth
    });

    safeParam({
      component: 'animejoy',
      param: { name: 'animejoy_proxy', type: 'input', values: '', default: '', placeholder: 'https://corsproxy.io/?url=' },
      field: { name: 'CORS-прокси', description: 'Нужен только в браузере (lampa.mx). Пример: https://corsproxy.io/?url=  В приложении на ТВ оставьте пустым' }
    });

    safeParam({
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

    safeParam({
      component: 'animejoy',
      param: {
        name: 'animejoy_player', type: 'select', default: 'cda',
        values: { auto: 'Авто', cda: 'CDA', allvideo: 'AllVideo', kodik: 'Kodik', mail: 'Наш плеер (Mail.ru)', sibnet: 'Sibnet' }
      },
      field: { name: 'Приоритет плеера', description: 'Какой плеер выбирать по умолчанию (Sibnet может требовать РФ-IP)' }
    });

    safeParam({
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
    try {
      var render = e.object.activity.render();
      if (!render || !render.length || render.find('.view--animejoy').length) return;
      if (!e.data || !e.data.movie) return;

      var movieData = $.extend ? $.extend({}, e.data.movie) : e.data.movie;
      if (!movieData.number_of_episodes && e.data.episodes) {
        var episodeList = e.data.episodes.episodes_original || e.data.episodes.episodes || [];
        if (episodeList.length) movieData.number_of_episodes = episodeList.length;
      }

      var btn = $('<div class="full-start__button selector view--animejoy" data-subtitle="Субтитры с animejoya.ru">' + ICON_SVG + '<span>' + PLUGIN_TITLE + '</span></div>');
      btn.on('hover:enter', function () {
        Lampa.Activity.push({
          url: '',
          component: 'animejoy_online',
          title: PLUGIN_TITLE,
          movie: movieData,
          page: 1
        });
      });

      // разные версии интерфейса: главное — попасть в .buttons--container,
      // откуда кнопка «Смотреть» собирает список источников (как у онлайн-мода)
      var torrent = render.find('.view--torrent').first();
      if (torrent.length) {
        torrent.after(btn);
      } else {
        var container = render.find('.buttons--container').first();
        if (container.length) {
          var more = container.find('.view--trailer').first();
          if (more.length) more.after(btn);
          else container.append(btn);
        } else {
          var anchor = render.find('.view--online').first();
          if (anchor.length) anchor.after(btn);
          else {
            var box = render.find('.full-start__buttons').first();
            if (box.length) box.append(btn);
            else render.append(btn);
          }
        }
      }
      console.log('AnimeJoy', 'button injected');
    } catch (err) {
      console.log('AnimeJoy', 'injectButton error:', err.message);
    }
  }

  /* ==================== ИНИЦИАЛИЗАЦИЯ ==================== */

  function startPlugin() {
    try { injectCss(); } catch (e) { console.log('AnimeJoy', 'css error:', e.message); }
    try { initSettings(); } catch (e) { console.log('AnimeJoy', 'settings error:', e.message); }
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
    playerPriority: playerPriority,
    pickQuality: pickQuality,
    normTitle: normTitle,
    romanTitle: romanTitle,
    exactTitle: exactTitle,
    savedTitleFor: savedTitleFor,
    saveTitleFor: saveTitleFor,
    savedPlaybackFor: savedPlaybackFor,
    savePlaybackFor: savePlaybackFor,
    homoglyph: homoglyph,
    derivedQueries: derivedQueries,
    seasonOf: seasonOf,
    scoreResult: scoreResult,
    episodeProgress: episodeProgress,
    rankSearchResults: rankSearchResults,
    parseKodikPage: parseKodikPage,
    decodeKodikSource: decodeKodikSource,
    buildPlayersFromPlaylist: buildPlayersFromPlaylist
  };

})();



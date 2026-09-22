// Тесты парсеров плагина animejoy.js на реальных данных, снятых с сайта
const fs = require('fs');
const path = require('path');

// работаем и из корня проекта, и из папки tests/
const pluginPath = fs.existsSync(path.join(__dirname, 'animejoy.js'))
  ? path.join(__dirname, 'animejoy.js')
  : path.join(__dirname, '..', 'animejoy.js');

function fixture(name) {
  const candidates = [
    path.join(__dirname, 'fixtures', name),
    path.join(__dirname, '..', 'fixtures', name),
    path.join(__dirname, '..', 'tests', 'fixtures', name),
    path.join(__dirname, '..', name)
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('fixture not found: ' + name);
}

// --- Стабы окружения Lampa ---
global.window = {
  atob: value => Buffer.from(value, 'base64').toString('binary')
};
global.Navigator = { canmove: () => false, move: () => {} };
global.document = {
  createElement: () => ({ appendChild: () => {}, type: '' }),
  head: { appendChild: () => {} }
};
const storageMemory = {};
global.Lampa = {
  Storage: {
    get: (k, d) => Object.prototype.hasOwnProperty.call(storageMemory, k) ? storageMemory[k] : d,
    set: (k, v) => { storageMemory[k] = v; }
  },
  Utils: { hash: value => String(value).split('').reduce((n, ch) => ((n * 31) + ch.charCodeAt(0)) | 0, 0) },
  Listener: { follow: () => {} },
  Component: { add: () => {} },
  SettingsApi: null
};
global.$ = {};

require(pluginPath);

const dbg = global.window.animejoy_debug;
if (!dbg) { console.error('FAIL: animejoy_debug не экспортирован'); process.exit(1); }

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

// ---------- 1. Парсинг плейлиста (реальный ответ playlists.php) ----------
console.log('== parsePlaylist ==');
const plJson = JSON.parse(fs.readFileSync(fixture('playlists.json'), 'utf8'));
const pl = dbg.parsePlaylist(plJson.response);

check('группа AL найдена', pl.groups.length === 1 && pl.groups[0].name === 'AL');
check('4 плеера (Kodik/Sibnet/AllVideo/CDA)', pl.players.length === 4);
check('плеер Sibnet определён', pl.players.some(p => p.name === 'Sibnet'));
check('серий всего = 40 (1 kodik + 13*3)', pl.videos.length === 40);

const sibnetEps = pl.videos.filter(v => v.dataId.endsWith('_1'));
check('Sibnet: 13 серий', sibnetEps.length === 13);
check('Sibnet: первая серия ссылка', sibnetEps[0] && sibnetEps[0].file.includes('iv.sibnet.ru/shell.php?videoid=4570576'));
check('Sibnet: название «1 серия»', sibnetEps[0] && sibnetEps[0].name === '1 серия');

const kodik = pl.videos.find(v => v.dataId === '0_0_0');
check('Kodik: протокол дополнен (// -> https:)', kodik && kodik.file.startsWith('https://kodikplayer.com'));

const cdaEps = pl.videos.filter(v => v.dataId.endsWith('_3'));
check('CDA: 13 серий', cdaEps.length === 13);

// ---------- 2. playerKind ----------
console.log('== playerKind ==');
check('Kodik по имени', dbg.playerKind('Kodik', 'https://kodikplayer.com/x') === 'kodik');
check('CDA по ссылке', dbg.playerKind('CDA', 'https://ebd.cda.pl/620x395/962595098') === 'cda');
check('AllVideo по fsst', dbg.playerKind('AllVideo', 'https://fsst.online/embed/751041/') === 'allvideo');
check('Sibnet', dbg.playerKind('Sibnet', 'https://iv.sibnet.ru/shell.php?videoid=1') === 'sibnet');
check('Mail.ru определяется отдельно', dbg.playerKind('Mail', 'https://my.mail.ru/video/embed/1') === 'mail');
check('собственный источник определяется как «Наш плеер»',
  dbg.playerKind('Наш плеер', 'https://animejoya.ru/player/playerjs.html?file=x') === 'animejoy');
check('автоприоритет начинается с собственного плеера',
  dbg.playerPriority().join(',') === 'animejoy,allvideo,kodik,sibnet,mail,cda');

// ---------- 3. AllVideo: реальный embed (incvideo) ----------
console.log('== AllVideo regex (реальный incvideo.html) ==');
const inc = fs.readFileSync(fixture('incvideo.html'), 'utf8');
const fm = /file:\s*"([^"]+)"/.exec(inc);
check('file: найден', !!fm);
const q = {};
if (fm) fm[1].split(',').forEach(p => {
  const mm = /\[(\d+p)\]\s*(https?:[^\s,]+)/.exec(p.trim());
  if (mm) q[mm[1]] = mm[2];
});
check('есть 360p и 720p', !!q['360p'] && !!q['720p']);
check('720p — mp4', q['720p'] && q['720p'].includes('.mp4'));

// ---------- 4. CDA API (реальный cda_api.json) ----------
console.log('== CDA API ==');
const cda = JSON.parse(fs.readFileSync(fixture('cda_api.json'), 'utf8'));
const cq = {};
(cda.video.qualities || []).forEach(x => { if (x.file) cq[x.name] = x.file; });
check('4 качества', Object.keys(cq).length === 4);
check('1080p это прямой mp4', cq['1080p'] && /^https:\/\/.+\.mp4$/.test(cq['1080p']));

// ---------- 5. pickQuality ----------
console.log('== pickQuality ==');
const qq = { '360p': 'a', '480p': 'b', '720p': 'c', '1080p': 'd' };
check('дефолт 1080p', dbg.pickQuality(qq) === 'd');
check('fallback на максимум', dbg.pickQuality({ '360p': 'a' }) === 'a');
check('пусто -> null', dbg.pickQuality({}) === null);

// ---------- 6. Поиск: синтетическая выдача DLE ----------
console.log('== parseSearchResults ==');
const searchHtml = `
<div class="shortstory">
  <a href="https://animejoya.ru/tv-serialy/2625-genjitsu-shugi-yuusha-no-oukoku-saikenki-2nd-season.html" class="title">Герой-рационал перестраивает королевство (2 сезон) [13 из 13]</a>
</div>
<div class="shortstory">
  <a href="https://animejoya.ru/tv-serialy/2525-genjitsu-shugi-yuusha-no-oukoku-saikenki.html">Герой-рационал перестраивает королевство [13 из 13]</a>
</div>
<a href="https://animejoya.ru/">Главная</a>`;
const res = dbg.parseSearchResults(searchHtml);
check('найдено 2 тайтла (главная отфильтрована)', res.length === 2);
check('id первого = 2625', res[0] && res[0].id === '2625');
check('url содержит категорию', res[0] && res[0].url.includes('/tv-serialy/'));

// ---------- 7. Скоринг и сезон ----------
console.log('== scoreResult / seasonOf ==');
check('seasonOf "(2 сезон)" = 2', dbg.seasonOf('Герой-рационал (2 сезон) [13 из 13]') === 2);
check('seasonOf "[ТВ-3]" = 3', dbg.seasonOf('Атака титанов [ТВ-3]') === 3);
const s2 = dbg.scoreResult({ title: 'Герой-рационал перестраивает королевство (2 сезон) [13 из 13]' }, 'Герой-рационал перестраивает королевство', 2);
const s1 = dbg.scoreResult({ title: 'Герой-рационал перестраивает королевство [13 из 13]' }, 'Герой-рационал перестраивает королевство', 2);
check('2-й сезон выигрывает у 1-го при поиске 2-го сезона', s2 > s1);

// ---------- 8. Группировка плееров ----------
console.log('== buildPlayersFromPlaylist ==');
const bp = dbg.buildPlayersFromPlaylist(pl);
check('4 плеера в реальном плейлисте (ничего не теряется)', bp.length === 4);
check('все известные плееры помечены поддерживаемыми', bp.every(p => p.supported === true));
check('Kodik доступен для последующей загрузки серий', bp.some(p => p.kind === 'kodik' && p.supported === true));
check('имена плееров осмысленные (CDA/Sibnet/AllVideo/Kodik)', bp.every(p => /^(CDA|Sibnet|AllVideo|Kodik)$/.test(p.name)));
const cdaPlayer = bp.find(p => p.kind === 'cda');
check('CDA: 13 серий и первая = «1 серия»', cdaPlayer && cdaPlayer.episodes.length === 13 && cdaPlayer.episodes[0].name === '1 серия');

// синтетика: две фансаб-группы
const multi = dbg.buildPlayersFromPlaylist({
  groups: [{ id: '0', name: 'AL' }, { id: '1', name: 'AniLibria' }],
  players: [{ id: '0_0_0', name: 'Kodik' }, { id: '0_0_1', name: 'Sibnet' }],
  videos: [
    { file: 'https://iv.sibnet.ru/shell.php?videoid=1', dataId: '0_0_1', name: '1 серия' },
    { file: 'https://iv.sibnet.ru/shell.php?videoid=2', dataId: '1_0_1', name: '1 серия' },
    { file: 'https://kodikplayer.com/serial/1/hash/720p', dataId: '0_0_0', name: '-' }
  ]
});
check('две группы -> отдельные плееры с префиксом группы', multi.length === 3 &&
  multi.some(p => p.name === 'AL · Sibnet') && multi.some(p => p.name === 'AniLibria · Sibnet'));
check('в мультигруппе Kodik не выброшен', multi.some(p => p.kind === 'kodik'));

// синтетика: dataId без разделителей не роняет парсер
const single = dbg.buildPlayersFromPlaylist({
  groups: [{ id: '0', name: 'AL' }],
  players: [{ id: 'x', name: 'AllVideo' }],
  videos: [{ file: 'https://fsst.online/embed/1/', dataId: '0', name: 'Фильм' }]
});
check('одиночный dataId -> один плеер с серией', single.length === 1 && single[0].episodes.length === 1);

// старые длинные сериалы: первый уровень — источники, второй — диапазоны серий
const nestedPlayers = dbg.buildPlayersFromPlaylist({
  groups: [
    { id: '0_0', name: 'Sibnet' },
    { id: '0_1', name: 'Mail' },
    { id: '0_2', name: 'Kodik' }
  ],
  players: [
    { id: '0_0_0', name: '1-10' },
    { id: '0_0_1', name: '11-20' }
  ],
  videos: [
    { file: 'https://iv.sibnet.ru/shell.php?videoid=1', dataId: '0_0_0', name: '1' },
    { file: 'https://iv.sibnet.ru/shell.php?videoid=2', dataId: '0_0_1', name: '11' },
    { file: 'https://my.mail.ru/video/embed/1', dataId: '0_1_0', name: '1' },
    { file: 'https://my.mail.ru/video/embed/2', dataId: '0_1_1', name: '11' },
    { file: 'https://kodikplayer.com/serial/1/hash/720p', dataId: '0_2', name: '-' }
  ]
});
check('диапазоны старого сериала объединяются по источнику', nestedPlayers.length === 3);
check('Sibnet: серии из разных диапазонов объединены', nestedPlayers.find(p => p.kind === 'sibnet').episodes.length === 2);
check('Mail.ru: серии объединены и поддерживаются', nestedPlayers.some(p => p.kind === 'mail' && p.supported && p.episodes.length === 2));

const ownFiles = dbg.parseAnimeJoyFiles(
  'https://animejoya.ru/player/playerjs.html?skip=10-20&file=' +
  encodeURIComponent('[1080p]https://storage.example/a-1080.mp4,[720p]https://cdn.example/a-720.mp4')
);
check('«Наш плеер»: извлечены отдельные 1080p и 720p', ownFiles['1080p'] && ownFiles['720p']);

// ---------- 9. Расхождение названий (латинские двойники + лишние слова) ----------
console.log('== названия TMDB vs animejoy ==');
const homoglyphTitle = 'Pacxититeль гpoбниц [11 из 12]';
check('латинские двойники нормализуются', dbg.normTitle(homoglyphTitle).indexOf('расхититель гробниц') !== -1);
check('derivedQueries: без первого слова', dbg.derivedQueries('Великий расхититель гробниц').indexOf('расхититель гробниц') !== -1);
check('derivedQueries: последние 2 слова', dbg.derivedQueries('Великий расхититель гробниц').indexOf('расхититель гробниц') !== -1);

const scoreHomoglyph = dbg.scoreResult({ title: homoglyphTitle }, 'Великий расхититель гробниц', 0);
check('найденный тайтл проходит порог (>=25) даже с лишним словом', scoreHomoglyph >= 25);
const scoreExact = dbg.scoreResult({ title: homoglyphTitle }, 'расхититель гробниц', 0);
check('точный производный запрос даёт высокий балл', scoreExact >= 50);
check('постороннее аниме не проходит порог', dbg.scoreResult({ title: 'Ван-Пис (1101+) [1179 из ХХ] One Piece' }, 'Великий расхититель гробниц', 0) < 25);

// ---------- 10. Длинные сериалы: полная запись выше отдельных частей ----------
console.log('== ранжирование полных сериалов ==');
const shippuden = dbg.rankSearchResults([
  { id: '5', title: 'Наруто: Ураганные хроники 5 — Кровавая тюрьма' },
  { id: '6', title: 'Наруто: Ураганные хроники 6 — Путь ниндзя' },
  { id: 'movie', title: 'Наруто: Ураганные хроники — Фильм [1 из 1]' },
  { id: 'main', title: 'Наруто: Ураганные хроники [500 из 500]' }
], 'Наруто: Ураганные хроники', 0);
check('Shippuden: полные 500 серий идут первыми', shippuden[0] && shippuden[0].id === 'main');
check('Shippuden: отдельная часть получает штраф', dbg.scoreResult(
  { title: 'Наруто: Ураганные хроники часть 5' },
  'Наруто: Ураганные хроники',
  0
) <= 40);

const naruto = dbg.rankSearchResults([
  { id: 'ova', title: 'Наруто OVA [9 из 9]' },
  { id: 'shippuden', title: 'Наруто: Ураганные хроники [500 из 500]' },
  { id: 'main', title: 'Наруто [220 из 220]' }
], 'Наруто', 0);
check('Naruto: оригинальные 220 серий идут первыми', naruto[0] && naruto[0].id === 'main');

const narutoLatin = dbg.rankSearchResults([
  { id: 'boruto', title: 'Боруто: Новое поколение Наруто [293 из 293]' },
  { id: 'movie', title: 'Наруто: Последний фильм' },
  { id: 'shippuden', title: 'Наруто: Ураганные хроники [500 из 500]' },
  { id: 'main', title: 'Наруто [220 из 220]' }
], 'Naruto', 0);
check('Naruto латиницей совпадает с «Наруто»', dbg.exactTitle('Наруто [220 из 220]', 'Naruto'));
check('Naruto латиницей: 220 серий выше Boruto', narutoLatin[0] && narutoLatin[0].id === 'main');
check('кириллица транслитерируется стабильно', dbg.romanTitle('Наруто: Ураганные хроники') === 'naruto uragannye hroniki');

const narutoJapanese = dbg.rankSearchResults([
  { id: 'boruto', title: 'Боруто: Новое поколение Наруто [293 из 293]' },
  { id: 'main', title: 'Наруто [220 из 220]' }
], 'ナルト', 0, 220);
check('число серий карточки помогает при японском названии', narutoJapanese[0] && narutoJapanese[0].id === 'main');
check('японское Shippuden совпадает с «Ураганными хрониками»',
  dbg.exactTitle('Наруто: Ураганные хроники [500 из 500]', 'NARUTO -ナルト- 疾風伝'));

const complete = dbg.episodeProgress('Наруто [220 из 220]');
const ongoing = dbg.episodeProgress('Боруто [280 из 300]');
check('полный счётчик серий распознан', complete.complete && complete.total === 220);
check('незавершённый счётчик не считается полным', !ongoing.complete && ongoing.total === 300);

// ---------- 11. Kodik: список серий и декодирование потоков ----------
console.log('== Kodik ==');
const kodikHtml = `
<script>
  var urlParams = '{"d":"kodikplayer.com","d_sign":"ds","pd":"kodikplayer.com","pd_sign":"pds","ref":"","ref_sign":"rs"}';
</script>
<div class="series-options">
  <div class="season-1">
    <option value="1" data-id="101" data-hash="hash101" data-title="1 серия">1 серия</option>
    <option value="2" data-id="102" data-hash="hash102" data-title="2 серия">2 серия</option>
  </div>
  <div class="season-2">
    <option value="1" data-id="201" data-hash="hash201" data-title="1 серия">1 серия</option>
  </div>
</div>`;
const kodikEpisodes = dbg.parseKodikPage(
  kodikHtml,
  'https://kodikplayer.com/serial/10/serialhash/720p',
  '/ftor'
);
check('Kodik: разобраны серии всех сезонов', kodikEpisodes.length === 3);
check('Kodik: сезоны различимы в названии', kodikEpisodes[2].name === 'Сезон 2 · 1 серия');
check('Kodik: серия содержит ID и hash', kodikEpisodes[0].kodikId === '101' && kodikEpisodes[0].kodikHash === 'hash101');
check('Kodik: endpoint приведён к абсолютному URL', kodikEpisodes[0].kodikContext.endpoint === 'https://kodikplayer.com/ftor');

function encodeKodikSource(value) {
  return Buffer.from(value).toString('base64').replace(/[a-zA-Z]/g, ch => {
    let code = ch.charCodeAt(0) - 18;
    const min = ch <= 'Z' ? 65 : 97;
    if (code < min) code += 26;
    return String.fromCharCode(code);
  });
}
const hls = 'https://cloud.kodik-storage.com/video/720.mp4:hls:manifest.m3u8';
check('Kodik: зашифрованный HLS декодируется', dbg.decodeKodikSource(encodeKodikSource(hls)) === hls);

// ---------- 12. Сохранение выбранного тайтла и серии ----------
console.log('== сохранение выбора ==');
const movieCard = { id: 46260, media_type: 'tv', name: 'Наруто' };
const selectedTitle = { id: '3249', url: 'https://animejoya.ru/tv-serialy/3249-naruto.html', title: 'Наруто [220 из 220]' };
dbg.saveTitleFor(movieCard, selectedTitle, true);
check('ручной тайтл читается из объектного Lampa.Storage',
  dbg.savedTitleFor(movieCard).id === '3249' && dbg.savedTitleFor(movieCard).manual === true);
dbg.savePlaybackFor(movieCard, selectedTitle, { kind: 'kodik' }, { name: '37 серия' });
const savedPlayback = dbg.savedPlaybackFor(movieCard, '3249');
check('последняя серия и плеер сохраняются', savedPlayback.episode === '37 серия' && savedPlayback.playerKind === 'kodik');

console.log('\nИтого: ' + passed + ' OK, ' + failed + ' FAIL');
process.exit(failed ? 1 : 0);

// Pin an existing, tested browser package version.  DuckDB's native/CLI
// versioning is independent from the npm package version.
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm';
import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';

let datasetUrl = new URL('./data/water-objects.parquet', window.location.href).href;
let dumpDate = '2026-09-24';
const TABLE = 'water_objects';
const ROW_HEIGHT = 38;
const VISIBLE_ROWS = 120;
const STORAGE_PREFIX = 'lakes-names:';
const QUERY_STORAGE_KEY = `${STORAGE_PREFIX}query`;
const DEFAULT_BOUNDS = [
  [-179.98762718593395, 41.221523435604816],
  [179.98308310354122, 81.16125090717857],
];

function allDataQuery() {
  return `-- natural=water + name, отобранные из дампа OpenStreetMap России от ${dumpDate}.

SELECT * FROM water_objects;

-- Всё работает полностью в браузере благодаря DuckDB. Данные обновляются раз в сутки.
-- Исходный код и данные в формате Parquet: https://github.com/deevroman/lakes-names

-- Не стесняйтесь исправлять кривые теги! (https://github.com/Zverik/osmtags-editor в помощь)
-- И участвуйте в обсуждении соглашения о названиях на форуме: https://c.osm.org/t/148024/18

-- А ниже примеры интересных запросов
`;
}

const queries = {
  all: allDataQuery(),
  lake: `-- Для разминки несколько простых запросов чтобы вспомнить SQL
-- Найдём все водоёмы с тегом water = lake

SELECT * FROM water_objects WHERE water = 'lake';`,
  'salty-ponds': `-- Солёные пруды

SELECT * EXCLUDE (tags_json)
FROM water_objects
WHERE water = 'pond'
  AND salt = 'yes';`,
  wikidata: `-- Объекты с тегом wikidata

SELECT * EXCLUDE (tags_json)
FROM water_objects
WHERE wikidata IS NOT NULL;`,
  'water-values': `-- Дальше запросы просто для вдохновения

-- Какие бывают значения тега water (помним, что в данных только водоёмы с названиями)

SELECT
  COALESCE(water, '(без тега)') AS water,
  COUNT(*) AS uses
FROM water_objects
GROUP BY water
ORDER BY uses DESC, water;`,
  'name-length': `-- Топ самых длинных названий водоёмов

SELECT
  name,
  length(name) AS name_length,
  osm_type,
  osm_id,
  longitude,
  latitude
FROM water_objects
ORDER BY name_length DESC, name;`,
  'name-whitespace': `-- Пробелы по краям и повторяющиеся пробелы

WITH checked AS (
  SELECT
    *,
    regexp_matches(name, '(^[[:space:]])|([[:space:]]$)') AS has_edge_space,
    regexp_matches(name, '[[:space:]]{2,}') AS has_repeated_space
  FROM water_objects
)
SELECT * EXCLUDE (intermittent, salt, tags_json)
FROM checked
WHERE has_edge_space
   OR has_repeated_space
ORDER BY name;`,
  'name-symbols': `-- Нерусские буквы, цифры без букв и спецсимволы (кроме дефиса)

WITH checked AS (
  SELECT
    *,
    regexp_matches(regexp_replace(name, '[^\\p{L}]', '', 'g'), '[^А-Яа-яЁё]') AS has_non_russian_letter,
    (regexp_matches(name, '[0-9]') AND NOT regexp_matches(name, '\\p{L}')) AS has_digit_without_letter,
    regexp_matches(name, '[^\\p{L}0-9[:space:]-]') AS has_special_symbol
  FROM water_objects
)
SELECT * EXCLUDE (intermittent, salt, tags_json)
FROM checked
WHERE has_non_russian_letter
   OR has_digit_without_letter
   OR has_special_symbol
ORDER BY name;`,
  forms: `-- Попробуем разложить названия у water=lake по группам. Названия без кириллицы пропускаем.
WITH classified AS (
  SELECT
    name,
    CASE
    WHEN regexp_matches(name, '(?i)оз[её]ра') THEN '01. Множественное число: «озёра»'
    WHEN regexp_matches(name, '(?i)озеро\\s+.+\\s+озеро') THEN '02. Озеро Большое озеро'
    WHEN regexp_matches(name, '(?i)^.+\\s+озеро$') THEN '03. Заканчивается на « озеро»'
    WHEN regexp_matches(name, '(?i)^\\S+$') AND regexp_matches(name, '(?i)ярви') THEN '04. Одно слово с финским «ярви»'
    WHEN regexp_matches(name, '(?i)^\\S+$') AND regexp_matches(name, '(?i)(күл|көл|кӱл|күөл|кюел|нуур|нур|нор|холь|сор|гӀуьр|вир|даггар)') THEN '05. Одно слово со словом озеро на других языках'
    WHEN regexp_matches(name, '(?i)^\\S+$') AND regexp_matches(name, '(?i)озеро') THEN '06. Название из одного слова с «озеро» внутри'
    WHEN regexp_matches(name, '(?i)^озеро\\s+') THEN '07. Начинается на «озеро»'
    WHEN regexp_matches(name, '(?i)^\\S+ое$') THEN '08. Одно слово с окончанием на «-ое»'
    WHEN regexp_matches(name, '(?i)^\\S+$') THEN '09. Одно слово'
    ELSE '10. другой вид'
  END AS form
  FROM water_objects
  WHERE water = 'lake'
    AND regexp_matches(name, '[А-Яа-яЁё]')
)
SELECT
  form,
  list_slice(list(DISTINCT name ORDER BY name), 1, 1000) AS names,
  COUNT(*) AS uses
FROM classified
GROUP BY form
ORDER BY form;`,
  plural: `-- Бывает и множественное число

SELECT * EXCLUDE (tags_json)
FROM water_objects
WHERE regexp_matches(name, '(?i)оз[её]ра')
ORDER BY name;`,
  ozerki: `-- не только озеро и озёра

SELECT * EXCLUDE (tags_json)
FROM water_objects
WHERE regexp_matches(name, '(?i)оз[её]р[^ао]')
ORDER BY name;`,
  nonLakeNamed: `-- Перед тем как узнать в каком формате названия у озёр
-- узнаем, а много ли озёр не имеют тега water=lake

SELECT * EXCLUDE (tags_json)
FROM water_objects
WHERE (water IS NULL or water != 'lake')
 and regexp_matches(name, '(?i)(оз[её]р|ярви)')
ORDER BY water, name;`,
  popularity: `-- Самые популярные названия водоёмов
  
SELECT
  name,
  COUNT(*) AS uses
FROM water_objects
GROUP BY name
ORDER BY uses DESC, name;

-- Это плохой топ, который не учитывает варианты названий
-- Исправим это в следующем запросе

`,
  normalized: `-- Приведём к нижнему регистру, уберём тип водоёма и подчистим пробелы

WITH normalized AS (
  SELECT
    name,
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(name), '(?i)(^|\\s)оз[её]р[оа](\\s|$)', ' ', 'g'),
          '(?i)(^|\\s)пруд(\\s|$)', ' ', 'g'
        ),
        '(?i)(^|\\s)(водохранилище|старица)(\\s|$)', ' ', 'g'
      ),
      '\\s+', ' ', 'g'
    )) AS name_without_ozero
  FROM water_objects
)
SELECT
  name_without_ozero,
  list(DISTINCT name ORDER BY name) AS names,
  COUNT(*) AS uses
FROM normalized
WHERE name_without_ozero <> ''
GROUP BY name_without_ozero
ORDER BY uses DESC, name_without_ozero;`,
  tags: `-- Сырые теги объектов тоже сохранены, но с ними чуть неприятнее работать
SELECT
  osm_type,
  osm_id,
  name,
  name_en,
  json_extract_string(tags_json, '$.loc_name') AS loc_name,
  json_extract_string(tags_json, '$."name:tt"') AS tag_name_tt,
  longitude,
  latitude,
  tags_json
FROM water_objects
WHERE json_extract_string(tags_json, '$.loc_name') IS NOT NULL
   OR json_extract_string(tags_json, '$."name:tt"') IS NOT NULL
ORDER BY name;`,
};

const $ = (selector) => document.querySelector(selector);
const runButton = $('#run-query');
const queryBox = $('#query');
const resultMeta = $('#result-meta');
const tableWrap = $('#table-wrap');
const error = $('#error');
const imageryToggle = $('#imagery-toggle');
const shareButton = $('#share-query');
const queryEditor = window.CodeMirror?.fromTextArea(queryBox, {
  mode: 'text/x-sql',
  lineNumbers: false,
  lineWrapping: true,
  extraKeys: {
    'Ctrl-Enter': () => runQuery(),
    'Cmd-Enter': () => runQuery(),
  },
});
if (queryEditor && 'ResizeObserver' in window) {
  new ResizeObserver(() => queryEditor.refresh()).observe(queryEditor.getWrapperElement());
}

let connection;
let resultView;
let mapSelectionTimer;
let mapRows = [];
let hasUserQuery = false;
let isSettingQueryText = false;

function setActiveExample(queryKey) {
  document.querySelectorAll('[data-query]').forEach((button) => {
    const active = button.dataset.query === queryKey;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  bounds: DEFAULT_BOUNDS,
  fitBoundsOptions: { padding: 28 },
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

function setBaseMap(showImagery) {
  if (!map.loaded()) {
    map.once('load', () => setBaseMap(imageryToggle.checked));
    return;
  }

  if (!showImagery) {
    map.setLayoutProperty('osm', 'visibility', 'visible');
    if (map.getLayer('esri-imagery')) map.removeLayer('esri-imagery');
    if (map.getSource('esri-imagery')) map.removeSource('esri-imagery');
    return;
  }

  if (!map.getSource('esri-imagery')) {
    map.addSource('esri-imagery', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    });
    map.addLayer(
      { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
      map.getLayer('query-points') ? 'query-points' : undefined,
    );
  }
  map.setLayoutProperty('osm', 'visibility', 'none');
}

function updateMap(rows, fitToPoints = true) {
  mapRows = rows;
  const points = rows.flatMap((row, rowIndex) => {
    const coordinates = coordinatesFor(row);
    return coordinates ? [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { rowIndex } }] : [];
  });
  const data = { type: 'FeatureCollection', features: points };

  const setPoints = () => {
    const source = map.getSource('query-points');
    if (source) {
      source.setData(data);
    } else {
      map.addSource('query-points', { type: 'geojson', data });
      map.addLayer({
        id: 'query-points',
        type: 'circle',
        source: 'query-points',
        paint: {
          'circle-radius': 3,
          'circle-color': '#111111',
          'circle-opacity': 1,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', 'query-points', (event) => {
        const rowIndex = Number(event.features?.[0]?.properties?.rowIndex);
        const row = mapRows[rowIndex];
        if (!Number.isInteger(rowIndex) || !resultView || !row) return;
        new maplibregl.Popup({ closeButton: false, offset: 8 })
          .setLngLat(event.lngLat)
          .setDOMContent(mapPopupContent(row))
          .addTo(map);
        resultView.scroller.scrollTop = Math.max(0, (rowIndex - 1) * ROW_HEIGHT);
        resultView.renderSlice();
        clearTimeout(mapSelectionTimer);
        mapSelectionTimer = setTimeout(() => {
          const row = resultView?.scroller.querySelector(`tr[data-row-index="${rowIndex}"]`);
          if (!row) return;
          row.classList.remove('map-selected');
          void row.offsetWidth;
          row.classList.add('map-selected');
          row.querySelector('a')?.focus({ preventScroll: true });
        }, 80);
      });
      map.on('mouseenter', 'query-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'query-points', () => { map.getCanvas().style.cursor = ''; });
    }

    if (fitToPoints && points.length) {
      const bounds = new maplibregl.LngLatBounds(points[0].geometry.coordinates, points[0].geometry.coordinates);
      points.slice(1).forEach((point) => bounds.extend(point.geometry.coordinates));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 28, maxZoom: 11, duration: 0 });
    }
  };

  if (map.loaded()) setPoints();
  else map.once('load', setPoints);
}

function resizeQueryBox() {
  // Автоматическое увеличение временно отключено: доступна ручная ресайзилка.
}

function queryText() {
  return queryEditor ? queryEditor.getValue() : queryBox.value;
}

function persistQuery(value = queryText()) {
  try {
    window.localStorage.setItem(QUERY_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function setQueryText(value, save = true) {
  isSettingQueryText = true;
  if (queryEditor) queryEditor.setValue(value);
  else queryBox.value = value;
  isSettingQueryText = false;
  if (save) {
    hasUserQuery = true;
    persistQuery(value);
  }
  resizeQueryBox();
}

function restoreQueryText() {
  const parameters = new URL(window.location.href).searchParams;
  let value = parameters.has('q') ? parameters.get('q') : null;
  if (value === null) {
    try {
      value = window.localStorage.getItem(QUERY_STORAGE_KEY);
    } catch {
      value = null;
    }
  }
  if (value !== null) setQueryText(value);
}

async function shareQuery() {
  const url = new URL(window.location.href);
  url.searchParams.set('q', queryText());
  window.history.replaceState(null, '', url);
  const label = shareButton.getAttribute('aria-label');
  let status;
  try {
    await navigator.clipboard.writeText(url.href);
    status = 'Скопировано';
  } catch {
    status = 'Ссылка в адресной строке';
  }
  shareButton.setAttribute('aria-label', status);
  shareButton.title = status;
  shareButton.dataset.status = status;
  window.setTimeout(() => {
    shareButton.setAttribute('aria-label', label);
    shareButton.title = label;
    delete shareButton.dataset.status;
  }, 1600);
}

async function loadDatasetMetadata() {
  try {
    const response = await fetch(new URL('./data/dataset.json', window.location.href), { cache: 'no-store' });
    if (!response.ok) return;
    const metadata = await response.json();
    if (typeof metadata.parquet === 'string' && /^water-objects(?:-\d{4}-\d{2}-\d{2})?\.parquet$/.test(metadata.parquet)) {
      datasetUrl = new URL(`./data/${metadata.parquet}`, window.location.href).href;
    }
    if (typeof metadata.dump_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.dump_date)) {
      dumpDate = metadata.dump_date;
    }
    queries.all = allDataQuery();
  } catch {
    // The checked-in baseline remains usable if the metadata request fails.
  }
}

function sqlError(reason) {
  const message = String(reason?.message || reason).replace(/^Error:\s*/i, '');
  error.hidden = false;
  error.textContent = message;
}

function printable(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('ru-RU') : value.toFixed(6);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderTable(arrowTable) {
  const originalRows = arrowTable.toArray();
  let rows = originalRows;
  const columns = arrowTable.schema.fields.map((field) => field.name);
  resultMeta.textContent = `${rows.length.toLocaleString('ru-RU')} строк`;
  updateMap(rows);
  resultView = undefined;

  if (!rows.length) {
    tableWrap.innerHTML = '<p class="placeholder">Нет строк</p>';
    return;
  }

  tableWrap.innerHTML = '<div class="virtual-scroller"><table class="virtual-table"><thead></thead><tbody></tbody></table></div>';
  const scroller = tableWrap.querySelector('.virtual-scroller');
  const table = tableWrap.querySelector('.virtual-table');
  const body = table.querySelector('tbody');
  const head = table.querySelector('thead');
  let sortColumn;
  let sortDirection;

  const renderHeader = () => {
    head.innerHTML = `<tr>${columns.map((column) => {
      const isCurrent = column === sortColumn;
      const ariaSort = isCurrent ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
      const indicator = isCurrent ? (sortDirection === 'asc' ? '↓' : '↑') : '';
      return `<th scope="col" aria-sort="${ariaSort}"${columnClass(column) ? ` class="${columnClass(column)}"` : ''}><button class="column-sort" type="button" data-column="${escapeAttr(column)}">${escapeHtml(column)}<span aria-hidden="true">${indicator}</span></button></th>`;
    }).join('')}</tr>`;
  };

  const renderSlice = () => {
    const start = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT));
    const visible = rows.slice(start, start + VISIBLE_ROWS);
    const before = start * ROW_HEIGHT;
    const after = Math.max(0, rows.length - start - visible.length) * ROW_HEIGHT;
    body.innerHTML = `${virtualGap(before, columns.length)}${visible.map((row, offset) => tableRow(row, columns, start + offset)).join('')}${virtualGap(after, columns.length)}`;
  };

  head.addEventListener('click', (event) => {
    const button = event.target.closest('.column-sort');
    if (!button) return;
    const column = button.dataset.column;
    if (column === sortColumn) {
      sortDirection = sortDirection === 'asc' ? 'desc' : undefined;
      if (!sortDirection) sortColumn = undefined;
    } else {
      sortColumn = column;
      sortDirection = 'asc';
    }
    rows = sortDirection ? [...originalRows].sort((left, right) => sortRows(left[column], right[column], sortDirection)) : originalRows;
    scroller.scrollTop = 0;
    renderHeader();
    renderSlice();
    updateMap(rows, false);
  });
  scroller.addEventListener('scroll', renderSlice, { passive: true });
  scroller.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const row = event.target.closest('tr[data-longitude]');
    if (!row || !map.loaded()) return;
    map.flyTo({
      center: [Number(row.dataset.longitude), Number(row.dataset.latitude)],
      zoom: 11,
      duration: 550,
    });
  });
  resultView = { scroller, renderSlice };
  renderHeader();
  renderSlice();
}

function sortRows(left, right, direction) {
  const leftEmpty = left === null || left === undefined;
  const rightEmpty = right === null || right === undefined;
  if (leftEmpty || rightEmpty) {
    if (leftEmpty === rightEmpty) return 0;
    return leftEmpty === (direction === 'asc') ? -1 : 1;
  }
  let comparison;
  if ((typeof left === 'number' || typeof left === 'bigint') && (typeof right === 'number' || typeof right === 'bigint')) {
    comparison = left < right ? -1 : left > right ? 1 : 0;
  } else {
    comparison = String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' });
  }
  return direction === 'asc' ? comparison : -comparison;
}

function coordinatesFor(row) {
  const longitude = Number(row.longitude);
  const latitude = Number(row.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return [longitude, latitude];
}

function mapPopupContent(row) {
  const content = document.createElement('div');
  content.className = 'map-popup';
  if (row.osm_type && row.osm_id !== null && row.osm_id !== undefined) {
    const title = document.createElement('a');
    title.href = `https://www.openstreetmap.org/${encodeURIComponent(row.osm_type)}/${encodeURIComponent(row.osm_id)}`;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = `${row.osm_type}/${row.osm_id}`;
    content.append(title);
  }

  const tags = tagsFromJson(row.tags_json);
  if (!tags.length) return content;

  const table = document.createElement('table');
  table.className = 'map-tags';
  const body = document.createElement('tbody');
  tags.forEach(([key, value]) => {
    const tagRow = document.createElement('tr');
    const keyCell = document.createElement('th');
    const valueCell = document.createElement('td');
    keyCell.textContent = key;
    valueCell.textContent = printable(value);
    tagRow.append(keyCell, valueCell);
    body.append(tagRow);
  });
  table.append(body);
  content.append(table);
  return content;
}

function tagsFromJson(tagsJson) {
  try {
    const tags = typeof tagsJson === 'string' ? JSON.parse(tagsJson) : tagsJson;
    return tags && typeof tags === 'object' && !Array.isArray(tags) ? Object.entries(tags) : [];
  } catch {
    return [];
  }
}

function tableRow(row, columns, rowIndex) {
  const coordinates = coordinatesFor(row);
  const attributes = coordinates ? ` data-row-index="${rowIndex}" data-longitude="${coordinates[0]}" data-latitude="${coordinates[1]}"` : ` data-row-index="${rowIndex}"`;
  return `<tr${attributes}>${columns.map((column) => tableCell(row, column)).join('')}</tr>`;
}

function virtualGap(height, columns) {
  return height ? `<tr class="virtual-gap"><td colspan="${columns}" style="height:${height}px"></td></tr>` : '';
}

function tableCell(row, column) {
  const value = printable(row[column]);
  const className = columnClass(column);
  const classAttribute = className ? ` class="${className}"` : '';
  if (column === 'osm_id' && row.osm_type && value !== '—') {
    const url = `https://www.openstreetmap.org/${encodeURIComponent(row.osm_type)}/${encodeURIComponent(value)}`;
    return `<td${classAttribute}><a href="${url}" target="_blank" rel="noopener noreferrer" title="OpenStreetMap: ${escapeAttr(row.osm_type)}/${escapeAttr(value)}">${escapeHtml(value)}</a></td>`;
  }
  return `<td${classAttribute} title="${escapeAttr(value)}">${escapeHtml(value)}</td>`;
}

function columnClass(column) {
  if (column === 'osm_id') return 'osm-id';
  if (column === 'name' || column === 'name_ru') return 'name-column';
  if (column === 'water') return 'water-column';
  if (column === 'longitude' || column === 'latitude' || column === 'area_m2') return 'coordinate';
  return '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

async function runQuery(sqlOverride) {
  if (!connection) return;
  error.hidden = true;
  try {
    const source = typeof sqlOverride === 'string' ? sqlOverride : queryText();
    if (typeof source !== 'string') throw new TypeError('Не удалось прочитать SQL-запрос.');
    const sql = source.trim().replace(/;+\s*$/, '');
    if (!sql) return;
    runButton.disabled = true;
    resultMeta.textContent = 'Выполняю…';
    renderTable(await connection.query(sql));
  } catch (reason) {
    resultMeta.textContent = '';
    tableWrap.innerHTML = '<p class="placeholder">Проверьте SQL и попробуйте снова.</p>';
    sqlError(reason);
  } finally {
    runButton.disabled = false;
  }
}

async function initialise() {
  try {
    await loadDatasetMetadata();
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts('${bundle.mainWorker}');`], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    await db.registerFileURL('water-objects.parquet', datasetUrl, duckdb.DuckDBDataProtocol.HTTP, false);
    connection = await db.connect();
    await connection.query(`CREATE VIEW ${TABLE} AS SELECT * FROM 'water-objects.parquet'`);
    runButton.disabled = false;
    if (!hasUserQuery) {
      setQueryText(queries.all, false);
      setActiveExample('all');
    }
    await runQuery();
  } catch (reason) {
    tableWrap.innerHTML = '<p class="placeholder">Убедитесь, что сайт открыт через HTTP(S), а не как файл.</p>';
    sqlError(reason);
  }
}

runButton.addEventListener('click', () => runQuery());
shareButton.addEventListener('click', shareQuery);
imageryToggle.addEventListener('change', () => setBaseMap(imageryToggle.checked));
if (!queryEditor) {
  queryBox.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runQuery();
  });
  queryBox.addEventListener('input', () => {
    if (isSettingQueryText) return;
    hasUserQuery = true;
    setActiveExample();
    persistQuery();
    resizeQueryBox();
  });
} else {
  queryEditor.on('change', () => {
    if (isSettingQueryText) return;
    hasUserQuery = true;
    setActiveExample();
    persistQuery();
    resizeQueryBox();
  });
}
document.querySelectorAll('[data-query]').forEach((button) => {
  button.addEventListener('click', () => {
    setQueryText(queries[button.dataset.query]);
    setActiveExample(button.dataset.query);
    runQuery();
  });
});

restoreQueryText();
initialise();

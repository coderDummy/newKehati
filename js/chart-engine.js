const chartInstances = {};
const csvLoadPromises = new Map();

const SPREADSHEET_IDS = {
  arboretum: '17ubjLK2F0K_UiCaFN5A7uqkZzFlkDYty',
  das: '1ab_fzvZXTGG2Fxt3QiW3aoOmHQgvnAnu',
  eduwisata: '1Y3Uzp76ekXiw39P7QcCSPdZB5isx0C5U',
  'mangrove-pagkalan-jambi': '1rprGqN0CCYmxpHhf7krWS3n087QAwixQ',
  poligowo: '1nVc9ZILH8q8H_0WS3RxIhBoJpiMfZQK0',
  sukajadi: '1BAUCogyOJG_k7PNr8IxcZBTUVsJHJNY-',
};

const SPREADSHEET_SHEETS = {
  'data-burung': 'Avifauna',
  'data-fauna-Burung': 'Avifauna',
  'data-flora': 'Flora',
  'data-flora-keragamanHayati': 'Flora',
  'data-mamalia': 'Mamalia',
  'data-fauna-Mamalia': 'Mamalia',
  'data-herpetofauna': 'Herpetofauna',
  'data-fauna-Herpetofauna': 'Herpetofauna',
  'data-kupukupu': 'Kupu-kupu',
  'data-fauna-Kupukupu': 'Kupu-kupu',
  'data-capung': 'Capung',
  'data-fauna-Capung': 'Capung',
};

function getSpreadsheetCsvUrl(path) {
  const match = /^data\/([^/]+)\/([^/]+)\.csv$/.exec(path);
  if (!match) throw new Error(`Sumber sheet tidak valid: ${path}`);

  const [, program, sourceName] = match;
  const spreadsheetId = SPREADSHEET_IDS[program];
  if (!spreadsheetId) throw new Error(`Spreadsheet belum dikonfigurasi: ${program}`);
  const sheetName = SPREADSHEET_SHEETS[sourceName];
  if (!sheetName) throw new Error(`Nama sheet belum dipetakan: ${sourceName}`);

  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('sheet', sheetName);
  return url;
}

async function loadCSV(path) {
  if (!csvLoadPromises.has(path)) {
    const request = (async () => {
      const response = await fetch(getSpreadsheetCsvUrl(path));
      if (!response.ok) throw new Error(`Gagal mengambil sheet (${response.status}): ${path}`);

      const csv = await response.text();
      const { data, errors, meta } = Papa.parse(csv, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      if (errors.length) throw new Error(`Format CSV sheet tidak valid: ${errors[0].message}`);
      if (!meta.fields?.includes('No')) throw new Error(`Kolom "No" tidak ditemukan pada sheet: ${path}`);

      return data.filter(row => typeof row['No'] === 'number');
    })();
    csvLoadPromises.set(path, request);
  }

  return csvLoadPromises.get(path);
}

function getYearCols(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(c => c.startsWith('Jumlah '));
}

function getIndexSourcePath(canvasId, tables) {
  const match = /^chart(?:Kehati|Ekologi)(Flora|Burung|Mamalia|Herpetofauna|Capung|Kupukupu)$/.exec(canvasId);
  if (!match) return null;

  const table = tables.find(item => item.containerId === `table-${match[1].toLowerCase()}`);
  return table?.csv ?? null;
}

function calculateDiversityIndices(rows) {
  const indicesByYear = new Map();

  getYearCols(rows).forEach(column => {
    const abundances = rows
      .map(row => Number(row[column]))
      .filter(value => Number.isFinite(value) && value > 0);
    const total = abundances.reduce((sum, value) => sum + value, 0);
    const speciesCount = abundances.length;
    if (total <= 0) return;

    const shannon = -abundances.reduce((sum, value) => {
      const proportion = value / total;
      return sum + proportion * Math.log(proportion);
    }, 0);

    indicesByYear.set(column.replace('Jumlah ', ''), {
      H: shannon,
      R: total > 1 ? (speciesCount - 1) / Math.log(total) : null,
      E: speciesCount > 1 ? shannon / Math.log(speciesCount) : null,
    });
  });

  return indicesByYear;
}

function sortYears(years) {
  return years.sort((left, right) => Number(left) - Number(right));
}

function mergeSingleIndexChart(cfg, indicesByYear) {
  const valuesByYear = new Map((cfg.labels ?? []).map((year, index) => [String(year), cfg.values[index]]));
  indicesByYear.forEach((indices, year) => {
    if (Number.isFinite(indices.H)) valuesByYear.set(year, indices.H);
  });

  const labels = sortYears([...valuesByYear.keys()]);
  return { labels, values: labels.map(year => valuesByYear.get(year)) };
}

function mergeGroupedIndexChart(cfg, indicesByYear) {
  const existingSeries = new Map((cfg.series ?? []).map(series => [String(series.label), series]));
  const valuesByYear = new Map();

  existingSeries.forEach((series, year) => {
    valuesByYear.set(year, Object.fromEntries(
      cfg.groups.map((group, index) => [group, series.values[index]])
    ));
  });

  indicesByYear.forEach((indices, year) => {
    const yearValues = valuesByYear.get(year) ?? {};
    cfg.groups.forEach(group => {
      const normalizedGroup = group.replace('′', "'").toUpperCase();
      const key = normalizedGroup.startsWith("H'") ? 'H' : normalizedGroup;
      if (Number.isFinite(indices[key])) yearValues[group] = indices[key];
    });
    valuesByYear.set(year, yearValues);
  });

  const years = sortYears([...valuesByYear.keys()]);
  const colorPalette = (cfg.series ?? []).map(series => series.color);
  return {
    groups: cfg.groups,
    series: years.map((year, index) => ({
      label: year,
      color: existingSeries.get(year)?.color ?? colorPalette[index % colorPalette.length] ?? '#2a9d8f',
      values: cfg.groups.map(group => valuesByYear.get(year)[group] ?? null),
    })),
  };
}

function showIndexFallbackWarning(card, cfg, error) {
  console.error(`Gagal menghitung indeks dinamis untuk ${cfg.canvasId}:`, error);
  if (!card) return;
  const subtitle = card.querySelector('.chart-subtitle');
  if (subtitle) {
    const manualSubtitle = cfg.subtitle ?? subtitle.textContent;
    subtitle.textContent = `${manualSubtitle} · Data indeks dinamis gagal dimuat; menampilkan nilai manual`;
  }
}

const VALUE_LABEL_PLUGIN = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx, data, scales: { x, y } } = chart;
    ctx.save();
    ctx.font = 'bold 11px DM Sans, sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    data.datasets[0].data.forEach((val, i) => {
      if (val == null) return;
      ctx.fillText(
        typeof val === 'number' && val % 1 !== 0 ? val.toFixed(2) : val.toLocaleString('id-ID'),
        x.getPixelForValue(i),
        y.getPixelForValue(val) - 4
      );
    });
    ctx.restore();
  }
};

const GROUPED_VALUE_LABEL_PLUGIN = {
  id: 'groupedBarValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx, data, scales: { x, y } } = chart;
    ctx.save();
    ctx.font = 'bold 10px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((bar, i) => {
        const val = dataset.data[i];
        if (val == null) return;
        const label = typeof val === 'number' && val % 1 !== 0
          ? val.toFixed(2) : val.toLocaleString('id-ID');
        ctx.fillStyle = '#333';
        ctx.fillText(label, bar.x, bar.y - 4);
      });
    });
    ctx.restore();
  }
};

async function mountGroupedBar(cfg, tables) {
  const canvas = document.getElementById(cfg.canvasId);
  if (!canvas) return;

  const card = canvas.closest('.chart-card');
  if (card) {
    const titleEl = card.querySelector('.chart-title');
    const subEl   = card.querySelector('.chart-subtitle');
    if (titleEl) titleEl.textContent = cfg.title ?? '';
    if (subEl)   subEl.textContent   = cfg.subtitle ?? '';
  }

  let groups = cfg.groups;
  let series = cfg.series;
  const indexSourcePath = getIndexSourcePath(cfg.canvasId, tables);
  if (indexSourcePath) {
    try {
      const rows = await loadCSV(indexSourcePath);
      ({ groups, series } = mergeGroupedIndexChart(cfg, calculateDiversityIndices(rows)));
    } catch (error) {
      showIndexFallbackWarning(card, cfg, error);
    }
  }

  if (chartInstances[cfg.canvasId]) chartInstances[cfg.canvasId].destroy();

  const datasets = series.map(s => ({
    label: s.label, data: s.values, backgroundColor: s.color, borderRadius: 3, borderSkipped: false,
  }));

  chartInstances[cfg.canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: groups, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: cfg.showValueLabels ? 28 : 0 } },
      plugins: {
        legend: { display: true, position: 'right', labels: { boxWidth: 14, boxHeight: 14, font: { size: 11 }, color: '#555', padding: 16 } },
        tooltip: {
          backgroundColor: '#1a3a2a', titleColor: '#c8a84b', bodyColor: '#fff', borderColor: 'rgba(200,168,75,0.3)', borderWidth: 1, padding: 12,
          callbacks: { label: ctx => { const v = ctx.parsed.y; return ` ${ctx.dataset.label}: ${v % 1 !== 0 ? v.toFixed(2) : v}`; } }
        }
      },
      scales: {
        y: {
          min: cfg.yMin ?? 0, grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 11 }, color: '#888', callback: v => v % 1 !== 0 ? v.toFixed(1) : v },
          title: cfg.yAxisLabel ? { display: true, text: cfg.yAxisLabel, color: '#aaa', font: { size: 11 }, padding: { bottom: 8 } } : { display: false }
        },
        x: { grid: { display: false }, ticks: { font: { size: 12, weight: '600' }, color: '#555' } }
      }
    },
    plugins: cfg.showValueLabels ? [GROUPED_VALUE_LABEL_PLUGIN] : []
  });
}

async function mountChart(cfg, tables) {
  if (cfg.type === 'groupedBar') return mountGroupedBar(cfg, tables);

  const canvas = document.getElementById(cfg.canvasId);
  if (!canvas) return;

  if (chartInstances[cfg.canvasId]) chartInstances[cfg.canvasId].destroy();

  const card = canvas.closest('.chart-card');
  if (card) {
    const titleEl = card.querySelector('.chart-title');
    const subEl   = card.querySelector('.chart-subtitle');
    if (titleEl) titleEl.textContent = cfg.title ?? '';
    if (subEl && cfg.subtitle) subEl.textContent = cfg.subtitle;
  }

  let labels = cfg.labels ?? [];
  let values = cfg.values ?? [];

  const indexSourcePath = getIndexSourcePath(cfg.canvasId, tables);
  if (indexSourcePath) {
    try {
      const rows = await loadCSV(indexSourcePath);
      ({ labels, values } = mergeSingleIndexChart(cfg, calculateDiversityIndices(rows)));
    } catch (error) {
      showIndexFallbackWarning(card, cfg, error);
    }
  }

  if (cfg.csv) {
    try {
      const rows = await loadCSV(cfg.csv);
      const yearCols = getYearCols(rows);
      labels = yearCols.map(c => c.replace('Jumlah ', ''));
      values = yearCols.map(col => rows.reduce((s, r) => s + (Number(r[col]) || 0), 0));

      if (card) {
        const subEl = card.querySelector('.chart-subtitle');
        if (subEl && !cfg.subtitle) subEl.textContent = `Total seluruh ${rows.length} spesies yang tercatat per tahun pemantauan`;
      }

      const statSpesies = document.getElementById('statSpesies'), statTotal = document.getElementById('statTotal'), statTahun = document.getElementById('statTahun');
      if (statSpesies) statSpesies.textContent = rows.length;
      if (statTotal) statTotal.textContent = values.at(-1)?.toLocaleString('id-ID') ?? '—';
      if (statTahun) statTahun.textContent = labels[0] + '–' + labels.at(-1);
    } catch(e) {
      canvas.parentElement.innerHTML = `<div class="loader-wrap text-[#c00]">Gagal memuat chart: ${e.message}</div>`; return;
    }
  }

  const isBar = cfg.type === 'bar';
  const maxVal = Math.max(...values);

  chartInstances[cfg.canvasId] = new Chart(canvas.getContext('2d'), {
    type: cfg.type ?? 'line',
    data: {
      labels,
      datasets: [{
        label: cfg.title ?? '', data: values, borderColor: cfg.color ?? '#2d5a40',
        backgroundColor: isBar ? values.map(v => v === maxVal ? cfg.color : (cfg.color + 'bb')) : (cfg.color ?? '#2d5a40') + '1a',
        borderWidth: isBar ? 0 : 2.5, borderRadius: isBar ? 4 : 0, borderSkipped: false,
        pointRadius: isBar ? 0 : 6, pointBackgroundColor: cfg.color ?? '#2d5a40', pointBorderColor: '#fff', pointBorderWidth: 2.5,
        tension: isBar ? 0 : 0.4, fill: cfg.fill ?? false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: cfg.showValueLabels ? 24 : 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a3a2a', titleColor: '#c8a84b', bodyColor: '#fff', borderColor: 'rgba(200,168,75,0.3)', borderWidth: 1, padding: 12,
          callbacks: { label: ctx => { const v = ctx.parsed.y; return ` ${v % 1 !== 0 ? v.toFixed(2) : v.toLocaleString('id-ID')}${cfg.tooltipSuffix ?? ''}`; } }
        }
      },
      scales: {
        y: {
          min: cfg.yMin ?? undefined, beginAtZero: cfg.yMin == null && !isBar, grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 11 }, color: '#888', callback: v => v % 1 !== 0 ? v.toFixed(1) : v.toLocaleString('id-ID') },
          title: cfg.yAxisLabel ? { display: true, text: cfg.yAxisLabel, color: '#aaa', font: { size: 11 }, padding: { bottom: 8 } } : { display: false }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#888' } }
      }
    },
    plugins: cfg.showValueLabels ? [VALUE_LABEL_PLUGIN] : []
  });
}

function buildTableHTML(rows, yearCols, yearLabels, headerColor) {
  const totals = {};
  yearCols.forEach(col => { totals[col] = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0); });

  const thead = `
    <tr class="thead-group" style="background:${headerColor};">
      <th>No</th><th>Nama Ilmiah</th><th>Nama Lokal</th>
      <th class="th-jumlah" colspan="${yearCols.length}">Jumlah</th>
    </tr>
    <tr class="thead-years">
      <th class="th-fixed"></th><th class="th-fixed"></th><th class="th-fixed"></th>
      ${yearLabels.map(y => `<th>${y}</th>`).join('')}
    </tr>`;

  const tbody = rows.map(r => {
    const cells = yearCols.map(col => {
      const n = Number(r[col]);
      return (!r[col] || isNaN(n) || n === 0) ? `<td class="td-dash">—</td>` : `<td class="td-num">${n.toLocaleString('id-ID')}</td>`;
    }).join('');
    return `<tr><td>${r['No']}</td><td class="td-italic">${r['Nama Ilmiah'] ?? ''}</td><td>${r['Nama Lokal'] ?? ''}</td>${cells}</tr>`;
  }).join('');

  const totalCells = yearCols.map(col => `<td class="td-num">${totals[col].toLocaleString('id-ID')}</td>`).join('');
  return `<table><thead>${thead}</thead><tbody>${tbody}<tr class="total-row"><td colspan="3" class="font-bold">TOTAL</td>${totalCells}</tr></tbody></table>`;
}

// --- PLUGIN BARU UNTUK MENAMPILKAN ANGKA DI ATAS 2 GARIS ---
const MULTI_LINE_LABEL_PLUGIN = {
  id: 'multiLineLabels',
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    ctx.save();
    ctx.font = 'bold 11px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    data.datasets.forEach((dataset, di) => {
      ctx.fillStyle = dataset.borderColor; // Warna angka menyesuaikan warna garis (Biru/Merah)
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((point, i) => {
        const val = dataset.data[i];
        if (val == null || val === 0) return;
        ctx.fillText(val.toLocaleString('id-ID'), point.x, point.y - 10);
      });
    });
    ctx.restore();
  }
};

// ── FUNGSI mountTable YANG DIPERBARUI (Merekam data per tahun) ──
async function mountTable(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return null;

  container.innerHTML = `<div class="table-card"><div class="loader-wrap"><div class="spinner"></div>Memuat data ${cfg.label}…</div></div>`;

  try {
    const rows = await loadCSV(cfg.csv);
    const yearCols = getYearCols(rows);
    const yearLabels = yearCols.map(c => c.replace('Jumlah ', ''));

    container.innerHTML = `
      <div class="table-card">
        <div class="table-header" style="background:${cfg.color};">
          <div class="table-header-icon">${cfg.icon}</div>
          <div class="table-header-text"><strong>${cfg.label}</strong><span>${cfg.sublabel} · ${rows.length} spesies · ${yearLabels.join(', ')}</span></div>
        </div>
        <div class="table-scroll">${buildTableHTML(rows, yearCols, yearLabels, cfg.color)}</div>
      </div>`;

    // --- LOGIKA MEREKAM DATA PER TAHUN ---
    const latestYearCol = yearCols[yearCols.length - 1];
    const totalIndividu = rows.reduce((sum, r) => sum + (Number(r[latestYearCol]) || 0), 0);

    const yearTotals = {};
    yearLabels.forEach((y, i) => {
        yearTotals[y] = rows.reduce((sum, r) => sum + (Number(r[yearCols[i]]) || 0), 0);
    });

    return {
      id: cfg.containerId,
      speciesCount: rows.length,
      individualCount: totalIndividu,
      yearLabels: yearLabels,
      yearTotals: yearTotals
    };
  } catch (e) {
    container.innerHTML = `<div class="loader-wrap text-[#c00]">Gagal memuat ${cfg.label}: ${e.message}</div>`;
    return null;
  }
}

// ── FUNGSI initChartsAndTables YANG DIPERBARUI (Menyuntikkan Angka Flora & Fauna) ──
async function initChartsAndTables() {
  try {
    const url = typeof CHART_DATA_URL !== 'undefined' ? CHART_DATA_URL : 'data/chart/gambut.json';
    const response = await fetch(url);
    const chartData = await response.json();

    const results = await Promise.all([
      ...chartData.CHARTS.map(cfg => mountChart(cfg, chartData.TABLES)),
      ...chartData.TABLES.map(mountTable)
    ]);

    // Variabel penampung
    let totalFaunaSpesies = 0;
    let totalFaunaIndividu = 0;
    let totalFloraSpesies = 0;
    let totalFloraIndividu = 0; // <-- TAMBAHAN UNTUK FLORA

    const aggregateFauna = {};
    const aggregateFlora = {};
    let chartYearLabels = [];

    // Mengumpulkan dan mengelompokkan data
    results.forEach(res => {
      if (res && res.id) {
        if (res.id === 'table-flora') {
          totalFloraSpesies = res.speciesCount;
          totalFloraIndividu = res.individualCount; // <-- MENANGKAP TOTAL INDIVIDU FLORA TERBARU
          chartYearLabels = res.yearLabels;
          res.yearLabels.forEach(y => {
            aggregateFlora[y] = res.yearTotals[y];
          });
        } else {
          totalFaunaSpesies += res.speciesCount;
          totalFaunaIndividu += res.individualCount;
          res.yearLabels.forEach(y => {
            aggregateFauna[y] = (aggregateFauna[y] || 0) + res.yearTotals[y];
          });
        }
      }
    });

    // --- UPDATE ELEMEN HTML CARD FLORA ---
    const elFloraSpesies = document.getElementById('statSpesies');
    const elFloraTotal = document.getElementById('statTotal');
    if (elFloraSpesies) elFloraSpesies.textContent = totalFloraSpesies.toLocaleString('id-ID');
    if (elFloraTotal) elFloraTotal.textContent = totalFloraIndividu.toLocaleString('id-ID');

    // --- UPDATE ELEMEN HTML CARD FAUNA ---
    const elFaunaSpesies = document.getElementById('statSpesiesFauna');
    const elFaunaTotal = document.getElementById('statTotalFauna');
    if (elFaunaSpesies) elFaunaSpesies.textContent = totalFaunaSpesies.toLocaleString('id-ID');
    if (elFaunaTotal) elFaunaTotal.textContent = totalFaunaIndividu.toLocaleString('id-ID');


    // ── RENDER GRAFIK GARIS KOMPOSIT (FLORA VS FAUNA) ──
    const canvasObj = document.getElementById('chartFloraFauna');
    if (canvasObj && chartYearLabels.length > 0) {
        const floraData = chartYearLabels.map(y => aggregateFlora[y] || 0);
        const faunaData = chartYearLabels.map(y => aggregateFauna[y] || 0);
        
        const card = canvasObj.closest('.chart-card');
        if (card) {
            const titleEl = card.querySelector('.chart-title');
            const subEl = card.querySelector('.chart-subtitle');
            if (titleEl) titleEl.textContent = "Tren Individu Flora vs Fauna";
            if (subEl) subEl.textContent = `Berdasarkan ${totalFloraSpesies} spesies flora dan ${totalFaunaSpesies} spesies fauna`;
        }

        new Chart(canvasObj.getContext('2d'), {
            type: 'line',
            data: {
                labels: chartYearLabels,
                datasets: [
                    {
                        label: 'Flora',
                        data: floraData,
                        borderColor: '#0A3A82', // Corporate Blue Pertamina
                        backgroundColor: 'rgba(10, 58, 130, 0.1)',
                        borderWidth: 3,
                        pointRadius: 6,
                        pointBackgroundColor: '#0A3A82',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Fauna',
                        data: faunaData,
                        borderColor: '#ED2024', // Corporate Red Pertamina
                        backgroundColor: 'rgba(237, 32, 36, 0.1)',
                        borderWidth: 3,
                        pointRadius: 6,
                        pointBackgroundColor: '#ED2024',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 35 } },
                plugins: {
                    legend: { display: true, position: 'top', labels: { usePointStyle: true, font: {family: 'Montserrat', weight: 600} } },
                    tooltip: {
                        backgroundColor: '#0A3A82',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('id-ID')} individu`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: { color: '#888', font: { family: 'Montserrat' }, callback: v => v.toLocaleString('id-ID') }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#888', font: { family: 'Montserrat', weight: 600 } }
                    }
                }
            },
            plugins: typeof MULTI_LINE_LABEL_PLUGIN !== 'undefined' ? [MULTI_LINE_LABEL_PLUGIN] : []
        });
    }

  } catch (error) {
    console.error("Gagal inisialisasi charts:", error);
  }
}
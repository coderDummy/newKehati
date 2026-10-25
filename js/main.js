// Utility: Scroll Reveal
function initReveal() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(el => { if (el.isIntersecting) el.target.classList.add('visible'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

// Mobile Nav Toggle
function toggleMenu(btn) {
  btn.classList.toggle('open');
  // Logic menu dropdown (bisa ditambah nanti jika ada list menu)
}

// Header Scroll Logic
function initHeaderScroll() {
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      nav.classList.add('nav-scrolled');
    } else {
      nav.classList.remove('nav-scrolled');
    }
  });
}

const DASHBOARD_SPREADSHEETS = [
  { name: 'Arboretum', id: '17ubjLK2F0K_UiCaFN5A7uqkZzFlkDYty' },
  { name: 'DAS', id: '1ab_fzvZXTGG2Fxt3QiW3aoOmHQgvnAnu' },
  { name: 'Eduwisata', id: '1Y3Uzp76ekXiw39P7QcCSPdZB5isx0C5U' },
  { name: 'Mangrove Pangkalan Jambi', id: '1rprGqN0CCYmxpHhf7krWS3n087QAwixQ' },
  { name: 'Poligowo', id: '1nVc9ZILH8q8H_0WS3RxIhBoJpiMfZQK0' },
  { name: 'Sukajadi', id: '1BAUCogyOJG_k7PNr8IxcZBTUVsJHJNY-' },
];
const dashboardSheetPromises = new Map();

async function loadDashboardSheet(spreadsheet, sheetName) {
  const cacheKey = `${spreadsheet.id}:${sheetName}`;
  if (!dashboardSheetPromises.has(cacheKey)) {
    const request = (async () => {
      const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheet.id}/gviz/tq`);
      url.searchParams.set('tqx', 'out:csv');
      url.searchParams.set('sheet', sheetName);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Gagal mengambil sheet ${sheetName} dari ${spreadsheet.name} (${response.status})`);

      const { data, errors, meta } = Papa.parse(await response.text(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      if (errors.length) throw new Error(`Format sheet ${sheetName} di ${spreadsheet.name} tidak valid: ${errors[0].message}`);
      if (!meta.fields?.includes('No')) throw new Error(`Kolom "No" tidak ditemukan pada sheet ${sheetName} di ${spreadsheet.name}`);

      return data.filter(row => typeof row.No === 'number');
    })();
    dashboardSheetPromises.set(cacheKey, request);
  }

  return dashboardSheetPromises.get(cacheKey);
}

function getDashboardYearColumns(rows) {
  if (!rows.length) throw new Error('Sheet tidak memiliki baris data');
  const columns = Object.keys(rows[0]).filter(column => /^Jumlah \d{4}$/.test(column));
  columns.sort((left, right) => Number(left.slice(7)) - Number(right.slice(7)));
  if (!columns.length) throw new Error('Kolom tahun "Jumlah YYYY" tidak ditemukan');
  return columns;
}

function getLatestCommonDashboardYear(sheets) {
  const commonYears = sheets
    .map(({ rows }) => getDashboardYearColumns(rows))
    .map(columns => new Set(columns.map(column => column.slice(7))))
    .reduce((years, nextYears) => new Set([...years].filter(year => nextYears.has(year))));
  const latestYear = [...commonYears].sort((left, right) => Number(right) - Number(left))[0];
  if (!latestYear) throw new Error('Tidak ada tahun data yang sama di semua spreadsheet');
  return latestYear;
}

function parseDashboardAbundance(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalizedValue = String(value ?? '').trim().replace(/,/g, '');
  const abundance = Number(normalizedValue);
  return Number.isFinite(abundance) ? abundance : 0;
}

function aggregateDashboardRows(sheets, year) {
  const countsBySpecies = new Map();
  let total = 0;

  sheets.forEach(({ spreadsheet, rows }) => {
    const yearColumn = `Jumlah ${year}`;
    rows.forEach((row, index) => {
      const abundance = parseDashboardAbundance(row[yearColumn]);
      if (abundance <= 0) return;

      total += abundance;
      const scientificName = String(row['Nama Ilmiah'] ?? '').trim().toLocaleLowerCase('id');
      const speciesKey = scientificName || `${spreadsheet.id}:${row.No ?? index}`;
      countsBySpecies.set(speciesKey, (countsBySpecies.get(speciesKey) ?? 0) + abundance);
    });
  });

  if (total <= 0) throw new Error(`Tidak ada jumlah spesies pada tahun ${year}`);
  return { counts: [...countsBySpecies.values()], total };
}

function calculateShannonIndex(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  return -counts.reduce((sum, value) => {
    const proportion = value / total;
    return sum + proportion * Math.log(proportion);
  }, 0);
}

async function updateDashboardStats({ year, counts, total, valueId, labelId, valueType, label }) {
  const valueElement = document.getElementById(valueId);
  const labelElement = document.getElementById(labelId);
  if (!valueElement || !labelElement) return;

  valueElement.textContent = valueType === 'total'
    ? new Intl.NumberFormat('id-ID').format(total)
    : calculateShannonIndex(counts).toFixed(2);
  labelElement.textContent = `${label} (${year})`;
}

async function loadDashboardStats() {
  try {
    const [floraSheets, avifaunaSheets] = await Promise.all(['Flora', 'Avifauna'].map(sheetName =>
      Promise.all(DASHBOARD_SPREADSHEETS.map(async spreadsheet => ({
        spreadsheet,
        rows: await loadDashboardSheet(spreadsheet, sheetName),
      })))
    ));
    const floraYear = getLatestCommonDashboardYear(floraSheets);
    const avifaunaYear = getLatestCommonDashboardYear(avifaunaSheets);
    const flora = aggregateDashboardRows(floraSheets, floraYear);
    const avifauna = aggregateDashboardRows(avifaunaSheets, avifaunaYear);

    await Promise.all([
    updateDashboardStats({
      year: floraYear,
      counts: flora.counts,
      total: flora.total,
      valueId: 'statMangrove',
      labelId: 'statMangroveLabel',
      valueType: 'total',
      label: 'Total Individu Flora',
    }),
    updateDashboardStats({
      year: floraYear,
      counts: flora.counts,
      total: flora.total,
      valueId: 'statFloraIndex',
      labelId: 'statFloraIndexLabel',
      valueType: 'shannon',
      label: 'Indeks Kehati Flora',
    }),
    updateDashboardStats({
      year: avifaunaYear,
      counts: avifauna.counts,
      total: avifauna.total,
      valueId: 'statAvifaunaIndex',
      labelId: 'statAvifaunaIndexLabel',
      valueType: 'shannon',
      label: 'Indeks Kehati Avifauna',
    }),
    ]);
  } catch (error) {
    ['statMangrove', 'statFloraIndex', 'statAvifaunaIndex'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '—';
    });
    console.error('Gagal memuat statistik gabungan dari seluruh spreadsheet:', error);
  }
}

// Memuat Program List di halaman Index
async function loadPrograms() {
  const grid = document.getElementById('programGrid');
  const elProgramAktif = document.getElementById('ProgramAktif'); // Ambil elemen target
  
  if (!grid) return;
  try {
    const response = await fetch('listProgram.json');
    const programs = await response.json();
    
    // UPDATE DINAMIS: Hitung jumlah data di JSON dan tampilkan
    if (elProgramAktif) {
      elProgramAktif.textContent = programs.length + '+';
    }

    grid.innerHTML = '';
    programs.forEach((p, i) => {
      const card = document.createElement('a');
      card.href = p.slug;
      card.className = 'program-card reveal';
      card.style.transitionDelay = `${i * 0.1}s`;
      card.innerHTML = `
        <div class="card-img-wrap">
          <img src="${p.image}" alt="${p.programName}" class="card-img" loading="lazy" />
        </div>
        <div class="card-body">
          <div class="card-cat">${p.category}</div>
          <div class="card-title">${p.programName}</div>
          <div class="card-desc">${p.description}</div>
          <div class="card-meta">
            <div class="card-loc">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${p.location}
            </div>
            <div class="card-year">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              ${p.year}
            </div>
            <div class="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
    initReveal();
  } catch (e) {
    grid.innerHTML = '<p class="text-center text-[#999] p-8">Gagal memuat daftar program.</p>';
  }
}

// Memuat Other Programs di halaman Inner
async function loadOtherPrograms() {
  const slider = document.getElementById('otherProgramsSlider');
  if (!slider) return;
  const currentPath = window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';
  try {
    const response = await fetch('listProgram.json');
    const programs = await response.json();
    slider.innerHTML = ''; 
    programs.forEach((p, i) => {
      const programPath = p.slug.replace(/\/+$/, '').split('/').pop();
      if (programPath === currentPath) return;
      const card = document.createElement('a');
      card.href = p.slug;
      card.className = 'slider-card reveal';
      card.style.transitionDelay = `${i * 0.1}s`;
      card.innerHTML = `
        <img src="${p.image}" alt="${p.programName}" class="slider-img" onerror="this.src='https://placehold.co/600x400?text=Image+Not+Found'">
        <div class="slider-body">
          <div class="slider-cat">${p.category}</div>
          <h3 class="slider-title">${p.programName}</h3>
        </div>
      `;
      slider.appendChild(card);
    });
    initReveal();
  } catch (e) {
    slider.innerHTML = `<p class="p-8 text-[#999] text-sm">Tidak dapat memuat program lainnya.</p>`;
  }
}

// Core Initialization Component Injection
async function initApp() {
  const isIndex = document.body.classList.contains('page-index');

  try {
    // 1. Inject Header
    const headerRes = await fetch('components/header.html');
    const headerHtml = await headerRes.text();
    document.getElementById('header-placeholder').outerHTML = headerHtml;

    // Aktifkan event scroll header setelah injeksi HTML
    initHeaderScroll();

    // 2. Inject Footer
    const footerRes = await fetch('components/footer.html');
    const footerHtml = await footerRes.text();
    document.getElementById('footer-placeholder').outerHTML = footerHtml;

    // 3. Conditional injection based on page
    if (isIndex) {
      await Promise.all([loadPrograms(), loadDashboardStats()]);
    } else {
      // Inject Other Programs BEFORE Footer
      const otherRes = await fetch('components/other-programs.html');
      const otherHtml = await otherRes.text();
      document.querySelector('.pertamina-footer').insertAdjacentHTML('beforebegin', otherHtml);
      await loadOtherPrograms();
      
      // Load Charts if specific page
      if (typeof initChartsAndTables === 'function') {
        initChartsAndTables();
      }
    }
    initReveal();
  } catch (error) {
    console.error("Gagal memuat komponen sistem:", error);
  }
}

window.addEventListener('DOMContentLoaded', initApp);
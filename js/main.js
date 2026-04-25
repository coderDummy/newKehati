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
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  try {
    const response = await fetch('listProgram.json');
    const programs = await response.json();
    slider.innerHTML = ''; 
    programs.forEach((p, i) => {
      if (p.slug === currentPath || p.slug.includes(currentPath)) return;
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
      await loadPrograms();
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
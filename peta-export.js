/* =====================================================================
   PETA — EXPORT JPEG / PDF
   Additif, tidak ubah peta-gis.js. Load setelah peta-gis.js.
   Pakai html2canvas + jsPDF via CDN (dimuat lazy pas tombol export
   diklik pertama kali, biar gak nambah beban load awal).
   ===================================================================== */

const PETA_EXPORT_LIB = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};

function petaLoadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat pustaka export: ' + src));
    document.head.appendChild(s);
  });
}

async function ensurePetaExportLibs() {
  if (!window.html2canvas) await petaLoadScript(PETA_EXPORT_LIB.html2canvas);
  if (!window.jspdf) await petaLoadScript(PETA_EXPORT_LIB.jspdf);
}

function petaExportFilename(ext) {
  const module = petaModuleByKey(petaState.module);
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = (module.label || 'peta').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `peta-${safe}-${stamp}.${ext}`;
}

async function petaCaptureCanvas() {
  const container = $('#petaMapContainer');
  if (!container || !petaMapInstance) throw new Error('Peta belum siap dimuat');
  // Leaflet render tile pas geser/zoom; kasih jeda kecil biar tile terakhir kelar digambar.
  petaMapInstance.invalidateSize();
  await new Promise(r => setTimeout(r, 150));
  return await html2canvas(container, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    scale: Math.min(2, window.devicePixelRatio || 2),
    logging: false,
  });
}

async function exportPetaJPEG() {
  const btn = $('#petaExportJpegBtn');
  const original = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
    await ensurePetaExportLibs();
    const canvas = await petaCaptureCanvas();
    const link = document.createElement('a');
    link.download = petaExportFilename('jpg');
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Peta berhasil diexport ke JPEG');
  } catch (err) {
    console.error('Export JPEG gagal:', err);
    toast('Gagal export JPEG: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original || 'Export JPEG'; }
  }
}

async function exportPetaPDF() {
  const btn = $('#petaExportPdfBtn');
  const original = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
    await ensurePetaExportLibs();
    const canvas = await petaCaptureCanvas();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const module = petaModuleByKey(petaState.module);

    const marginTop = 44;
    const availH = pageH - marginTop - 20;
    const ratio = Math.min(pageW / canvas.width, availH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageW - w) / 2;

    pdf.setFontSize(13);
    pdf.text(`Peta — ${module.label}`, 24, 26);
    pdf.setFontSize(9);
    pdf.setTextColor(120);
    pdf.text(new Date().toLocaleString('id-ID'), 24, 38);
    pdf.addImage(imgData, 'JPEG', x, marginTop, w, h);

    pdf.save(petaExportFilename('pdf'));
    toast('Peta berhasil diexport ke PDF');
  } catch (err) {
    console.error('Export PDF gagal:', err);
    toast('Gagal export PDF: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original || 'Export PDF'; }
  }
}

/* --- Suntik tombol ke toolbar peta ------------------------------------ */
function petaInjectExportButtons() {
  if ($('#petaExportJpegBtn')) return; // sudah ada, jangan dobel
  const reloadBtn = document.querySelector('[onclick="paintPeta()"]');
  if (!reloadBtn) return;
  reloadBtn.insertAdjacentHTML('afterend', `
    <button class="btn btn-outline btn-sm" id="petaExportJpegBtn" type="button">Export JPEG</button>
    <button class="btn btn-outline btn-sm" id="petaExportPdfBtn" type="button">Export PDF</button>
  `);
  $('#petaExportJpegBtn').addEventListener('click', exportPetaJPEG);
  $('#petaExportPdfBtn').addEventListener('click', exportPetaPDF);
}

const _petaExportPrevPaintPeta = paintPeta;
paintPeta = async function (...args) {
  await _petaExportPrevPaintPeta(...args);
  petaInjectExportButtons();
};

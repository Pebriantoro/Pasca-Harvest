/* =====================================================================
   APPROVAL PREVIEW ADDON — load SETELAH approval-workflow.js.
   ADDITIF: tidak mengubah file lain, hanya override approveMany() supaya
   Supervisor/Superintendent WAJIB lihat pratinjau lengkap data yang
   diinput pengawas/staff (semua kolom, bukan cuma ringkasan tabel)
   sebelum tombol "Verifikasi"/"Setujui" (single maupun bulk) benar-benar
   mengeksekusi update ke database.
   ===================================================================== */

// Kolom yang mau ditampilkan di pratinjau, per tabel — pakai urutan
// TABLES[table].columns yang sudah ada (semua field yang diisi pengawas),
// ditambah info status approval di baris paling akhir.
function _approvalPreviewCols(table) {
  return [...TABLES[table].columns, 'status_approval'];
}

function _approvalPreviewRowHtml(table, row) {
  const cols = _approvalPreviewCols(table);
  return `
    <div class="card" style="margin-bottom:14px; border:1px solid var(--border);">
      <div class="table-toolbar" style="justify-content:space-between;">
        <span style="font-size:13px; font-weight:600;">${esc(TABLES[table].label)} — <span class="petak-tag">${esc(row.petak || '-')}</span></span>
        ${badgeForStatus(row.status_approval || 'Menunggu Verifikasi Supervisor')}
      </div>
      <table class="diff-table">
        <thead><tr><th>Kolom</th><th>Diinput Pengawas</th></tr></thead>
        <tbody>
          ${cols.map(col => {
            const v = row[col];
            if (col === 'status_approval') return '';
            if (v === null || v === undefined || v === '') return '';
            return `<tr><td>${esc(FIELD_META[col]?.label || col)}</td><td>${esc(v)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function showApprovalPreviewModal(list, rowsData, onConfirm) {
  const step = approvalStepConfig();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'approvalPreviewOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header">
        <div class="card-title">Pratinjau Sebelum ${esc(step.actionLabel)}</div>
        <button class="btn btn-outline btn-icon" onclick="$('#approvalPreviewOverlay').remove()">✕</button>
      </div>
      <div class="modal-body" style="max-height:70vh; overflow:auto;">
        <p style="font-size:12.5px; color:var(--text-faint); margin-top:-4px;">
          Periksa dulu data yang sudah diinput sebelum ${esc(step.actionLabel.toLowerCase())} ${list.length > 1 ? `${list.length} baris ini` : 'baris ini'}. Data tidak bisa diubah dari sini — kembali ke menu modul jika perlu koreksi.
        </p>
        ${list.map(({ table, id }) => _approvalPreviewRowHtml(table, rowsData[`${table}_${id}`])).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="$('#approvalPreviewOverlay').remove()">Batal</button>
        <button class="btn btn-primary" id="approvalPreviewConfirmBtn">${esc(step.actionLabel)}${list.length > 1 ? ` (${list.length})` : ''}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  $('#approvalPreviewConfirmBtn').addEventListener('click', async () => {
    $('#approvalPreviewConfirmBtn').disabled = true;
    $('#approvalPreviewConfirmBtn').textContent = 'Memproses…';
    await onConfirm();
    $('#approvalPreviewOverlay')?.remove();
  });
}

// Override approveMany: sebelum eksekusi asli (update status_approval),
// ambil data lengkap tiap baris lalu tampilkan pratinjau dulu. Aksi asli
// (dari approval-workflow.js) baru jalan setelah tombol konfirmasi ditekan.
const _coreApproveMany = approveMany;
approveMany = async function (list) {
  if (!list.length) return _coreApproveMany(list);
  const rowsData = {};
  for (const { table, id } of list) {
    const rows = await ensureData(table);
    rowsData[`${table}_${id}`] = rows.find(r => r.id === id) || {};
  }
  showApprovalPreviewModal(list, rowsData, async () => {
    await _coreApproveMany(list);
  });
};

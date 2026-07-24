/* =====================================================================
   BULK EDIT / MASS UPDATE
   Additif, load PALING TERAKHIR. Nambah checkbox pilih banyak baris di
   tabel data modul generik (Pasca Harvest, RPC After Giling, Extra
   Planting, Blanking, Ratoon, Kondisi Bulanan — semua yang didaftar di
   TABLES), lalu satu kolom bisa di-update ke satu nilai yang sama untuk
   SEMUA baris yang dicentang sekaligus (lewat modal terpisah, bukan buka
   satu-satu).

   - Cuma nongol untuk role yang memang punya izin edit modul itu
     (canEditModule() yang sudah ada di app.js).
   - Kolom yang bisa diedit massal dibatasi ke kolom non-computed (bukan
     kategori_pasca_harvest/status_pengecekan_pasca_hvt/status_bulan yang
     dihitung otomatis, bukan juga petak/id/kolom audit).
   - Kalau kolom yang diedit adalah salah satu dari 3 kategori pemicu
     Kategori Pasca Harvest, atau 6 kategori pemicu Status Bulan, field
     otomatis yang bergantung padanya (kategori_pasca_harvest +
     status_pengecekan_pasca_hvt, atau status_bulan) ikut dihitung ulang
     per baris — konsisten dengan logika edit satuan yang sudah ada.
   - Setiap update dicatat ke notifikasi Admin yang sudah ada
     (logNotificationGrouped), sama seperti edit/import biasa.
   ===================================================================== */

const BULK_EDIT_EXCLUDE_COLS = ['petak', 'id', 'kategori_pasca_harvest', 'status_pengecekan_pasca_hvt', 'status_bulan', 'updated_by', 'created_by', 'zona'];
const bulkSelected = {}; // { [table]: Set<id> }

function bulkSelectedSet(table){ return (bulkSelected[table] = bulkSelected[table] || new Set()); }

// 1) Sisipkan checkbox + bar aksi setiap kali tabel modul generik dirender ulang
//    (paintTablePage dipanggil ulang tiap sort/filter/cari/ganti halaman).
const _prevPaintTablePageBulk = paintTablePage;
paintTablePage = function (table, allRows) {
  _prevPaintTablePageBulk(table, allRows);
  if(!TABLES[table] || !canEditModule(table)) return;
  injectBulkEditCheckboxes(table);
  renderBulkBar(table);
};

function injectBulkEditCheckboxes(table){
  const dataTable = document.querySelector('.table-scroll table.data-table');
  const thead = dataTable?.querySelector('thead tr');
  const tbody = dataTable?.querySelector('tbody');
  if(!thead || !tbody) return;
  const selected = bulkSelectedSet(table);

  const thCheck = document.createElement('th');
  thCheck.style.width = '30px';
  thCheck.innerHTML = `<input type="checkbox" id="bulkSelectAll">`;
  thead.insertBefore(thCheck, thead.firstChild);

  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach(tr => {
    const editBtn = tr.querySelector(`button[onclick^="openRecordModal('${table}'"]`);
    if(!editBtn) return; // baris "Tidak ada data yang cocok" gak punya tombol edit
    const m = editBtn.getAttribute('onclick').match(/,\s*(\d+)\)/);
    if(!m) return;
    const id = parseInt(m[1], 10);
    const td = document.createElement('td');
    td.innerHTML = `<input type="checkbox" class="bulk-row-check" data-id="${id}" ${selected.has(id) ? 'checked' : ''}>`;
    tr.insertBefore(td, tr.firstChild);
    td.querySelector('input').onchange = (e) => {
      if(e.target.checked) selected.add(id); else selected.delete(id);
      renderBulkBar(table);
    };
  });

  const selectAll = $('#bulkSelectAll');
  if(selectAll){
    const idsOnPage = rows.map(tr => tr.querySelector('.bulk-row-check')?.dataset.id).filter(Boolean).map(Number);
    selectAll.checked = idsOnPage.length > 0 && idsOnPage.every(id => selected.has(id));
    selectAll.onchange = (e) => {
      idsOnPage.forEach(id => { if(e.target.checked) selected.add(id); else selected.delete(id); });
      injectBulkEditCheckboxes(table);
      renderBulkBar(table);
    };
  }
}

// 2) Bar aksi mengambang di bawah layar — muncul begitu ada baris dicentang.
//    Dibuat sekali per sesi (tidak ikut hilang saat paintTablePage repaint),
//    isinya diperbarui tiap kali jumlah seleksi berubah.
function ensureBulkBarEl(){
  let bar = document.getElementById('bulkEditBar');
  if(bar) return bar;
  bar = document.createElement('div');
  bar.id = 'bulkEditBar';
  bar.style.cssText = `
    position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
    background:var(--bg-elevated); border:1px solid var(--border-soft);
    border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.28);
    padding:10px 14px; display:none; align-items:center; gap:12px;
    z-index:500; font-size:13px; color:var(--text-primary);
  `;
  document.body.appendChild(bar);
  return bar;
}

function renderBulkBar(table){
  const bar = ensureBulkBarEl();
  const count = bulkSelectedSet(table).size;
  if(!count){ bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span><b>${count}</b> baris dipilih</span>
    <button class="btn btn-primary btn-sm" onclick="openBulkEditModal('${table}')">Edit Massal</button>
    <button class="btn btn-outline btn-sm" onclick="bulkClearSelection('${table}')">Batal</button>
  `;
}

function bulkClearSelection(table){
  bulkSelectedSet(table).clear();
  paintTablePage(table, state[table].data);
}

// 3) Modal pilih kolom + nilai baru, lalu terapkan ke semua baris terpilih.
function openBulkEditModal(table){
  const cfg = TABLES[table];
  const ids = Array.from(bulkSelectedSet(table));
  if(!ids.length) return;
  const editableCols = cfg.columns.filter(c => !BULK_EDIT_EXCLUDE_COLS.includes(c));

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'bulkEditOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">Edit Massal — ${esc(cfg.label)}</div>
        <button class="btn btn-outline btn-icon" onclick="closeBulkEditModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12.5px; color:var(--text-faint); margin:-4px 0 14px;">
          Nilai baru akan diterapkan ke <b>${ids.length}</b> baris yang dipilih. Kolom lain pada baris-baris itu tidak berubah.
        </p>
        <div class="form-grid">
          <div>
            <label class="field-label">Kolom yang diedit</label>
            <select class="input" id="bulkEditCol" onchange="renderBulkEditValueField('${table}')">
              ${editableCols.map(c => `<option value="${c}">${esc(FIELD_META[c].label)}</option>`).join('')}
            </select>
          </div>
          <div id="bulkEditValueWrap"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeBulkEditModal()">Batal</button>
        <button class="btn btn-primary" onclick="applyBulkEdit('${table}')">Terapkan ke ${ids.length} Baris</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  renderBulkEditValueField(table);
}

function renderBulkEditValueField(table){
  const col = $('#bulkEditCol')?.value;
  if(!col) return;
  $('#bulkEditValueWrap').innerHTML = fieldHTML(col, '', false).replace(`name="${col}"`, `name="${col}" id="bulkEditValueInput"`);
}

function closeBulkEditModal(){ $('#bulkEditOverlay')?.remove(); }

async function applyBulkEdit(table){
  const cfg = TABLES[table];
  const col = $('#bulkEditCol')?.value;
  const input = $('#bulkEditValueInput');
  if(!col || !input) return;
  let value = input.value;
  if(FIELD_META[col].type === 'number') value = value === '' ? null : parseFloat(value);
  if(value === '') value = null;

  const ids = Array.from(bulkSelectedSet(table));
  const rowsById = new Map(state[table].data.map(r => [r.id, r]));
  const payloadsUsed = []; // { id, payload } — dipakai buat audit trail (before/after)

  const results = await Promise.all(ids.map(id => {
    const existing = rowsById.get(id) || {};
    const payload = { [col]: value };
    // Field turunan otomatis: recompute biar tetap konsisten sama edit satuan.
    if(table === 'pasca_harvest' && typeof KATEGORI_PASCA_TRIGGER_COLS !== 'undefined' && KATEGORI_PASCA_TRIGGER_COLS.includes(col)){
      const merged = { ...existing, [col]: value };
      payload.kategori_pasca_harvest = computeKategoriPascaHarvest(merged);
      const lengkap = KATEGORI_PASCA_TRIGGER_COLS.every(c => (merged[c] ?? '').toString().trim() !== '');
      payload.status_pengecekan_pasca_hvt = lengkap ? 'SUDAH' : 'BELUM';
    }
    if(table === 'kondisi_bulanan' && typeof STATUS_BULAN_TRIGGER_COLS !== 'undefined' && STATUS_BULAN_TRIGGER_COLS.includes(col)){
      const merged = { ...existing, [col]: value };
      payload.status_bulan = computeStatusBulan(merged) || null;
    }
    payloadsUsed.push({ id, payload });
    return supa.from(table).update(payload).eq('id', id);
  }));

  const failed = results.filter(r => r.error);
  const successIds = ids.filter((id, i) => !results[i].error);
  if(successIds.length){
    const updatedRows = successIds.map(id => rowsById.get(id)).filter(Boolean);
    await logNotificationGrouped(table, 'edit', updatedRows);
    // Riwayat Perubahan Data: bandingin nilai lama vs baru per kolom yg kena edit massal.
    const auditRows = [];
    successIds.forEach(id => {
      const rec = payloadsUsed.find(p => p.id === id);
      const existing = rowsById.get(id);
      if(rec) auditRows.push(...buildFieldAuditRows(table, id, existing?.petak, existing, rec.payload, Object.keys(rec.payload), 'bulk_edit'));
    });
    insertFieldAuditRows(auditRows);
  }
  if(failed.length){
    console.error('Bulk edit gagal untuk sebagian baris:', failed.map(f => f.error.message));
    toast(`${successIds.length} baris berhasil, ${failed.length} baris gagal. Cek console untuk detail.`, true);
  } else {
    toast(`${successIds.length} baris berhasil diperbarui.`);
  }

  closeBulkEditModal();
  bulkSelectedSet(table).clear();
  state[table].loaded = false;
  const freshRows = await ensureData(table);
  paintTablePage(table, freshRows);
}

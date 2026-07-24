/* =====================================================================
   APPROVAL WORKFLOW ADDON — Pasca Harvest & Kondisi Bulanan
   Di-load SETELAH estate2-addons.js. Sepenuhnya ADDITIF: tidak mengubah
   app.js / estate2-addons.js, hanya menimpa (override) beberapa fungsi
   global & menambah properti ke config yang sudah ada (TABLES, FIELD_META,
   MODULE_PERMISSIONS).

   Ringkasan alur (lihat workflow_approve.txt):
   - staff input Pasca Harvest & Kondisi Bulanan -> baris otomatis berstatus
     "Menunggu Verifikasi Supervisor" (tanpa tombol submit terpisah).
   - LANGKAH 1: Supervisor (petak/zona tanggung jawabnya sendiri) verifikasi
     dari tab "Approval" -> status jadi "Menunggu Approval Superintendent"
     + tercatat verified_by/at.
   - LANGKAH 2: Superintendent (zona sendiri) approve final dari tab yang
     sama -> status jadi "Disetujui" + tercatat approved_by/at.
   - Admin TIDAK punya akses tab/menu ini sama sekali.
   - Baris yang sudah lewat langkah 1 atau 2 lalu diedit lagi -> otomatis
     balik ke "Menunggu Verifikasi Supervisor" dari awal (verified_by/at
     dan approved_by/at direset).
   - Import ulang (XLSX) TIDAK mengganggu status approval (kolom-kolom
     approval sengaja tidak ikut di TABLES.columns, jadi tidak pernah masuk
     payload import/export/form — lihat approval_schema.sql untuk kolomnya).
   ===================================================================== */

const APPROVAL_TABLES = ['pasca_harvest', 'kondisi_bulanan'];
const APPROVAL_PENDING = 'Menunggu Verifikasi Supervisor'; // step 1
const APPROVAL_STEP2 = 'Menunggu Approval Superintendent'; // step 2
const APPROVAL_DONE = 'Disetujui';

/* ---------------------------------------------------------------------
   1. PATCH CONFIG YANG SUDAH ADA (tidak menyentuh app.js)
   --------------------------------------------------------------------- */
// Staff sekarang punya hak CRUD di Pasca Harvest (dibatasi zona+nama staff
// lewat getUserPersonRestriction() yang sudah generik di app.js), sama
// persis seperti Kondisi Bulanan.
MODULE_PERMISSIONS.pasca_harvest = { edit: ['admin', 'staff'], del: ['admin', 'staff'] };

Object.assign(FIELD_META, {
  status_approval: { label: 'Status Approval', type: 'select', options: [APPROVAL_PENDING, APPROVAL_STEP2, APPROVAL_DONE] },
  verified_by: { label: 'Diverifikasi Oleh', type: 'text' },
  verified_at: { label: 'Waktu Verifikasi', type: 'text' },
  approved_by: { label: 'Disetujui Oleh', type: 'text' },
  approved_at: { label: 'Waktu Approve', type: 'text' },
});

// Tampilkan kolom Status Approval di tabel modul Pasca Harvest & Kondisi
// Bulanan (bukan cuma di tab Approval baru). Sengaja TIDAK ditambahkan ke
// TABLES[...].columns supaya tidak ikut ke form tambah/edit maupun ke
// export/import XLSX.
APPROVAL_TABLES.forEach(t => TABLES[t].listColumns.push('status_approval'));

// Badge warna khusus utk 2 nilai status approval (hijau/kuning), selebihnya
// tetap pakai logika badgeForStatus bawaan.
const _prevBadgeForStatus = badgeForStatus;
badgeForStatus = function (val) {
  const v = (val || '').toString().trim().toLowerCase();
  if (v === 'disetujui') return `<span class="badge badge-done">${esc(val)}</span>`;
  if (v === 'menunggu approval superintendent') return `<span class="badge badge-progress">${esc(val)}</span>`;
  if (v === 'menunggu verifikasi supervisor') return `<span class="badge badge-notyet">${esc(val)}</span>`;
  return _prevBadgeForStatus(val);
};

/* ---------------------------------------------------------------------
   2. OVERRIDE saveRecord() — reset status approval saat baris "Disetujui"
   diedit ulang, dan set default "Menunggu Approval" utk baris baru.
   Tabel selain Pasca Harvest/Kondisi Bulanan tetap pakai perilaku lama
   (delegasi ke saveRecord versi estate2-addons.js).
   --------------------------------------------------------------------- */
const _prevSaveRecord = saveRecord;
saveRecord = async function (table, id) {
  if (!APPROVAL_TABLES.includes(table)) return _prevSaveRecord(table, id);

  const form = $('#recordForm');
  const cfg = TABLES[table];
  const payload = {};
  cfg.columns.forEach(col => {
    const el = form.elements[col];
    let v = el.value;
    if (FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if (table === 'pasca_harvest') payload.kategori_pasca_harvest = computeKategoriPascaHarvest(payload);
  if (table === 'kondisi_bulanan') payload.status_bulan = computeStatusBulan(payload) || null;

  const errors = validatePayload(cfg, payload);
  // Status Pengecekan Pasca HVT: otomatis SUDAH/BELUM (tidak pernah manual), dan
  // Kategori Kondisi Juringan/Tunggul/Gulma WAJIB diisi semua — kalau ada yang
  // kosong, sistem tolak simpan (baris ini tidak boleh berstatus SUDAH parsial).
  if (table === 'pasca_harvest') {
    payload.status_pengecekan_pasca_hvt = computeStatusPengecekanPascaHVT(payload);
    const kosong = KATEGORI_PASCA_TRIGGER_COLS.filter(c => payload[c] === null || payload[c] === undefined || payload[c] === '');
    if (kosong.length) {
      errors.push(`${kosong.map(c => FIELD_META[c].label).join(', ')} wajib diisi semua sebelum Status Pengecekan Pasca HVT bisa otomatis SUDAH.`);
    }
  }

  const before = id ? (state[table].data.find(r => r.id === id) || null) : null;
  const wasProgressed = before && (before.status_approval === APPROVAL_STEP2 || before.status_approval === APPROVAL_DONE);

  if (!before) {
    payload.status_approval = APPROVAL_PENDING; // baris baru selalu mulai dari Menunggu Verifikasi Supervisor
  } else if (wasProgressed) {
    payload.status_approval = APPROVAL_PENDING; // edit baris yang sudah lewat verifikasi/approval -> balik ke step 1
    payload.verified_by = null;
    payload.verified_at = null;
    payload.approved_by = null;
    payload.approved_at = null;
  }
  // Baris yang memang masih "Menunggu Verifikasi Supervisor" -> dibiarkan, tidak perlu disentuh.

  showPreviewModal({
    title: (id ? 'Pratinjau Perubahan' : 'Pratinjau Data Baru') + ' — ' + cfg.label,
    subtitle: (id
      ? 'Periksa kolom yang berubah (ditandai kuning) sebelum menyimpan ke database.'
      : 'Periksa data sebelum ditambahkan ke database.')
      + (wasProgressed ? ' Baris ini sudah melewati verifikasi/approval — menyimpan akan mengembalikannya ke status "Menunggu Verifikasi Supervisor".' : ''),
    diffCols: [...cfg.columns, 'status_approval'],
    before, after: payload, errors,
    confirmLabel: id ? 'Simpan Perubahan' : 'Tambahkan Data',
    onConfirm: async () => {
      const hasAudit = cfg.hasAuditColumns !== false;
      const finalPayload = { ...payload };
      if (hasAudit) finalPayload.updated_by = currentUser.id;
      if (!id && hasAudit) finalPayload.created_by = currentUser.id;

      if (!navigator.onLine) {
        await queueOfflineAction({ table, action: id ? 'update' : 'insert', payload: finalPayload, recordId: id || null, before });
        toast('Offline — data disimpan lokal, akan disinkron otomatis saat online kembali', true);
        closeModal();
        return;
      }

      let res;
      if (id) res = await supa.from(table).update(finalPayload).eq('id', id).select();
      else res = await supa.from(table).insert(finalPayload).select();

      // Fallback: kolom approval (verified_by/at, approved_by/at) belum ada di DB
      // (approval_schema.sql belum dijalankan) -> buang kolom itu, simpan ulang
      // sisanya biar data tidak hilang, lalu kasih tahu admin.
      const APPROVAL_COLS = ['verified_by', 'verified_at', 'approved_by', 'approved_at', 'status_approval'];
      if (res.error && /schema cache/i.test(res.error.message) && APPROVAL_COLS.some(c => res.error.message.includes(c))) {
        const retryPayload = { ...finalPayload };
        APPROVAL_COLS.forEach(c => delete retryPayload[c]);
        res = id ? await supa.from(table).update(retryPayload).eq('id', id).select()
                 : await supa.from(table).insert(retryPayload).select();
        if (!res.error) toast('Data tersimpan, TAPI kolom approval belum ada di database — jalankan approval_schema.sql, lalu hubungi admin.', true);
      }

      if (res.error) { toast('Gagal menyimpan: ' + res.error.message, true); return; }

      toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
      await logNotification({ table, action: id ? 'edit' : 'tambah', petakList: [finalPayload.petak], zona: finalPayload.zona });
      closeModal();
      state[table].loaded = false;
      await ensureData(table);
      paintTablePage(table, state[table].data);
      refreshAllCounts();
    }
  });
};

/* ---------------------------------------------------------------------
   3. TAB "APPROVAL" — 2 langkah verifikator:
   - Supervisor  : verifikator PERTAMA. Lihat baris "Menunggu Verifikasi
     Supervisor" milik zona + petak yang jadi tanggung jawabnya sendiri
     (dibatasi otomatis oleh getUserZonaRestriction()/
     getUserPersonRestriction() lewat ensureData()). Aksi "Verifikasi"
     -> status jadi "Menunggu Approval Superintendent" + verified_by/at.
   - Superintendent : verifikator KEDUA. Lihat baris "Menunggu Approval
     Superintendent" di zonanya sendiri. Aksi "Setujui" -> status jadi
     "Disetujui" + approved_by/at.
   Admin tidak termasuk verifikator sama sekali (tidak ada akses tab ini).
   --------------------------------------------------------------------- */
function canAccessApprovalTab() {
  return ['supervisor', 'superintendent'].includes(currentProfile?.role);
}

// Status mana yang jadi giliran role saat ini, dan status/label tujuan setelah aksi.
function approvalStepConfig() {
  if (currentProfile?.role === 'supervisor') {
    return { pendingStatus: APPROVAL_PENDING, nextStatus: APPROVAL_STEP2, actionLabel: 'Verifikasi', bulkLabel: 'Verifikasi Terpilih', actorField: 'verified_by', atField: 'verified_at', doneToast: 'diverifikasi' };
  }
  if (currentProfile?.role === 'superintendent') {
    return { pendingStatus: APPROVAL_STEP2, nextStatus: APPROVAL_DONE, actionLabel: 'Setujui', bulkLabel: 'Approve Terpilih', actorField: 'approved_by', atField: 'approved_at', doneToast: 'disetujui' };
  }
  return null;
}

async function fetchApprovalRows() {
  const step = approvalStepConfig();
  if (!step) return [];
  const items = [];
  for (const table of APPROVAL_TABLES) {
    const rows = await ensureData(table); // sudah dibatasi zona/petak sesuai role
    rows
      .filter(r => (r.status_approval || APPROVAL_PENDING) === step.pendingStatus)
      .forEach(r => items.push({ table, row: r }));
  }
  return items;
}

async function renderApproval() {
  if (!canAccessApprovalTab()) { toast('Menu ini tidak tersedia untuk role Anda', true); return navigate('dashboard'); }
  $('#pageEyebrow').textContent = 'PERSETUJUAN';
  $('#pageTitle').textContent = 'Approval';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const items = await fetchApprovalRows();
  paintApproval(items);
}

function paintApproval(items) {
  const step = approvalStepConfig();
  const stepLabel = currentProfile.role === 'supervisor' ? 'verifikasi (langkah 1 dari 2)' : 'approval final (langkah 2 dari 2)';
  $('#pageContent').innerHTML = `
    <div class="card">
      <div class="table-toolbar">
        <span style="font-size:12.5px; color:var(--text-faint);">${items.length} baris menunggu ${esc(stepLabel)} — Zona ${esc(getUserZonaRestriction() || '')}</span>
        <button class="btn btn-outline btn-sm" onclick="renderApproval()">Muat Ulang</button>
        <button class="btn btn-primary btn-sm" id="bulkApproveBtn" ${items.length ? '' : 'disabled'}>${esc(step.bulkLabel)}</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th><input type="checkbox" id="approvalSelectAll" ${items.length ? '' : 'disabled'}></th>
            <th>Modul</th><th>Petak</th><th>Zona</th><th>Superitendent</th><th>Supervisor</th><th>Staff</th><th>Status</th><th>Aksi</th>
          </tr></thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="9"><div class="empty-state">Tidak ada baris menunggu ${esc(stepLabel)}.</div></td></tr>` :
              items.map(it => `<tr>
                <td><input type="checkbox" class="approvalCheck" data-table="${it.table}" data-id="${it.row.id}"></td>
                <td>${esc(TABLES[it.table].label)}</td>
                <td><span class="petak-tag">${esc(it.row.petak)}</span></td>
                <td>${esc(it.row.zona)}</td>
                <td>${esc(it.row.superitendent)}</td>
                <td>${esc(it.row.supervisor)}</td>
                <td>${esc(it.row.staff)}</td>
                <td>${badgeForStatus(it.row.status_approval || APPROVAL_PENDING)}</td>
                <td><button class="btn btn-primary btn-sm" onclick="approveOne('${it.table}', ${it.row.id})">${esc(step.actionLabel)}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  $('#approvalSelectAll')?.addEventListener('change', function () {
    $all('.approvalCheck').forEach(cb => cb.checked = this.checked);
  });
  $('#bulkApproveBtn')?.addEventListener('click', async () => {
    const list = $all('.approvalCheck:checked').map(cb => ({ table: cb.dataset.table, id: parseInt(cb.dataset.id) }));
    if (!list.length) { toast('Pilih minimal 1 baris', true); return; }
    await approveMany(list);
  });
}

async function approveOne(table, id) { await approveMany([{ table, id }]); }

async function approveMany(list) {
  const step = approvalStepConfig();
  if (!step) return;
  const actorName = currentProfile.full_name || currentProfile.email;
  const nowIso = new Date().toISOString();
  const results = await Promise.all(list.map(({ table, id }) =>
    supa.from(table).update({ status_approval: step.nextStatus, [step.actorField]: actorName, [step.atField]: nowIso }).eq('id', id)
  ));
  const failed = results.filter(r => r.error).length;
  const ok = list.length - failed;
  toast(failed ? `${ok} baris ${step.doneToast}, ${failed} gagal` : `${ok} baris berhasil ${step.doneToast}`, !!failed && !ok);
  APPROVAL_TABLES.forEach(t => state[t].loaded = false);
  refreshAllCounts();
  renderApproval();

  if (!window.sendPushTrigger || ok <= 0) return;
  for (const table of APPROVAL_TABLES) {
    const rows = await ensureData(table);
    const doneIds = new Set(list.filter(l => l.table === table).map(l => l.id));
    if (step.nextStatus === APPROVAL_STEP2) {
      // Supervisor baru verifikasi -> beri tahu Superintendent zona terkait supaya lanjut approval final.
      const zonas = [...new Set(rows.filter(r => doneIds.has(r.id) && r.zona).map(r => r.zona.toString().trim()))];
      for (const zona of zonas) {
        sendPushTrigger({
          roles: ['superintendent'],
          zona,
          title: 'Menunggu Approval Superintendent',
          body: `${ok} data di ${TABLES[table]?.label || table} sudah diverifikasi Supervisor, menunggu approval final.`,
          tag: 'approval-step2',
        });
      }
    } else {
      // Superintendent approve final -> beri tahu staff pemilik petak (berdasar nama di kolom 'staff').
      const staffNames = [...new Set(rows.filter(r => doneIds.has(r.id) && r.staff).map(r => r.staff.toString().trim()))];
      if (staffNames.length) {
        sendPushTrigger({
          full_names: staffNames,
          title: 'Data Disetujui',
          body: `${ok} data di ${TABLES[table]?.label || table} sudah disetujui oleh ${actorName}`,
          tag: 'approval-done',
        });
      }
    }
  }
}

/* ---------------------------------------------------------------------
   4. OVERRIDE navigate() — routing tab 'approval'
   --------------------------------------------------------------------- */
const _prevNavigateApproval = navigate;
navigate = async function (view) {
  if (view === 'approval' && !canAccessApprovalTab()) {
    toast('Menu ini tidak tersedia untuk role Anda', true);
    return _prevNavigateApproval('dashboard');
  }
  if (view === 'approval') {
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const activeItem = $all('.nav-item').find(el => el.dataset.view === view);
    const parentSection = activeItem?.closest('.nav-section');
    if (parentSection && parentSection.classList.contains('collapsed')) {
      parentSection.classList.remove('collapsed');
      const key = parentSection.id.replace('navSection_', '');
      const btn = parentSection.querySelector('.nav-section-label');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      saveNavSectionState(key, false);
    }
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderApproval();
    return;
  }
  return _prevNavigateApproval(view);
};

/* ---------------------------------------------------------------------
   5. OVERRIDE applyRoleUI() — tampilkan menu Approval hanya utk
   Supervisor & Superintendent (Admin tetap disembunyikan).
   --------------------------------------------------------------------- */
const _prevApplyRoleUIApproval = applyRoleUI;
applyRoleUI = function () {
  _prevApplyRoleUIApproval();
  const el = $('#navSection_approval');
  if (el) el.style.display = canAccessApprovalTab() ? '' : 'none';
};

/* ---------------------------------------------------------------------
   6. OVERRIDE refreshAllCounts() — badge jumlah pending di menu Approval
   --------------------------------------------------------------------- */
const _prevRefreshAllCountsApproval = refreshAllCounts;
refreshAllCounts = async function () {
  await _prevRefreshAllCountsApproval();
  if (!canAccessApprovalTab()) return;
  const step = approvalStepConfig();
  let pending = 0;
  for (const t of APPROVAL_TABLES) {
    const rows = await ensureData(t);
    pending += rows.filter(r => (r.status_approval || APPROVAL_PENDING) === step.pendingStatus).length;
  }
  const el = $('#countBadge_approval');
  if (el) el.textContent = pending;
};

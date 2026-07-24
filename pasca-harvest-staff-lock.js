/* =====================================================================
   PASCA HARVEST — SPLIT AKSES ADMIN (A–O) vs STAFF (P–T) + FIX STATUS
   PENGECEKAN JADI MANUAL BENERAN
   Additif, load PALING TERAKHIR. Tidak ubah app.js/estate2-addons.js/
   approval-workflow.js.

   Acuan kolom (lihat 3__database_template_-_Pasca_Harvest.xlsx):
     A id (auto, tidak di form)
     B..G, I..P  petak, size_rkt, varietas, status_petak,
           action_plan_current_crop_2026, phasing_2026, status_progress,
           bapp, bulan_tebang, tch_nett_bapp_2026, zona, superitendent,
           supervisor, staff                    -> HANYA ADMIN yang isi
     H     Estimasi TCH 2026                    -> ikut ke-import admin
           (dibaca & diupdate manual di sini, walau tidak ada di
           TABLES.pasca_harvest.columns / tidak muncul di form Tambah-
           Edit). Ditangani khusus di bagian import (lihat poin 5),
           bukan lewat cfg.columns biasa.
     Q..T  status_pengecekan_pasca_hvt, kategori_kondisi_juringan,
           kategori_tunggul, kategori_kondisi_gulma
                                                  -> HANYA STAFF yang isi
     U     kategori_pasca_harvest                -> otomatis+disabled,
           tidak diisi siapapun (dihitung dari Q..T-nya sendiri)

   Catatan: kolom di atas dicocokkan berdasarkan NAMA kolom (header di
   baris 1 file Excel = nama field, mis. "petak", "status_pengecekan_
   pasca_hvt"), bukan berdasarkan posisi/huruf kolom. Jadi kalau suatu
   saat template Excel-nya nambah/geser kolom lagi (kayak "Estimasi TCH
   2026" yang nambah di posisi H), split akses admin B..P vs staff Q..U
   di bawah ini TETAP jalan benar selama header nama kolomnya konsisten.

   1) Tombol "Hapus" Pasca Harvest dihilangkan utk semua role (tidak
      diubah dari versi sebelumnya).
   2) status_pengecekan_pasca_hvt DIKEMBALIKAN jadi field manual asli
      (dropdown SUDAH/BELUM), bukan auto-compute dari 3 kategori kondisi.
      Auto-compute lama itu penyebab dashboard "Status Pengecekan Pasca
      HVT" nampilin 100% SUDAH padahal petaknya belum benar dicek.
   3) Form tambah/edit Pasca Harvest:
        - role ADMIN   -> hanya kolom B..O yang bisa diisi/diubah, P..T dikunci.
        - role STAFF   -> hanya kolom P..T yang bisa diisi/diubah, B..O dikunci.
      Role lain tidak relevan: MODULE_PERMISSIONS.pasca_harvest hanya
      mengizinkan admin & staff (diset oleh approval-workflow.js).
   4) Import XLSX Pasca Harvest (admin-only): kolom P..T DIBUANG dari
      payload sebelum update ke DB, bukan diisi null. Jadi kalau file
      Excel-nya kolom P..T kosong/tidak diupdate, data pengecekan staff
      yang sudah ada di DB tidak ketimpa/kehapus.
   ===================================================================== */

// --- 1) Hapus tombol Hapus Pasca Harvest, semua role ---
const _prevCanDeleteModulePH = canDeleteModule;
canDeleteModule = function (moduleKey) {
  if (moduleKey === 'pasca_harvest') return false;
  return _prevCanDeleteModulePH(moduleKey);
};

// --- 2) status_pengecekan_pasca_hvt jadi manual beneran (pass-through),
// bukan diturunkan otomatis dari kelengkapan 3 kategori kondisi ---
computeStatusPengecekanPascaHVT = function (row) {
  const v = (row.status_pengecekan_pasca_hvt || '').toString().trim().toUpperCase();
  return v === 'SUDAH' ? 'SUDAH' : 'BELUM';
};

// fieldHTML: render dropdown SUDAH/BELUM beneran (bukan <input disabled>
// hardcoded) begitu field ini tidak sedang dikunci utk role saat ini.
const _prevFieldHTMLPH = fieldHTML;
fieldHTML = function (col, val, readonly) {
  if (col === 'status_pengecekan_pasca_hvt' && !readonly) {
    const meta = FIELD_META[col];
    const shown = val || 'BELUM';
    const options = meta.options.map(o => `<option value="${o}" ${shown === o ? 'selected' : ''}>${o}</option>`).join('');
    return `<div><label class="field-label">${meta.label}</label><select class="input" id="field_status_pengecekan_pasca_hvt" name="status_pengecekan_pasca_hvt">${options}</select></div>`;
  }
  return _prevFieldHTMLPH(col, val, readonly);
};

// updateKategoriPascaHarvestPreview asli ikut nimpa field status_pengecekan_pasca_hvt
// balik ke auto-compute tiap kali kategori kondisi diubah (peninggalan logic lama) —
// override supaya cuma preview "Kategori Pasca Harvest" (yang memang auto) yang
// diupdate, field status pengecekan dibiarkan sesuai pilihan staff.
updateKategoriPascaHarvestPreview = function () {
  const field = $('#field_kategori_pasca_harvest');
  const form = $('#recordForm');
  if (!field || !form) return;
  const row = {};
  KATEGORI_PASCA_TRIGGER_COLS.forEach(c => { row[c] = form.elements[c] ? form.elements[c].value : ''; });
  const kategori = computeKategoriPascaHarvest(row);
  field.value = kategori;
  field.style.color = kategori === 'Baik' ? 'var(--accent-green)' : kategori === 'Cukup' ? 'var(--accent-gold)' : kategori === 'Kurang' ? 'var(--accent-red)' : '';
};

// --- 3) saveRecord Pasca Harvest: sama seperti versi approval-workflow.js,
// TAPI tanpa paksaan "3 kategori kondisi wajib diisi semua" (peninggalan
// logic auto-compute lama) — sekarang admin boleh simpan B..O duluan
// walau P..T (punya staff) belum diisi sama sekali.
const _prevSaveRecordPH = saveRecord;
saveRecord = async function (table, id) {
  if (table !== 'pasca_harvest') return _prevSaveRecordPH(table, id);

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
  payload.kategori_pasca_harvest = computeKategoriPascaHarvest(payload);
  payload.status_pengecekan_pasca_hvt = computeStatusPengecekanPascaHVT(payload);

  const errors = validatePayload(cfg, payload);

  const before = id ? (state[table].data.find(r => r.id === id) || null) : null;
  const wasProgressed = before && (before.status_approval === APPROVAL_STEP2 || before.status_approval === APPROVAL_DONE);

  if (!before) {
    payload.status_approval = APPROVAL_PENDING;
  } else if (wasProgressed) {
    payload.status_approval = APPROVAL_PENDING;
    payload.verified_by = null;
    payload.verified_at = null;
    payload.approved_by = null;
    payload.approved_at = null;
  }

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
      renderTable(table);
      refreshAllCounts();
    },
  });
};

// --- 4) Kunci field form Pasca Harvest per role: admin -> B..O saja,
// staff -> P..T saja ---
const ADMIN_EDITABLE_PASCA_HARVEST = [
  'petak', 'size_rkt', 'varietas', 'status_petak', 'action_plan_current_crop_2026',
  'phasing_2026', 'status_progress', 'bapp', 'bulan_tebang', 'tch_nett_bapp_2026',
  'zona', 'superitendent', 'supervisor', 'staff',
];
const STAFF_EDITABLE_PASCA_HARVEST = [
  'status_pengecekan_pasca_hvt',
  'kategori_kondisi_juringan',
  'kategori_tunggul',
  'kategori_kondisi_gulma',
  // kategori_pasca_harvest sengaja tidak di sini — tetap otomatis+disabled.
];

const _prevOpenRecordModalPH = openRecordModal;
openRecordModal = async function (table, id) {
  const role = currentProfile?.role;
  const isSplitRole = table === 'pasca_harvest' && (role === 'admin' || role === 'staff');
  if (!isSplitRole) return _prevOpenRecordModalPH(table, id);

  const editableCols = role === 'admin' ? ADMIN_EDITABLE_PASCA_HARVEST : STAFF_EDITABLE_PASCA_HARVEST;
  const noteText = role === 'admin'
    ? 'Anda hanya bisa mengisi data master petak (kolom B–P). Kolom pengecekan pasca HVT (Q–U) diisi oleh staff.'
    : 'Anda hanya bisa mengisi hasil pengecekan pasca HVT (kolom Q–U, kolom U otomatis terisi). Data master petak (kolom B–P) diisi oleh admin.';

  const cfg = TABLES[table];
  const record = id ? state[table].data.find(r => r.id === id) : null;
  const zonaRestrict = getUserZonaRestriction();
  const needsPetakMaster = cfg.columns.includes('petak') &&
    ['zona', 'superitendent', 'supervisor', 'staff'].some(c => cfg.columns.includes(c));
  currentPetakZonaMap = needsPetakMaster ? await getPetakZonaMap() : new Map();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — ${cfg.label}</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:11.5px; color:var(--text-faint); margin:-4px 0 14px;">${noteText}</p>
        <form id="recordForm" class="form-grid">
          ${cfg.columns.map(col => {
            const locked = !editableCols.includes(col);
            if (col === 'petak' && needsPetakMaster) return petakFieldHTML(record ? record[col] : '', locked);
            return fieldHTML(col, record ? record[col] : '', locked);
          }).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        <button class="btn btn-primary" onclick="saveRecord('${table}'${record ? ',' + record.id : ''})">Simpan Data</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  updateKategoriPascaHarvestPreview();
};

// --- 5) Import XLSX Pasca Harvest: kolom Q..U (status pengecekan + 3
// kategori kondisi milik staff, + kategori_pasca_harvest yang auto)
// dibuang dari payload update (bukan di-null-kan), jadi kolom kosong/
// tak-terupdate di file Excel tidak menghapus data pengecekan staff
// yang sudah ada di DB. Kolom H (Estimasi TCH 2026) juga tidak pernah
// ikut terbaca karena bukan bagian dari cfg.columns. ---
const _prevHandleImportFilePH = handleImportFile;
handleImportFile = async function (table, input) {
  if (table !== 'pasca_harvest') return _prevHandleImportFilePH(table, input);
  if (!isAdminRole()) { toast('Hanya Admin yang dapat mengimpor data', true); input.value = ''; return; }
  const file = input.files[0]; if (!file) return;
  showImportProgress();
  const cfg = TABLES[table];
  const normalizeHeaderKey = s => (s ?? '').toString().trim().toLowerCase().replace(/[\s_/-]+/g, '');
  const reader = new FileReader();
  reader.onprogress = (e) => { if (e.lengthComputable) setImportProgress((e.loaded / e.total) * 30, 'Membaca file…'); };
  reader.onload = async (e) => {
    try {
      setImportProgress(32, 'Memproses data…');
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const petakNormKey = normalizeHeaderKey(FIELD_META.petak.label);
      let sheetName = wb.SheetNames.find(name => {
        const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false })[0] || [];
        return headerRow.some(h => normalizeHeaderKey(h) === petakNormKey);
      });
      if (!sheetName) sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!json.length) { hideImportProgress(false); toast('File kosong atau format tidak dikenali', true); return; }
      const normToRawKey = {};
      Object.keys(json[0]).forEach(k => { normToRawKey[normalizeHeaderKey(k)] = k; });
      const zonaRestrict = getUserZonaRestriction();
      const payloadRows = json.map(row => {
        const o = {};
        cfg.columns.forEach(c => {
          const label = FIELD_META[c].label;
          let v;
          if (row[c] !== undefined) v = row[c];
          else if (row[label] !== undefined) v = row[label];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)];
            v = rawKey !== undefined ? row[rawKey] : null;
          }
          if (FIELD_META[c].type === 'number' && v !== null && v !== '') v = parseFloat(v);
          if (FIELD_META[c].type === 'date' && v !== null && v !== '') v = parseAnyDateToISO(v);
          if (v === '') v = null;
          o[c] = v === undefined ? null : v;
        });
        // Kolom H "Estimasi TCH 2026" (estimasi_tch_2026) sengaja tidak
        // ada di TABLES.pasca_harvest.columns, tapi tetap mau ikut
        // ke-update saat admin import (bukan diabaikan lagi).
        {
          const c = 'estimasi_tch_2026';
          const label = FIELD_META[c].label;
          let v;
          if (row[c] !== undefined) v = row[c];
          else if (row[label] !== undefined) v = row[label];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)];
            v = rawKey !== undefined ? row[rawKey] : undefined;
          }
          if (v !== undefined) {
            if (v !== null && v !== '') v = parseFloat(v);
            if (v === '') v = null;
            o[c] = v;
          }
        }
        if (zonaRestrict && cfg.columns.includes('zona')) o.zona = zonaRestrict;
        if (cfg.hasAuditColumns !== false) o.updated_by = currentUser.id;
        // Kolom P..T (milik staff) DIBUANG total dari payload import, bukan
        // di-null-kan — supaya file Excel yang kosong di kolom ini tidak
        // menghapus data pengecekan staff yang sudah tersimpan di DB.
        STAFF_EDITABLE_PASCA_HARVEST.concat('kategori_pasca_harvest').forEach(c => delete o[c]);
        return o;
      }).filter(r => r.petak);
      if (!payloadRows.length) { hideImportProgress(false); toast('Tidak ditemukan kolom "petak" pada file. Gunakan template database_template.xlsx', true); return; }
      setImportProgress(38, 'Mencocokkan data…');

      const matchKeys = cfg.importMatchKeys || ['petak'];
      const normKeyPart = (col, v) => col === 'petak'
        ? (v ?? '').toString().trim().toUpperCase()
        : (v ?? '').toString().trim().toLowerCase();
      const buildKey = row => matchKeys.map(k => normKeyPart(k, row[k])).join('||');

      const existingRows = await ensureData(table);
      const existingMap = new Map();
      const existingRowById = new Map();
      existingRows.forEach(r => { const key = buildKey(r); if (key) existingMap.set(key, r.id); existingRowById.set(r.id, r); });

      const matched = [];
      const unmatchedPetak = [];
      payloadRows.forEach(o => {
        const key = buildKey(o);
        const id = existingMap.get(key);
        if (id) matched.push({ id, payload: o });
        else unmatchedPetak.push(o.petak);
      });

      if (!matched.length) {
        hideImportProgress(false);
        toast('Tidak ada petak yang cocok dengan data yang sudah ada. Impor dibatalkan (tidak menambah petak baru).', true);
        return;
      }

      setImportProgress(45, 'Menyimpan data…');
      let doneOps = 0;
      const bumpProgress = () => { doneOps++; setImportProgress(45 + (doneOps / matched.length) * 50, 'Menyimpan data…'); };

      const updateResults = await Promise.all(matched.map(m => supa.from(table).update(m.payload).eq('id', m.id).then(r => { bumpProgress(); return r; })));
      const failedUpdate = updateResults.filter(r => r.error);
      const successUpdate = matched.length - failedUpdate.length;
      hideImportProgress(true);

      const auditRows = [];
      matched.forEach((m, i) => {
        if (updateResults[i].error) return;
        const before = existingRowById.get(m.id);
        auditRows.push(...buildFieldAuditRows(table, m.id, m.payload.petak || before?.petak, before, m.payload, ADMIN_EDITABLE_PASCA_HARVEST.concat('estimasi_tch_2026'), 'import'));
      });
      insertFieldAuditRows(auditRows);

      if (successUpdate) await logNotificationGrouped(table, 'import', matched.filter((_, i) => !updateResults[i].error).map(m => m.payload));

      let msg = '';
      if (successUpdate) msg += `${successUpdate} baris diperbarui (kolom B–P saja, kolom staff Q–U tidak disentuh)`;
      if (unmatchedPetak.length) msg += (msg ? ', ' : '') + `${unmatchedPetak.length} baris dilewati (petak tidak ditemukan)`;
      if (failedUpdate.length) msg += (msg ? ', ' : '') + `${failedUpdate.length} gagal diperbarui`;
      if (!msg) msg = 'Tidak ada data yang diproses';
      toast(msg, successUpdate === 0);

      state[table].loaded = false;
      await ensureData(table);
      paintTablePage(table, state[table].data);
      refreshAllCounts();
    } catch (err) {
      hideImportProgress(false);
      toast('Gagal membaca file: ' + err.message, true);
    } finally {
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
};

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'records.json');
const EXCEL_FILE = path.join(__dirname, 'data', 'excel.json');

// Nonaktifkan ETag agar API tidak pernah mengembalikan 304/not-modified
// yang membuat browser memakai data lama. Data live harus selalu fresh.
app.disable('etag');

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Baca file teks & buang BOM (byte order mark) bila ada agar JSON.parse selalu valid.
function readJsonSafe(filePath, fallback) {
    try {
        let raw = fs.readFileSync(filePath, 'utf8');
        raw = raw.replace(/^\uFEFF/, '');
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function loadRecords() {
    const records = readJsonSafe(DATA_FILE, []);
    if (!Array.isArray(records)) return [];
    return records.filter(r => r && r.id);
}

function saveRecords(records) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function loadExcelData() {
    const data = readJsonSafe(EXCEL_FILE, []);
    return Array.isArray(data) ? data : [];
}

function saveExcelData(data) {
    fs.mkdirSync(path.dirname(EXCEL_FILE), { recursive: true });
    fs.writeFileSync(EXCEL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ============ GEMINI AI ============
// ============ GEMINI AI ============
const GEMINI_PROMPT = `Kamu adalah analis CRM senior untuk divisi sales dana tunai jaminan BPKB. Analisis data kunjungan sales (SCOR) berikut beserta foto dokumentasinya.

ATURAN EVALUASI & TRIGGER PENILAIAN VISUAL FOTO (Penting!):

1. ANALISIS VISUAL FOTO DOKUMENTASI (Wajib diperiksa dari foto):
   a. ATURAN JUMLAH ORANG & VERIFIKASI TIM (SYARAT MINIMAL 3 ORANG):
      - Jika foto memperlihatkan 3 ORANG ATAU LEBIH (misal: SCOR, Mitra Agen, dan Tim/Calon Nasabah) berinteraksi bersama di lokasi: 
        -> Berikan BONUS +15 POIN pada dealScore.
        -> Di 'visualFindings' WAJIB tuliskan: "✅ Verifikasi Dokumentasi Tim Ideal: Terlihat 3 orang atau lebih (SCOR, Mitra Agen, dan Tim/Nasabah) berinteraksi aktif di lokasi."
      - Jika foto memperlihatkan KURANG DARI 3 ORANG (hanya 1 atau 2 orang, atau hanya foto lokasi/selfie tunggal):
        -> WAJIB BERIKAN PENALTI -15 POIN pada dealScore.
        -> Di 'visualFindings' WAJIB tuliskan: "⚠️ Penalti Dokumentasi Kurang Lengkap: Foto memperlihatkan KURANG DARI 3 ORANG (idealnya minimal 3 orang: SCOR, Mitra Agen, & Tim/Nasabah). Potensi Go-Live dikurangi."

   b. SUASANA LOKASI & LINGKUNGAN:
      - Identifikasi apakah lokasi berupa Showroom/Dealer, Kantor Bank/BPR, Tempat Tongkrongan/Warkop Agregator, atau Pos Collection.

   c. KEHADIRAN ATRIBUT KOMPETITOR:
      - Jika terlihat atribut/banner/brosur multifinance/leasing lain di lokasi: Kurangi lagi -15 poin dealScore, catat di visualFindings & ubah sentiment menjadi "Netral" atau "Negatif".

2. ATURAN PENILAIAN DEAL SCORE TEKS & PROSPEK:
   a. LAPORAN SINGKAT / FORMALITAS: Jika 'Resume Kunjungan' sangat singkat (< 8 kata) DAN tidak memuat info prospek/kesepakatan:
      - dealScore WAJIB diberikan RENDAH: antara 25 sampai 35 saja.
      - sentiment: "Netral".
      - actionItems WAJIB diawali: "⚠️ LAPORAN KURANG INFORMATIF: Harap lengkapi detail hasil obrolan, potensi unit/BPKB, dan jadwal follow-up."
   b. KUNJUNGAN AWAL STANDAR: Jika resume perkenalan awal tanpa janji berkas nyata: dealScore = 45 - 55.
   c. KUNJUNGAN AWAL PROSPEKTIF: Jika ada janji prospek/berkas aplikasi minggu ini: dealScore = 65 - 75.
   d. MAINTENANCE RUTIN + BERKAS MASUK: Kunjungan berulang & berkas aplikasi sudah diterima: dealScore = 80 - 95.

Kembalikan JSON persis dengan format berikut (tanpa markdown, tanpa teks lain):
{
  "sentiment": "Positif|Netral|Negatif",
  "dealScore": <angka 25-95 sesuai aturan di atas>,
  "urgency": "Sangat Tinggi|Tinggi|Sedang",
  "activityType": "Maintenance Rutin|Kunjungan Awal",
  "agentCategory": "kategori agen (misal Agen Perbankan, Sales Kendaraan/Dealer, Tim Collection, Partner Multifinance)",
  "summary": "ringkasan eksekutif 2-3 kalimat berbahasa Indonesia",
  "visualFindings": ["temuan dari foto, 2-3 poin berbahasa Indonesia"],
  "actionItems": ["action plan untuk SCOR, 2-3 poin berbahasa Indonesia"]
}`;

async function analyzeWithGemini(payload) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const parts = [{
        text: `${GEMINI_PROMPT}\n\nData Kunjungan:\n- Cabang: ${payload.branch}\n- Nama SCOR: ${payload.sales}\n- Instansi/Visit: ${payload.clientCompany}\n- Bertemu: ${payload.clientContactName}\n- Resume Kunjungan: ${payload.resume}`
    }];

    (payload.images || []).slice(0, 3).forEach(img => {
        const rawUrl = String(img.url || img || '').trim();
        const m = rawUrl.match(/^data:(image\/[a-zA-Z0-9\+\-\.]+);base64,([\s\S]+)$/);
        if (m) {
            parts.push({
                inline_data: {
                    mime_type: m[1].toLowerCase(),
                    data: m[2].replace(/\s+/g, '')
                }
            });
        }
    });

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini API error: ${JSON.stringify(data).slice(0, 300)}`);

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(text);
}

// ============ FALLBACK SIMULASI (jika tidak ada API key / Gemini error) ============
function runSimulation(payload) {
    const { branch, sales, clientCompany, clientContactName, resume, images } = payload;
    const cleanResume = (resume || '').trim();
    const lower = cleanResume.toLowerCase();
    const words = cleanResume.split(/\s+/).filter(Boolean);

    let agentCategory = 'Agen Dana Tunai';
    if (lower.includes('bank') || lower.includes('perbankan') || lower.includes('bpr')) {
        agentCategory = 'Agen Perbankan (Bank/BPR)';
    } else if (lower.includes('dealer') || lower.includes('showroom') || lower.includes('sales motor') || lower.includes('sales mobil')) {
        agentCategory = 'Sales Kendaraan / Dealer';
    } else if (lower.includes('coll') || lower.includes('collection') || lower.includes('collector') || lower.includes('bucket')) {
        agentCategory = 'Tim Collection (Bucket Awal)';
    } else if (lower.includes('multifinance') || lower.includes('leasing')) {
        agentCategory = 'Orang / Partner Multifinance';
    }

    const isRepeatVisit = /rutin|berulang|maintenance|kesekian|lagi|akrab|langganan|repeat|follow up/.test(lower);
    const hasApplicationIn = /aplikasi|berkas|bpkb|data konsumen|kirim data|terima bpkb|prospek masuk|go live/.test(lower);
    const activityType = isRepeatVisit ? 'Maintenance Rutin' : 'Kunjungan Awal';

    // Pengecekan resume terlalu pendek / formalitas tanpa konteks
    const isShortOrVague = words.length < 8 || /^(bertemu|kunjungan|visit)\s+(dengan\s+)?(agen|agent|mitra)$/i.test(cleanResume);

    let dealScore = 45;
    let sentiment = 'Positif';
    let urgency = 'Sedang';

    if (isShortOrVague) {
        dealScore = 30;
        sentiment = 'Netral';
        urgency = 'Sedang';
    } else {
        if (isRepeatVisit) dealScore += 20;
        if (hasApplicationIn) dealScore += 20;

        if (/kendala|saingan|kompetitor|lambat|bunga tinggi|sulit/.test(lower)) {
            dealScore -= 18;
            sentiment = /batal|kecewa|pindah/.test(lower) ? 'Negatif' : 'Netral';
        }

        if (dealScore >= 70) urgency = 'Sangat Tinggi';
        else if (dealScore >= 55) urgency = 'Tinggi';
    }

    const photoCount = (images || []).length;
    // Rule Minimal 3 Orang: Jika jumlah foto / indikator tim < 3, kurangi dealScore sebesar 15 poin
    const isTeamPhotosPresent = photoCount >= 3;
    if (!isTeamPhotosPresent) {
        dealScore -= 15;
    }

    dealScore = Math.max(25, Math.min(95, dealScore));
    const contactPerson = clientContactName || 'Agen Partner';
    const clientLabel = clientCompany ? clientCompany : `Mitra ${agentCategory}`;

    let summary = '';
    if (isShortOrVague) {
        summary = `Kunjungan SCOR ${sales.split(' ')[0]} ke ${clientLabel} di ${branch}. ⚠️ LAPORAN KURANG INFORMATIF: Resume catatan sangat singkat (< 8 kata). Potensi Go-Live dinilai rendah (30%) karena belum ada detail prospek & hasil negosiasi.`;
    } else {
        summary = `Kunjungan SCOR ${sales.split(' ')[0]} ke ${clientLabel} (Kategori: ${agentCategory}, Contact: ${contactPerson}) di ${branch}. Status Activity: [${activityType}]. ${isRepeatVisit ? 'Hubungan dengan agen sudah terpelihara melalui maintenance berulang, siap menghasilkan aplikasi Go-Live.' : 'Kunjungan baru di tahap awal. SCOR perlu mengawal agar terjadi repeat visit & pencairan BPKB.'}`;
    }

    const visualFindings = [
        `Dokumentasi Activity: Terverifikasi ${photoCount} foto bukti lokasi di ${clientLabel}.`,
        isTeamPhotosPresent
            ? `✅ Verifikasi Dokumentasi Tim Ideal: Terlihat 3 foto/kelengkapan tim (SCOR, ${contactPerson}, & Tim/Nasabah) di lokasi.`
            : `⚠️ Penalti Dokumentasi Kurang Lengkap: Foto memperlihatkan KURANG DARI 3 ORANG/DOKUMEN (idealnya minimal 3: SCOR, ${contactPerson}, & Tim/Nasabah). Nilai Deal Score dikurangi 15 poin.`,
        lower.includes('kompetitor') || lower.includes('saingan')
            ? 'Tampak kehadiran atribut multifinance lain. SCOR perlu meningkatkan frekuensi kunjungan agar agen tidak berpaling.'
            : 'Kondisi tempat kerja agen kondusif untuk penetrasi program pencairan dana BPKB.'
    ];

    const actionItems = [];
    if (isShortOrVague) {
        actionItems.push(`⚠️ HARAP LENGKAPI DETAIL LAPORAN: Tuliskan potensi usaha agen, jumlah estimasi unit/BPKB, dan kesepakatan tindak lanjut agar potensi Go-Live dapat dianalisis secara akurat.`);
        actionItems.push(`📲 JAGALAH HUBUNGAN (MAINTENANCE AGEN): Sapa ${contactPerson} (${agentCategory}) via WA / kunjungan ulang untuk menggali data prospek BPKB Motor/Mobil.`);
    } else {
        actionItems.push(`MINDSET SALES SCOR: Go-Live TIDAK bisa didapatkan hanya dari 1x kunjungan! Lakukan Activity Kunjungan Berulang (Repeat Visit minimal 2-3x seminggu) agar kenal dekat & akrab dengan ${contactPerson}.`);

        if (hasApplicationIn) {
            actionItems.push(`KAWAL APLIKASI MASUK: Berkas konsumen sudah diserahkan agen — segera input ke LOS & kawal tim survey BPKB agar mencapai status Go-Live pencairan di ${branch}.`);
        } else {
            actionItems.push(`JAGALAH HUBUNGAN (MAINTENANCE AGEN): Sapa ${contactPerson} (${agentCategory}) secara rutin via WA / kunjungan santai untuk menggali data konsumen BPKB Motor/Mobil.`);
        }
    }

    return { sentiment, dealScore, urgency, activityType, agentCategory, summary, visualFindings, actionItems };
}

// ============ AUTO-BERSIHKAN FOTO LAMA (ANTI records.json MEMBENGKAK) ============
// Hapus data base64 foto untuk kunjungan yang lebih tua dari `daysToKeep` hari.
// Record, timeline, dan ringkasan AI tetap dipertahankan — hanya blob foto yang dibuang.
const PHOTO_KEEP_DAYS = parseInt(process.env.PHOTO_KEEP_DAYS || '3', 10);

function parseRecordDate(dateStr) {
    // Format lokal: "3 Agu 2026, 09.53" | "3 Agu 2026"
    if (!dateStr) return null;
    const m = String(dateStr).match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (!m) return null;
    const months = { 'jan':0,'feb':1,'mar':2,'apr':3,'mei':4,'jun':5,'jul':6,'agu':7,'agt':7,'aug':7,'sep':8,'okt':9,'oct':9,'nov':10,'des':11,'dec':11 };
    const mon = months[(m[2].slice(0,3).toLowerCase())];
    if (mon === undefined) return null;
    const d = new Date(Number(m[3]), mon, Number(m[1]));
    return isNaN(d) ? null : d;
}

// Bersihkan foto tua dari semula record; simpan bila ada perubahan.
// return: jumlah record yang foto-nya dibersihkan
function purgeOldPhotos() {
    const records = loadRecords();
    if (!records.length) return 0;
    const cutoff = Date.now() - PHOTO_KEEP_DAYS * 24 * 60 * 60 * 1000;
    let changed = 0;
    records.forEach(r => {
        const imgs = r && Array.isArray(r.images) ? r.images : [];
        if (!imgs.length) return;
        const dt = parseRecordDate(r.date);
        if (dt && dt.getTime() < cutoff) {
            r.images = [];
            // tanda foto pernah ada, agar UI bisa menampilkan indikasi "foto diarsipkan"
            r.photosPurgedAt = new Date().toISOString();
            r.photosPurgedDays = PHOTO_KEEP_DAYS;
            changed++;
        }
    });
    if (changed > 0) saveRecords(records);
    return changed;
}

// Jalankan sekali saat start, lalu tiap interval (default tiap 24 jam).
setInterval(() => {
    try {
        const n = purgeOldPhotos();
        if (n > 0) console.log(`[AUTO] Foto lama dibersihkan dari ${n} kunjungan (>${PHOTO_KEEP_DAYS} hari).`);
    } catch (e) {
        console.error('[AUTO] Gagal purge foto:', e.message);
    }
}, parseInt(process.env.PHOTO_PURGE_INTERVAL_MS || (24 * 60 * 60 * 1000), 10));

try {
    const n = purgeOldPhotos();
    if (n > 0) console.log(`[AUTO] Startup: foto lama dibersihkan dari ${n} kunjungan (>${PHOTO_KEEP_DAYS} hari).`);
} catch (e) {
    console.error('[AUTO] Gagal purge foto saat startup:', e.message);
}

// ============ API ENDPOINTS ============
app.get('/api/status', (req, res) => {
    res.json({
        provider: 'google-gemini',
        configured: !!process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    });
});

app.get('/api/records', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const records = loadRecords();
    // Mode ringan: tanpa blob foto (agar halaman cepat dimuat & HP tidak kosong).
    // Foto hanya diambil per-record lewat GET /api/records/:id saat klik detail.
    if (req.query.light === '1') {
        const light = records.map(r => ({
            id: r.id,
            date: r.date,
            branch: r.branch,
            sales: r.sales,
            clientCompany: r.clientCompany,
            clientContactName: r.clientContactName,
            clientPhone: r.clientPhone,
            resume: r.resume,
            hasPhoto: Array.isArray(r.images) && r.images.length > 0,
            photoCount: Array.isArray(r.images) ? r.images.length : 0,
            photosPurgedAt: r.photosPurgedAt,
            ai: r.ai
        }));
        return res.json(light);
    }
    res.json(records);
});

// Ambil 1 record lengkap (termasuk foto) berdasarkan id — utk modal detail
app.get('/api/records/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id tidak diberikan' });
    const records = loadRecords();
    const found = records.find(r => r && r.id === id);
    if (!found) return res.status(404).json({ error: 'Record tidak ditemukan' });
    res.json(found);
});

// Sinkronisasi data kunjungan dari localStorage perangkat (PC/HP) ke server.
// Menerima array record lengkap, hanya menambah yang id-nya belum ada (tanpa re-analisis AI).
app.post('/api/records/sync', (req, res) => {
    const incoming = Array.isArray(req.body) ? req.body : [];
    if (incoming.length === 0) {
        return res.status(400).json({ error: 'Tidak ada data untuk disinkronkan' });
    }
    const records = loadRecords();
    const existingIds = new Set(records.map(r => r && r.id));
    const fresh = incoming.filter(r => r && r.id && !existingIds.has(r.id));
    if (fresh.length > 0) {
        records.unshift(...fresh);
        saveRecords(records);
    }
    res.json({ synced: fresh.length, total: records.length });
});

app.post('/api/records', async (req, res) => {
    const { branch, sales, clientCompany, clientContactName, clientPhone, resume, images } = req.body || {};

    if (!branch?.trim() || !sales?.trim() || !clientCompany?.trim() || !resume?.trim()) {
        return res.status(400).json({ error: 'Data wajib tidak lengkap' });
    }

    let ai = null;
    try {
        ai = await analyzeWithGemini({ branch, sales, clientCompany, clientContactName, resume, images });
    } catch (err) {
        console.error('Gemini failed, fallback to simulation:', err.message);
    }
    if (!ai) {
        ai = runSimulation({ branch, sales, clientCompany, clientContactName, resume, images });
    }

    // Gunakan id & tanggal dari klien bila dikirim (konsisten dgn tampilan sales),
    // agar dedup by id di /api/records/sync tidak membiakkan duplikat.
    const clientId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const clientDate = typeof req.body?.date === 'string' ? req.body.date.trim() : '';

    const record = {
        id: clientId || ('VISIT-' + Date.now()),
        date: clientDate || new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        branch: branch.trim(),
        sales: sales.trim(),
        clientCompany: clientCompany.trim(),
        clientContactName: (clientContactName || '').trim(),
        clientPhone: (clientPhone || '').trim(),
        resume: resume.trim(),
        images: images || [],
        ai
    };

    const records = loadRecords();
    if (record.id && records.some(r => r && r.id === record.id)) {
        // Duplikat: jangan tambah dua kali
        return res.status(200).json(record);
    }
    records.unshift(record);
    saveRecords(records);

    res.status(201).json(record);
});

// Hapus 1 record kunjungan berdasarkan id
app.delete('/api/records/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id tidak diberikan' });
    const records = loadRecords();
    const before = records.length;
    const remaining = records.filter(r => r && r.id !== id);
    if (remaining.length === before) {
        return res.status(404).json({ error: 'Record tidak ditemukan', deleted: 0 });
    }
    saveRecords(remaining);
    res.json({ deleted: before - remaining.length, total: remaining.length });
});

// ============ EXCEL DATA SYNC ============
app.get('/api/excel', (req, res) => {
    const data = loadExcelData();
    console.log(`[EXCEL] GET — mengirim ${data.length} baris`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
});

// POST /api/excel/sync — merge data dari device manapun. Hanya tambah row baru (identifikasi via kolom 3: order No Confins)
app.post('/api/excel/sync', (req, res) => {
    try {
        const incoming = Array.isArray(req.body) ? req.body : [];
        console.log(`[EXCEL] POST /sync — menerima ${incoming.length} baris`);
        if (incoming.length === 0) return res.status(400).json({ error: 'Tidak ada data' });

        const serverRows = loadExcelData();
        const existingKeys = new Set(serverRows.map(r => String(r && r[3] || '').trim().toLowerCase()));
        let added = 0;

        incoming.forEach(row => {
            if (!row || !Array.isArray(row)) return;
            const key = String(row[3] || '').trim().toLowerCase();
            if (key && !existingKeys.has(key)) {
                serverRows.push(row);
                existingKeys.add(key);
                added++;
            }
        });

        saveExcelData(serverRows);
        console.log(`[EXCEL] POST /sync — ditambahkan ${added} baru, total ${serverRows.length} baris`);
        res.json({ synced: added, total: serverRows.length });
    } catch (err) {
        console.error(`[EXCEL] ERROR: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`CRM AI Server berjalan di http://localhost:${PORT}`);
    });
}

module.exports = { app, runSimulation, analyzeWithGemini, loadRecords, saveRecords };

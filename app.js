
        // ============================================================
        // 1. DATA DEFINISI & STATE
        // ============================================================
        const DEFAULT_DATA = {
            "main": [],
            "draft1": [],
            "draft2": []
        };

        let appState = {
            mode: 'SALIN',
            main: [],
            draft1: [],
            draft2: [],
            trash: [], 
            trashTimestamp: 0, 
            currentView: 'main',
            draftOpen: false,
            copiedSet: new Set(),
            copiedDetailSet: new Set(),
            salesNotes: [],
            searchNikQuery: '',
            searchDetailQuery: '',
            addingNew: false,
            newNikData: null,
            expandedNik: new Set(),
            movedFromDraftTimestamps: {},
            currentColorTargetNik: null 
        };

        let undoStack = null;
        let currentUser = null;

        // ============================================================
        // 2. AUTH & USER MANAGEMENT
        // ============================================================
        const PROFILE_PHOTO_KEY = 'NIK_GAS_LPG_PROFILE_PHOTO_V1';
        const PROFILE_PHOTO_SIZE = 512;
        let profileCropImage = null;
        let profileCropObjectUrl = null;
        let profileCropZoom = 1;
        let profileCropOffsetX = 0;
        let profileCropOffsetY = 0;
        let profileCropDrag = null;
        const supabaseConfig = window.NIK_GAS_LPG_SUPABASE_CONFIG;
        const supabaseClient = window.supabase && supabaseConfig
            ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
            : null;

        function checkAuth() {
            if (!supabaseClient) {
                showAuth();
                showNotification('Koneksi Supabase tidak tersedia. Periksa pemuatan pustaka dan konfigurasi.');
                return;
            }
            supabaseClient.auth.getSession().then(({ data, error }) => {
                if (error) {
                    console.error('Gagal memeriksa sesi Supabase:', error);
                    showAuth();
                    showNotification('Gagal memeriksa sesi login. Muat ulang halaman dan coba lagi.');
                    return;
                }
                if (data.session) {
                    handleAuthenticatedUser(data.session.user);
                } else {
                    showAuth();
                }
            }).catch(error => {
                console.error('Gagal memeriksa sesi Supabase:', error);
                showAuth();
                showNotification(`Gagal memeriksa sesi: ${error.message}`);
            });
        }

        function showAuth() {
            document.getElementById('auth-screen').classList.remove('hidden');
            document.getElementById('app-main').classList.add('hidden');
        }

        function showApp() {
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('app-main').classList.remove('hidden');
        }

        function showLogin() {
            setLoginError('');
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('forgot-form').classList.add('hidden');
        }

        function showForgot() {
            setLoginError('');
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('forgot-form').classList.remove('hidden');
        }

        function setLoginError(message) {
            const errorElement = document.getElementById('login-error');
            errorElement.textContent = message;
            errorElement.hidden = !message;
        }

        function togglePasswordVisibility(inputId, button) {
            const input = document.getElementById(inputId);
            const isVisible = input.type === 'password';
            input.type = isVisible ? 'text' : 'password';
            button.setAttribute('aria-pressed', String(isVisible));
            button.setAttribute('aria-label', isVisible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
        }

        async function login() {
            if (!supabaseClient) {
                setLoginError('Koneksi Supabase tidak tersedia. Periksa koneksi internet lalu coba lagi.');
                return;
            }
            setLoginError('');
            const email = document.getElementById('login-identifier').value.trim().toLowerCase();
            const password = document.getElementById('login-password').value;
            if (!email || !password) {
                setLoginError('Masukkan email dan kata sandi.');
                return;
            }
            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) {
                    const message = error.message === 'Invalid login credentials'
                        ? 'Email atau kata sandi salah. Periksa kembali penulisannya.'
                        : `Login gagal: ${error.message}`;
                    setLoginError(message);
                    return;
                }
                await handleAuthenticatedUser(data.user);
            } catch (error) {
                console.error('Login Supabase gagal:', error);
                setLoginError(`Login gagal: ${error.message}`);
            }
        }

        async function logout() {
            if (!supabaseClient) return;
            try {
                await cloudSyncQueue;
                const { error } = await supabaseClient.auth.signOut();
                if (error) {
                    console.error('Gagal keluar dari Supabase:', error);
                    showNotification(`Gagal keluar: ${error.message}`);
                    return;
                }
            } catch (error) {
                console.error('Gagal keluar dari Supabase:', error);
                showNotification(`Gagal keluar: ${error.message}`);
                return;
            }
            currentUser = null;
            cloudSyncReady = false;
            if (cloudRealtimeChannel) {
                await supabaseClient.removeChannel(cloudRealtimeChannel);
                cloudRealtimeChannel = null;
            }
            closeProfile();
            showAuth();
            showNotification('Anda telah keluar');
        }

        function updateProfileUI() {
            if (!currentUser) return;
            const metadata = currentUser.user_metadata || {};
            document.getElementById('edit-nama').value = metadata.display_name || 'UD. CHARLES';
            document.getElementById('edit-username').value = currentUser.email || '';
            document.getElementById('edit-password').value = '';
            const savedPhoto = localStorage.getItem(PROFILE_PHOTO_KEY);
            if (savedPhoto) document.getElementById('profile-photo').src = savedPhoto;
        }

        async function saveProfile() {
            if (!currentUser || !supabaseClient) return;
            const displayName = document.getElementById('edit-nama').value.trim();
            const password = document.getElementById('edit-password').value;
            if (!displayName) {
                showNotification('Nama wajib diisi.');
                return;
            }
            const updates = {
                data: { ...(currentUser.user_metadata || {}), display_name: displayName }
            };
            if (password) updates.password = password;
            try {
                const { data, error } = await supabaseClient.auth.updateUser(updates);
                if (error) {
                    showNotification(`Profil gagal disimpan: ${error.message}`);
                    return;
                }
                currentUser = data.user;
                updateProfileUI();
                showNotification('Profil berhasil disimpan');
            } catch (error) {
                console.error('Gagal memperbarui profil Supabase:', error);
                showNotification(`Profil gagal disimpan: ${error.message}`);
            }
        }

        function uploadProfilePhoto(event) {
            const input = event.currentTarget;
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            if (file.type && !file.type.startsWith('image/')) {
                showNotification('Pilih file gambar untuk foto profil.');
                return;
            }
            if (file.size > 20 * 1024 * 1024) {
                showNotification('Ukuran foto maksimal 20 MB.');
                return;
            }

            releaseProfileCropImage();
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                profileCropImage = image;
                profileCropObjectUrl = objectUrl;
                profileCropZoom = 1;
                profileCropOffsetX = 0;
                profileCropOffsetY = 0;
                document.getElementById('profile-crop-zoom').value = '1';
                document.getElementById('profile-crop-image').src = objectUrl;
                document.getElementById('profile-crop-modal').classList.remove('hidden');
                requestAnimationFrame(updateProfileCropPreview);
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                showNotification('Foto tidak bisa dibuka. Coba pilih gambar JPG atau PNG.');
            };
            image.src = objectUrl;
        }

        function updateProfileCropPreview() {
            if (!profileCropImage) return;
            const viewport = document.getElementById('profile-crop-viewport');
            const preview = document.getElementById('profile-crop-image');
            const size = viewport.clientWidth;
            if (!size) return;

            const scale = Math.max(
                size / profileCropImage.naturalWidth,
                size / profileCropImage.naturalHeight
            ) * profileCropZoom;
            const width = profileCropImage.naturalWidth * scale;
            const height = profileCropImage.naturalHeight * scale;
            const maxOffsetX = Math.max(0, (width - size) / 2);
            const maxOffsetY = Math.max(0, (height - size) / 2);
            profileCropOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, profileCropOffsetX));
            profileCropOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, profileCropOffsetY));

            preview.style.width = `${width}px`;
            preview.style.height = `${height}px`;
            preview.style.left = `${(size - width) / 2 + profileCropOffsetX}px`;
            preview.style.top = `${(size - height) / 2 + profileCropOffsetY}px`;
        }

        function startProfileCropDrag(event) {
            if (!profileCropImage) return;
            event.preventDefault();
            profileCropDrag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: profileCropOffsetX,
                offsetY: profileCropOffsetY
            };
            event.currentTarget.setPointerCapture(event.pointerId);
        }

        function moveProfileCropDrag(event) {
            if (!profileCropDrag || event.pointerId !== profileCropDrag.pointerId) return;
            profileCropOffsetX = profileCropDrag.offsetX + event.clientX - profileCropDrag.startX;
            profileCropOffsetY = profileCropDrag.offsetY + event.clientY - profileCropDrag.startY;
            updateProfileCropPreview();
        }

        function endProfileCropDrag(event) {
            if (profileCropDrag && event.pointerId === profileCropDrag.pointerId) {
                profileCropDrag = null;
            }
        }

        function releaseProfileCropImage() {
            if (profileCropObjectUrl) URL.revokeObjectURL(profileCropObjectUrl);
            profileCropObjectUrl = null;
            profileCropImage = null;
            profileCropDrag = null;
            const preview = document.getElementById('profile-crop-image');
            preview.removeAttribute('src');
            preview.removeAttribute('style');
        }

        function cancelProfileCrop() {
            document.getElementById('profile-crop-modal').classList.add('hidden');
            releaseProfileCropImage();
        }

        function saveProfileCrop() {
            if (!profileCropImage) return;
            updateProfileCropPreview();
            const viewport = document.getElementById('profile-crop-viewport');
            const preview = document.getElementById('profile-crop-image');
            const size = viewport.clientWidth;
            const width = Number.parseFloat(preview.style.width);
            const height = Number.parseFloat(preview.style.height);
            const left = Number.parseFloat(preview.style.left);
            const top = Number.parseFloat(preview.style.top);
            if (!size || !width || !height || !Number.isFinite(left) || !Number.isFinite(top)) {
                showNotification('Area potong foto belum siap. Coba lagi.');
                return;
            }
            const sourceWidth = size / width * profileCropImage.naturalWidth;
            const sourceHeight = size / height * profileCropImage.naturalHeight;
            const sourceX = Math.max(0, Math.min(
                profileCropImage.naturalWidth - sourceWidth,
                -left / width * profileCropImage.naturalWidth
            ));
            const sourceY = Math.max(0, Math.min(
                profileCropImage.naturalHeight - sourceHeight,
                -top / height * profileCropImage.naturalHeight
            ));
            const canvas = document.createElement('canvas');
            canvas.width = PROFILE_PHOTO_SIZE;
            canvas.height = PROFILE_PHOTO_SIZE;
            const context = canvas.getContext('2d');
            if (!context) {
                showNotification('Foto gagal diproses di browser ini.');
                return;
            }

            try {
                context.drawImage(
                    profileCropImage,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    PROFILE_PHOTO_SIZE,
                    PROFILE_PHOTO_SIZE
                );
                const photoData = canvas.toDataURL('image/jpeg', 0.82);
                localStorage.setItem(PROFILE_PHOTO_KEY, photoData);
                document.getElementById('profile-photo').src = photoData;
            } catch (error) {
                console.error('Gagal memotong atau menyimpan foto profil:', error);
                showNotification('Foto gagal disimpan. Coba gambar lain.');
                return;
            }

            cancelProfileCrop();
            showNotification('Foto profil disimpan di browser ini saja.');
        }

        function closeProfile() {
            if (profileCropImage) cancelProfileCrop();
            document.getElementById('profile-modal').classList.add('hidden');
        }
        // 3. PENYIMPANAN DATA (AGAR TERSIMPAN PERMANEN)
        // ============================================================
        const STORAGE_KEY_DATA = 'NIK_GAS_LPG_DATA_V1';
        const STORAGE_KEY_NOTES = 'NIK_GAS_LPG_NOTES_V1';
        const STORAGE_KEY_DARKMODE = 'NIK_GAS_LPG_DARKMODE_V1';
        const STORAGE_KEY_MOVED = 'NIK_GAS_LPG_MOVED_TIMESTAMPS';
        const VALID_NIK_COLORS = new Set(['', '#ef4444', '#f59e0b', '#10b981']);
        let cloudSyncReady = false;
        let cloudSyncBaseline = { nikRecords: [], salesNotes: [] };
        let cloudSyncQueue = Promise.resolve();
        let cloudRealtimeChannel = null;
        let cloudRefreshTimer = null;

        function normalizeNikRecord(item) {
            const record = typeof item === 'string' ? { nik: item } : item;
            if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
            if (typeof record.nik !== 'string' || !isValidNIK(record.nik)) return null;

            const tempat = record.tempat == null ? '' : record.tempat;
            const tanggal = record.tanggal == null ? '' : record.tanggal;
            const color = record.color == null ? '' : record.color;
            if (typeof tempat !== 'string' || typeof tanggal !== 'string' || typeof color !== 'string') return null;
            if (!isValidTanggalValue(tanggal) || !VALID_NIK_COLORS.has(color)) return null;

            return { nik: record.nik, tempat, tanggal, color };
        }

        function normalizeNikRecordList(records) {
            if (!Array.isArray(records)) throw new Error('Daftar NIK harus berupa array.');
            return records.map((record, index) => {
                const normalized = normalizeNikRecord(record);
                if (!normalized) throw new Error(`Data NIK ke-${index + 1} tidak valid.`);
                return normalized;
            });
        }

        function isValidTanggalValue(value) {
            if (!value) return true;
            const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
            if (!match) return false;

            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);
            const date = new Date(0);
            date.setFullYear(year, month - 1, day);
            return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
        }

        function normalizeSalesNote(note, index) {
            if (!note || typeof note !== 'object' || Array.isArray(note) ||
                !Number.isSafeInteger(note.awal) || note.awal < 1 ||
                !Number.isSafeInteger(note.akhir) || note.akhir < 1 ||
                typeof note.date !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(note.date)) {
                throw new Error(`Catatan penjualan ke-${index + 1} tidak valid.`);
            }
            const [day, month, year] = note.date.split('/').map(Number);
            const date = new Date(0);
            date.setFullYear(year, month - 1, day);
            if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
                throw new Error(`Tanggal catatan ke-${index + 1} tidak valid.`);
            }
            const isUuid = typeof note.id === 'string' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(note.id);
            return { id: isUuid ? note.id : crypto.randomUUID(), awal: note.awal, akhir: note.akhir, date: note.date };
        }

        function normalizeSalesNoteList(notes) {
            if (!Array.isArray(notes)) throw new Error('Daftar catatan harus berupa array.');
            return notes.map((note, index) => normalizeSalesNote(note, index));
        }

        function loadAppData() {
            const saved = localStorage.getItem(STORAGE_KEY_DATA);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('Format data tersimpan tidak valid.');
                    }
                    const main = normalizeNikRecordList(parsed.main || []);
                    const draft1 = normalizeNikRecordList(parsed.draft1 || []);
                    const draft2 = normalizeNikRecordList(parsed.draft2 || []);
                    const trash = Array.isArray(parsed.trash) ? parsed.trash.map((item, index) => {
                        const normalized = normalizeNikRecord(item);
                        if (!normalized || !['main', 'draft1', 'draft2'].includes(item._originalView) ||
                            !Number.isInteger(item._originalIndex) || item._originalIndex < 0 ||
                            !Number.isFinite(item._deletedAt)) {
                            throw new Error(`Data sampah ke-${index + 1} tidak valid.`);
                        }
                        return { ...normalized, _originalView: item._originalView, _originalIndex: item._originalIndex, _deletedAt: item._deletedAt };
                    }) : [];
                    appState.main = main;
                    appState.draft1 = draft1;
                    appState.draft2 = draft2;
                    appState.trash = trash;
                    appState.trashTimestamp = parsed.trashTimestamp || 0;
                    
                    // Cek masa berlaku Trash (30 Hari)
                    if (appState.trashTimestamp > 0 && (Date.now() - appState.trashTimestamp > 30 * 24 * 60 * 60 * 1000)) {
                        appState.trash = [];
                        appState.trashTimestamp = 0;
                        saveAppData();
                    }
                } catch (e) {
                    console.error('Gagal memuat data tersimpan:', e);
                    showNotification('Data tersimpan tidak valid; data lama tidak ditimpa. Pulihkan dari backup JSON.');
                }
            } else {
                loadDataFromDefault();
            }
        }

        function saveAppData() {
            const dataToSave = {
                main: appState.main,
                draft1: appState.draft1,
                draft2: appState.draft2,
                trash: appState.trash,
                trashTimestamp: appState.trashTimestamp
            };
            localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(dataToSave));
            queueCloudSync();
        }

        function loadDataFromDefault() {
            appState.main = DEFAULT_DATA.main.map(item => ({ ...item }));
            appState.draft1 = DEFAULT_DATA.draft1.map(item => ({ ...item }));
            appState.draft2 = DEFAULT_DATA.draft2.map(item => ({ ...item }));
            appState.trash = [];
            appState.trashTimestamp = 0;
            saveAppData();
        }

        function loadSalesNotes() {
            const saved = localStorage.getItem(STORAGE_KEY_NOTES);
            if (saved) {
                try {
                    appState.salesNotes = normalizeSalesNoteList(JSON.parse(saved));
                } catch (error) {
                    console.error('Gagal memuat catatan tersimpan:', error);
                    showNotification('Catatan tersimpan tidak valid; pulihkan dari backup JSON.');
                    appState.salesNotes = [];
                }
            } else {
                appState.salesNotes = [];
            }
        }

        function saveSalesNotes() {
            appState.salesNotes = normalizeSalesNoteList(appState.salesNotes);
            localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(appState.salesNotes));
            queueCloudSync();
        }

        function toDatabaseDate(value, separator) {
            if (!value) return null;
            const [day, month, year] = value.split(separator);
            return `${year}-${month}-${day}`;
        }

        function fromDatabaseDate(value, separator) {
            if (!value) return '';
            const [year, month, day] = value.split('-');
            return `${day}${separator}${month}${separator}${year}`;
        }

        function createCloudSnapshotFromState() {
            const nikRecords = [];
            ['main', 'draft1', 'draft2'].forEach(listName => {
                appState[listName].forEach((item, index) => {
                    nikRecords.push({
                        nik: item.nik,
                        tempat_lahir: item.tempat,
                        tanggal_lahir: toDatabaseDate(item.tanggal, '-'),
                        list_name: listName,
                        sort_order: index,
                        color: item.color || ''
                    });
                });
            });
            const salesNotes = appState.salesNotes.map((note, index) => ({
                id: note.id,
                awal: note.awal,
                akhir: note.akhir,
                tanggal: toDatabaseDate(note.date, '/'),
                sort_order: index
            }));
            return { nikRecords, salesNotes };
        }

        function cloudSnapshotsEqual(left, right) {
            return JSON.stringify(left) === JSON.stringify(right);
        }

        function snapshotHasData(snapshot) {
            return snapshot.nikRecords.length > 0 || snapshot.salesNotes.length > 0;
        }

        async function fetchAllCloudRows(buildQuery) {
            const pageSize = 500;
            const rows = [];
            for (let offset = 0; ; offset += pageSize) {
                const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
                if (error) throw error;
                rows.push(...data);
                if (data.length < pageSize) return rows;
            }
        }

        async function fetchCloudSnapshot() {
            const [nikResult, notesResult] = await Promise.all([
                fetchAllCloudRows(() => supabaseClient.from('nik_records')
                    .select('nik, tempat_lahir, tanggal_lahir, list_name, sort_order, color')
                    .order('list_name')
                    .order('sort_order')
                    .order('nik')),
                fetchAllCloudRows(() => supabaseClient.from('sales_notes')
                    .select('id, awal, akhir, tanggal, sort_order')
                    .order('sort_order')
                    .order('id'))
            ]);

            const nikRecords = nikResult.map((row, index) => {
                if (!['main', 'draft1', 'draft2'].includes(row.list_name) ||
                    !Number.isInteger(row.sort_order) || row.sort_order < 0) {
                    throw new Error(`Data NIK dari database ke-${index + 1} tidak valid.`);
                }
                const normalized = normalizeNikRecord({
                    nik: row.nik,
                    tempat: row.tempat_lahir,
                    tanggal: fromDatabaseDate(row.tanggal_lahir, '-'),
                    color: row.color
                });
                if (!normalized) throw new Error(`Data NIK dari database ke-${index + 1} tidak valid.`);
                return {
                    nik: normalized.nik,
                    tempat_lahir: normalized.tempat,
                    tanggal_lahir: row.tanggal_lahir,
                    list_name: row.list_name,
                    sort_order: row.sort_order,
                    color: normalized.color
                };
            });
            const listOrder = { main: 0, draft1: 1, draft2: 2 };
            nikRecords.sort((left, right) =>
                listOrder[left.list_name] - listOrder[right.list_name] ||
                left.sort_order - right.sort_order ||
                left.nik.localeCompare(right.nik)
            );
            const salesNotes = notesResult.map((row, index) => {
                if (!Number.isInteger(row.sort_order) || row.sort_order < 0) {
                    throw new Error(`Catatan penjualan dari database ke-${index + 1} tidak valid.`);
                }
                const normalized = normalizeSalesNote({
                    id: row.id,
                    awal: row.awal,
                    akhir: row.akhir,
                    date: fromDatabaseDate(row.tanggal, '/')
                }, index);
                return {
                    id: normalized.id,
                    awal: normalized.awal,
                    akhir: normalized.akhir,
                    tanggal: row.tanggal,
                    sort_order: row.sort_order
                };
            });
            return { nikRecords, salesNotes };
        }

        function applyCloudSnapshotToState(snapshot) {
            appState.main = [];
            appState.draft1 = [];
            appState.draft2 = [];
            snapshot.nikRecords.forEach(row => {
                appState[row.list_name].push({
                    nik: row.nik,
                    tempat: row.tempat_lahir,
                    tanggal: fromDatabaseDate(row.tanggal_lahir, '-'),
                    color: row.color
                });
            });
            appState.salesNotes = snapshot.salesNotes.map(note => ({
                id: note.id,
                awal: note.awal,
                akhir: note.akhir,
                date: fromDatabaseDate(note.tanggal, '/')
            }));
        }

        function mergeCloudSnapshots(remote, local) {
            const mergedNikRecords = [];
            const seenNik = new Set();
            const sortOrderByList = { main: 0, draft1: 0, draft2: 0 };
            const appendUniqueRecords = snapshot => {
                ['main', 'draft1', 'draft2'].forEach(listName => {
                    snapshot.nikRecords
                        .filter(item => item.list_name === listName)
                        .forEach(item => {
                            if (seenNik.has(item.nik)) return;
                            seenNik.add(item.nik);
                            mergedNikRecords.push({
                                ...item,
                                list_name: listName,
                                sort_order: sortOrderByList[listName]++
                            });
                        });
                });
            };
            appendUniqueRecords(remote);
            appendUniqueRecords(local);
            const mergedNotes = [...remote.salesNotes];
            const seenNotes = new Set(mergedNotes.map(note => note.id));
            local.salesNotes.forEach(note => {
                if (!seenNotes.has(note.id)) {
                    mergedNotes.push(note);
                    seenNotes.add(note.id);
                }
            });
            return {
                nikRecords: mergedNikRecords,
                salesNotes: mergedNotes.map((note, index) => ({ ...note, sort_order: index }))
            };
        }

        async function syncCloudSnapshot() {
            if (!currentUser || !supabaseClient) return;
            const desired = createCloudSnapshotFromState();
            const previousNik = new Map(cloudSyncBaseline.nikRecords.map(item => [item.nik, item]));
            const desiredNik = new Map(desired.nikRecords.map(item => [item.nik, item]));
            const nikUpserts = desired.nikRecords.filter(item =>
                !previousNik.has(item.nik) || !cloudSnapshotsEqual(item, previousNik.get(item.nik)));
            const nikDeletes = [...previousNik.keys()].filter(nik => !desiredNik.has(nik));

            for (let offset = 0; offset < nikUpserts.length; offset += 100) {
                const batch = nikUpserts.slice(offset, offset + 100);
                const { error } = await supabaseClient.from('nik_records').upsert(
                    batch.map(item => ({ ...item, owner_id: currentUser.id })),
                    { onConflict: 'owner_id,nik' }
                );
                if (error) throw error;
            }
            for (let offset = 0; offset < nikDeletes.length; offset += 100) {
                const batch = nikDeletes.slice(offset, offset + 100);
                const { error } = await supabaseClient.from('nik_records')
                    .delete()
                    .eq('owner_id', currentUser.id)
                    .in('nik', batch);
                if (error) throw error;
            }

            const previousNotes = new Map(cloudSyncBaseline.salesNotes.map(item => [item.id, item]));
            const desiredNotes = new Map(desired.salesNotes.map(item => [item.id, item]));
            const noteUpserts = desired.salesNotes.filter(item =>
                !previousNotes.has(item.id) || !cloudSnapshotsEqual(item, previousNotes.get(item.id)));
            const noteDeletes = [...previousNotes.keys()].filter(id => !desiredNotes.has(id));
            for (let offset = 0; offset < noteUpserts.length; offset += 100) {
                const batch = noteUpserts.slice(offset, offset + 100);
                const { error } = await supabaseClient.from('sales_notes').upsert(
                    batch.map(item => ({ ...item, owner_id: currentUser.id }))
                );
                if (error) throw error;
            }
            for (let offset = 0; offset < noteDeletes.length; offset += 100) {
                const batch = noteDeletes.slice(offset, offset + 100);
                const { error } = await supabaseClient.from('sales_notes')
                    .delete()
                    .eq('owner_id', currentUser.id)
                    .in('id', batch);
                if (error) throw error;
            }
            cloudSyncBaseline = desired;
        }

        function queueCloudSync() {
            if (!cloudSyncReady || !currentUser) return;
            cloudSyncQueue = cloudSyncQueue.then(syncCloudSnapshot).catch(error => {
                console.error('Gagal menyinkronkan data ke Supabase:', error);
                showNotification(`Sinkronisasi gagal: ${error.message}. Data lokal tetap tersimpan.`);
            });
        }

        function subscribeToCloudChanges() {
            if (cloudRealtimeChannel) supabaseClient.removeChannel(cloudRealtimeChannel);
            cloudRealtimeChannel = supabaseClient
                .channel(`nik-gas-lpg-${currentUser.id}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'nik_records' }, scheduleCloudRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_notes' }, scheduleCloudRefresh)
                .subscribe(status => {
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.error('Supabase Realtime belum tersambung:', status);
                        showNotification('Sinkronisasi langsung belum aktif. Perubahan tetap tersimpan; perangkat lain mungkin perlu memuat ulang.');
                    }
                });
        }

        function scheduleCloudRefresh() {
            clearTimeout(cloudRefreshTimer);
            cloudRefreshTimer = setTimeout(refreshCloudData, 250);
        }

        async function refreshCloudData() {
            if (!cloudSyncReady || !currentUser || appState.mode === 'EDIT' || appState.addingNew) return;
            try {
                await cloudSyncQueue;
                if (!cloudSnapshotsEqual(createCloudSnapshotFromState(), cloudSyncBaseline)) return;
                const baselineAtFetch = cloudSyncBaseline;
                const remoteSnapshot = await fetchCloudSnapshot();
                if (cloudSyncBaseline !== baselineAtFetch ||
                    !cloudSnapshotsEqual(createCloudSnapshotFromState(), baselineAtFetch)) return;
                if (cloudSnapshotsEqual(remoteSnapshot, cloudSyncBaseline)) return;
                cloudSyncBaseline = remoteSnapshot;
                applyCloudSnapshotToState(remoteSnapshot);
                saveAppData();
                saveSalesNotes();
                renderAll();
                showNotification('Data diperbarui dari perangkat lain');
            } catch (error) {
                console.error('Gagal memuat perubahan dari Supabase:', error);
                showNotification(`Gagal memuat perubahan: ${error.message}`);
            }
        }

        async function handleAuthenticatedUser(user) {
            currentUser = user;
            cloudSyncReady = false;
            try {
                const localSnapshot = createCloudSnapshotFromState();
                const remoteSnapshot = await fetchCloudSnapshot();
                let selectedSnapshot = remoteSnapshot;
                const localHasData = snapshotHasData(localSnapshot);
                const remoteHasData = snapshotHasData(remoteSnapshot);
                if (localHasData && !cloudSnapshotsEqual(localSnapshot, remoteSnapshot)) {
                    const message = remoteHasData
                        ? 'Ada data lokal dan data Supabase. Gabungkan data lokal ke Supabase? NIK yang sudah ada di Supabase akan tetap memakai data Supabase. Jika memilih Batal, login dibatalkan dan data lokal tidak diubah.'
                        : 'Ada data lokal di browser ini, sedangkan Supabase masih kosong. Unggah data lokal ke Supabase agar dapat dipakai di perangkat lain? Jika memilih Batal, login dibatalkan dan data lokal tidak diubah.';
                    if (!window.confirm(message)) {
                        const { error } = await supabaseClient.auth.signOut();
                        if (error) throw error;
                        currentUser = null;
                        showAuth();
                        showNotification('Login dibatalkan; data lokal tidak diubah.');
                        return;
                    }
                    selectedSnapshot = mergeCloudSnapshots(remoteSnapshot, localSnapshot);
                }

                applyCloudSnapshotToState(selectedSnapshot);
                cloudSyncBaseline = remoteSnapshot;
                saveAppData();
                saveSalesNotes();
                cloudSyncReady = true;
                if (!cloudSnapshotsEqual(selectedSnapshot, remoteSnapshot)) {
                    await syncCloudSnapshot();
                }
                subscribeToCloudChanges();
                updateProfileUI();
                renderAll();
                showApp();
                showNotification(`Selamat datang, ${currentUser.email}`);
            } catch (error) {
                cloudSyncReady = false;
                currentUser = null;
                console.error('Gagal menyiapkan data Supabase:', error);
                showAuth();
                showNotification(`Gagal memuat data Supabase: ${error.message}`);
            }
        }

        function loadMovedTimestamps() {
            const saved = localStorage.getItem(STORAGE_KEY_MOVED);
            if (saved) {
                try { appState.movedFromDraftTimestamps = JSON.parse(saved); } catch (e) { appState.movedFromDraftTimestamps = {}; }
            } else {
                appState.movedFromDraftTimestamps = {};
            }
            const now = Date.now();
            for (const key in appState.movedFromDraftTimestamps) {
                if (now - appState.movedFromDraftTimestamps[key] > 86400000) {
                    delete appState.movedFromDraftTimestamps[key];
                }
            }
            saveMovedTimestamps();
        }

        function saveMovedTimestamps() {
            localStorage.setItem(STORAGE_KEY_MOVED, JSON.stringify(appState.movedFromDraftTimestamps));
        }

        function applyDarkMode() {
            const isDark = localStorage.getItem(STORAGE_KEY_DARKMODE) === 'true';
            document.body.classList.toggle('dark-mode', isDark);
            document.getElementById('dark-mode-toggle').setAttribute('aria-pressed', String(isDark));
        }

        // ============================================================
        // 4. INISIALISASI UTAMA
        // ============================================================
        function initApp() {
            loadAppData();
            loadSalesNotes();
            loadMovedTimestamps();
            applyDarkMode();
            renderAll();
            checkAuth();
            document.getElementById('login-identifier').addEventListener('input', () => setLoginError(''));
            document.getElementById('login-password').addEventListener('input', () => setLoginError(''));

            document.getElementById('profile-btn').addEventListener('click', () => {
                updateProfileUI();
                document.getElementById('profile-modal').classList.remove('hidden');
            });
            document.getElementById('upload-photo').addEventListener('change', uploadProfilePhoto);
            const profileCropViewport = document.getElementById('profile-crop-viewport');
            profileCropViewport.addEventListener('pointerdown', startProfileCropDrag);
            profileCropViewport.addEventListener('pointermove', moveProfileCropDrag);
            profileCropViewport.addEventListener('pointerup', endProfileCropDrag);
            profileCropViewport.addEventListener('pointercancel', endProfileCropDrag);
            document.getElementById('profile-crop-zoom').addEventListener('input', event => {
                profileCropZoom = Number(event.currentTarget.value);
                updateProfileCropPreview();
            });
            window.addEventListener('resize', updateProfileCropPreview);
            document.getElementById('quick-add-btn').addEventListener('click', quickAddNikFromSearch);

            document.querySelectorAll('.btn, .quick-add-btn, .draft-toggle-btn, .info-dropdown-btn').forEach(btn => {
                btn.addEventListener('mousedown', function(e) {
                    const rect = this.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.style.setProperty('--x', x + 'px');
                    this.style.setProperty('--y', y + 'px');
                });
            });

            document.addEventListener('click', function(e) {
                const dropdown = document.getElementById('info-dropdown-content');
                const btn = document.getElementById('info-dropdown-btn');
                if (dropdown && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                    dropdown.classList.remove('open');
                }
            });

            document.getElementById('dark-mode-toggle').addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-mode');
                localStorage.setItem(STORAGE_KEY_DARKMODE, isDark);
                document.getElementById('dark-mode-toggle').setAttribute('aria-pressed', String(isDark));
            });

            updateModeIcon();
            console.log('UD. CHARLES APP SIAP!');
        }

        // ============================================================
        // 5. FUNGSI UTAMA & RENDER
        // ============================================================
        function getCurrentList() {
            if (appState.currentView === 'main') return appState.main;
            if (appState.currentView === 'draft1') return appState.draft1;
            if (appState.currentView === 'draft2') return appState.draft2;
            return [];
        }

        function getViewLabel() {
            if (appState.currentView === 'main') return 'UTAMA';
            if (appState.currentView === 'draft1') return 'DRAFT 1';
            if (appState.currentView === 'draft2') return 'DRAFT 2';
            if (appState.currentView === 'search') return 'PENCARIAN';
            return 'UTAMA';
        }

        function updateViewLabel() {
            document.getElementById('stat-view-label').textContent = getViewLabel();
            updateModeIcon();
        }

        function updateModeIcon() {
            const icon = document.getElementById('nik-title-icon');
            if (appState.mode === 'SALIN') {
                icon.className = 'nik-title-icon mode-salin';
                icon.textContent = 'S';
            } else {
                icon.className = 'nik-title-icon mode-edit';
                icon.textContent = 'E';
            }
        }

        function renderAll() {
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;
            renderStats();
            renderSalesNotes();
            renderNikTable();
            updateDeleteAllButton();
            updateViewLabel();
            updateDraftButtons();
            updateQuickAddButton();
            const isSearch = (appState.currentView === 'search');
            const addContainer = document.getElementById('add-nik-container');
            const deleteContainer = document.getElementById('delete-all-container');
            if (addContainer) {
                if (isSearch) addContainer.classList.add('hidden');
                else {
                    if (appState.mode === 'EDIT') addContainer.classList.remove('hidden');
                    else addContainer.classList.add('hidden');
                }
            }
            if (deleteContainer) {
                if (isSearch) deleteContainer.classList.add('hidden');
                else {
                    if (appState.mode === 'EDIT') deleteContainer.classList.remove('hidden');
                    else deleteContainer.classList.add('hidden');
                }
            }
            if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
                window.scrollTo(scrollX, scrollY);
            }
        }

        function renderStats() {
            let list = [];
            let isSearch = (appState.currentView === 'search');
            if (isSearch) list = getSearchResults();
            else list = getCurrentList();
            const total = list.length;
            let copiedCount = 0;
            list.forEach(item => { if (appState.copiedSet.has(item.nik)) copiedCount++; });
            document.getElementById('stat-total').textContent = total;
            document.getElementById('stat-copied').textContent = copiedCount;
            document.getElementById('stat-remaining').textContent = total - copiedCount;
        }

        // FIX #4 (T-2): helper nomor urut lintas-view untuk pencarian
        function getNomorUrutGlobal(item) {
            let idx = appState.main.indexOf(item);
            if (idx !== -1) return idx + 1;
            idx = appState.draft1.indexOf(item);
            if (idx !== -1) return idx + 1;
            idx = appState.draft2.indexOf(item);
            if (idx !== -1) return idx + 1;
            return 0;
        }

        function getSearchResults() {
            const qNik = appState.searchNikQuery.trim().toLowerCase();
            const qDetail = appState.searchDetailQuery.trim().toLowerCase();
            if (!qNik && !qDetail) return [];
            const all = [...appState.main, ...appState.draft1, ...appState.draft2];
            return all.filter(item => {
                const nikMatch = qNik ? item.nik.toLowerCase().includes(qNik) : true;
                // FIX #4 (T-2): nomor urut berlaku di view asal item (main/draft1/draft2)
                const noMatch = qNik ? (getNomorUrutGlobal(item).toString() === qNik) : true;
                const tempatMatch = qDetail ? (item.tempat || '').toLowerCase().includes(qDetail) : true;
                const tanggalMatch = qDetail ? (item.tanggal || '').toLowerCase().includes(qDetail) : true;
                return (nikMatch || noMatch) && (tempatMatch || tanggalMatch);
            });
        }

        function handleSearch() {
            appState.searchNikQuery = document.getElementById('search-nik-input').value.trim();
            appState.searchDetailQuery = document.getElementById('search-detail-input').value.trim();
            const hasQuery = appState.searchNikQuery || appState.searchDetailQuery;
            if (hasQuery) {
                const results = getSearchResults();
                if (results.length > 0) appState.currentView = 'search';
                else appState.currentView = appState.currentView === 'search' ? 'main' : appState.currentView;
            } else {
                if (appState.currentView === 'search') appState.currentView = 'main';
            }
            renderAll();
        }

        function switchMode(newMode) {
            if (appState.mode === newMode) return;
            appState.mode = newMode;
            appState.addingNew = false;
            appState.newNikData = null;
            const btnSalin = document.getElementById('btn-mode-salin');
            const btnEdit = document.getElementById('btn-mode-edit');
            if (newMode === 'SALIN') {
                btnSalin.className = 'btn btn-primary btn-active';
                btnEdit.className = 'btn btn-secondary';
            } else {
                btnEdit.className = 'btn btn-primary btn-active';
                btnSalin.className = 'btn btn-secondary';
            }
            updateModeIcon();
            renderAll();
        }

        function toggleDraftLaci() {
            appState.draftOpen = !appState.draftOpen;
            const laci = document.getElementById('draft-laci');
            const arrow = document.getElementById('draft-arrow');
            if (appState.draftOpen) {
                laci.classList.add('open');
                arrow.textContent = '▼';
                arrow.classList.add('open');
            } else {
                laci.classList.remove('open');
                arrow.textContent = '▶';
                arrow.classList.remove('open');
            }
            if (!appState.draftOpen && appState.currentView !== 'main' && appState.currentView !== 'search') {
                appState.currentView = 'main';
                renderAll();
            }
        }

        function switchDraftView(view) {
            if (appState.currentView === view) {
                appState.currentView = 'main';
            } else {
                appState.currentView = view;
                if (!appState.draftOpen) {
                    appState.draftOpen = true;
                    document.getElementById('draft-laci').classList.add('open');
                    const arrow = document.getElementById('draft-arrow');
                    arrow.textContent = '▼';
                    arrow.classList.add('open');
                }
            }
            document.getElementById('search-nik-input').value = '';
            document.getElementById('search-detail-input').value = '';
            appState.searchNikQuery = '';
            appState.searchDetailQuery = '';
            renderAll();
        }

        function updateDraftButtons() {
            const btn1 = document.getElementById('btn-draft1');
            const btn2 = document.getElementById('btn-draft2');
            btn1.classList.remove('draft-btn-active');
            btn2.classList.remove('draft-btn-active');
            if (appState.currentView === 'draft1') btn1.classList.add('draft-btn-active');
            if (appState.currentView === 'draft2') btn2.classList.add('draft-btn-active');
        }

        function generateTanggalFromNIK(nik) {
            if (!/^\d{16}$/.test(nik)) {
                return { isValid: false, message: 'NIK harus 16 digit angka' };
            }
            const digits = nik.split('');
            const tanggalRaw = parseInt(digits[6] + digits[7], 10);
            const bulanRaw = parseInt(digits[8] + digits[9], 10);
            const tahun2 = parseInt(digits[10] + digits[11], 10);
            let tanggal = tanggalRaw;
            let gender = 'Laki-laki';
            if (tanggalRaw > 40 && tanggalRaw <= 71) {
                tanggal = tanggalRaw - 40;
                gender = 'Perempuan';
            } else if (tanggalRaw < 1 || tanggalRaw > 31) {
                return { isValid: false, message: 'Tanggal lahir tidak valid' };
            }
            if (bulanRaw < 1 || bulanRaw > 12) {
                return { isValid: false, message: 'Bulan lahir tidak valid' };
            }
            const currentYear = new Date().getFullYear();
            const currentTwoDigit = currentYear % 100;
            let tahun = (tahun2 > currentTwoDigit) ? 1900 + tahun2 : 2000 + tahun2;
            
            const dateObj = new Date(tahun, bulanRaw - 1, tanggal);
            if (dateObj.getFullYear() !== tahun || dateObj.getMonth() !== bulanRaw - 1 || dateObj.getDate() !== tanggal) {
                return { isValid: false, message: 'Tanggal lahir tidak valid' };
            }
            const dd = String(tanggal).padStart(2, '0');
            const mm = String(bulanRaw).padStart(2, '0');
            return { isValid: true, gender: gender, tanggalLahir: `${tahun}-${mm}-${dd}`, message: 'Sukses' };
        }

        function isValidNIK(value) { return /^\d{16}$/.test(value); }

        function quickAddNikFromSearch() {
            const query = appState.searchNikQuery.trim();
            if (query.length !== 16 || !/^\d{16}$/.test(query)) {
                showNotification('NIK harus 16 digit angka');
                return;
            }
            const all = [...appState.main, ...appState.draft1, ...appState.draft2];
            if (all.some(item => item.nik === query)) {
                showNotification('NIK sudah terdaftar');
                return;
            }
            const result = generateTanggalFromNIK(query);
            if (!result.isValid) {
                showNotification('Gagal generate tanggal: ' + result.message);
                return;
            }
            const parts = result.tanggalLahir.split('-');
            const tanggalDisplay = `${parts[2]}-${parts[1]}-${parts[0]}`;
            if (appState.mode !== 'EDIT') switchMode('EDIT');
            appState.addingNew = true;
            appState.newNikData = { nik: query, tempat: '', tanggal: tanggalDisplay, color: '' };
            renderAll();
            setTimeout(() => evaluateEditButtonByIndex(-1), 50);
            showNotification('Baru: NIK & tanggal diisi, silakan centang');
        }

        function evaluateEditButtonByIndex(index) {
            const btnCheck = document.querySelector(`button[data-index="${index}"][data-action="check"]`);
            const btnMove = document.querySelector(`button[data-index="${index}"][data-action="move"]`);
            const nikInput = document.querySelector(`input[data-index="${index}"][data-field="nik"]`);
            if (!nikInput) return;
            // FIX #5 (T-3): tombol simpan dinonaktifkan saat view = pencarian
            const isSearch = (appState.currentView === 'search');
            const currentNik = nikInput.value.trim();
            const currentTempat = document.querySelector(`input[data-index="${index}"][data-field="tempat"]`)?.value.trim() || '';
            const currentTanggal = getTanggalFromFields(index);
            let valid = false;
            if (index >= 0) {
                valid = true;
                const currentList = getCurrentList();
                if (currentList && index < currentList.length) {
                    const originalNik = currentList[index].nik;
                    const originalTempat = currentList[index].tempat || '';
                    const originalTanggal = currentList[index].tanggal || '';
                    const hasChanged = (currentNik !== originalNik || currentTempat !== originalTempat || currentTanggal !== originalTanggal);
                    if (btnCheck) btnCheck.disabled = !hasChanged || isSearch;
                }
            } else {
                const all = [...appState.main, ...appState.draft1, ...appState.draft2];
                const isNikValid = isValidNIK(currentNik) && !all.some(item => item.nik === currentNik);
                valid = isNikValid;
                if (btnCheck) btnCheck.disabled = !valid || isSearch;
            }
            if (btnMove) {
                if (index >= 0) btnMove.disabled = false;
                else btnMove.disabled = !valid || !isValidTanggalEntry(index);
            }
        }

        function createTanggalInputsWithMove(index, tanggalValue, nik, isNew = false) {
            const parts = tanggalValue ? tanggalValue.split('-') : ['', '', ''];
            const container = document.createElement('div');
            container.className = 'date-inputs';

            const inputHari = document.createElement('input');
            inputHari.type = 'text';
            inputHari.className = 'nik-input-edit date-input date-input-day';
            inputHari.inputMode = 'numeric';
            inputHari.placeholder = 'DD';
            inputHari.maxLength = 2;
            inputHari.dataset.index = index;
            inputHari.dataset.field = 'tanggal_hari';
            inputHari.value = parts[0] || '';
            inputHari.addEventListener('input', () => evaluateEditButtonByIndex(index));
            inputHari.addEventListener('blur', function() {
                if (this.value.length === 1) { this.value = this.value.padStart(2, '0'); evaluateEditButtonByIndex(index); }
            });

            const dash1 = document.createElement('span');
            dash1.textContent = '-';
            dash1.style.margin = '0 2px';

            const inputBulan = document.createElement('input');
            inputBulan.type = 'text';
            inputBulan.className = 'nik-input-edit date-input date-input-month';
            inputBulan.inputMode = 'numeric';
            inputBulan.placeholder = 'MM';
            inputBulan.maxLength = 2;
            inputBulan.dataset.index = index;
            inputBulan.dataset.field = 'tanggal_bulan';
            inputBulan.value = parts[1] || '';
            inputBulan.addEventListener('input', () => evaluateEditButtonByIndex(index));
            inputBulan.addEventListener('blur', function() {
                if (this.value.length === 1) { this.value = this.value.padStart(2, '0'); evaluateEditButtonByIndex(index); }
            });

            const dash2 = document.createElement('span');
            dash2.textContent = '-';
            dash2.style.margin = '0 2px';

            const inputTahun = document.createElement('input');
            inputTahun.type = 'text';
            inputTahun.className = 'nik-input-edit date-input date-input-year';
            inputTahun.inputMode = 'numeric';
            inputTahun.placeholder = 'YYYY';
            inputTahun.maxLength = 4;
            inputTahun.dataset.index = index;
            inputTahun.dataset.field = 'tanggal_tahun';
            inputTahun.value = parts[2] || '';
            inputTahun.addEventListener('input', () => evaluateEditButtonByIndex(index));

            container.appendChild(inputHari);
            container.appendChild(dash1);
            container.appendChild(inputBulan);
            container.appendChild(dash2);
            container.appendChild(inputTahun);

            const isSearch = (appState.currentView === 'search');
            if (appState.mode === 'EDIT' && !isSearch && (index >= 0 || isNew)) {
                const moveBtn = document.createElement('button');
                moveBtn.className = 'btn btn-warning btn-xs move-draft-btn';
                moveBtn.textContent = '➜';
                moveBtn.title = 'Pindahkan ke draft/utama';
                moveBtn.dataset.index = index;
                moveBtn.dataset.action = 'move';
                if (index >= 0) moveBtn.disabled = false;
                else moveBtn.disabled = true;
                moveBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (isNew) {
                        if (!isValidTanggalEntry(index)) {
                            showNotification('Tanggal lahir tidak valid. Gunakan format DD-MM-YYYY.');
                            return;
                        }
                        const nikVal = document.querySelector(`input[data-index="${index}"][data-field="nik"]`);
                        if (nikVal) {
                            const newData = {
                                nik: nikVal.value.trim(),
                                tempat: document.querySelector(`input[data-index="${index}"][data-field="tempat"]`)?.value.trim() || '',
                                tanggal: getTanggalFromFields(index),
                                color: ''
                            };
                            if (isValidNIK(newData.nik)) {
                                appState.newNikData = newData;
                                promptMoveNik(-1, true);
                            } else {
                                showNotification('NIK tidak valid');
                            }
                        }
                    } else {
                        promptMoveNik(index, false);
                    }
                };
                container.appendChild(moveBtn);
            }
            return container;
        }

        function getTanggalFromFields(index) {
            const hari = document.querySelector(`input[data-index="${index}"][data-field="tanggal_hari"]`);
            const bulan = document.querySelector(`input[data-index="${index}"][data-field="tanggal_bulan"]`);
            const tahun = document.querySelector(`input[data-index="${index}"][data-field="tanggal_tahun"]`);
            const hh = hari ? hari.value.trim().padStart(2, '0') : '';
            const bb = bulan ? bulan.value.trim().padStart(2, '0') : '';
            const tt = tahun ? tahun.value.trim() : '';
            if (hh && bb && tt) return `${hh}-${bb}-${tt}`;
            return '';
        }

        function isValidTanggalEntry(index) {
            const values = ['tanggal_hari', 'tanggal_bulan', 'tanggal_tahun'].map(field =>
                document.querySelector(`input[data-index="${index}"][data-field="${field}"]`)?.value.trim() || ''
            );
            if (values.every(value => !value)) return true;
            if (values.some(value => !value)) return false;

            const tanggal = `${values[0].padStart(2, '0')}-${values[1].padStart(2, '0')}-${values[2]}`;
            const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(tanggal);
            if (!match) return false;

            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);
            const date = new Date(0);
            date.setFullYear(year, month - 1, day);
            return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
        }

        // ============================================================
        // 6. RENDER TABEL (DENGAN FITUR WARNA)
        // ============================================================
        function renderNikTable() {
            const tbody = document.getElementById('nik-table-body');
            tbody.innerHTML = '';

            let currentList = [];
            let isSearch = (appState.currentView === 'search');
            if (isSearch) currentList = getSearchResults();
            else currentList = getCurrentList();

            const qNik = appState.searchNikQuery.trim().toLowerCase();
            const qDetail = appState.searchDetailQuery.trim().toLowerCase();

            let filtered = currentList.map((item, idx) => ({ ...item, _idx: idx }));
            if (!isSearch) {
                if (qNik) {
                    filtered = filtered.filter((item, idx) => {
                        const noUrut = idx + 1;
                        return item.nik.toLowerCase().includes(qNik) || noUrut.toString() === qNik;
                    });
                }
                if (qDetail) {
                    filtered = filtered.filter(item => {
                        const tempat = (item.tempat || '').toLowerCase();
                        const tanggal = (item.tanggal || '').toLowerCase();
                        return tempat.includes(qDetail) || tanggal.includes(qDetail);
                    });
                }
            }

            filtered.forEach((item, displayIndex) => {
                const realIndex = item._idx;
                const nik = item.nik;
                const tempat = item.tempat || '';
                const tanggal = item.tanggal || '';
                const noUrut = displayIndex + 1;

                const isExpanded = appState.expandedNik.has(nik);
                const tr = document.createElement('tr');

                // FITUR BARU: Penanda Warna pada Nomor Urut
                const tdNo = document.createElement('td');
                const movedAt = appState.movedFromDraftTimestamps[nik];
                const isHighlight = movedAt && (Date.now() - movedAt < 86400000);
                if (isHighlight && !item.color) tdNo.className = 'nik-number-highlight';
                tdNo.textContent = noUrut;
                
                // Terapkan warna dari properti item.color
                if (item.color) {
                    tdNo.style.backgroundColor = item.color;
                    tdNo.style.color = (item.color === '#f59e0b') ? '#1e293b' : '#ffffff';
                    tdNo.style.borderRadius = '4px';
                    tdNo.style.fontWeight = 'bold';
                }
                
                tdNo.title = "Klik untuk memberi warna penanda";
                // Meneruskan NIK (bukan index) agar warna menempel pada data
                tdNo.onclick = (e) => {
                    e.stopPropagation();
                    openColorPicker(item.nik); 
                };
                
                tr.appendChild(tdNo);

                const tdNik = document.createElement('td');
                if (appState.mode === 'SALIN') {
                    tdNik.textContent = nik;
                    tdNik.className = 'nik-input-edit';
                } else {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = nik;
                    input.className = 'nik-input-edit';
                    input.maxLength = 16;
                    input.dataset.index = realIndex;
                    input.dataset.field = 'nik';
                    input.dataset.original = nik;
                    input.addEventListener('input', () => evaluateEditButtonByIndex(realIndex));
                    tdNik.appendChild(input);
                }
                tr.appendChild(tdNik);

                const tdAksi = document.createElement('td');
                tdAksi.style.textAlign = 'center';

                if (appState.mode === 'SALIN') {
                    const divAksi = document.createElement('div');
                    divAksi.className = 'aksi-buttons';
                    const btnCopy = document.createElement('button');
                    const isCopied = appState.copiedSet.has(nik);
                    btnCopy.className = isCopied ? 'btn btn-primary btn-xs btn-copied' : 'btn btn-primary btn-xs';
                    btnCopy.textContent = '⎘';
                    btnCopy.title = isCopied ? 'Tersalin' : 'Salin NIK';
                    btnCopy.disabled = isCopied;
                    btnCopy.onclick = () => copyNikToClipboard(nik, btnCopy);

                    const arrowBtn = document.createElement('button');
                    arrowBtn.className = 'btn btn-secondary btn-arrow';
                    arrowBtn.textContent = isExpanded ? '▲' : '▼';
                    arrowBtn.title = 'Tampilkan detail';
                    arrowBtn.dataset.targetKey = nik;
                    arrowBtn.onclick = () => toggleDetailRow(`detail-${realIndex}`, nik);

                    divAksi.appendChild(btnCopy);
                    divAksi.appendChild(arrowBtn);
                    tdAksi.appendChild(divAksi);
                } else {
                    const divAksi = document.createElement('div');
                    divAksi.className = 'aksi-buttons';
                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn btn-danger btn-xs';
                    btnDelete.textContent = 'X';
                    btnDelete.title = 'Hapus NIK';
                    btnDelete.disabled = isSearch;
                    btnDelete.onclick = () => { if (!isSearch) promptDeleteNik(realIndex); };

                    const btnCheck = document.createElement('button');
                    btnCheck.className = 'btn btn-success btn-xs';
                    btnCheck.textContent = '✓';
                    btnCheck.title = 'Simpan perubahan';
                    btnCheck.disabled = true;
                    btnCheck.dataset.index = realIndex;
                    btnCheck.dataset.action = 'check';
                    btnCheck.addEventListener('click', () => {
                        if (!isSearch) {
                            const nikInput = document.querySelector(`input[data-index="${realIndex}"][data-field="nik"]`);
                            if (nikInput) saveEditNik(realIndex, nikInput, btnCheck);
                        }
                    });

                    const arrowBtn = document.createElement('button');
                    arrowBtn.className = 'btn btn-secondary btn-arrow';
                    arrowBtn.textContent = isExpanded ? '▲' : '▼';
                    arrowBtn.title = 'Tampilkan detail';
                    arrowBtn.dataset.targetKey = nik;
                    arrowBtn.onclick = () => toggleDetailRow(`detail-${realIndex}`, nik);

                    divAksi.appendChild(btnDelete);
                    divAksi.appendChild(btnCheck);
                    divAksi.appendChild(arrowBtn);
                    tdAksi.appendChild(divAksi);
                }
                tr.appendChild(tdAksi);
                tbody.appendChild(tr);

                // DETAIL ROW
                const detailTr = document.createElement('tr');
                detailTr.className = 'detail-row';
                detailTr.id = `detail-${realIndex}`;
                detailTr.style.display = isExpanded ? '' : 'none';
                const detailTd = document.createElement('td');
                detailTd.colSpan = 3;

                if (appState.mode === 'SALIN') {
                    const container = document.createElement('div');
                    container.className = 'detail-saln-container';

                    const itemTempat = document.createElement('div');
                    itemTempat.className = 'detail-item';
                    const labelTempat = document.createElement('span');
                    labelTempat.className = 'detail-label';
                    labelTempat.textContent = 'Tempat Lahir:';
                    const valueTempat = document.createElement('div');
                    valueTempat.className = 'detail-value';
                    valueTempat.textContent = tempat || '-';
                    const keyTempat = `${nik}:tempat`;
                    const isTempatCopied = appState.copiedDetailSet.has(keyTempat);
                    const btnCopyTempat = document.createElement('button');
                    btnCopyTempat.className = isTempatCopied ? 'btn btn-warning btn-xs btn-copied' : 'btn btn-warning btn-xs';
                    btnCopyTempat.textContent = '⎘';
                    btnCopyTempat.title = isTempatCopied ? 'Tersalin' : 'Salin Tempat Lahir';
                    btnCopyTempat.disabled = isTempatCopied;
                    btnCopyTempat.onclick = () => copyDetailText(tempat, 'Tempat Lahir', btnCopyTempat, keyTempat);
                    itemTempat.appendChild(labelTempat);
                    itemTempat.appendChild(valueTempat);
                    itemTempat.appendChild(btnCopyTempat);

                    const itemTanggal = document.createElement('div');
                    itemTanggal.className = 'detail-item';
                    const labelTanggal = document.createElement('span');
                    labelTanggal.className = 'detail-label';
                    labelTanggal.textContent = 'Tanggal Lahir:';
                    const valueTanggal = document.createElement('div');
                    valueTanggal.className = 'detail-value detail-date-value';
                    valueTanggal.textContent = tanggal || '-';
                    const keyTanggal = `${nik}:tanggal`;
                    const isTanggalCopied = appState.copiedDetailSet.has(keyTanggal);
                    const btnCopyTanggal = document.createElement('button');
                    btnCopyTanggal.className = isTanggalCopied ? 'btn btn-warning btn-xs btn-copied' : 'btn btn-warning btn-xs';
                    btnCopyTanggal.textContent = '⎘';
                    btnCopyTanggal.title = isTanggalCopied ? 'Tersalin' : 'Salin Tanggal Lahir';
                    btnCopyTanggal.disabled = isTanggalCopied;
                    btnCopyTanggal.onclick = () => copyDetailText(tanggal, 'Tanggal Lahir', btnCopyTanggal, keyTanggal);
                    itemTanggal.appendChild(labelTanggal);
                    itemTanggal.appendChild(valueTanggal);
                    itemTanggal.appendChild(btnCopyTanggal);

                    container.appendChild(itemTempat);
                    container.appendChild(itemTanggal);
                    detailTd.appendChild(container);
                } else {
                    const container = document.createElement('div');
                    container.className = 'detail-edit-container';
                    const tempatInput = document.createElement('input');
                    tempatInput.type = 'text';
                    tempatInput.placeholder = 'Tempat';
                    tempatInput.value = tempat;
                    tempatInput.className = 'nik-input-edit';
                    tempatInput.dataset.index = realIndex;
                    tempatInput.dataset.field = 'tempat';
                    tempatInput.dataset.original = tempat;
                    tempatInput.addEventListener('input', () => evaluateEditButtonByIndex(realIndex));
                    container.appendChild(tempatInput);

                    const tanggalContainer = createTanggalInputsWithMove(realIndex, tanggal, nik, false);
                    container.appendChild(tanggalContainer);

                    detailTd.appendChild(container);
                }
                detailTr.appendChild(detailTd);
                tbody.appendChild(detailTr);
            });

            // Baris tambahan untuk NIK baru
            if (appState.mode === 'EDIT' && appState.addingNew && !isSearch) {
                const index = -1;
                const key = '__new__';
                const isExpanded = appState.expandedNik.has(key);
                const tr = document.createElement('tr');
                const tdNo = document.createElement('td');
                // FIX #2: nomor urut mengikuti list tujuan (main/draft1/draft2) agar konsisten saat di draft
                const targetListForNumber =
                    appState.currentView === 'draft1' ? appState.draft1 :
                    appState.currentView === 'draft2' ? appState.draft2 :
                    appState.main;
                // FIX #3 (T-1): label view untuk tooltip tombol ✓
                const targetViewLabel = appState.currentView === 'draft1' ? 'Draft 1' : appState.currentView === 'draft2' ? 'Draft 2' : 'Utama';
                tdNo.textContent = targetListForNumber.length + 1;
                tr.appendChild(tdNo);

                const tdNik = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Masukkan 16 digit NIK';
                input.className = 'nik-input-edit';
                input.maxLength = 16;
                input.dataset.index = index;
                input.dataset.field = 'nik';
                input.value = appState.newNikData ? appState.newNikData.nik : '';
                input.dataset.original = input.value;
                input.addEventListener('input', () => evaluateEditButtonByIndex(index));
                tdNik.appendChild(input);
                tr.appendChild(tdNik);

                const tdAksi = document.createElement('td');
                tdAksi.style.textAlign = 'center';
                const divAksi = document.createElement('div');
                divAksi.className = 'aksi-buttons';
                const btnCancel = document.createElement('button');
                btnCancel.className = 'btn btn-secondary btn-xs';
                btnCancel.textContent = '✕';
                btnCancel.title = 'Batal';
                btnCancel.onclick = () => { appState.addingNew = false; appState.newNikData = null; appState.expandedNik.delete(key); renderAll(); };
                const btnCheck = document.createElement('button');
                btnCheck.className = 'btn btn-success btn-xs';
                btnCheck.textContent = '✓';
                // FIX #3 (T-1): tooltip dinamis mengikuti target view aktif
                btnCheck.title = `Tambah NIK ke ${targetViewLabel}`;
                btnCheck.disabled = true;
                btnCheck.dataset.index = index;
                btnCheck.dataset.action = 'check';
                btnCheck.addEventListener('click', () => {
                    const nikInput = document.querySelector(`input[data-index="-1"][data-field="nik"]`);
                    if (nikInput) saveEditNik(-1, nikInput, btnCheck);
                });
                const arrowBtn = document.createElement('button');
                arrowBtn.className = 'btn btn-secondary btn-arrow';
                arrowBtn.textContent = isExpanded ? '▲' : '▼';
                arrowBtn.title = 'Tampilkan detail';
                arrowBtn.dataset.targetKey = key;
                arrowBtn.onclick = () => toggleDetailRow('detail-new', key);

                divAksi.appendChild(btnCancel);
                divAksi.appendChild(btnCheck);
                divAksi.appendChild(arrowBtn);
                tdAksi.appendChild(divAksi);
                tr.appendChild(tdAksi);
                tbody.appendChild(tr);

                const detailTr = document.createElement('tr');
                detailTr.className = 'detail-row';
                detailTr.id = 'detail-new';
                detailTr.style.display = isExpanded ? '' : 'none';
                const detailTd = document.createElement('td');
                detailTd.colSpan = 3;
                const container = document.createElement('div');
                container.className = 'detail-edit-container';

                const tempatInput = document.createElement('input');
                tempatInput.type = 'text';
                tempatInput.placeholder = 'Tempat';
                tempatInput.className = 'nik-input-edit';
                tempatInput.dataset.index = index;
                tempatInput.dataset.field = 'tempat';
                tempatInput.value = appState.newNikData ? appState.newNikData.tempat : '';
                tempatInput.dataset.original = tempatInput.value;
                tempatInput.addEventListener('input', () => evaluateEditButtonByIndex(index));
                container.appendChild(tempatInput);

                const tanggalValue = appState.newNikData ? appState.newNikData.tanggal : '';
                const tanggalContainer = createTanggalInputsWithMove(index, tanggalValue, null, true);
                container.appendChild(tanggalContainer);

                detailTd.appendChild(container);
                detailTr.appendChild(detailTd);
                tbody.appendChild(detailTr);

                setTimeout(() => evaluateEditButtonByIndex(-1), 50);
            }

            if (tbody.children.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 3;
                td.style.textAlign = 'center';
                td.style.color = 'var(--text-muted)';
                td.textContent = 'Tidak ada data NIK.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
        }

        // FITUR BARU: FUNGSI COLOR PICKER (BERDASARKAN NIK)
        function openColorPicker(nikString) {
            appState.currentColorTargetNik = nikString; 
            document.getElementById('color-picker-modal').classList.remove('hidden');
        }

        function applyColor(colorHex) {
            if (appState.currentColorTargetNik) {
                const allLists = [appState.main, appState.draft1, appState.draft2];
                let found = false;
                
                for (const list of allLists) {
                    const item = list.find(i => i.nik === appState.currentColorTargetNik);
                    if (item) {
                        item.color = colorHex; 
                        found = true;
                        break;
                    }
                }
                
                if (found) {
                    saveAppData();
                    renderNikTable();
                    showNotification('Warna penanda disimpan');
                }
            }
            document.getElementById('color-picker-modal').classList.add('hidden');
            appState.currentColorTargetNik = null;
        }

        function saveEditNik(index, input, btnCheck) {
            if (btnCheck.disabled) return;
            let val = input.value.trim();
            const tempatInput = document.querySelector(`input[data-index="${index}"][data-field="tempat"]`);
            let tempatVal = tempatInput ? tempatInput.value.trim() : '';
            let tanggalVal = getTanggalFromFields(index);

            if (!isValidTanggalEntry(index)) {
                showNotification('Tanggal lahir tidak valid. Gunakan format DD-MM-YYYY.');
                return;
            }

            if (!/^\d{16}$/.test(val)) {
                showNotification('NIK harus 16 digit angka');
                return;
            }

            const currentList = getCurrentList();
            const allNik = [...appState.main, ...appState.draft1, ...appState.draft2];
            const isDuplicate = allNik.some(item => item.nik === val && item !== (index >= 0 ? currentList[index] : null));
            if (isDuplicate) {
                showNotification('NIK sudah terdaftar');
                return;
            }

            if (index >= 0) {
                const item = currentList[index];
                item.nik = val;
                item.tempat = tempatVal;
                item.tanggal = tanggalVal;
                showNotification('NIK berhasil diubah');
            } else {
                // FIX #1: hormati view aktif — draft1/draft2/main, fallback ke main
                let targetList;
                if (appState.currentView === 'draft1') targetList = appState.draft1;
                else if (appState.currentView === 'draft2') targetList = appState.draft2;
                else targetList = appState.main;
                targetList.push({ nik: val, tempat: tempatVal, tanggal: tanggalVal, color: appState.newNikData?.color || '' });
                appState.addingNew = false;
                appState.newNikData = null;
                appState.expandedNik.delete('__new__');
                showNotification('NIK berhasil ditambahkan');
            }
            saveAppData();
            renderAll();
        }

        function copyNikToClipboard(nikString, btnElement) {
            const cleanNik = String(nikString).trim();
            function onSuccess() {
                appState.copiedSet.add(cleanNik);
                renderStats();
                if (btnElement) {
                    btnElement.className = 'btn btn-primary btn-xs btn-copied';
                    btnElement.textContent = '⎘';
                    btnElement.title = 'Tersalin';
                    btnElement.disabled = true;
                }
                showNotification('NIK berhasil disalin');
            }
            function onFailure() { showNotification('Gagal menyalin NIK'); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(cleanNik).then(onSuccess).catch(() => fallbackCopy(cleanNik, onSuccess, onFailure));
            } else {
                fallbackCopy(cleanNik, onSuccess, onFailure);
            }
        }

        function copyDetailText(text, label, btnElement, key) {
            const clean = String(text).trim();
            if (!clean) { showNotification(`${label} kosong`); return; }
            function onSuccess() {
                appState.copiedDetailSet.add(key);
                if (btnElement) {
                    btnElement.classList.add('btn-copied');
                    btnElement.disabled = true;
                    btnElement.title = 'Tersalin';
                }
                showNotification(`${label} berhasil disalin`);
            }
            function onFailure() { showNotification(`Gagal menyalin ${label}`); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(clean).then(onSuccess).catch(() => fallbackCopy(clean, onSuccess, onFailure));
            } else {
                fallbackCopy(clean, onSuccess, onFailure);
            }
        }

        function fallbackCopy(text, onSuccess, onFailure) {
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.top = '0';
                textArea.style.left = '0';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) onSuccess();
                else onFailure();
            } catch (err) { onFailure(); }
        }

        function toggleDetailRow(detailId, key) {
            const row = document.getElementById(detailId);
            if (!row) return;
            const isHidden = row.style.display === 'none';
            row.style.display = isHidden ? '' : 'none';
            if (isHidden) appState.expandedNik.add(key);
            else appState.expandedNik.delete(key);
            const btn = document.querySelector(`button[data-target-key="${key}"]`);
            if (btn) btn.textContent = isHidden ? '▲' : '▼';
        }

        // ============================================================
        // 7. FITUR BARU: DRAFT SAMPAH (TRASH)
        // ============================================================
        
        function addToTrash(item, originalView, originalIndex) {
            const trashItem = {
                ...item,
                _originalView: originalView,
                _originalIndex: originalIndex,
                _deletedAt: Date.now()
            };
            
            appState.trash.unshift(trashItem);
            
            if (appState.trash.length > 10) {
                appState.trash = appState.trash.slice(0, 10);
            }
            
            appState.trashTimestamp = Date.now();
            saveAppData();
        }

        function openTrashModal() {
            if (appState.trashTimestamp > 0 && (Date.now() - appState.trashTimestamp > 30 * 24 * 60 * 60 * 1000)) {
                appState.trash = [];
                appState.trashTimestamp = 0;
                saveAppData();
                showNotification('Draft Sampah dikosongkan karena melewati 30 hari tanpa penghapusan baru.');
            }
            
            document.getElementById('info-dropdown-content').classList.remove('open');
            renderTrashList();
            document.getElementById('trash-modal').classList.remove('hidden');
        }

        function renderTrashList() {
            const container = document.getElementById('trash-list-container');
            container.innerHTML = '';
            
            if (appState.trash.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.style.cssText = 'text-align:center; color:var(--text-muted); font-size:0.8rem; padding:20px;';
                emptyMessage.textContent = 'Draft Sampah kosong.';
                container.appendChild(emptyMessage);
                return;
            }

            appState.trash.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'trash-item';
                
                const dateStr = new Date(item._deletedAt).toLocaleString('id-ID', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit'});

                const info = document.createElement('div');
                info.className = 'trash-info';
                const nikLabel = document.createElement('strong');
                if (VALID_NIK_COLORS.has(item.color) && item.color) {
                    const colorIndicator = document.createElement('span');
                    colorIndicator.style.cssText = `display:inline-block; width:10px; height:10px; border-radius:50%; background:${item.color}; margin-right:4px;`;
                    colorIndicator.setAttribute('aria-hidden', 'true');
                    nikLabel.appendChild(colorIndicator);
                }
                nikLabel.appendChild(document.createTextNode(item.nik));
                const origin = document.createElement('span');
                origin.style.cssText = 'color:var(--text-muted); font-size:0.65rem;';
                origin.textContent = `Asal: ${item._originalView.toUpperCase()} (No. ${item._originalIndex + 1})`;
                const deletedAt = document.createElement('span');
                deletedAt.style.cssText = 'color:var(--text-muted); font-size:0.65rem;';
                deletedAt.textContent = `Dihapus: ${dateStr}`;
                info.append(nikLabel, origin, deletedAt);

                const restoreButton = document.createElement('button');
                restoreButton.className = 'btn btn-success btn-xs';
                restoreButton.textContent = 'Pulihkan';
                restoreButton.addEventListener('click', () => restoreFromTrash(index));
                div.append(info, restoreButton);
                container.appendChild(div);
            });
        }

        function restoreFromTrash(trashIndex) {
            const item = appState.trash[trashIndex];
            if (!item) return;

            let targetList;
            if (item._originalView === 'main') targetList = appState.main;
            else if (item._originalView === 'draft1') targetList = appState.draft1;
            else if (item._originalView === 'draft2') targetList = appState.draft2;

            if (targetList) {
                if ([...appState.main, ...appState.draft1, ...appState.draft2].some(record => record.nik === item.nik)) {
                    showNotification('NIK sudah ada di daftar; hapus duplikat sebelum memulihkan.');
                    return;
                }
                appState.trash.splice(trashIndex, 1);
                
                const insertIndex = Math.min(item._originalIndex, targetList.length);
                targetList.splice(insertIndex, 0, normalizeNikRecord(item));
                
                saveAppData();
                renderAll();
                renderTrashList(); 
                showNotification('Data berhasil dipulihkan ke posisi semula');
            } else {
                showNotification('Gagal memulihkan: Tujuan asal tidak ditemukan');
            }
        }

        function promptDeleteNik(index) {
            const currentList = getCurrentList();
            if (index < 0 || index >= currentList.length) return;
            showModal('Apakah Anda yakin ingin menghapus NIK ini? (Data akan masuk ke Draft Sampah)', () => {
                const deleted = currentList.splice(index, 1)[0];
                undoStack = { type: 'DELETE_NIK', index: index, data: deleted, list: appState.currentView };
                addToTrash(deleted, appState.currentView, index);
                renderAll();
                showNotification('NIK dipindahkan ke Draft Sampah', true);
            });
        }

        function promptDeleteAllNik() {
            const currentList = getCurrentList();
            if (currentList.length === 0) {
                showNotification('Daftar NIK di view ini sudah kosong');
                return;
            }
            showModal('PERINGATAN: Anda akan menghapus SEMUA NIK di view ini dan memasukkannya ke Draft Sampah. Lanjutkan?', () => {
                const oldList = [...currentList];
                undoStack = { type: 'DELETE_ALL_NIK', data: oldList, list: appState.currentView };
                currentList.length = 0;
                for (let i = oldList.length - 1; i >= 0; i--) {
                    appState.trash.unshift({
                        ...oldList[i],
                        _originalView: appState.currentView,
                        _originalIndex: i,
                        _deletedAt: Date.now()
                    });
                }
                appState.trash = appState.trash.slice(0, 10);
                appState.trashTimestamp = Date.now();
                saveAppData();
                renderAll();
                showNotification('Semua NIK di view ini dipindahkan ke Draft Sampah', true);
            });
        }

        function addNewNikRow() {
            if (appState.addingNew) return;
            appState.addingNew = true;
            appState.newNikData = null;
            appState.expandedNik.delete('__new__');
            renderAll();
        }

        // ============================================================
        // 8. SALES NOTES
        // ============================================================
        function renderSalesNotes() {
            const tbody = document.getElementById('sales-notes-list');
            tbody.innerHTML = '';
            appState.salesNotes.forEach((note, index) => {
                const tr = document.createElement('tr');
                const tdNo = document.createElement('td');
                tdNo.textContent = index + 1;
                tr.appendChild(tdNo);
                const tdAwal = document.createElement('td');
                tdAwal.textContent = note.awal;
                tr.appendChild(tdAwal);
                const tdAkhir = document.createElement('td');
                tdAkhir.textContent = note.akhir;
                tr.appendChild(tdAkhir);
                const tdTanggal = document.createElement('td');
                tdTanggal.textContent = note.date;
                tr.appendChild(tdTanggal);
                const tdAksi = document.createElement('td');
                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn btn-danger btn-action-sm';
                btnDelete.textContent = 'HAPUS';
                btnDelete.onclick = () => promptDeleteNote(index);
                tdAksi.appendChild(btnDelete);
                tr.appendChild(tdAksi);
                tbody.appendChild(tr);
            });
            if (appState.salesNotes.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 5;
                td.style.textAlign = 'center';
                td.style.color = 'var(--text-muted)';
                td.textContent = 'Belum ada catatan penjualan.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
        }

        function saveSalesNote() {
            const awalInput = document.getElementById('note-awal');
            const akhirInput = document.getElementById('note-akhir');
            const awal = parseInt(awalInput.value, 10);
            const akhir = parseInt(akhirInput.value, 10);
            if (isNaN(awal) || isNaN(akhir)) { showNotification('Input tidak valid: harus angka'); return; }
            if (awal < 1 || akhir < 1) { showNotification('Nomor tidak boleh kurang dari 1'); return; }
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`;
            appState.salesNotes.push({ awal, akhir, date: dateStr });
            undoStack = { type: 'ADD_NOTE', index: appState.salesNotes.length - 1 };
            saveSalesNotes();
            renderSalesNotes();
            awalInput.value = '';
            akhirInput.value = '';
            showNotification('Catatan berhasil disimpan', true);
        }

        function promptDeleteNote(index) {
            showModal('Apakah Anda yakin ingin menghapus catatan ini?', () => {
                const deletedNote = appState.salesNotes[index];
                undoStack = { type: 'DELETE_NOTE', index, data: deletedNote };
                appState.salesNotes.splice(index, 1);
                saveSalesNotes();
                renderSalesNotes();
                showNotification('Catatan berhasil dihapus', true);
            });
        }

        function promptResetNotes() {
            if (appState.salesNotes.length === 0) { showNotification('Catatan penjualan sudah kosong'); return; }
            showModal('Apakah Anda yakin ingin menghapus SELURUH catatan penjualan?', () => {
                const oldNotes = [...appState.salesNotes];
                undoStack = { type: 'RESET_NOTES', data: oldNotes };
                appState.salesNotes = [];
                saveSalesNotes();
                renderSalesNotes();
                showNotification('Reset berhasil dilakukan', true);
            });
        }

        // ============================================================
        // 9. NOTIFICATION & UNDO
        // ============================================================
        function showNotification(message, hasUndo = false) {
            const container = document.getElementById('notification-container');
            while (container.children.length >= 3) container.removeChild(container.firstChild);
            const toast = document.createElement('div');
            toast.className = 'toast';
            const textSpan = document.createElement('span');
            textSpan.textContent = message;
            toast.appendChild(textSpan);
            if (hasUndo && undoStack) {
                const undoBtn = document.createElement('button');
                undoBtn.className = 'toast-undo-icon';
                undoBtn.textContent = 'UNDO';
                undoBtn.title = 'Urungkan';
                undoBtn.onclick = () => { executeUndo(); toast.remove(); };
                toast.appendChild(undoBtn);
            }
            container.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
        }

        function executeUndo() {
            if (!undoStack) return;
            const action = undoStack;
            undoStack = null;
            switch (action.type) {
                case 'DELETE_NIK': {
                    const list = getListByView(action.list);
                    const trashItemIndex = appState.trash.findIndex(t => t.nik === action.data.nik && t._originalView === action.list);
                    if (trashItemIndex !== -1) {
                        appState.trash.splice(trashItemIndex, 1);
                    }
                    if (list) list.splice(action.index, 0, action.data);
                    saveAppData();
                    break;
                }
                case 'DELETE_ALL_NIK': {
                    action.data.forEach(item => {
                        const trashItemIndex = appState.trash.findIndex(t => t.nik === item.nik && t._originalView === action.list);
                        if (trashItemIndex !== -1) {
                            appState.trash.splice(trashItemIndex, 1);
                        }
                    });
                    const list = getListByView(action.list);
                    if (list) { list.length = 0; list.push(...action.data); }
                    saveAppData();
                    break;
                }
                case 'DELETE_NOTE':
                    appState.salesNotes.splice(action.index, 0, action.data);
                    saveSalesNotes();
                    break;
                case 'RESET_NOTES':
                    appState.salesNotes = action.data;
                    saveSalesNotes();
                    break;
                case 'ADD_NOTE':
                    if (action.index >= 0 && action.index < appState.salesNotes.length) appState.salesNotes.splice(action.index, 1);
                    saveSalesNotes();
                    break;
                default:
                    return;
            }
            renderAll();
            showNotification('Aksi telah dibatalkan');
        }

        function getListByView(view) {
            if (view === 'main') return appState.main;
            if (view === 'draft1') return appState.draft1;
            if (view === 'draft2') return appState.draft2;
            return null;
        }

        function updateDeleteAllButton() {
            const container = document.getElementById('delete-all-container');
            if (!container) return;
            const isSearch = (appState.currentView === 'search');
            if (isSearch) container.classList.add('hidden');
            else {
                if (appState.mode === 'EDIT') container.classList.remove('hidden');
                else container.classList.add('hidden');
            }
        }

        function updateQuickAddButton() {
            const btn = document.getElementById('quick-add-btn');
            const query = appState.searchNikQuery.trim();
            const valid = query.length === 16 && /^\d{16}$/.test(query);
            const all = [...appState.main, ...appState.draft1, ...appState.draft2];
            const exists = valid && all.some(item => item.nik === query);
            btn.disabled = !valid || exists;
        }

        // ============================================================
        // 10. INFO DROPDOWN & DETAIL
        // ============================================================
        function toggleInfoDropdown() {
            const content = document.getElementById('info-dropdown-content');
            if (content) content.classList.toggle('open');
        }

        function showInfoDetail(target) {
            const content = document.getElementById('info-dropdown-content');
            if (content) content.classList.remove('open');

            let list = [];
            let label = '';
            if (target === 'keseluruhan') {
                list = [...appState.main, ...appState.draft1, ...appState.draft2];
                label = 'KESELURUHAN';
            } else if (target === 'utama') {
                list = appState.main;
                label = 'UTAMA';
            } else if (target === 'draft1') {
                list = appState.draft1;
                label = 'DRAFT 1';
            } else if (target === 'draft2') {
                list = appState.draft2;
                label = 'DRAFT 2';
            }

            const total = list.length;
            let male = 0, female = 0;
            let age17Plus = 0, ageUnder17 = 0;
            let complete = 0, onlyPlace = 0, onlyDate = 0;
            const today = new Date();

            list.forEach(item => {
                const nik = item.nik;
                const hasPlace = item.tempat && item.tempat.trim() !== '';
                const hasDate = item.tanggal && item.tanggal.trim() !== '';

                if (hasPlace && hasDate) complete++;
                else if (hasPlace && !hasDate) onlyPlace++;
                else if (!hasPlace && hasDate) onlyDate++;

                if (nik && nik.length >= 8) {
                    const digit = parseInt(nik[6] + nik[7], 10);
                    if (digit >= 40 && digit <= 71) female++;
                    else male++;
                }

                if (hasDate) {
                    const parts = item.tanggal.split('-');
                    if (parts.length === 3) {
                        const dd = parseInt(parts[0], 10);
                        const mm = parseInt(parts[1], 10) - 1;
                        const yyyy = parseInt(parts[2], 10);
                        if (!isNaN(dd) && !isNaN(mm) && !isNaN(yyyy)) {
                            const birth = new Date(yyyy, mm, dd);
                            let age = today.getFullYear() - birth.getFullYear();
                            if (today.getMonth() < birth.getMonth() ||
                                (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) {
                                age--;
                            }
                            if (age >= 17) age17Plus++;
                            else ageUnder17++;
                        }
                    }
                }
            });

            const html = `
                <table class="info-table">
                    <tr><td class="label">Total NIK</td><td class="value highlight">${total}</td></tr>
                    <tr><td class="label">Laki-laki</td><td class="value">${male}</td></tr>
                    <tr><td class="label">Perempuan</td><td class="value">${female}</td></tr>
                    <tr><td class="label">Umur ≥ 17 tahun</td><td class="value">${age17Plus}</td></tr>
                    <tr><td class="label">Umur < 17 tahun</td><td class="value">${ageUnder17}</td></tr>
                    <tr><td class="label">Data Lengkap</td><td class="value">${complete}</td></tr>
                    <tr><td class="label">Hanya Tempat Lahir</td><td class="value">${onlyPlace}</td></tr>
                    <tr><td class="label">Hanya Tanggal Lahir</td><td class="value">${onlyDate}</td></tr>
                </table>
                <div style="font-size:0.7rem; color:var(--text-muted); text-align:center; margin-top:12px;">
                    Terakhir diperbarui: ${today.toLocaleString('id-ID')}
                </div>
            `;

            document.getElementById('info-detail-title').textContent = `Informasi Data - ${label}`;
            document.getElementById('info-detail-body').innerHTML = html;
            document.getElementById('info-detail-modal').classList.remove('hidden');
        }

        // ============================================================
        // 11. PINDAH NIK
        // ============================================================
        function promptMoveNik(index, isNew = false) {
            const currentList = isNew ? null : getCurrentList();
            if (!isNew && (index < 0 || index >= currentList.length)) return;
            const item = isNew ? appState.newNikData : currentList[index];
            if (!item) return;
            const nik = item.nik || '';

            let options = [];
            if (appState.currentView === 'main' || appState.currentView === 'search' || isNew) {
                options = [
                    { label: 'Draft 1', value: 'draft1' },
                    { label: 'Draft 2', value: 'draft2' }
                ];
            } else if (appState.currentView === 'draft1') {
                options = [
                    { label: 'NIK Utama', value: 'main' },
                    { label: 'Draft 2', value: 'draft2' }
                ];
            } else if (appState.currentView === 'draft2') {
                options = [
                    { label: 'NIK Utama', value: 'main' },
                    { label: 'Draft 1', value: 'draft1' }
                ];
            }

            const msg = document.getElementById('move-draft-message');
            msg.textContent = isNew ? `Pindahkan NIK baru ${nik} ke:` : `Pindahkan NIK ${nik} ke:`;

            const actionsDiv = document.getElementById('move-draft-actions');
            actionsDiv.innerHTML = '';
            options.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-primary btn-action-sm';
                btn.textContent = opt.label;
                btn.onclick = () => {
                    if (isNew) executeMoveNewNik(opt.value, item);
                    else executeMoveNik(index, opt.value, item);
                };
                actionsDiv.appendChild(btn);
            });
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary btn-action-sm';
            cancelBtn.textContent = 'BATAL';
            cancelBtn.onclick = () => {
                document.getElementById('move-draft-modal').classList.add('hidden');
            };
            actionsDiv.appendChild(cancelBtn);

            document.getElementById('move-draft-modal').classList.remove('hidden');
        }

        function executeMoveNik(index, targetView, item) {
            const currentList = getCurrentList();
            if (index < 0 || index >= currentList.length) return;
            const targetList = getListByView(targetView);
            if (!targetList || targetList === currentList) return;

            const [removed] = currentList.splice(index, 1);
            targetList.push(removed);
            if (appState.currentView === 'main' && targetView !== 'main') {
                appState.movedFromDraftTimestamps[removed.nik] = Date.now();
                saveMovedTimestamps();
            }
            saveAppData();
            document.getElementById('move-draft-modal').classList.add('hidden');
            renderAll();
            showNotification(`NIK dipindahkan ke ${targetView.toUpperCase()}`);
        }

        function executeMoveNewNik(targetView, item) {
            if (!isValidNIK(item.nik)) {
                showNotification('NIK tidak valid (harus 16 digit)');
                return;
            }
            const all = [...appState.main, ...appState.draft1, ...appState.draft2];
            if (all.some(i => i.nik === item.nik)) {
                showNotification('NIK sudah terdaftar di salah satu view');
                return;
            }

            let targetList;
            if (targetView === 'main') targetList = appState.main;
            else if (targetView === 'draft1') targetList = appState.draft1;
            else if (targetView === 'draft2') targetList = appState.draft2;
            else return;

            const newItem = { nik: item.nik, tempat: item.tempat || '', tanggal: item.tanggal || '', color: item.color || '' };
            targetList.push(newItem);

            appState.addingNew = false;
            appState.newNikData = null;
            appState.expandedNik.delete('__new__');

            saveAppData();
            document.getElementById('move-draft-modal').classList.add('hidden');
            renderAll();
            showNotification(`NIK baru ditambahkan ke ${targetView.toUpperCase()}`);
        }

        // ============================================================
        // 12. EKSPOR & IMPOR (DISEMPURNAKAN)
        // ============================================================
        
        function openExportModal() {
            document.getElementById('export-modal').classList.remove('hidden');
        }

        function processExport(type) {
            document.getElementById('export-modal').classList.add('hidden');
            
            let dataToExport = {};
            let filename = `ud_charles_backup_${type}_${new Date().toISOString().slice(0, 10)}.json`;
            
            if (type === 'all') {
                dataToExport = {
                    type: "all",
                    main: appState.main,
                    draft1: appState.draft1,
                    draft2: appState.draft2,
                    salesNotes: appState.salesNotes,
                    exportedAt: new Date().toISOString()
                };
                filename = `ud_charles_FULL_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;
            } else if (type === 'main') {
                dataToExport = { type: "main", data: appState.main };
            } else if (type === 'draft1') {
                dataToExport = { type: "draft1", data: appState.draft1 };
            } else if (type === 'draft2') {
                dataToExport = { type: "draft2", data: appState.draft2 };
            } else if (type === 'notes') {
                dataToExport = { type: "notes", data: appState.salesNotes };
            }

            const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showNotification(`Ekspor ${type.toUpperCase()} berhasil`);
        }

        function importData(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                event.target.value = '';
                showNotification('Gagal import: Ukuran file maksimal 5 MB.');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const nextMain = [...appState.main];
                    const nextDraft1 = [...appState.draft1];
                    const nextDraft2 = [...appState.draft2];
                    const nextNotes = [...appState.salesNotes];
                    const seenNik = new Set([...nextMain, ...nextDraft1, ...nextDraft2].map(item => item.nik));
                    const noteKeys = new Set(nextNotes.map(note => `${note.awal}|${note.akhir}|${note.date}`));
                    let skippedCount = 0;
                    const summary = [];

                    const mergeNikRecords = (target, records) => {
                        let addedCount = 0;
                        normalizeNikRecordList(records).forEach(item => {
                            if (seenNik.has(item.nik)) {
                                skippedCount++;
                                return;
                            }
                            target.push(item);
                            seenNik.add(item.nik);
                            addedCount++;
                        });
                        return addedCount;
                    };
                    const mergeNotes = records => {
                        let addedCount = 0;
                        normalizeSalesNoteList(records).forEach(note => {
                            const key = `${note.awal}|${note.akhir}|${note.date}`;
                            if (noteKeys.has(key)) {
                                skippedCount++;
                                return;
                            }
                            nextNotes.push(note);
                            noteKeys.add(key);
                            addedCount++;
                        });
                        return addedCount;
                    };

                    if (data.type === "notes") {
                        summary.push(`Catatan Belanja: +${mergeNotes(data.data)} ditambahkan`);
                    } else if (data.type === "main" || data.type === "draft1" || data.type === "draft2") {
                        const targetList = data.type === 'main' ? nextMain :
                            data.type === 'draft1' ? nextDraft1 : nextDraft2;
                        summary.push(`${data.type.toUpperCase()}: +${mergeNikRecords(targetList, data.data)} NIK ditambahkan`);
                    } else if (data.type === "all" || Array.isArray(data.main)) {
                        const addedMain = mergeNikRecords(nextMain, data.main || []);
                        const addedDraft1 = mergeNikRecords(nextDraft1, data.draft1 || []);
                        const addedDraft2 = mergeNikRecords(nextDraft2, data.draft2 || []);
                        const addedNotes = data.salesNotes == null ? 0 : mergeNotes(data.salesNotes);
                        summary.push(`Full Data: Main +${addedMain}, D1 +${addedDraft1}, D2 +${addedDraft2}, Notes +${addedNotes}`);
                    } else {
                        throw new Error('Format file tidak dikenali.');
                    }

                    appState.main = nextMain;
                    appState.draft1 = nextDraft1;
                    appState.draft2 = nextDraft2;
                    appState.salesNotes = nextNotes;
                    saveAppData();
                    saveSalesNotes();
                    renderAll();
                    showNotification(`Impor berhasil: ${summary.join(' | ')}, ${skippedCount} duplikat dilewati.`);

                } catch (err) {
                    showNotification(`Gagal import: ${err.message}`);
                    console.error(err);
                }
            };
            reader.onerror = () => showNotification('Gagal import: File tidak dapat dibaca.');
            reader.readAsText(file);
            event.target.value = ''; // Reset input file
        }

        // ============================================================
        // 13. MODAL CONFIRM & LAINNYA
        // ============================================================
        let currentModalAction = null;

        function showModal(message, onConfirm) {
            document.getElementById('modal-message').textContent = message;
            currentModalAction = onConfirm;
            document.getElementById('modal-confirm').classList.remove('hidden');
        }

        function closeModal() {
            document.getElementById('modal-confirm').classList.add('hidden');
            currentModalAction = null;
        }
        document.getElementById('modal-btn-confirm').addEventListener('click', () => {
            if (currentModalAction) currentModalAction();
            closeModal();
        });

        document.getElementById('move-draft-modal').addEventListener('click', function(e) {
            if (e.target === this) this.classList.add('hidden');
        });

        // ============================================================
        // 14. MULAI APLIKASI
        // ============================================================
        initApp();
    
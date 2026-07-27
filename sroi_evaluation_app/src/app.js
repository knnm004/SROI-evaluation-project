import html2pdf from 'html2pdf.js';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase using Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper to scope draft keys per project ID so projects don't bleed into each other
function getDraftKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id') || 'new';
    return `sroi-evaluation-draft-${id}`;
}

const OSM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_DEFAULT_CENTER = [13.7563, 100.5018];
const OSM_DEFAULT_ZOOM = 11;

const SDGs_LIST = [
    { id: 1, title: "ขจัดความยากจน", focus: "รายได้ ความมั่นคงของครัวเรือน การเข้าถึงสวัสดิการ" },
    { id: 2, title: "ยุติความหิวโหย", focus: "อาหาร โภชนาการ เกษตรกรรมยั่งยืน" },
    { id: 3, title: "สุขภาพและความเป็นอยู่ที่ดี", focus: "สุขภาวะ การรักษา การป้องกันโรค" },
    { id: 4, title: "การศึกษาที่มีคุณภาพ", focus: "การเรียนรู้ ทักษะ โอกาสทางการศึกษา" },
    { id: 5, title: "ความเท่าเทียมทางเพศ", focus: "สิทธิ ความปลอดภัย การมีส่วนร่วม" },
    { id: 6, title: "น้ำสะอาดและสุขาภิบาล", focus: "น้ำใช้ สุขอนามัย การจัดการน้ำ" },
    { id: 7, title: "พลังงานสะอาดที่เข้าถึงได้", focus: "พลังงานทางเลือก ประสิทธิภาพพลังงาน" },
    { id: 8, title: "งานที่มีคุณค่าและการเติบโตทางเศรษฐกิจ", focus: "อาชีพ รายได้ ผู้ประกอบการ" },
    { id: 9, title: "อุตสาหกรรม นวัตกรรม และโครงสร้างพื้นฐาน", focus: "นวัตกรรม เทคโนโลยี โครงสร้างพื้นฐาน" },
    { id: 10, title: "ลดความเหลื่อมล้ำ", focus: "กลุ่มเปราะบาง การเข้าถึงบริการ ความเป็นธรรม" },
    { id: 11, title: "เมืองและถิ่นฐานมนุษย์อย่างยั่งยืน", focus: "ชุมชน ที่อยู่อาศัย เมืองปลอดภัย" },
    { id: 12, title: "การผลิตและการบริโภคที่ยั่งยืน", focus: "ทรัพยากร ขยะ ห่วงโซ่อุปทาน" },
    { id: 13, title: "การรับมือการเปลี่ยนแปลงสภาพภูมิอากาศ", focus: "ปรับตัว ลดคาร์บอน ภัยพิบัติ" },
    { id: 14, title: "ทรัพยากรทางทะเล", focus: "ชายฝั่ง ประมง ระบบนิเวศทะเล" },
    { id: 15, title: "ระบบนิเวศทางบก", focus: "ป่า ความหลากหลายทางชีวภาพ ที่ดิน" },
    { id: 16, title: "สังคมสงบสุข ยุติธรรม และสถาบันเข้มแข็ง", focus: "ธรรมาภิบาล ความยุติธรรม ความปลอดภัย" },
    { id: 17, title: "ความร่วมมือเพื่อการพัฒนาที่ยั่งยืน", focus: "เครือข่าย นโยบาย ความร่วมมือข้ามภาคส่วน" }
];

export const appState = {
    currentView: 'view-landing',
    currentStep: 1,
    totalSteps: 6,
    uploadedImage: null,
    isViewMode: false,
    sroiRows: [],
    areaMap: null,
    areaMarker: null,
    areaRectangle: null,
    areaDragStart: null,
    isDrawingArea: false,
    mapSelectionMode: 'pin',
    areaSearchResults: [],
    lastGeocodeAt: 0,
    saveTimer: null,
    autosaveAttached: false,
    
    init() {
        this.sroiRows = [this.createSROIRow()];
        this.renderSDGs();
        this.renderStepper();
        this.renderSROIRows();
        this.attachAutoSaveListeners();
        this.loadDraft();
        this.updateSelectedSDGs();
        this.calculateSROIPreview();
        this.updateLiveSummary();
        this.setMapSelectionMode(this.getValue('m_location_type') || 'pin', false);
        this.updateAreaLocationUI();
    },

    showView(viewId) {
        document.getElementById('view-landing').classList.add('hidden');
        document.getElementById('view-login').classList.add('hidden');
        document.getElementById('view-app').classList.add('hidden');
        document.getElementById(viewId).classList.remove('hidden');
        this.currentView = viewId;
    },

    async login() {
        console.log("Attempting to log in with Chula Google OAuth...");

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                queryParams: {
                    hd: 'student.chula.ac.th',
                    prompt: 'select_account' // Forces Google account chooser to prevent auto-login
                },
                redirectTo: `${window.location.origin}/dashboard.html`
            }
        });

        if (error) {
            console.error("Login failed:", error);
            alert("เกิดข้อผิดพลาดในการเข้าสู่ระบบ (Login error occurred)");
            return;
        }
    },

    async logout() {
        try {
            await supabase.auth.signOut();
        } catch (error) {
            console.error("Error signing out:", error);
        }

        // Wipe all project draft keys from localStorage so data doesn't carry over
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sroi-evaluation-draft')) {
                localStorage.removeItem(key);
            }
        });

        this.currentStep = 1;
        this.uploadedImage = null;
        this.sroiRows = [];
        this.isViewMode = false;

        document.querySelectorAll('input, textarea').forEach(el => {
            if (el.type !== 'file') {
                el.value = '';
            }
        });
        document.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
        document.querySelectorAll('.sdg-checkbox').forEach(cb => cb.checked = false);

        window.history.replaceState({}, document.title, window.location.pathname);
        window.location.href = window.location.pathname;
    },

    goHome() {
        if(this.currentView === 'view-app' && !confirm('ข้อมูลถูกบันทึกเป็น draft บนเครื่องนี้ ต้องการกลับสู่หน้าหลักหรือไม่?')) return;
        window.location.href = '/dashboard.html';
    },

    renderSDGs() {
        const container = document.getElementById('sdg-container');
        let html = '';
        SDGs_LIST.forEach((sdg) => {
            const value = `SDG ${sdg.id}: ${sdg.title}`;
            const search = `${sdg.id} ${sdg.title} ${sdg.focus}`.toLowerCase();
            html += `
                <label class="cursor-pointer relative sdg-card" data-sdg-card data-search="${this.escapeHTML(search)}">
                    <input type="checkbox" class="sdg-checkbox peer sr-only" value="${this.escapeHTML(value)}" data-sdg-id="${sdg.id}">
                    <div class="h-full p-3 border-2 border-gray-200 rounded-lg hover:border-chula-light transition-colors text-sm flex items-start gap-3">
                        <div class="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0 flex items-center justify-center text-xs font-bold text-gray-500">
                            ${sdg.id}
                        </div>
                        <div>
                            <span class="font-semibold text-gray-800 leading-tight block">${this.escapeHTML(sdg.title)}</span>
                            <span class="text-xs text-gray-500 leading-snug mt-1 block">${this.escapeHTML(sdg.focus)}</span>
                        </div>
                    </div>
                </label>
            `;
        });
        container.innerHTML = html;
    },

    renderStepper() {
        const container = document.getElementById('stepper-container').querySelector('.flex');
        let stepsHtml = '';
        const stepNames = ["Metadata", "I1 SDGs", "I2/I3 Pathway", "S1 Evidence", "S2 SROI", "S3 Report"];
        
        for(let i=1; i<=this.totalSteps; i++) {
            stepsHtml += `
                <div class="flex flex-col items-center relative z-10 w-1/6 cursor-pointer hover:opacity-75" id="step-indicator-${i}" onclick="appState.goToStep(${i})">
                    <div class="w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm bg-white transition-colors duration-300 ${i===1 ? 'step-active' : 'step-inactive'}">
                        ${i}
                    </div>
                    <span class="text-xs mt-2 font-medium ${i===1 ? 'text-chula' : 'text-gray-400'} hidden md:block text-center px-1">${stepNames[i-1]}</span>
                </div>
            `;
        }
        container.innerHTML = stepsHtml;
    },

    goToStep(step) {
        if (this.isViewMode && step !== this.totalSteps) {
            alert("กรุณากดปุ่ม 'แก้ไขข้อมูล' ก่อนทำการแก้ไข (Please click the Edit button before modifying data)");
            return;
        }
        
        this.currentStep = step;
        this.updateStepUI();
        window.scrollTo({top: 0, behavior: 'smooth'});
    },

    enableEditMode() {
        this.isViewMode = false;
        this.currentStep = 1;
        this.updateStepUI(); 
        
        setTimeout(() => {
            const firstInput = document.getElementById('m_projectName');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
    },

    updateStepUI() {
        for(let i=1; i<=this.totalSteps; i++) {
            const indicator = document.getElementById(`step-indicator-${i}`);
            const circle = indicator.querySelector('div');
            const text = indicator.querySelector('span');
            
            if(i === this.currentStep) {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 step-active";
                text.className = "text-xs mt-2 font-medium text-chula hidden md:block text-center px-1";
            } else if (i < this.currentStep) {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 bg-chula-light border-chula-light text-white";
                text.className = "text-xs mt-2 font-medium text-gray-600 hidden md:block text-center px-1";
            } else {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 step-inactive";
                text.className = "text-xs mt-2 font-medium text-gray-400 hidden md:block text-center px-1";
            }
        }

        document.querySelectorAll('.step-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`step-${this.currentStep}`).classList.remove('hidden');

        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const formNav = document.getElementById('form-navigation');

        if (this.currentStep === 1) {
            btnPrev.classList.add('hidden');
        } else {
            btnPrev.classList.remove('hidden');
        }

        if (this.currentStep === this.totalSteps) {
            formNav.classList.add('hidden');
            this.generateReport(); 
            
            const btnSave = document.getElementById('btn-save-assessment');
            if (btnSave) {
                if (this.isViewMode) {
                    btnSave.innerHTML = 'แก้ไขข้อมูล <i class="fa-solid fa-pen-to-square ml-2"></i>';
                    btnSave.className = 'bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2 px-6 rounded-lg shadow transition-colors ml-4';
                    btnSave.setAttribute('onclick', 'appState.enableEditMode()');
                } else {
                    btnSave.innerHTML = 'บันทึกผลประเมิน <i class="fa-solid fa-floppy-disk ml-2"></i>';
                    btnSave.className = 'bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-6 rounded-lg shadow transition-colors ml-4';
                    btnSave.setAttribute('onclick', 'appState.confirmAndSave()');
                }
            }
        } else {
            formNav.classList.remove('hidden');
            if (this.currentStep === this.totalSteps - 1) {
                btnNext.innerHTML = 'ประมวลผลรายงาน <i class="fa-solid fa-file-invoice ml-2"></i>';
                btnNext.classList.remove('bg-chula');
                btnNext.classList.add('bg-gray-900', 'hover:bg-black');
            } else {
                btnNext.innerHTML = 'ถัดไป <i class="fa-solid fa-arrow-right ml-2"></i>';
                btnNext.classList.add('bg-chula');
                btnNext.classList.remove('bg-gray-900', 'hover:bg-black');
            }
        }

        document.querySelectorAll('input, textarea, select').forEach(el => {
            if (this.isViewMode) {
                el.disabled = true;
                el.readOnly = true;
                el.setAttribute('disabled', 'true');
                el.setAttribute('readonly', 'true');
                el.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            } else {
                el.disabled = false;
                el.readOnly = false;
                el.removeAttribute('disabled');
                el.removeAttribute('readonly');
                el.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });

        if (!this.isViewMode) {
            setTimeout(() => {
                const currentStepContainer = document.getElementById(`step-${this.currentStep}`);
                if (currentStepContainer) {
                    const firstInput = currentStepContainer.querySelector('input[type="text"], input[type="number"], textarea');
                    if (firstInput) {
                        firstInput.focus();
                    }
                }
            }, 50);
        }

        this.updateLiveSummary();
        if (this.currentStep === 1) {
            window.setTimeout(() => this.initAreaMap(), 0);
        }
    },

    nextStep() {
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
            this.updateStepUI();
            window.scrollTo({top: 0, behavior: 'smooth'});
            
            const mockDataToSave = {
                projectName: document.getElementById('m_projectName')?.value || "Untitled",
                currentStep: this.currentStep
            };
            saveProjectData(mockDataToSave);
        }
    },

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStepUI();
            window.scrollTo({top: 0, behavior: 'smooth'});
        }
    },

    showPathwayPanel(panelId) {
        document.querySelectorAll('[data-pathway-panel]').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.pathwayPanel !== panelId);
        });
        document.querySelectorAll('[data-pathway-tab]').forEach(tab => {
            const active = tab.dataset.pathwayTab === panelId;
            tab.classList.toggle('framework-tab-active', active);
            tab.classList.toggle('framework-tab-idle', !active);
        });
    },

    initAreaMap() {
        const mapEl = document.getElementById('area-map');
        if (!mapEl) return;

        if (!window.L) {
            this.setAreaMapStatus('โหลดแผนที่ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต');
            return;
        }

        if (!this.areaMap) {
            this.areaMap = window.L.map(mapEl, { scrollWheelZoom: false }).setView(OSM_DEFAULT_CENTER, OSM_DEFAULT_ZOOM);
            window.L.tileLayer(OSM_TILE_URL, {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(this.areaMap);
            this.areaMap.on('click', (event) => {
                if (this.mapSelectionMode === 'area') return;

                this.setProjectLocation({
                    lat: event.latlng.lat,
                    lng: event.latlng.lng,
                    displayName: 'ตำแหน่งที่ปักหมุดเอง',
                    label: this.getValue('m_location_label') || 'ตำแหน่งที่ปักหมุดเอง'
                });
            });
            this.areaMap.on('mousedown', (event) => this.startAreaDrag(event.latlng));
            this.areaMap.on('mousemove', (event) => this.updateAreaDrag(event.latlng));
            this.areaMap.on('mouseup', (event) => this.finishAreaDrag(event.latlng));
            this.areaMap.on('mouseout', (event) => {
                if (this.isDrawingArea && event.latlng) this.finishAreaDrag(event.latlng);
            });
        }

        window.setTimeout(() => {
            this.areaMap.invalidateSize();
            this.syncAreaMarkerFromFields();
        }, 0);
    },

    setAreaMapStatus(message) {
        const status = document.getElementById('area-map-status');
        if (status) status.innerText = message;
    },

    setMapSelectionMode(mode, updateStatus = true) {
        this.mapSelectionMode = mode === 'area' ? 'area' : 'pin';
        const typeInput = document.getElementById('m_location_type');
        if (typeInput && !this.getValue('m_lat')) typeInput.value = this.mapSelectionMode;

        ['pin', 'area'].forEach(item => {
            const button = document.getElementById(`map-mode-${item}`);
            if (!button) return;
            const active = item === this.mapSelectionMode;
            button.classList.toggle('map-mode-button-active', active);
            button.classList.toggle('map-mode-button-idle', !active);
        });

        const mapEl = document.getElementById('area-map');
        if (mapEl) mapEl.classList.toggle('area-map-draw-mode', this.mapSelectionMode === 'area');
        if (this.areaMap) {
            if (this.mapSelectionMode === 'area') {
                this.areaMap.dragging.disable();
            } else {
                this.areaMap.dragging.enable();
            }
        }

        if (this.mapSelectionMode === 'area') {
            this.areaDragStart = null;
            this.isDrawingArea = false;
            if (updateStatus) this.setAreaMapStatus('โหมดกำหนดพื้นที่: ลากบนแผนที่เพื่อคลุมพื้นที่ดำเนินงาน');
        } else if (updateStatus) {
            this.setAreaMapStatus('โหมดปักหมุด: คลิกบนแผนที่เพื่อเลือกตำแหน่งโครงการ');
        }
    },

    parseBounds(boundingbox) {
        if (!Array.isArray(boundingbox) || boundingbox.length !== 4) return null;
        const [south, north, west, east] = boundingbox.map(Number);
        if (![south, north, west, east].every(Number.isFinite)) return null;
        if (south === north || west === east) return null;
        return { south, north, west, east };
    },

    getBoundsFromFields() {
        const bounds = {
            south: this.parseNumberValue(this.getValue('m_bounds_south')),
            north: this.parseNumberValue(this.getValue('m_bounds_north')),
            west: this.parseNumberValue(this.getValue('m_bounds_west')),
            east: this.parseNumberValue(this.getValue('m_bounds_east'))
        };
        if (![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)) return null;
        if (!this.getValue('m_bounds_south') || !this.getValue('m_bounds_north') || !this.getValue('m_bounds_west') || !this.getValue('m_bounds_east')) return null;
        if (bounds.south === bounds.north || bounds.west === bounds.east) return null;
        return bounds;
    },

    getBoundsFromLatLngs(first, second) {
        const bounds = {
            south: Math.min(first.lat, second.lat),
            north: Math.max(first.lat, second.lat),
            west: Math.min(first.lng, second.lng),
            east: Math.max(first.lng, second.lng)
        };
        if (Math.abs(bounds.north - bounds.south) < 0.00005 || Math.abs(bounds.east - bounds.west) < 0.00005) return null;
        return bounds;
    },

    startAreaDrag(latlng) {
        if (this.mapSelectionMode !== 'area' || !this.areaMap || !window.L) return;
        this.areaDragStart = latlng;
        this.isDrawingArea = true;
        this.setAreaMapStatus('กำลังลากคลุมพื้นที่...');
    },

    updateAreaDrag(latlng) {
        if (!this.isDrawingArea || !this.areaDragStart || !this.areaMap || !window.L) return;
        const bounds = this.getBoundsFromLatLngs(this.areaDragStart, latlng);
        if (!bounds) return;
        this.setAreaRectangle(bounds, this.getSelectedLocationLabel('พื้นที่ที่กำหนดเอง'), false, true);
    },

    finishAreaDrag(latlng) {
        if (!this.isDrawingArea || !this.areaDragStart) return;
        const bounds = this.getBoundsFromLatLngs(this.areaDragStart, latlng);
        this.areaDragStart = null;
        this.isDrawingArea = false;

        if (!bounds) {
            this.setAreaMapStatus('ลากให้ครอบพื้นที่กว้างขึ้นอีกนิดเพื่อบันทึกขอบเขต');
            return;
        }

        this.setProjectArea({
            bounds,
            displayName: 'พื้นที่ที่กำหนดเอง',
            label: this.getValue('m_location_label') || 'พื้นที่ที่กำหนดเอง'
        });
    },

    getGeocodeCacheKey(query) {
        return `osm-search:${query.trim().toLowerCase()}`;
    },

    async searchAreaLocation() {
        const query = this.getValue('m_area').trim();
        if (!query) {
            this.setAreaMapStatus('กรอกชื่อพื้นที่ก่อนค้นหา');
            return;
        }

        const cached = localStorage.getItem(this.getGeocodeCacheKey(query));
        if (cached) {
            try {
                this.areaSearchResults = JSON.parse(cached);
                this.renderAreaSearchResults(this.areaSearchResults);
                this.setAreaMapStatus(`พบ ${this.areaSearchResults.length} ผลลัพธ์จาก cache`);
                return;
            } catch (error) {
                console.warn('Could not parse cached OSM result', error);
            }
        }

        const waitMs = Math.max(0, 1000 - (Date.now() - this.lastGeocodeAt));
        if (waitMs > 0) await new Promise(resolve => window.setTimeout(resolve, waitMs));

        this.setAreaMapStatus('กำลังค้นหาจาก OpenStreetMap...');
        this.lastGeocodeAt = Date.now();

        try {
            const params = new URLSearchParams({
                format: 'jsonv2',
                q: query,
                limit: '5',
                'accept-language': 'th,en',
                addressdetails: '1'
            });
            const response = await fetch(`${OSM_SEARCH_ENDPOINT}?${params.toString()}`, {
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`OSM search failed: ${response.status}`);
            const results = await response.json();
            this.areaSearchResults = Array.isArray(results) ? results : [];
            localStorage.setItem(this.getGeocodeCacheKey(query), JSON.stringify(this.areaSearchResults));
            this.renderAreaSearchResults(this.areaSearchResults);
            this.setAreaMapStatus(this.areaSearchResults.length ? `พบ ${this.areaSearchResults.length} ตำแหน่ง เลือกหนึ่งรายการด้านล่าง` : 'ไม่พบตำแหน่ง ลองค้นหาด้วยชื่อพื้นที่ที่เฉพาะเจาะจงขึ้น');
        } catch (error) {
            console.warn(error);
            this.setAreaMapStatus('ค้นหาแผนที่ไม่สำเร็จ ลองใหม่อีกครั้งหรือคลิกปักหมุดเองบนแผนที่');
        }
    },

    renderAreaSearchResults(results) {
        const container = document.getElementById('area-search-results');
        if (!container) return;

        if (!results.length) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML = results.map((result, index) => `
            <div class="map-result">
                <span class="font-semibold text-gray-900">${this.escapeHTML(result.name || result.display_name)}</span>
                <span class="text-xs text-gray-500">${this.escapeHTML(result.display_name)}</span>
                <div class="map-result-actions">
                    <button type="button" onclick="appState.selectAreaSearchResult(${index}, 'pin')">
                        <i class="fa-solid fa-location-dot mr-1"></i>เลือกเป็นจุด
                    </button>
                    ${this.parseBounds(result.boundingbox) ? `<button type="button" onclick="appState.selectAreaSearchResult(${index}, 'area')"><i class="fa-solid fa-vector-square mr-1"></i>ใช้ขอบเขตพื้นที่นี้</button>` : ''}
                </div>
            </div>
        `).join('');
    },

    selectAreaSearchResult(index, type = 'pin') {
        const result = this.areaSearchResults[index];
        if (!result) return;
        const bounds = this.parseBounds(result.boundingbox);

        if (type === 'area' && bounds) {
            this.setProjectArea({
                bounds,
                displayName: result.display_name,
                label: result.name || result.display_name,
                osmId: result.osm_id
            });
            const resultsEl = document.getElementById('area-search-results');
            if (resultsEl) resultsEl.classList.add('hidden');
            return;
        }

        this.setProjectLocation({
            lat: result.lat,
            lng: result.lon,
            displayName: result.display_name,
            label: result.name || result.display_name,
            osmId: result.osm_id,
            boundingbox: result.boundingbox
        });

        const resultsEl = document.getElementById('area-search-results');
        if (resultsEl) resultsEl.classList.add('hidden');
    },

    setProjectLocation(location) {
        const lat = Number(location.lat);
        const lng = Number(location.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const displayName = location.displayName || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        const areaInput = document.getElementById('m_area');
        const latInput = document.getElementById('m_lat');
        const lngInput = document.getElementById('m_lng');
        const placeInput = document.getElementById('m_place_name');
        const osmIdInput = document.getElementById('m_osm_id');
        const labelInput = document.getElementById('m_location_label');
        const typeInput = document.getElementById('m_location_type');

        if (areaInput) areaInput.value = displayName;
        if (latInput) latInput.value = lat.toFixed(6);
        if (lngInput) lngInput.value = lng.toFixed(6);
        if (placeInput) placeInput.value = displayName;
        if (osmIdInput) osmIdInput.value = location.osmId || '';
        if (labelInput && !labelInput.value.trim()) labelInput.value = location.label || displayName;
        if (typeInput) typeInput.value = 'pin';
        this.setMapSelectionMode('pin', false);
        this.clearAreaBounds(false);

        this.setAreaMarker(lat, lng, this.getSelectedLocationLabel(displayName), location.boundingbox);
        this.updateAreaLocationUI();
        this.setAreaMapStatus('เลือกตำแหน่งแบบปักหมุดแล้ว สามารถแก้ชื่อที่จะแสดงในรายงานได้');
        this.scheduleSave();
        this.updateLiveSummary();
    },

    setProjectArea(area) {
        const bounds = area.bounds;
        if (!bounds || ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)) return;

        const centerLat = (bounds.south + bounds.north) / 2;
        const centerLng = (bounds.west + bounds.east) / 2;
        const displayName = area.displayName || 'พื้นที่โครงการ';
        const areaInput = document.getElementById('m_area');
        const latInput = document.getElementById('m_lat');
        const lngInput = document.getElementById('m_lng');
        const placeInput = document.getElementById('m_place_name');
        const osmIdInput = document.getElementById('m_osm_id');
        const labelInput = document.getElementById('m_location_label');
        const typeInput = document.getElementById('m_location_type');

        if (areaInput) areaInput.value = displayName;
        if (latInput) latInput.value = centerLat.toFixed(6);
        if (lngInput) lngInput.value = centerLng.toFixed(6);
        if (placeInput) placeInput.value = displayName;
        if (osmIdInput) osmIdInput.value = area.osmId || '';
        if (labelInput && !labelInput.value.trim()) labelInput.value = area.label || displayName;
        if (typeInput) typeInput.value = 'area';
        this.setMapSelectionMode('area', false);
        this.setBoundsFields(bounds);
        this.setAreaRectangle(bounds, this.getSelectedLocationLabel(displayName));
        this.updateAreaLocationUI();
        this.setAreaMapStatus('เลือกขอบเขตพื้นที่แล้ว สามารถแก้ชื่อที่จะแสดงในรายงานได้');
        this.scheduleSave();
        this.updateLiveSummary();
    },

    setBoundsFields(bounds) {
        const fieldMap = {
            m_bounds_south: bounds.south,
            m_bounds_north: bounds.north,
            m_bounds_west: bounds.west,
            m_bounds_east: bounds.east
        };
        Object.entries(fieldMap).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = Number(value).toFixed(6);
        });
    },

    clearAreaBounds(updateUI = true) {
        ['m_bounds_south', 'm_bounds_north', 'm_bounds_west', 'm_bounds_east'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        if (this.areaRectangle && this.areaMap) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }
        if (updateUI) this.updateAreaLocationUI();
    },

    getSelectedLocationLabel(fallback = 'ตำแหน่งโครงการ') {
        return this.getValue('m_location_label').trim()
            || this.getValue('m_place_name').trim()
            || this.getValue('m_area').trim()
            || fallback;
    },

    refreshSelectedLocationLabel() {
        const lat = this.parseNumberValue(this.getValue('m_lat'));
        const lng = this.parseNumberValue(this.getValue('m_lng'));
        const label = this.getSelectedLocationLabel();
        const bounds = this.getBoundsFromFields();
        const type = this.getValue('m_location_type') || 'pin';

        if (type === 'area' && bounds && this.areaRectangle) {
            this.areaRectangle.bindPopup(this.escapeHTML(label));
        } else if (lat && lng && this.areaMarker) {
            this.areaMarker.bindPopup(this.escapeHTML(label));
        }
        this.updateAreaLocationUI();
    },

    setAreaMarker(lat, lng, label, boundingbox = null) {
        if (!this.areaMap || !window.L) return;

        if (this.areaRectangle) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }

        if (!this.areaMarker) {
            this.areaMarker = window.L.marker([lat, lng], { draggable: true }).addTo(this.areaMap);
            this.areaMarker.on('dragend', () => {
                const position = this.areaMarker.getLatLng();
                this.setProjectLocation({
                    lat: position.lat,
                    lng: position.lng,
                    displayName: 'ตำแหน่งที่เลื่อนหมุดเอง',
                    label: this.getValue('m_location_label') || 'ตำแหน่งที่เลื่อนหมุดเอง'
                });
            });
        } else {
            this.areaMarker.setLatLng([lat, lng]);
        }

        this.areaMarker.bindPopup(this.escapeHTML(label)).openPopup();

        if (Array.isArray(boundingbox) && boundingbox.length === 4) {
            const [south, north, west, east] = boundingbox.map(Number);
            if ([south, north, west, east].every(Number.isFinite)) {
                this.areaMap.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 16 });
                return;
            }
        }

        this.areaMap.setView([lat, lng], 15);
    },

    setAreaRectangle(bounds, label, fitMap = true, keepClosed = false) {
        if (!this.areaMap || !window.L) return;

        if (this.areaMarker) {
            this.areaMap.removeLayer(this.areaMarker);
            this.areaMarker = null;
        }

        const latLngBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
        if (!this.areaRectangle) {
            this.areaRectangle = window.L.rectangle(latLngBounds, {
                color: '#de5f8b',
                weight: 2,
                fillColor: '#de5f8b',
                fillOpacity: 0.16
            }).addTo(this.areaMap);
        } else {
            this.areaRectangle.setBounds(latLngBounds);
        }

        this.areaRectangle.bindPopup(this.escapeHTML(label || 'พื้นที่โครงการ'));
        if (!keepClosed) this.areaRectangle.openPopup();
        if (fitMap) this.areaMap.fitBounds(latLngBounds, { padding: [24, 24], maxZoom: 16 });
    },

    syncAreaMarkerFromFields() {
        const lat = this.parseNumberValue(this.getValue('m_lat'));
        const lng = this.parseNumberValue(this.getValue('m_lng'));
        const label = this.getSelectedLocationLabel();
        const bounds = this.getBoundsFromFields();
        const type = this.getValue('m_location_type') || (bounds ? 'area' : 'pin');

        if (lat && lng && type === 'area' && bounds) {
            this.setMapSelectionMode('area', false);
            this.setAreaRectangle(bounds, label);
        } else if (lat && lng) {
            this.setMapSelectionMode('pin', false);
            this.setAreaMarker(lat, lng, label || 'ตำแหน่งโครงการ');
        }
        this.updateAreaLocationUI();
    },

    updateAreaLocationUI() {
        const container = document.getElementById('selected-area-location');
        if (!container) return;
        const lat = this.getValue('m_lat');
        const lng = this.getValue('m_lng');
        const place = this.getValue('m_place_name') || this.getValue('m_area');
        const label = this.getSelectedLocationLabel();
        const type = this.getValue('m_location_type') || 'pin';
        const bounds = this.getBoundsFromFields();

        if (!lat || !lng) {
            container.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i>ยังไม่ได้เลือกตำแหน่ง';
            return;
        }

        container.innerHTML = `
            <div>
                <p class="font-semibold text-gray-900">${this.escapeHTML(label || 'ตำแหน่งโครงการ')}</p>
                <p class="text-xs text-gray-500">${type === 'area' ? 'ขอบเขตพื้นที่' : 'ปักหมุด'} · Lat ${this.escapeHTML(lat)}, Lng ${this.escapeHTML(lng)}</p>
                ${place && place !== label ? `<p class="text-xs text-gray-500">${this.escapeHTML(place)}</p>` : ''}
                ${type === 'area' && bounds ? `<p class="text-xs text-gray-500">SW ${bounds.south.toFixed(4)}, ${bounds.west.toFixed(4)} · NE ${bounds.north.toFixed(4)}, ${bounds.east.toFixed(4)}</p>` : ''}
            </div>
            <a href="${this.getOSMLink(lat, lng)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-chula hover:underline">เปิดใน OSM</a>
        `;
    },

    clearAreaLocation() {
        ['m_lat', 'm_lng', 'm_place_name', 'm_osm_id', 'm_location_label', 'm_bounds_south', 'm_bounds_north', 'm_bounds_west', 'm_bounds_east'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        const typeInput = document.getElementById('m_location_type');
        if (typeInput) typeInput.value = this.mapSelectionMode;
        if (this.areaMarker && this.areaMap) {
            this.areaMap.removeLayer(this.areaMarker);
            this.areaMarker = null;
        }
        if (this.areaRectangle && this.areaMap) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }
        if (this.areaMap) this.areaMap.setView(OSM_DEFAULT_CENTER, OSM_DEFAULT_ZOOM);
        this.areaDragStart = null;
        this.isDrawingArea = false;
        this.updateAreaLocationUI();
        this.setAreaMapStatus(this.mapSelectionMode === 'area'
            ? 'โหมดกำหนดพื้นที่: ลากบนแผนที่เพื่อคลุมพื้นที่ดำเนินงาน'
            : 'โหมดปักหมุด: คลิกบนแผนที่เพื่อเลือกตำแหน่งโครงการ');
        this.scheduleSave();
    },

    getOSMLink(lat, lng) {
        return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=15/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
    },

    previewImage(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.uploadedImage = e.target.result;
                const preview = document.getElementById('photo-preview');
                preview.src = this.uploadedImage;
                preview.classList.remove('hidden');
                document.getElementById('photo-placeholder').classList.add('hidden');
                this.scheduleSave();
                this.updateLiveSummary();
            };
            reader.readAsDataURL(file);
        }
    },

    filterSDGs() {
        const query = this.getValue('sdg-search').trim().toLowerCase();
        document.querySelectorAll('[data-sdg-card]').forEach(card => {
            const checked = card.querySelector('.sdg-checkbox')?.checked;
            const matches = card.dataset.search.includes(query);
            card.classList.toggle('hidden', Boolean(query) && !matches && !checked);
        });
    },

    handleSDGChange() {
        this.updateSelectedSDGs();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    updateSelectedSDGs() {
        const container = document.getElementById('selected-sdgs');
        if (!container) return;
        const existingNotes = {};
        document.querySelectorAll('.sdg-reason').forEach(note => {
            existingNotes[note.dataset.sdgId] = note.value;
        });

        const selected = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => {
            const sdgId = cb.dataset.sdgId;
            const sdg = SDGs_LIST.find(item => String(item.id) === sdgId);
            return { ...sdg, value: cb.value, note: existingNotes[sdgId] || '' };
        });

        if (selected.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500 italic">ยังไม่ได้เลือก SDGs</p>';
            return;
        }

        container.innerHTML = selected.map(sdg => `
            <div class="border border-chula-light bg-white rounded-lg p-3">
                <div class="flex items-start gap-2 mb-2">
                    <span class="w-7 h-7 rounded-full bg-chula text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${sdg.id}</span>
                    <div>
                        <p class="text-sm font-semibold text-gray-900">SDG ${sdg.id}: ${this.escapeHTML(sdg.title)}</p>
                        <p class="text-xs text-gray-500">${this.escapeHTML(sdg.focus)}</p>
                    </div>
                </div>
                <label class="form-label">เหตุผลที่เกี่ยวข้องกับโครงการนี้</label>
                <textarea rows="2" class="form-control resize-none sdg-reason" data-sdg-id="${sdg.id}" placeholder="ระบุเหตุผลสั้น ๆ ว่า SDG นี้เกี่ยวข้องอย่างไร">${this.escapeHTML(sdg.note)}</textarea>
            </div>
        `).join('');
    },

    createSROIRow(overrides = {}) {
        return {
            id: overrides.id || `sroi_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            stakeholderGroup: overrides.stakeholderGroup || '',
            groupSize: overrides.groupSize ?? 0,
            inputDescription: overrides.inputDescription || '',
            outputSummary: overrides.outputSummary || '',
            investment: overrides.investment ?? 0,
            quantity: overrides.quantity ?? 0,
            monetaryValue: overrides.monetaryValue ?? 0,
            changeDepth: overrides.changeDepth || '',
            weighting: overrides.weighting || '',
            outcomeDescription: overrides.outcomeDescription || '',
            duration: overrides.duration ?? 1,
            outcomeStart: overrides.outcomeStart || 'period-activity',
            discountRate: overrides.discountRate ?? 3.5,
            deadweight: overrides.deadweight ?? 0,
            displacement: overrides.displacement ?? 0,
            attribution: overrides.attribution ?? 0,
            dropoff: overrides.dropoff ?? 0,
            valuationApproach: overrides.valuationApproach || '',
            indicatorSource: overrides.indicatorSource || ''
        };
    },

    renderSROIRows() {
        const container = document.getElementById('sroi-rows-container');
        if (!container) return;
        if (this.sroiRows.length === 0) {
            this.sroiRows = [this.createSROIRow()];
        }

        container.innerHTML = this.sroiRows.map((row, index) => {
            const result = this.calculateSROIRow(row);
            const title = row.outcomeDescription || row.stakeholderGroup || `Outcome row ${index + 1}`;
            return `
                <details class="form-panel bg-white sroi-row" ${index === 0 ? 'open' : ''}>
                    <summary class="cursor-pointer list-none">
                        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <div>
                                <p class="font-bold text-gray-900"><i class="fa-solid fa-table-list text-chula mr-2"></i>${this.escapeHTML(title)}</p>
                                <p class="text-xs text-gray-500">PV ${this.formatMoney(result.totalPV)} บาท · Investment ${this.formatMoney(result.investment)} บาท</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-semibold bg-chula bg-opacity-10 text-chula-darker px-3 py-1 rounded-full">1 : ${result.sroiRatio.toFixed(2)}</span>
                                ${this.sroiRows.length > 1 ? `<button type="button" onclick="event.preventDefault(); appState.removeSROIRow('${row.id}')" class="text-xs text-red-600 hover:text-red-800 px-2 py-1"><i class="fa-solid fa-trash-can mr-1"></i>ลบ</button>` : ''}
                            </div>
                        </div>
                    </summary>
                    <div class="mt-4 space-y-5">
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-users text-chula mr-2"></i>Stage 1: Stakeholders</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                ${this.rowInput(row, 'stakeholderGroup', 'กลุ่มผู้ได้รับผลกระทบ', 'text', 'เช่น สมาชิกชุมชน ผู้เข้าอบรม นักเรียน ครัวเรือน')}
                                ${this.rowInput(row, 'groupSize', 'จำนวนคนในกลุ่มทั้งหมด', 'number', '0')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-arrow-right-to-bracket text-chula mr-2"></i>Stage 2: Inputs และ Outputs</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                ${this.rowTextarea(row, 'inputDescription', 'สิ่งที่ลงทุน/สนับสนุน', 'เงิน เวลา อุปกรณ์ องค์ความรู้ หรือทรัพยากรที่ผู้มีส่วนเกี่ยวข้องลงทุน')}
                                ${this.rowTextarea(row, 'outputSummary', 'Output เชิงตัวเลข', 'เช่น จัดอบรม 3 รุ่น ผู้เข้าร่วม 120 คน ผลิตคู่มือ 1 ชุด')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-coins text-chula mr-2"></i>Stage 3: Outcome Value</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                ${this.rowInput(row, 'investment', 'มูลค่าการลงทุนรวม (บาท)', 'number', '0.00')}
                                ${this.rowInput(row, 'quantity', 'จำนวนผู้ได้รับ outcome', 'number', '0')}
                                ${this.rowInput(row, 'monetaryValue', 'มูลค่าต่อคนต่อปี (บาท)', 'number', '0.00')}
                                ${this.rowInput(row, 'changeDepth', 'จำนวน/ระดับการเปลี่ยนแปลงต่อคน (เพื่อความโปร่งใส)', 'text', 'เช่น รายได้เพิ่ม 20%')}
                                ${this.rowInput(row, 'weighting', 'น้ำหนักความสำคัญ (1-10, สะท้อนใน monetary value)', 'number', '1-10')}
                                ${this.rowInput(row, 'outcomeDescription', 'Outcome description', 'text', 'การเปลี่ยนแปลงที่เกิดขึ้นกับ stakeholder')}
                                ${this.rowInput(row, 'duration', 'ระยะเวลา outcome (ปี)', 'number', '1-6')}
                                <div>
                                    <label class="form-label">Outcome เริ่มเมื่อใด</label>
                                    <select class="form-control" data-sroi-row="${row.id}" data-sroi-field="outcomeStart">
                                        <option value="period-activity" ${row.outcomeStart === 'period-activity' ? 'selected' : ''}>ปีที่ดำเนินกิจกรรม</option>
                                        <option value="period-after" ${row.outcomeStart === 'period-after' ? 'selected' : ''}>ปีถัดจากกิจกรรม</option>
                                    </select>
                                </div>
                                ${this.rowInput(row, 'discountRate', 'Discount rate (%)', 'number', '3.5')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-scale-balanced text-chula mr-2"></i>Impact Adjustment</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                ${this.rowInput(row, 'deadweight', 'Deadweight (%)', 'number', '0')}
                                ${this.rowInput(row, 'displacement', 'Displacement (%)', 'number', '0')}
                                ${this.rowInput(row, 'attribution', 'Attribution (%)', 'number', '0')}
                                ${this.rowInput(row, 'dropoff', 'Drop-off ต่อปี (%)', 'number', '0')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-file-signature text-chula mr-2"></i>หลักฐานและวิธีประเมินมูลค่า</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                ${this.rowTextarea(row, 'valuationApproach', 'Valuation approach / financial proxy', 'ระบุวิธีประเมินมูลค่า เช่น market price, avoided cost หรือ proxy')}
                                ${this.rowTextarea(row, 'indicatorSource', 'Indicator และแหล่งข้อมูล', 'ระบุว่าจะวัด outcome อย่างไรและใช้ข้อมูลจากแหล่งใด')}
                            </div>
                        </div>
                        <div class="validation-message" id="row-validation-${row.id}"></div>
                    </div>
                </details>
            `;
        }).join('');

        this.updateSROIValidation();
        this.calculateSROIPreview();
    },

    rowInput(row, field, label, type, placeholder) {
        const constraints = {
            groupSize: 'min="0"',
            investment: 'min="0"',
            quantity: 'min="0"',
            monetaryValue: 'min="0"',
            duration: 'min="1" max="6"',
            weighting: 'min="1" max="10"',
            discountRate: 'min="0" max="100"',
            deadweight: 'min="0" max="100"',
            displacement: 'min="0" max="100"',
            attribution: 'min="0" max="100"',
            dropoff: 'min="0" max="100"'
        };

        return `
            <div>
                <label class="form-label">${this.escapeHTML(label)}</label>
                <input type="${type}" class="form-control ${type === 'number' ? 'text-right font-mono' : ''}" value="${this.escapeHTML(row[field])}" placeholder="${this.escapeHTML(placeholder)}" data-sroi-row="${row.id}" data-sroi-field="${field}" ${type === 'number' ? `step="any" ${constraints[field] || ''}` : ''}>
            </div>
        `;
    },

    rowTextarea(row, field, label, placeholder) {
        return `
            <div>
                <label class="form-label">${this.escapeHTML(label)}</label>
                <textarea rows="3" class="form-control resize-none" placeholder="${this.escapeHTML(placeholder)}" data-sroi-row="${row.id}" data-sroi-field="${field}">${this.escapeHTML(row[field])}</textarea>
            </div>
        `;
    },

    addSROIRow() {
        this.sroiRows.push(this.createSROIRow());
        this.renderSROIRows();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    removeSROIRow(rowId) {
        this.sroiRows = this.sroiRows.filter(row => row.id !== rowId);
        if (this.sroiRows.length === 0) this.sroiRows = [this.createSROIRow()];
        this.renderSROIRows();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    updateSROIRow(rowId, field, value) {
        const row = this.sroiRows.find(item => item.id === rowId);
        if (!row) return;
        row[field] = value;
        this.calculateSROIPreview();
        this.updateSROIValidation();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    getValue(id) {
        return document.getElementById(id)?.value || '';
    },

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value || '-';
    },

    parseNumberValue(value) {
        return parseFloat(value) || 0;
    },

    clampPercent(value) {
        return Math.max(0, Math.min(100, this.parseNumberValue(value))) / 100;
    },

    isSROIRowStarted(row) {
        const textFields = [
            'stakeholderGroup',
            'inputDescription',
            'outputSummary',
            'changeDepth',
            'weighting',
            'outcomeDescription',
            'valuationApproach',
            'indicatorSource'
        ];
        const moneyFields = ['groupSize', 'investment', 'quantity', 'monetaryValue'];
        const adjustmentFields = ['deadweight', 'displacement', 'attribution', 'dropoff'];

        return textFields.some(field => String(row[field] ?? '').trim())
            || moneyFields.some(field => this.parseNumberValue(row[field]) > 0)
            || adjustmentFields.some(field => this.parseNumberValue(row[field]) > 0)
            || this.parseNumberValue(row.duration) !== 1
            || this.parseNumberValue(row.discountRate) !== 3.5
            || row.outcomeStart !== 'period-activity';
    },

    getActiveSROIRows() {
        return this.sroiRows.filter(row => this.isSROIRowStarted(row));
    },

    calculateSROIRow(row) {
        const investment = Math.max(0, this.parseNumberValue(row.investment));
        const quantity = Math.max(0, this.parseNumberValue(row.quantity));
        const monetaryValue = Math.max(0, this.parseNumberValue(row.monetaryValue));
        const duration = Math.max(1, Math.min(6, Math.round(this.parseNumberValue(row.duration) || 1)));
        const discountRate = this.clampPercent(row.discountRate);
        const deadweight = this.clampPercent(row.deadweight);
        const displacement = this.clampPercent(row.displacement);
        const attribution = this.clampPercent(row.attribution);
        const dropoff = this.clampPercent(row.dropoff);
        const startOffset = row.outcomeStart === 'period-after' ? 1 : 0;
        const adjustedAnnualValue = quantity * monetaryValue * (1 - deadweight) * (1 - displacement) * (1 - attribution);
        const yearlyValues = [];
        let totalPV = 0;

        for (let calendarYear = 0; calendarYear < 6; calendarYear++) {
            if (calendarYear < startOffset) {
                yearlyValues.push(0);
                continue;
            }

            const activeYear = calendarYear - startOffset;
            if (activeYear >= duration) {
                yearlyValues.push(0);
                continue;
            }

            const droppedValue = adjustedAnnualValue * Math.pow(1 - dropoff, activeYear);
            const presentValue = droppedValue / Math.pow(1 + discountRate, calendarYear);
            yearlyValues.push(presentValue);
            totalPV += presentValue;
        }

        return {
            row,
            investment,
            quantity,
            monetaryValue,
            duration,
            discountRate,
            deadweight,
            displacement,
            attribution,
            dropoff,
            adjustedAnnualValue,
            yearlyValues,
            totalPV,
            netPresentValue: totalPV - investment,
            sroiRatio: investment > 0 ? totalPV / investment : 0
        };
    },

    calculateSROI() {
        const rows = this.getActiveSROIRows().map(row => this.calculateSROIRow(row));
        const investment = rows.reduce((sum, row) => sum + row.investment, 0);
        const totalPV = rows.reduce((sum, row) => sum + row.totalPV, 0);
        const adjustedAnnualValue = rows.reduce((sum, row) => sum + row.adjustedAnnualValue, 0);
        const yearlyValues = Array.from({ length: 6 }, (_, index) => rows.reduce((sum, row) => sum + row.yearlyValues[index], 0));

        return {
            rows,
            investment,
            adjustedAnnualValue,
            totalPV,
            netPresentValue: totalPV - investment,
            sroiRatio: investment > 0 ? totalPV / investment : 0,
            yearlyValues
        };
    },

    calculateSROIPreview() {
        const calc = this.calculateSROI();
        const ratioEl = document.getElementById('preview_sroi_ratio');
        const pvEl = document.getElementById('preview_total_pv');
        const npvEl = document.getElementById('preview_npv');
        if (ratioEl) ratioEl.innerText = `1 : ${calc.sroiRatio.toFixed(2)}`;
        if (pvEl) pvEl.innerText = `${this.formatMoney(calc.totalPV)} บาท`;
        if (npvEl) npvEl.innerText = `${this.formatMoney(calc.netPresentValue)} บาท`;
        this.updateFormulaBreakdown(calc);
        this.updateLiveSummary();
    },

    validateSROIRow(result) {
        const row = result.row;
        const messages = [];
        const groupSize = this.parseNumberValue(row.groupSize);
        const quantity = this.parseNumberValue(row.quantity);
        const duration = this.parseNumberValue(row.duration);
        const percentageFields = [
            ['deadweight', 'Deadweight'],
            ['displacement', 'Displacement'],
            ['attribution', 'Attribution'],
            ['dropoff', 'Drop-off'],
            ['discountRate', 'Discount rate']
        ];

        if (result.investment <= 0) messages.push('กรอกมูลค่าการลงทุนรวม');
        if (quantity <= 0) messages.push('กรอกจำนวนผู้ได้รับ outcome');
        if (result.monetaryValue <= 0) messages.push('กรอกมูลค่าต่อคนต่อปี');
        if (duration < 1 || duration > 6) messages.push('ระยะเวลา outcome ต้องอยู่ระหว่าง 1-6 ปี');
        if (groupSize > 0 && quantity > groupSize) messages.push('จำนวนผู้ได้รับ outcome มากกว่าขนาด stakeholder group');
        if (row.weighting !== '' && (this.parseNumberValue(row.weighting) < 1 || this.parseNumberValue(row.weighting) > 10)) {
            messages.push('น้ำหนักความสำคัญควรอยู่ระหว่าง 1-10');
        }
        percentageFields.forEach(([field, label]) => {
            const value = this.parseNumberValue(row[field]);
            if (value < 0 || value > 100) messages.push(`${label} ต้องอยู่ระหว่าง 0-100%`);
        });
        return messages;
    },

    updateSROIValidation() {
        const activeRows = this.getActiveSROIRows();
        const activeIds = new Set(activeRows.map(row => row.id));
        const results = activeRows.map(row => this.calculateSROIRow(row));
        const allMessages = [];

        this.sroiRows.forEach((row) => {
            if (activeIds.has(row.id)) return;
            const el = document.getElementById(`row-validation-${row.id}`);
            if (el) {
                el.className = 'validation-message validation-neutral';
                el.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i>แถวนี้ยังว่าง ระบบจะยังไม่นำไปรวมในการคำนวณ';
            }
        });

        results.forEach((result) => {
            const rowNumber = this.sroiRows.findIndex(row => row.id === result.row.id) + 1;
            const messages = this.validateSROIRow(result);
            const el = document.getElementById(`row-validation-${result.row.id}`);
            if (el) {
                el.className = messages.length ? 'validation-message validation-error' : 'validation-message validation-ok';
                el.innerHTML = messages.length
                    ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i>${messages.map(message => this.escapeHTML(message)).join(' · ')}`
                    : '<i class="fa-solid fa-circle-check mr-1"></i>ข้อมูลแถวนี้พร้อมคำนวณ';
            }
            messages.forEach(message => allMessages.push({ rowNumber, message }));
        });

        const list = document.getElementById('sroi-validation-list');
        const panel = document.getElementById('sroi-validation-panel');
        const icon = document.getElementById('sroi-validation-icon');
        const title = document.getElementById('sroi-validation-title');
        const emptyRows = this.sroiRows.length - activeRows.length;
        if (list) {
            if (activeRows.length === 0) {
                list.innerHTML = '<p>กรอก outcome row อย่างน้อย 1 แถว โดยใส่ Investment, Quantity และ Monetary value</p>';
            } else if (allMessages.length) {
                list.innerHTML = allMessages.map(item => `
                    <div class="validation-item">
                        <span class="validation-row-pill">Row ${item.rowNumber}</span>
                        <span>${this.escapeHTML(item.message)}</span>
                    </div>
                `).join('');
            } else {
                list.innerHTML = `<p>คำนวณจาก ${activeRows.length} outcome row${emptyRows ? ` · ข้ามแถวว่าง ${emptyRows} แถว` : ''}</p>`;
            }
        }
        if (panel && icon && title) {
            const hasBlockingIssue = activeRows.length === 0 || allMessages.length > 0;
            panel.className = hasBlockingIssue ? 'sroi-validation-panel sroi-validation-panel-error' : 'sroi-validation-panel sroi-validation-panel-ok';
            icon.className = hasBlockingIssue ? 'fa-solid fa-circle-exclamation mt-1' : 'fa-solid fa-circle-check mt-1';
            title.innerText = hasBlockingIssue ? 'ต้องแก้ก่อนประมวลผลรายงาน' : 'ข้อมูลพร้อมคำนวณ';
        }
        return allMessages;
    },

    updateFormulaBreakdown(calc = this.calculateSROI()) {
        const container = document.getElementById('formula-breakdown');
        if (!container) return;
        const yearCards = calc.yearlyValues.map((value, index) => `
            <div class="pv-year-card">
                <span>Year ${index}</span>
                <strong>${this.formatMoney(value)}</strong>
            </div>
        `).join('');
        const rowList = calc.rows.map((result) => {
            const rowNumber = this.sroiRows.findIndex(row => row.id === result.row.id) + 1;
            return `
            <tr class="border-t">
                <td class="px-2 py-1">Row ${rowNumber}</td>
                <td class="px-2 py-1">${this.escapeHTML(result.row.stakeholderGroup || result.row.outcomeDescription || '-')}</td>
                <td class="px-2 py-1 text-right font-mono">${this.formatMoney(result.adjustedAnnualValue)}</td>
                <td class="px-2 py-1 text-right font-mono">${this.formatMoney(result.totalPV)}</td>
            </tr>
        `;
        }).join('') || '<tr class="border-t"><td colspan="4" class="px-2 py-3 text-center text-gray-500">ยังไม่มี outcome row ที่นำมาคำนวณ</td></tr>';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div class="bg-gray-50 rounded-lg border border-gray-100 p-4">
                    <h5 class="font-bold text-gray-900 mb-2">สูตรที่ใช้</h5>
                    <div class="space-y-2 text-xs text-gray-600 leading-relaxed">
                        <p>1. มูลค่ารายปี = Quantity x Monetary value</p>
                        <p>2. หัก Deadweight, Displacement และ Attribution</p>
                        <p>3. กระจายตาม Duration, Drop-off และ Discount rate เพื่อรวมเป็น PV</p>
                    </div>
                    <div class="mt-4 text-sm space-y-1">
                        <div class="flex justify-between"><span>Total PV</span><strong>${this.formatMoney(calc.totalPV)} บาท</strong></div>
                        <div class="flex justify-between"><span>Investment</span><strong>${this.formatMoney(calc.investment)} บาท</strong></div>
                        <div class="flex justify-between"><span>NPV</span><strong>${this.formatMoney(calc.netPresentValue)} บาท</strong></div>
                    </div>
                </div>
                <div class="bg-gray-50 rounded-lg border border-gray-100 p-4">
                    <h5 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-calendar-days text-chula mr-2"></i>Present value by year</h5>
                    <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">${yearCards}</div>
                </div>
            </div>
            <div class="mt-4 bg-gray-50 rounded-lg border border-gray-100 overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="bg-white">
                            <tr>
                                <th class="px-2 py-2 text-left">Row</th>
                                <th class="px-2 py-2 text-left">Stakeholder/outcome</th>
                                <th class="px-2 py-2 text-right">Adjusted annual</th>
                                <th class="px-2 py-2 text-right">PV</th>
                            </tr>
                        </thead>
                        <tbody>${rowList}</tbody>
                    </table>
            </div>
        `;
    },

    formatMoney(amount) {
        return amount.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    },

    formatNumber(amount) {
        return amount.toLocaleString('th-TH', {maximumFractionDigits: 0});
    },

    generateReport() {
        this.setText('r_projectName', this.getValue('m_projectName') || 'ไม่ได้ระบุชื่อโครงการ');
        this.setText('r_responsible', this.getValue('m_responsible'));
        this.setText('r_area', this.getValue('m_area'));
        this.setText('r_objective', this.getValue('m_objective'));

        const selectedSDGs = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => cb.value);
        const sdgContainer = document.getElementById('r_sdgs');
        if(selectedSDGs.length > 0) {
            sdgContainer.innerHTML = selectedSDGs.map(sdg => `<span class="bg-gray-100 text-chula-darker border border-chula-light px-3 py-1 rounded-full text-xs font-semibold">${this.escapeHTML(sdg)}</span>`).join('');
        } else {
            sdgContainer.innerHTML = '<span class="text-gray-500 italic">ไม่ได้ระบุ</span>';
        }

        this.setText('r_inputs', this.getValue('i_inputs'));
        this.setText('r_knowledge', this.getValue('i_knowledge'));
        this.setText('r_stakeholders', this.getValue('i_stakeholders'));
        this.setText('r_activities', this.getValue('i_activities'));
        this.setText('r_output', this.getValue('i_output'));
        this.setText('r_output_sdg', this.getValue('i_output_sdg'));
        this.setText('r_outcome', this.getValue('i_outcome'));
        this.setText('r_outcome_stakeholders', this.getValue('i_outcome_stakeholders'));
        this.setText('r_impact_economic', this.getValue('i_impact_economic'));
        this.setText('r_impact_social', this.getValue('i_impact_social'));
        this.setText('r_impact_environment', this.getValue('i_impact_environment'));
        this.setText('r_toc_statement', this.getValue('i_toc_statement'));
        this.setText('r_indicator_output', this.getValue('i_indicator_output'));
        this.setText('r_indicator_outcome', this.getValue('i_indicator_outcome'));
        this.setText('r_indicator_impact', this.getValue('i_indicator_impact'));

        if(this.uploadedImage) {
            const img = document.getElementById('r_photo');
            img.src = this.uploadedImage;
            img.classList.remove('hidden');
        } else {
            const img = document.getElementById('r_photo');
            img.src = '';
            img.classList.add('hidden');
        }
        this.setText('r_quote', this.getValue('sv_quote') || 'ไม่มีข้อมูลสัมภาษณ์');

        const calc = this.calculateSROI();
        const rowContainer = document.getElementById('r_sroi_rows');
        if (rowContainer) {
            rowContainer.innerHTML = calc.rows.map((result, index) => `
                <div class="report-cell">
                    <strong class="report-label">SROI row ${index + 1}</strong>
                    <div class="space-y-1">
                        <p><span class="font-semibold">Stakeholder:</span> ${this.escapeHTML(result.row.stakeholderGroup || '-')} (${this.formatNumber(this.parseNumberValue(result.row.groupSize))} คน)</p>
                        <p><span class="font-semibold">Input/output:</span> ${this.escapeHTML(result.row.inputDescription || '-')} / ${this.escapeHTML(result.row.outputSummary || '-')}</p>
                        <p><span class="font-semibold">Outcome:</span> ${this.escapeHTML(result.row.outcomeDescription || '-')}</p>
                        <p><span class="font-semibold">Depth/weighting:</span> ${this.escapeHTML(result.row.changeDepth || '-')} / ${this.escapeHTML(result.row.weighting || '-')}</p>
                        <p><span class="font-semibold">PV:</span> ${this.formatMoney(result.totalPV)} บาท · <span class="font-semibold">Investment:</span> ${this.formatMoney(result.investment)} บาท</p>
                    </div>
                </div>
            `).join('');
        }

        this.setText('r_calc_quantity', this.formatNumber(calc.rows.reduce((sum, row) => sum + row.quantity, 0)));
        this.setText('r_calc_monetary', this.formatMoney(calc.rows.reduce((sum, row) => sum + row.monetaryValue, 0)));
        this.setText('r_calc_adjusted_annual', this.formatMoney(calc.adjustedAnnualValue));
        this.setText('r_val_total_pv', this.formatMoney(calc.totalPV));
        this.setText('r_val_npv', this.formatMoney(calc.netPresentValue));
        this.setText('r_val_invest', this.formatMoney(calc.investment));
        this.setText('r_calc_assumptions', `${calc.rows.length} SROI outcome row(s), Discount/adjustment applied per row`);
        this.setText('r_sroi_ratio', calc.sroiRatio.toFixed(2));
        this.setText('r_sroi_value', calc.sroiRatio.toFixed(2));
    },

    attachAutoSaveListeners() {
        if (this.autosaveAttached) return;
        this.autosaveAttached = true;

        document.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.id === 'sdg-search') {
                this.filterSDGs();
                return;
            }

            if (target.id === 'm_area' && this.getValue('m_lat') && target.value !== this.getValue('m_place_name')) {
                this.clearAreaLocation();
            }

            if (target.id === 'm_location_label') {
                this.refreshSelectedLocationLabel();
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (target.dataset.sroiRow && target.dataset.sroiField) {
                this.updateSROIRow(target.dataset.sroiRow, target.dataset.sroiField, target.value);
                return;
            }

            if (target.classList.contains('sdg-reason')) {
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.type !== 'file') {
                this.scheduleSave();
                this.calculateSROIPreview();
                this.updateLiveSummary();
            }
        });

        document.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.classList.contains('sdg-checkbox')) {
                this.handleSDGChange();
                return;
            }

            if (target.dataset.sroiRow && target.dataset.sroiField) {
                this.updateSROIRow(target.dataset.sroiRow, target.dataset.sroiField, target.value);
                return;
            }

            if (target.tagName === 'SELECT') {
                this.scheduleSave();
                this.calculateSROIPreview();
                this.updateLiveSummary();
            }
        });
    },

    collectDraft() {
        const fields = {};
        document.querySelectorAll('input[id], textarea[id], select[id]').forEach(element => {
            if (element.type === 'file' || element.type === 'checkbox' || element.dataset.sroiRow) return;
            fields[element.id] = element.value;
        });

        const selectedSDGs = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => cb.value);
        const sdgReasons = {};
        document.querySelectorAll('.sdg-reason').forEach(note => {
            sdgReasons[note.dataset.sdgId] = note.value;
        });

        return {
            fields,
            selectedSDGs,
            sdgReasons,
            sroiRows: this.sroiRows,
            updatedAt: new Date().toISOString()
        };
    },

    scheduleSave() {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.saveDraft(), 250);
        const status = document.getElementById('draft-status');
        if (status) status.innerText = 'กำลังบันทึก...';
    },

    saveDraft() {
        localStorage.setItem(getDraftKey(), JSON.stringify(this.collectDraft()));
        const status = document.getElementById('draft-status');
        if (status) status.innerText = 'บันทึก draft แล้ว';
    },

    loadDraft() {
        const rawDraft = localStorage.getItem(getDraftKey());
        if (!rawDraft) return;

        try {
            const draft = JSON.parse(rawDraft);
            if (Array.isArray(draft.sroiRows) && draft.sroiRows.length > 0) {
                this.sroiRows = draft.sroiRows.map(row => this.createSROIRow(row));
                this.renderSROIRows();
            }

            Object.entries(draft.fields || {}).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element && element.type !== 'file') element.value = value;
            });

            const selected = new Set(draft.selectedSDGs || []);
            document.querySelectorAll('.sdg-checkbox').forEach(cb => {
                cb.checked = selected.has(cb.value);
            });
            this.updateSelectedSDGs();
            Object.entries(draft.sdgReasons || {}).forEach(([sdgId, value]) => {
                const note = document.querySelector(`.sdg-reason[data-sdg-id="${sdgId}"]`);
                if (note) note.value = value;
            });
            this.filterSDGs();
        } catch (error) {
            console.warn('Could not load SROI draft', error);
        }
    },

    updateLiveSummary() {
        this.updateProjectHeader();
    },

    updateProjectHeader() {
        const projectName = this.getValue('m_projectName').trim();
        this.setText('project-title-chip', projectName || 'ยังไม่ได้ตั้งชื่อโครงการ');
    },

    exportPDF() {
        const element = document.getElementById('report-container');
        const opt = {
            margin:       10,
            filename:     'SROI_Report.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const btn = document.querySelector('button[onclick="appState.exportPDF()"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังสร้าง PDF...';
        
        html2pdf().set(opt).from(element).save().then(() => {
            btn.innerHTML = originalText;
        });
    },

    async confirmAndSave() {
        if (confirm('คุณต้องการบันทึกผลการประเมินนี้ใช่หรือไม่? (Do you want to save this assessment?)')) {
            
            const btn = document.getElementById('btn-save-assessment');
            const originalText = btn ? btn.innerHTML : 'บันทึกผลประเมิน';
            if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังบันทึก...';

            const selectedSDGs = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => cb.value);

            const projectData = {
                currentStep: this.currentStep,
                sroiCalculations: this.calculateSROI(),
                inputs: {
                    m_projectName: document.getElementById('m_projectName')?.value || '',
                    m_responsible: document.getElementById('m_responsible')?.value || '',
                    m_area: document.getElementById('m_area')?.value || '',
                    m_objective: document.getElementById('m_objective')?.value || '',
                    sdgs: selectedSDGs,
                    i_manpower: document.getElementById('i_manpower')?.value || '',
                    i_budget: document.getElementById('i_budget')?.value || '',
                    i_activities: document.getElementById('i_activities')?.value || '',
                    i_output: document.getElementById('i_output')?.value || '',
                    i_outcome: document.getElementById('i_outcome')?.value || '',
                    i_impact: document.getElementById('i_impact')?.value || '',
                    sv_quote: document.getElementById('sv_quote')?.value || '',
                    c_outcome_value: document.getElementById('c_outcome_value')?.value || '',
                    c_base_case: document.getElementById('c_base_case')?.value || '',
                    c_investment: document.getElementById('c_investment')?.value || '',
                    uploadedImage: this.uploadedImage 
                }
            };

            const isSuccess = await saveProjectData(projectData);

            if (isSuccess) {
                // Clear local storage draft for this specific project since it's now officially saved to Supabase
                localStorage.removeItem(getDraftKey());

                if (btn) btn.innerHTML = originalText;
                this.isViewMode = true;
                this.updateStepUI(); 
                alert('บันทึกข้อมูลสำเร็จ (Data saved successfully!)');
            } else {
                alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง (Error saving data)');
                if (btn) btn.innerHTML = originalText;
            }
        }
    },

    escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
};


// ==========================================
// SUPABASE LOGIC 
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    appState.init();

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
        console.log("No active session found. Showing landing page.");
        appState.showView('view-landing'); 
        return;
    }

    const userEmail = session.user.email;
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');
    const isNew = urlParams.get('new');

    if (projectId || isNew) {
        appState.showView('view-app');
        appState.updateStepUI();
        
        document.getElementById('user-email-display').innerText = userEmail;
        document.getElementById('nav-user').classList.remove('hidden');

        if (projectId) {
            console.log(`Resuming project ID: ${projectId}`);
            await loadExistingProject(projectId, userEmail);
        } else {
            console.log("Starting a new assessment");
            initializeNewProject();
        }
    } else {
        window.location.href = '/dashboard.html';
    }
});

async function loadExistingProject(id, email) {
    const { data: project, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .eq('user_email', email)
        .single(); 

    if (error) {
        console.error("Error loading project:", error);
        alert("Could not load your project data.");
        return;
    }

    if (project.assessment_data && project.assessment_data.inputs) {
        const inputs = project.assessment_data.inputs;
        const fieldsToRestore = [
            'm_projectName', 'm_responsible', 'm_area', 'm_objective',
            'i_manpower', 'i_budget', 'i_activities', 'i_output', 
            'i_outcome', 'i_impact', 'sv_quote', 
            'c_outcome_value', 'c_base_case', 'c_investment'
        ];

        fieldsToRestore.forEach(fieldId => {
            const el = document.getElementById(fieldId);
            if (el && inputs[fieldId] !== undefined) {
                el.value = inputs[fieldId];
            }
        });

        if (inputs.sdgs && Array.isArray(inputs.sdgs)) {
            document.querySelectorAll('.sdg-checkbox').forEach(cb => {
                if (inputs.sdgs.includes(cb.value)) {
                    cb.checked = true;
                }
            });
        }

        if (inputs.uploadedImage) {
            appState.uploadedImage = inputs.uploadedImage;
        }
    } else if (project.project_name) {
        const projectNameInput = document.getElementById('m_projectName');
        if (projectNameInput) projectNameInput.value = project.project_name;
    }

    appState.currentStep = 6; 
    appState.isViewMode = true; 
    appState.updateStepUI();
}

function initializeNewProject() {
    appState.isViewMode = false;
    appState.currentStep = 1;
    appState.updateStepUI();
}

export async function saveProjectData(currentProjectData) {
    const urlParams = new URLSearchParams(window.location.search);
    let projectId = urlParams.get('id');
    
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        alert("Your session has expired. Please log in again.");
        return false;
    }

    if (projectId) {
        const { error } = await supabase
            .from('projects')
            .update({ 
                assessment_data: currentProjectData,
                last_page_url: window.location.href
            })
            .eq('id', projectId);
            
        if (error) {
            console.error("Update failed:", error);
            return false;
        } else {
            console.log("Project successfully updated!");
            return true; 
        }
    } else {
        const projectNameInput = document.getElementById('m_projectName');
        const finalProjectName = (projectNameInput && projectNameInput.value) ? projectNameInput.value : "ไม่ได้ระบุชื่อโครงการ";

        const { data, error } = await supabase
            .from('projects')
            .insert([{ 
                user_email: session.user.email,
                project_name: finalProjectName, 
                assessment_data: currentProjectData,
                last_page_url: window.location.href
            }])
            .select(); 
            
        if (error) {
            console.error("Insert failed:", error);
            return false;
        } else if (data && data.length > 0) {
            console.log("New project saved!");
            const newId = data[0].id;
            const newUrl = `${window.location.pathname}?id=${newId}`;
            window.history.replaceState({}, '', newUrl);
            return true;
        }
    }
}
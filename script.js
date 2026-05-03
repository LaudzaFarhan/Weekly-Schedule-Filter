// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
// Replace this with your actual Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyAmeryoAv6Nisk7foNUPOAQ3WIfYUajyOQ",
  authDomain: "weekly-schedule-chatbot.firebaseapp.com",
  projectId: "weekly-schedule-chatbot",
  storageBucket: "weekly-schedule-chatbot.firebasestorage.app",
  messagingSenderId: "479018870777",
  appId: "1:479018870777:web:d329c6f253ca80fe303f28",
  measurementId: "G-8BRCJLZFLF"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================
const loginOverlay = document.getElementById('login-overlay');
const appLayout = document.getElementById('app-layout');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-submit-btn');

auth.onAuthStateChanged((user) => {
    if (user) {
        // Logged in
        loginOverlay.style.display = 'none';
        appLayout.style.display = 'flex';
        // Re-evaluate hash routing in case it loaded behind the login screen
        if (typeof handleHashChange === 'function') handleHashChange();
    } else {
        // Not logged in
        loginOverlay.style.display = 'flex';
        appLayout.style.display = 'none';
    }
});

if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loginError.textContent = '';
        
        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value;

        if (!username || !password) {
            loginError.textContent = 'Please enter both username and password.';
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'Authenticating...';

        // Map username to email for Firebase Auth
        let email = username;
        if (!email.includes('@')) {
            email = `${username}@schedule.local`;
        }

        auth.signInWithEmailAndPassword(email, password)
            .then(() => {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            })
            .catch((error) => {
                console.error(error);
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
                
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                    loginError.textContent = 'Invalid username or password.';
                } else if (error.code === 'auth/invalid-api-key') {
                    loginError.textContent = 'Firebase is not configured correctly. Check your script.js config.';
                } else {
                    loginError.textContent = error.message;
                }
            });
    });
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        auth.signOut().catch((error) => console.error("Error signing out: ", error));
    });
}

// ==========================================
// FEATURE TOGGLES
// ==========================================
// ==========================================
(function applyFeatureToggles() {
    const defaultState = {
        conflicts: true,
        availability: true,
        avail_available: true,
        avail_busy: true,
        avail_leave: true,
        leave: true,
        trial: true,
        trial_overview: true,
        finder: true,
        schedule: true
    };
    const state = JSON.parse(localStorage.getItem('featureToggles') || JSON.stringify(defaultState));
    
    if (state.conflicts === false) { 
        const el = document.querySelector('.conflicts-panel'); if (el) el.style.display = 'none'; 
        const nav = document.querySelector('.nav-item[data-target="view-conflicts"]'); if (nav) nav.style.display = 'none';
    }
    if (state.availability === false) { 
        const el = document.querySelector('.availability-panel'); if (el) el.style.display = 'none'; 
        const nav = document.querySelector('.nav-item[data-target="view-availability"]'); if (nav) nav.style.display = 'none';
    }
    if (state.leave === false) { 
        const el = document.querySelector('.leave-panel'); if (el) el.style.display = 'none'; 
        const nav = document.querySelector('.nav-item[data-target="view-leave"]'); if (nav) nav.style.display = 'none';
    }
    if (state.trial === false && state.trial_overview === false) { 
        const nav = document.querySelector('.nav-item[data-target="view-trial"]'); if (nav) nav.style.display = 'none';
    }
    if (state.trial === false) { const el = document.querySelector('.trial-priority-panel'); if (el) el.style.display = 'none'; }
    if (state.trial_overview === false) { const el = document.querySelector('.trial-overview-panel'); if (el) el.style.display = 'none'; }
    
    if (state.finder === false) { 
        const el = document.querySelector('.free-finder-panel'); if (el) el.style.display = 'none'; 
        const nav = document.querySelector('.nav-item[data-target="view-finder"]'); if (nav) nav.style.display = 'none';
    }
    if (state.schedule === false) { 
        const el = document.querySelector('.full-schedule-panel'); if (el) el.style.display = 'none'; 
        const nav = document.querySelector('.nav-item[data-target="view-schedule"]'); if (nav) nav.style.display = 'none';
    }

    // Sub-toggles for Availability Columns
    if (state.availability !== false) {
        const columns = document.querySelectorAll('.availability-panel .result-column');
        let visibleCount = 3;
        if (columns.length === 3) {
            if (state.avail_available === false) { columns[0].style.display = 'none'; visibleCount--; }
            if (state.avail_busy === false) { columns[1].style.display = 'none'; visibleCount--; }
            if (state.avail_leave === false) { columns[2].style.display = 'none'; visibleCount--; }
        }

        const resGrid = document.querySelector('.availability-panel .results-grid');
        if (resGrid) {
            if (visibleCount === 2) {
                resGrid.classList.remove('results-grid-3');
                resGrid.style.gridTemplateColumns = '1fr 1fr';
            } else if (visibleCount === 1) {
                resGrid.classList.remove('results-grid-3');
                resGrid.style.gridTemplateColumns = '1fr';
            } else if (visibleCount === 0) {
                resGrid.style.display = 'none';
            }
        }
    }
})();

// ==========================================
// CONFIGURATION
// ==========================================
// Day names to look for in sheet tab names (case-insensitive matching)
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ==========================================
// GLOBAL STATE
// ==========================================
let allClasses   = [];
let uniqueTeachers = new Set();
let uniqueBaseTeachers = new Set();
let uniqueTimes  = {};     // { "Monday": Set(["1PM", "2.30PM"]) }
let allTimeSlots = new Set(); // All unique time slots across all days

// Leave list
let leaveList = JSON.parse(localStorage.getItem('leaveList') || '[]');

// ==========================================
// DOM REFERENCES
// ==========================================
const syncBtn          = document.getElementById('sync-btn');
const syncStatus       = document.getElementById('sync-status');
const statusDot        = document.querySelector('.status-dot');
const daySelect        = document.getElementById('day-select');
const timeSelect       = document.getElementById('time-select');
const availableList    = document.getElementById('available-list');
const busyList         = document.getElementById('busy-list');
const onleaveList      = document.getElementById('onleave-list');
const conflictsContainer = document.getElementById('conflicts-container');
const conflictCountBadge = document.getElementById('conflict-count');
const scheduleTbody    = document.getElementById('schedule-tbody');
const scheduleFilter   = document.getElementById('schedule-filter');
const filterInstructor = document.getElementById('filter-instructor');
const lastSyncTime     = document.getElementById('last-sync-time');
const sheetUrlInput    = document.getElementById('sheet-url');

// Home KPI controls
const homeDaySelect    = document.getElementById('home-day-select');
const homeTimeSelect   = document.getElementById('home-time-select');
const kpiTotalTeachers = document.getElementById('kpi-total-teachers');
const kpiAvailTeachers = document.getElementById('kpi-available-teachers');
const kpiBusyTeachers  = document.getElementById('kpi-busy-teachers');

// Finder controls
const finderInstructor = document.getElementById('finder-instructor');
const finderDayTabsEl  = document.getElementById('finder-day-tabs');
const finderTrack      = document.getElementById('finder-cards-track');
const finderPrev       = document.getElementById('finder-prev');
const finderNext       = document.getElementById('finder-next');
const finderPagination = document.getElementById('finder-pagination');
const finderSummary    = document.getElementById('finder-summary');
const finderEmpty      = document.getElementById('finder-empty');

// Schedule state
let currentScheduleData = [];
let schedulePage = 1;
const SCHEDULE_PAGE_SIZE = 8;
let finderActiveDay   = null; // currently selected day tab
let finderPage        = 0;    // current card page index
const CARDS_PER_PAGE  = 3;    // max cards shown at once

// ==========================================
// DATA FETCHING & PARSING
// ==========================================

function getBaseUrl() {
    let url = sheetUrlInput.value.trim();
    if (!url) return null;
    // Strip query params and hash
    if (url.includes('?')) url = url.split('?')[0];
    if (url.includes('#')) url = url.split('#')[0];
    // Normalize to /pub base
    if (url.endsWith('/pubhtml')) url = url.replace('/pubhtml', '/pub');
    if (url.endsWith('/edit'))    url = url.replace('/edit', '/pub');
    if (!url.endsWith('/pub'))    url = url + '/pub';
    return url;
}

function getPubHtmlUrl() {
    let url = sheetUrlInput.value.trim();
    if (!url) return null;
    if (url.includes('?')) url = url.split('?')[0];
    if (url.includes('#')) url = url.split('#')[0];
    if (url.endsWith('/pub'))  url = url.replace('/pub', '/pubhtml');
    if (url.endsWith('/edit')) url = url.replace('/edit', '/pubhtml');
    if (!url.endsWith('/pubhtml')) url = url + 'html';
    return url;
}

// Fetch with a timeout to prevent hanging
function fetchWithTimeout(url, timeoutMs = 15000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        )
    ]);
}

// Get the appropriate proxy URL based on the environment
function getProxyUrl(targetUrl) {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
        return `/proxy?url=${encodeURIComponent(targetUrl)}`;
    } else {
        // When hosted statically on GitHub Pages, use a public CORS proxy
        // allorigins is currently unstable, using codetabs proxy instead
        return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
    }
}

// Auto-discover tabs from the pubhtml page
async function discoverTabs() {
    const pubHtmlUrl = getPubHtmlUrl();
    if (!pubHtmlUrl) throw new Error("Invalid URL");

    const proxyUrl = getProxyUrl(pubHtmlUrl);
    const res = await fetchWithTimeout(proxyUrl, 20000);
    if (!res.ok) throw new Error(`Failed to load sheet (HTTP ${res.status})`);

    const html = await res.text();

    // Extract tab info from the JavaScript init block
    // Pattern: items.push({name: "TabName", ..., gid: "12345"...})
    const tabRegex = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
    const tabs = [];
    let match;
    while ((match = tabRegex.exec(html)) !== null) {
        tabs.push({ name: match[1], gid: match[2] });
    }

    if (tabs.length === 0) {
        throw new Error("Could not find any tabs. Make sure the sheet is published (File → Share → Publish to web).");
    }

    return tabs;
}

// Filter to only day-schedule tabs
function filterDayTabs(allTabs) {
    return allTabs.filter(tab => {
        const lower = tab.name.toLowerCase();
        return DAY_NAMES.some(day => lower.includes(day.toLowerCase()));
    });
}

async function fetchAndParseSchedule() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
        alert("Please enter a valid Google Sheets Publish link.");
        return;
    }

    setSyncState(true);
    allClasses = [];
    uniqueTeachers.clear();
    uniqueBaseTeachers.clear();
    uniqueTimes = {};
    allTimeSlots.clear();

    try {
        // Step 1: Auto-discover tabs from the sheet
        syncStatus.textContent = "Discovering tabs...";
        const allTabs = await discoverTabs();
        const dayTabs = filterDayTabs(allTabs);

        if (dayTabs.length === 0) {
            const tabNames = allTabs.map(t => t.name).join(', ');
            throw new Error(`No day tabs found! Found tabs: [${tabNames}]. Tab names must include a day name (Monday, Tuesday, etc.)`);
        }

        // Step 2: Fetch all day tabs in parallel for speed
        syncStatus.textContent = `Syncing ${dayTabs.length} tabs...`;

        const results = await Promise.allSettled(
            dayTabs.map(async (tab) => {
                const targetUrl = `${baseUrl}?gid=${tab.gid}&single=true&output=csv`;
                const proxyUrl  = getProxyUrl(targetUrl);
                const response = await fetchWithTimeout(proxyUrl, 15000);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const csvText = await response.text();
                return { tab, csvText };
            })
        );

        // Process results
        let successCount = 0;
        let failedTabs = [];

        for (const result of results) {
            if (result.status === 'fulfilled') {
                parseCSVData(result.value.csvText, result.value.tab.name);
                successCount++;
            } else {
                failedTabs.push(result.reason.message);
            }
        }

        if (successCount === 0) {
            throw new Error("All tabs failed to load. Check your internet connection and that the sheet is published.");
        }

        processParsedData();

        let statusMsg = `Synced ${successCount}/${dayTabs.length} day(s)`;
        if (failedTabs.length > 0) statusMsg += ` (${failedTabs.length} failed)`;
        setSyncState(false, statusMsg);
    } catch (error) {
        console.error("Sync error:", error);
        setSyncState(false, "Sync Failed");
        alert(`Sync Failed!\n\nError: ${error.message}\n\n⚠️ Make sure:\n  1. The sheet is published (File → Share → Publish to web)\n  2. You opened this tool via http://localhost:3000\n  3. The server is running (double-click "Start Server.bat")`);
    }
}

function parseCSVData(csvText, dayName) {
    Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
            let lastTime    = "";
            let lastTerm    = "";
            let lastTeacher = "";
            let lastBaseTeacher = "";

            results.data.forEach(row => {
                if (!row['Student Name'] && !row['Time'] && !row['Term-Branch']) return;
                if (row['Time'] === 'Time' || row['Term-Branch'] === 'Term-Branch') return;

                // Smart inheritance for merged/empty cells
                let time    = row['Time']           ? row['Time'].trim()           : lastTime;
                let term    = row['Term-Branch']    ? row['Term-Branch'].trim()    : lastTerm;
                
                // Check if Column C (Main Inst/PIC) has an actual value in THIS row
                const rawColumnC = row['Main Inst/PIC'] ? row['Main Inst/PIC'].trim() : '';
                
                // Base teacher from Column C (with inheritance for merged cells)
                let baseTeacher = rawColumnC || lastBaseTeacher;
                let teacher = baseTeacher;

                if (baseTeacher) lastBaseTeacher = baseTeacher;

                if (baseTeacher && baseTeacher !== "-") {
                    uniqueBaseTeachers.add(baseTeacher);
                }

                // Override teacher if Column F (Lesson Arrange Date) is present
                // Format is usually "Lesson Name, Instructor Name" e.g., "KF1.7, Helen"
                const lessonArrange = row['Lesson Arrange Date'];
                if (lessonArrange && lessonArrange.includes(',')) {
                    const parts = lessonArrange.split(',');
                    const assignedInstructor = parts[parts.length - 1].trim();
                    if (assignedInstructor && assignedInstructor !== "-") {
                        // Also update lastTeacher so merged cells below it inherit the right person
                        teacher = assignedInstructor;
                    }
                } else if (!lessonArrange || lessonArrange.trim() === '') {
                    // Column F is empty — check if Column C has an actual value for THIS row
                    // If Column C is also empty, this teacher is NOT assigned to this class
                    if (!rawColumnC) {
                        teacher = ''; // No teacher assigned — don't inherit from previous rows
                    }
                    // If Column C has a value, the base teacher (from Column C) is the assigned teacher
                }

                // Fix occasional stray leading zero from Google Sheets
                if (time.startsWith('010.')) time = time.substring(1);

                if (time)    lastTime    = time;
                if (term)    lastTerm    = term;
                if (teacher) lastTeacher = teacher;

                const student = row['Student Name'] ? row['Student Name'].trim() : "";

                if (student && teacher && time) {
                    allClasses.push({
                        day:     dayName,
                        time,
                        program: term,
                        teacher,
                        student,
                        remarks:     row['Remarks'] || "",
                        fullProgram: row['Program'] || "",
                    });

                    if (teacher !== "-") uniqueTeachers.add(teacher);
                    if (!uniqueTimes[dayName]) uniqueTimes[dayName] = new Set();
                    uniqueTimes[dayName].add(time);
                    allTimeSlots.add(time);
                }
            });
        }
    });
}

// ==========================================
// TIME PARSING & OVERLAP ENGINE
// ==========================================

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    timeStr = timeStr.toLowerCase().trim();
    const isPM = timeStr.includes('pm');
    const isAM = timeStr.includes('am');
    
    timeStr = timeStr.replace(/am|pm/g, '').trim();
    let parts = timeStr.split(/[:.]/);
    let hours = parseInt(parts[0], 10) || 0;
    let minutes = parseInt(parts[1], 10) || 0;
    
    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    
    return hours * 60 + minutes;
}

function parseTimeSlot(slotStr) {
    if (!slotStr) return null;
    const parts = slotStr.split('-');
    if (parts.length !== 2) return null;
    
    let startStr = parts[0].trim();
    let endStr = parts[1].trim();
    
    // Inherit am/pm if not present
    if (!startStr.includes('am') && !startStr.includes('pm')) {
        if (endStr.includes('pm')) startStr += ' pm';
        if (endStr.includes('am')) startStr += ' am';
    }
    
    return {
        start: parseTimeToMinutes(startStr),
        end: parseTimeToMinutes(endStr),
        original: slotStr
    };
}

function doTimeSlotsOverlap(slot1, slot2) {
    if (slot1 === slot2) return true;

    const parsed1 = parseTimeSlot(slot1);
    const parsed2 = parseTimeSlot(slot2);
    
    if (!parsed1 || !parsed2) return slot1 === slot2;
    
    return parsed1.start < parsed2.end && parsed2.start < parsed1.end;
}

// ==========================================
// POST-PARSE PROCESSING
// ==========================================

function processParsedData() {
    populateDropdowns();
    renderFullSchedule(allClasses);
    runConflictEngine();
    populateFinderDropdowns();
    populateTrialInstructorDropdown();
    populateLeaveInstructorDropdown();
    renderTrialOverview();

    // Populate Global Instructor Filter
    filterInstructor.innerHTML = '<option value="all">All Instructors</option>';
    [...uniqueTeachers].sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        filterInstructor.appendChild(opt);
    });

    // Update timestamp
    const now = new Date();
    lastSyncTime.textContent = `Last synced: ${now.toLocaleTimeString()}`;

    // Enable all controls
    [daySelect, timeSelect, scheduleFilter, filterInstructor, finderInstructor]
        .forEach(el => el.disabled = false);

    // Initial render with filters applied
    applyGlobalFilters();
}

function applyGlobalFilters() {
    schedulePage = 1; // Reset to page 1 on filter change
    
    const dayValue  = daySelect.value;
    const timeValue = timeSelect.value;
    const instValue = filterInstructor.value;
    const search    = scheduleFilter.value.toLowerCase();

    const filtered = allClasses.filter(c => {
        const matchDay  = !dayValue || dayValue === 'all' || c.day === dayValue;
        const matchTime = !timeValue || timeValue === 'all' || c.time === timeValue;
        const matchInst = instValue === 'all' || c.teacher === instValue;
        const matchSearch = !search || 
            c.teacher.toLowerCase().includes(search) || 
            c.student.toLowerCase().includes(search) ||
            c.program.toLowerCase().includes(search) ||
            (c.remarks && c.remarks.toLowerCase().includes(search));
        
        return matchDay && matchTime && matchInst && matchSearch;
    });

    renderFullSchedule(filtered);
}

// Global Filter Listeners
[daySelect, timeSelect, scheduleFilter, filterInstructor].forEach(el => {
    el.addEventListener('input', applyGlobalFilters);
});

// ==========================================
// CONFLICT ENGINE
// ==========================================

function runConflictEngine() {
    const conflicts = [];
    
    // Group classes by day + teacher
    const teacherSchedule = {};
    allClasses.forEach(cls => {
        if (!cls.teacher || cls.teacher === "-") return;
        const key = `${cls.day}|${cls.teacher}`;
        if (!teacherSchedule[key]) teacherSchedule[key] = [];
        
        const existing = teacherSchedule[key].find(c => c.time === cls.time && c.program === cls.program);
        if (!existing) {
            teacherSchedule[key].push({ time: cls.time, program: cls.program });
        }
    });

    for (const [key, classes] of Object.entries(teacherSchedule)) {
        const [day, teacher] = key.split('|');
        
        for (let i = 0; i < classes.length; i++) {
            for (let j = i + 1; j < classes.length; j++) {
                if (doTimeSlotsOverlap(classes[i].time, classes[j].time)) {
                    conflicts.push({
                        day,
                        time: `${classes[i].time} & ${classes[j].time}`,
                        teacher,
                        programs: [classes[i].program, classes[j].program]
                    });
                }
            }
        }
    }

    renderConflicts(conflicts);
}

// ==========================================
// AVAILABILITY CHECKER (slot-based)
// ==========================================

function updateAvailability() {
    const selectedDay  = daySelect.value;
    const selectedTime = timeSelect.value;
    if (!selectedDay || !selectedTime) return;

    const allTeachersArr = [...uniqueTeachers].sort();
    const busyMap = {};

    allClasses.forEach(cls => {
        if (cls.day === selectedDay && cls.teacher !== "-") {
            if (doTimeSlotsOverlap(cls.time, selectedTime)) {
                if (!busyMap[cls.teacher]) busyMap[cls.teacher] = new Set();
                busyMap[cls.teacher].add(cls.program);
            }
        }
    });

    const busyTeachers = Object.keys(busyMap);
    let available    = allTeachersArr.filter(t => !busyTeachers.includes(t));

    // Filter out part-time instructors if they don't work on selectedDay
    const workingDaysMap = {};
    trialPriorityList.forEach(t => {
        workingDaysMap[t.name] = {
            status: t.workingStatus || 'fulltime',
            days: t.workingDays || []
        };
    });

    const getTrialConfig = (instructorName) => {
        let config = workingDaysMap[instructorName];
        if (config) return config;
        const baseNames = Object.keys(workingDaysMap).sort((a,b) => b.length - a.length);
        for (const base of baseNames) {
            if (instructorName.includes(base)) return workingDaysMap[base];
        }
        return null;
    };

    available = available.filter(t => {
        const config = getTrialConfig(t);
        if (config && config.status === 'parttime') {
            return config.days.includes(selectedDay);
        }
        return true;
    });

    Object.keys(busyMap).forEach(t => {
        const config = getTrialConfig(t);
        if (config && config.status === 'parttime' && !config.days.includes(selectedDay)) {
            delete busyMap[t];
        }
    });

    // Separate on-leave instructors
    const onLeaveInstructors = [];
    const isOnLeave = (name) => {
        return leaveList.some(l => {
            if (l.day !== selectedDay) return false;
            if (l.name === name) return true;
            if (name.includes(l.name)) return true;
            return false;
        });
    };

    // Remove on-leave from available
    available = available.filter(t => {
        if (isOnLeave(t)) {
            const entry = leaveList.find(l => l.day === selectedDay && (l.name === t || t.includes(l.name)));
            onLeaveInstructors.push({ name: t, reason: entry ? entry.reason : '' });
            return false;
        }
        return true;
    });

    // Remove on-leave from busy
    Object.keys(busyMap).forEach(t => {
        if (isOnLeave(t)) {
            const entry = leaveList.find(l => l.day === selectedDay && (l.name === t || t.includes(l.name)));
            onLeaveInstructors.push({ name: t, reason: entry ? entry.reason : '' });
            delete busyMap[t];
        }
    });

    renderAvailability(available, busyMap, onLeaveInstructors);
}

// ==========================================
// FREE INSTRUCTOR FINDER
// ==========================================

const CARDS_VISIBLE = 3; // how many time-slot cards shown at once

function populateFinderDropdowns() {
    // Instructor filter
    finderInstructor.innerHTML = '<option value="all">All Instructors</option>';
    [...uniqueTeachers].sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        finderInstructor.appendChild(opt);
    });
    finderInstructor.disabled = false;
    finderInstructor.addEventListener('change', () => renderFinderCards());

    // Day tabs
    const days = Object.keys(uniqueTimes);
    finderDayTabsEl.innerHTML = days.map((day, i) => `
        <button class="finder-tab-btn${i === 0 ? ' active' : ''}" data-day="${day}">${day}</button>
    `).join('');

    finderActiveDay = days[0] || null;
    finderPage = 0;

    finderDayTabsEl.querySelectorAll('.finder-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            finderDayTabsEl.querySelectorAll('.finder-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            finderActiveDay = btn.dataset.day;
            finderPage = 0;
            renderFinderCards();
        });
    });

    renderFinderCards();
}

function renderFinderCards() {
    if (!finderActiveDay) return;

    const filterInst = finderInstructor.value;
    let instructors = filterInst === 'all'
        ? [...uniqueTeachers].sort()
        : [filterInst];

    // Filter out part-time instructors if they don't work on finderActiveDay
    const workingDaysMap = {};
    trialPriorityList.forEach(t => {
        workingDaysMap[t.name] = {
            status: t.workingStatus || 'fulltime',
            days: t.workingDays || []
        };
    });

    const getTrialConfig = (instructorName) => {
        let config = workingDaysMap[instructorName];
        if (config) return config;
        const baseNames = Object.keys(workingDaysMap).sort((a,b) => b.length - a.length);
        for (const base of baseNames) {
            if (instructorName.includes(base)) return workingDaysMap[base];
        }
        return null;
    };

    instructors = instructors.filter(t => {
        const config = getTrialConfig(t);
        if (config && config.status === 'parttime') {
            return config.days.includes(finderActiveDay);
        }
        return true;
    });

    const times = uniqueTimes[finderActiveDay]
        ? [...uniqueTimes[finderActiveDay]].sort()
        : [];

    // Group classes by instructor for the active day
    const dayClassesByInst = {};
    allClasses.forEach(cls => {
        if (cls.day === finderActiveDay && cls.teacher !== '-') {
            if (!dayClassesByInst[cls.teacher]) dayClassesByInst[cls.teacher] = [];
            dayClassesByInst[cls.teacher].push(cls);
        }
    });

    // Build busy lookup using overlaps
    const busyLookup = {};
    times.forEach(t => instructors.forEach(inst => {
        const k = `${t}|${inst}`;
        const instClasses = dayClassesByInst[inst] || [];
        
        for (const cls of instClasses) {
            if (doTimeSlotsOverlap(cls.time, t)) {
                if (!busyLookup[k]) busyLookup[k] = new Set();
                busyLookup[k].add(cls.program);
            }
        }
    }));

    // Count summary
    let totalFree = 0, totalBusy = 0;
    times.forEach(t => instructors.forEach(inst => {
        busyLookup[`${t}|${inst}`] ? totalBusy++ : totalFree++;
    }));

    // Show/hide empty state
    const hasData = times.length > 0 && instructors.length > 0;
    finderEmpty.style.display        = hasData ? 'none' : 'flex';
    finderSummary.style.display      = hasData ? 'flex' : 'none';
    finderTrack.parentElement.parentElement.style.display = hasData ? 'flex' : 'none';
    finderPagination.style.display   = hasData ? 'flex' : 'none';

    if (!hasData) return;

    // Summary
    finderSummary.innerHTML = `
        <span>Day: <strong>${finderActiveDay}</strong> &nbsp;|&nbsp; <strong>${instructors.length}</strong> instructor(s)</span>
        <span style="color:var(--success)">✓ <strong>${totalFree}</strong> free</span>
        <span style="color:var(--danger)">✗ <strong>${totalBusy}</strong> busy</span>
    `;

    // Total pages
    const totalPages = Math.ceil(times.length / CARDS_VISIBLE);
    finderPage = Math.min(finderPage, totalPages - 1);

    // Build cards
    const viewport = finderTrack.parentElement;
    const gap      = 16; // px, must match CSS gap: 1rem
    const cardWidth = Math.floor((viewport.offsetWidth - gap * (CARDS_VISIBLE - 1)) / CARDS_VISIBLE);

    finderTrack.innerHTML = times.map(time => {
        const rows = instructors.map(inst => {
            const isBusy = !!busyLookup[`${time}|${inst}`];
            const programs = isBusy ? [...busyLookup[`${time}|${inst}`]].join(', ') : '';

            // Check if on leave
            const instOnLeave = leaveList.some(l => {
                if (l.day !== finderActiveDay) return false;
                if (l.name === inst) return true;
                if (inst.includes(l.name)) return true;
                return false;
            });
            const leaveEntry = instOnLeave ? leaveList.find(l => l.day === finderActiveDay && (l.name === inst || inst.includes(l.name))) : null;

            if (instOnLeave) {
                return `
                <div class="slot-instructor-row" style="opacity:0.7;">
                    <span class="instructor-name">${inst}</span>
                    <span class="status-onleave" style="color:var(--warning);font-weight:600;font-size:0.75rem;">✈ On Leave${leaveEntry && leaveEntry.reason ? ' (' + leaveEntry.reason + ')' : ''}</span>
                </div>`;
            }

            return `
                <div class="slot-instructor-row">
                    <span class="instructor-name">${inst}</span>
                    <span class="${isBusy ? 'status-busy' : 'status-free'}">${isBusy ? '✗ Busy' : '✓ Free'}</span>
                </div>`;
        }).join('');

        const freeCount = instructors.filter(i => {
            const onLeave = leaveList.some(l => l.day === finderActiveDay && (l.name === i || i.includes(l.name)));
            return !busyLookup[`${time}|${i}`] && !onLeave;
        }).length;

        return `
            <div class="finder-card" style="width:${cardWidth}px">
                <div class="finder-card-header">
                    <span class="finder-card-time">${time}</span>
                    <span class="slot-free-pill">${freeCount} free</span>
                </div>
                <div class="finder-card-body">${rows}</div>
            </div>`;
    }).join('');

    // Translate track to current page
    const offset = finderPage * CARDS_VISIBLE * (cardWidth + gap);
    finderTrack.style.transform = `translateX(-${offset}px)`;

    // Nav buttons
    finderPrev.disabled = finderPage === 0;
    finderNext.disabled = finderPage >= totalPages - 1;

    // Dots
    if (totalPages <= 1) {
        finderPagination.innerHTML = '';
    } else {
        finderPagination.innerHTML =
            `<span class="page-label">Page ${finderPage + 1} of ${totalPages}</span>` +
            Array.from({ length: totalPages }, (_, i) =>
                `<span class="finder-dot${i === finderPage ? ' active' : ''}" data-page="${i}"></span>`
            ).join('');

        finderPagination.querySelectorAll('.finder-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                finderPage = +dot.dataset.page;
                renderFinderCards();
            });
        });
    }
}

// Wire up nav arrows (once)
finderPrev.addEventListener('click', () => { finderPage--; renderFinderCards(); });
finderNext.addEventListener('click', () => { finderPage++; renderFinderCards(); });


// ==========================================
// RENDERING
// ==========================================

function populateDropdowns() {
    // Slot Checker: Days
    daySelect.innerHTML = '<option value="" disabled selected>Select a Day...</option>';
    Object.keys(uniqueTimes).forEach(day => {
        const opt = document.createElement('option');
        opt.value = day; opt.textContent = day;
        daySelect.appendChild(opt);
    });

    daySelect.addEventListener('change', () => {
        const day = daySelect.value;
        timeSelect.innerHTML = '<option value="" disabled selected>Select a Time...</option>';
        if (uniqueTimes[day]) {
            [...uniqueTimes[day]].sort().forEach(time => {
                const opt = document.createElement('option');
                opt.value = time; opt.textContent = time;
                timeSelect.appendChild(opt);
            });
        }
        updateAvailability();
    });

    timeSelect.addEventListener('change', updateAvailability);

    scheduleFilter.addEventListener('input', () => {
        const term = scheduleFilter.value.toLowerCase();
        renderFullSchedule(allClasses.filter(c =>
            c.teacher.toLowerCase().includes(term) ||
            c.student.toLowerCase().includes(term) ||
            c.program.toLowerCase().includes(term)
        ));
    });
}

// ── Pagination state for Conflicts & Availability ──
let conflictPage = 1;
const CONFLICT_PAGE_SIZE = 4;
let allConflicts = [];

let availPage = 1;
const AVAIL_PAGE_SIZE = 5;
let cachedAvailable = [];
let cachedBusyMap = {};
let cachedOnLeave = [];

function renderMiniPagination(containerId, currentPage, totalPages, onPageChange) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button ${currentPage <= 1 ? 'disabled' : ''} class="mini-pag-btn" data-dir="prev">‹ Prev</button>
        <span class="mini-pag-label">${currentPage} / ${totalPages}</span>
        <button ${currentPage >= totalPages ? 'disabled' : ''} class="mini-pag-btn" data-dir="next">Next ›</button>
    `;
    el.querySelector('[data-dir="prev"]').addEventListener('click', () => { onPageChange(currentPage - 1); });
    el.querySelector('[data-dir="next"]').addEventListener('click', () => { onPageChange(currentPage + 1); });
}

function renderConflicts(conflicts) {
    allConflicts = conflicts;
    conflictPage = 1;
    renderConflictsPage();
}

function renderConflictsPage() {
    conflictCountBadge.textContent = `${allConflicts.length} Detected`;
    conflictCountBadge.className   = allConflicts.length > 0 ? 'badge badge-danger' : 'badge badge-success';

    if (allConflicts.length === 0) {
        conflictsContainer.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--success)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                <p>No double-bookings found!</p>
                <span class="subtext">Schedule looks clean.</span>
            </div>`;
        document.getElementById('conflicts-pagination').innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(allConflicts.length / CONFLICT_PAGE_SIZE);
    if (conflictPage > totalPages) conflictPage = totalPages;
    const start = (conflictPage - 1) * CONFLICT_PAGE_SIZE;
    const page = allConflicts.slice(start, start + CONFLICT_PAGE_SIZE);

    conflictsContainer.innerHTML = page.map(c => `
        <div class="conflict-item">
            <h4>⚠ ${c.teacher} — Double Booked</h4>
            <p>${c.day} at ${c.time}</p>
            <p style="margin-top:4px;font-weight:600;">Assigned to: ${c.programs.join(' &amp; ')}</p>
        </div>`).join('');

    renderMiniPagination('conflicts-pagination', conflictPage, totalPages, (p) => {
        conflictPage = p;
        renderConflictsPage();
    });
}

function renderAvailability(available, busyMap, onLeaveInstructors = []) {
    cachedAvailable = available;
    cachedBusyMap = busyMap;
    cachedOnLeave = onLeaveInstructors;
    availPage = 1;
    renderAvailabilityPage();
}

function renderAvailabilityPage() {
    const available = cachedAvailable;
    const busyMap = cachedBusyMap;
    const onLeave = cachedOnLeave;

    document.getElementById('available-count').textContent = available.length;
    document.getElementById('busy-count').textContent      = Object.keys(busyMap).length;
    document.getElementById('onleave-count').textContent    = onLeave.length;

    // Paginate available list
    const availTotalPages = Math.ceil(available.length / AVAIL_PAGE_SIZE) || 1;
    if (availPage > availTotalPages) availPage = availTotalPages;
    const aStart = (availPage - 1) * AVAIL_PAGE_SIZE;
    const availSlice = available.slice(aStart, aStart + AVAIL_PAGE_SIZE);

    availableList.innerHTML = available.length === 0
        ? '<li class="empty-list-item">No instructors available</li>'
        : availSlice.map(t => `
            <li class="available-item">
                <span>${t}</span>
                <span style="color:var(--success);font-weight:600;font-size:0.75rem;">✓ Free</span>
            </li>`).join('');

    renderMiniPagination('available-pagination', availPage, availTotalPages, (p) => {
        availPage = p;
        renderAvailabilityPage();
    });

    // Paginate busy list
    const busyArr = Object.entries(busyMap);
    const busyTotalPages = Math.ceil(busyArr.length / AVAIL_PAGE_SIZE) || 1;
    const bStart = (availPage - 1) * AVAIL_PAGE_SIZE;
    const busySlice = busyArr.slice(aStart, aStart + AVAIL_PAGE_SIZE);

    busyList.innerHTML = busyArr.length === 0
        ? '<li class="empty-list-item">No instructors busy</li>'
        : busySlice.map(([teacher, programs]) => {
            const tags = [...programs].map(p => {
                let bg = '#4F46E520', color = '#4F46E5', border = '#4F46E540';
                if (p.includes('K') || p.toLowerCase().includes('kinder'))
                    { bg='#fef3c720'; color='var(--kinder)'; border='#fde68a'; }
                if (p.includes('J') || p.toLowerCase().includes('junior'))
                    { bg='#e0f2fe'; color='var(--junior)'; border='#bae6fd'; }
                if (p.toLowerCase().includes('coder'))
                    { bg='#d1fae5'; color='var(--coder)'; border='#a7f3d0'; }
                return `<span class="module-tag" style="background:${bg};color:${color};border:1px solid ${border}">${p}</span>`;
            }).join('');

            return `
                <li>
                    <span>${teacher}</span>
                    <div class="busy-info">Teaching ${tags}</div>
                </li>`;
        }).join('');

    renderMiniPagination('busy-pagination', availPage, busyTotalPages, (p) => {
        availPage = p;
        renderAvailabilityPage();
    });

    // Paginate on-leave list
    const onleaveTotalPages = Math.ceil(onLeave.length / AVAIL_PAGE_SIZE) || 1;
    const oStart = (availPage - 1) * AVAIL_PAGE_SIZE;
    const onleaveSlice = onLeave.slice(oStart, oStart + AVAIL_PAGE_SIZE);

    onleaveList.innerHTML = onLeave.length === 0
        ? '<li class="empty-list-item">No one on leave</li>'
        : onleaveSlice.map(item => `
            <li class="onleave-item">
                <span>${item.name}</span>
                <div class="onleave-info">✈ On Leave${item.reason ? ' • ' + item.reason : ''}</div>
            </li>`).join('');

    renderMiniPagination('onleave-pagination', availPage, onleaveTotalPages, (p) => {
        availPage = p;
        renderAvailabilityPage();
    });
}

// ==========================================
// RENDERING SCHEDULE
// ==========================================

function renderFullSchedule(data) {
    currentScheduleData = data;
    const totalPages = Math.ceil(data.length / SCHEDULE_PAGE_SIZE);
    
    // Safety check for page bounds
    if (schedulePage > totalPages && totalPages > 0) schedulePage = totalPages;
    if (schedulePage < 1) schedulePage = 1;

    const start = (schedulePage - 1) * SCHEDULE_PAGE_SIZE;
    const paginatedData = data.slice(start, start + SCHEDULE_PAGE_SIZE);

    const tbody = document.getElementById('schedule-tbody');
    const pagEl = document.getElementById('schedule-pagination');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state-table">No classes found.</td></tr>';
        if (pagEl) pagEl.innerHTML = '';
        return;
    }

    tbody.innerHTML = paginatedData.map(cls => {
        let progBg = '#f1f5f9', progColor = '#475569';
        const pl = cls.program.toLowerCase();
        if (pl.includes('k') || pl.includes('kinder'))
            { progBg = '#fef3c7'; progColor = '#92400e'; }
        if (pl.includes('j') || pl.includes('junior'))
            { progBg = '#e0f2fe'; progColor = '#075985'; }
        if (pl.includes('coder'))
            { progBg = '#d1fae5'; progColor = '#065f46'; }

        return `
            <tr>
                <td><span class="day-chip">${cls.day}</span></td>
                <td style="font-weight:600;">${cls.time}</td>
                <td><span class="program-chip" style="background:${progBg};color:${progColor}">${cls.program}</span></td>
                <td style="font-weight:500;">${cls.teacher}</td>
                <td>${cls.student}</td>
                <td style="color:var(--text-muted);font-size:0.78rem;">${cls.remarks}</td>
            </tr>`;
    }).join('');

    // Pagination controls
    if (pagEl) {
        if (totalPages <= 1) {
            pagEl.innerHTML = '';
        } else {
            pagEl.innerHTML = `
                <button ${schedulePage <= 1 ? 'disabled' : ''} onclick="schedulePage--; renderFullSchedule(currentScheduleData);">← Prev</button>
                <span class="page-label">Page ${schedulePage} of ${totalPages}</span>
                <button ${schedulePage >= totalPages ? 'disabled' : ''} onclick="schedulePage++; renderFullSchedule(currentScheduleData);">Next →</button>
            `;
        }
    }
}

function setSyncState(isSyncing, text = null) {
    if (isSyncing) {
        syncBtn.classList.add('loading');
        statusDot.className = 'status-dot syncing';
        syncStatus.textContent = "Syncing...";
    } else {
        syncBtn.classList.remove('loading');
        statusDot.className = `status-dot ${text && !text.includes('Failed') ? 'active' : ''}`;
        syncStatus.textContent = text || "Ready";
    }
}

// ==========================================
// TRIAL PRIORITY INSTRUCTORS
// ==========================================

const trialNameSelect  = document.getElementById('trial-instructor-name');
const trialTypeSelect  = document.getElementById('trial-instructor-type');
const trialStatusSelect = document.getElementById('trial-instructor-status');
const trialWorkingDaysContainer = document.getElementById('trial-working-days-container');
const trialDayCbs = document.querySelectorAll('.trial-day-cb');
const trialAddBtn      = document.getElementById('trial-add-btn');
const trialBtnText     = document.getElementById('trial-btn-text');
const trialTbody       = document.getElementById('trial-tbody');
const trialCountBadge  = document.getElementById('trial-count');

// Trial capabilities mapping
const TRIAL_CAPABILITIES = {
    'kinder-junior': { label: 'Kinder & Junior', categories: ['Kinder', 'Junior'], color: 'type-kinder-junior' },
    'junior-coder':  { label: 'Junior & Coder',  categories: ['Kinder', 'Junior', 'Coder'], color: 'type-junior-coder' }
};

// Load from localStorage
let trialPriorityList = JSON.parse(localStorage.getItem('trialPriorityList') || '[]');

function saveTrialPriority() {
    localStorage.setItem('trialPriorityList', JSON.stringify(trialPriorityList));
}

// Enable/disable Add button based on form completeness
function checkTrialFormReady() {
    let ready = trialNameSelect.value && trialTypeSelect.value;
    if (trialStatusSelect.value === 'parttime') {
        const anyDaySelected = Array.from(trialDayCbs).some(cb => cb.checked);
        ready = ready && anyDaySelected;
    }
    trialAddBtn.disabled = !ready;
}

trialNameSelect.addEventListener('change', () => {
    const selectedName = trialNameSelect.value;
    const existing = trialPriorityList.find(t => t.name === selectedName);
    
    if (existing) {
        trialTypeSelect.value = existing.type || '';
        trialStatusSelect.value = existing.workingStatus || 'fulltime';
        
        if (existing.workingStatus === 'parttime') {
            trialWorkingDaysContainer.style.display = 'block';
            trialDayCbs.forEach(cb => {
                cb.checked = (existing.workingDays || []).includes(cb.value);
            });
        } else {
            trialWorkingDaysContainer.style.display = 'none';
            trialDayCbs.forEach(cb => cb.checked = false);
        }
        if(trialBtnText) trialBtnText.textContent = 'Update';
    } else {
        trialTypeSelect.value = '';
        trialStatusSelect.value = 'fulltime';
        trialWorkingDaysContainer.style.display = 'none';
        trialDayCbs.forEach(cb => cb.checked = false);
        if(trialBtnText) trialBtnText.textContent = 'Add';
    }
    checkTrialFormReady();
});

trialTypeSelect.addEventListener('change', checkTrialFormReady);
trialStatusSelect.addEventListener('change', () => {
    if (trialStatusSelect.value === 'parttime') {
        trialWorkingDaysContainer.style.display = 'block';
    } else {
        trialWorkingDaysContainer.style.display = 'none';
    }
    checkTrialFormReady();
});
trialDayCbs.forEach(cb => cb.addEventListener('change', checkTrialFormReady));

// Populate the instructor dropdown after sync
function populateTrialInstructorDropdown() {
    const current = trialNameSelect.value;
    trialNameSelect.innerHTML = '<option value="" disabled selected>Select instructor...</option>';

    // Get synced teachers from base Column C + any manually added ones already in the list
    const allNames = new Set([...uniqueBaseTeachers]);
    trialPriorityList.forEach(t => allNames.add(t.name));

    const alreadyAdded = new Set(trialPriorityList.map(t => t.name));

    [...allNames].sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        trialNameSelect.appendChild(opt);
    });

    // Restore selection if still available
    if (current && trialNameSelect.querySelector(`option[value="${current}"]`)) {
        trialNameSelect.value = current;
    }
    trialNameSelect.disabled = false;
}

// Add instructor
trialAddBtn.addEventListener('click', () => {
    const name = trialNameSelect.value;
    const type = trialTypeSelect.value;
    const workingStatus = trialStatusSelect.value;
    const workingDays = [];
    if (workingStatus === 'parttime') {
        trialDayCbs.forEach(cb => { if(cb.checked) workingDays.push(cb.value) });
    }

    if (!name || !type) return;

    const existingIndex = trialPriorityList.findIndex(t => t.name === name);
    if (existingIndex !== -1) {
        // Update existing
        trialPriorityList[existingIndex] = { name, type, workingStatus, workingDays };
    } else {
        // Add new
        trialPriorityList.push({ name, type, workingStatus, workingDays });
    }

    saveTrialPriority();

    // Reset form
    trialNameSelect.value = '';
    trialTypeSelect.value = '';
    trialStatusSelect.value = 'fulltime';
    trialWorkingDaysContainer.style.display = 'none';
    trialDayCbs.forEach(cb => cb.checked = false);
    if(trialBtnText) trialBtnText.textContent = 'Add';
    trialAddBtn.disabled = true;

    populateTrialInstructorDropdown();
    renderTrialTable();
});

// Remove instructor
function removeTrialInstructor(name) {
    trialPriorityList = trialPriorityList.filter(t => t.name !== name);
    saveTrialPriority();
    populateTrialInstructorDropdown();
    renderTrialTable();
}

// Render the trial table (paginated, 3 per page)
let trialPage = 1;
const TRIAL_PAGE_SIZE = 3;

function renderTrialTable() {
    trialCountBadge.textContent = `${trialPriorityList.length} Assigned`;

    if (trialPriorityList.length === 0) {
        trialTbody.innerHTML = '<tr><td colspan="5" class="empty-state-table">No priority instructors assigned yet.</td></tr>';
        document.getElementById('trial-pagination').innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(trialPriorityList.length / TRIAL_PAGE_SIZE);
    if (trialPage > totalPages) trialPage = totalPages;
    if (trialPage < 1) trialPage = 1;
    const start = (trialPage - 1) * TRIAL_PAGE_SIZE;
    const pageItems = trialPriorityList.slice(start, start + TRIAL_PAGE_SIZE);

    trialTbody.innerHTML = pageItems.map(item => {
        const cap = TRIAL_CAPABILITIES[item.type];
        if (!cap) return '';

        const categoryTags = cap.categories.map(cat => {
            let cls = 'trial-cat-tag';
            if (cat === 'Kinder') cls += ' cat-kinder';
            else if (cat === 'Junior') cls += ' cat-junior';
            else if (cat === 'Coder') cls += ' cat-coder';
            return `<span class="${cls}">${cat}</span>`;
        }).join('');

        const isAllCategories = cap.categories.length === 3;

        let workingDaysHtml = '';
        const status = item.workingStatus || 'fulltime';
        if (status === 'fulltime') {
            workingDaysHtml = '<span class="trial-all-badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;">★ All Days</span>';
        } else {
            workingDaysHtml = (item.workingDays || []).map(d => `<span class="module-tag" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;padding:2px 6px;border-radius:4px;font-size:0.7rem;margin-right:4px;">${d.substring(0,3)}</span>`).join('');
        }

        return `
            <tr>
                <td style="font-weight:600;">${item.name}</td>
                <td><span class="trial-type-badge ${cap.color}">${cap.label}</span></td>
                <td>
                    ${isAllCategories ? '<span class="trial-all-badge">★ All Categories</span> ' : ''}
                    ${categoryTags}
                </td>
                <td>${workingDaysHtml}</td>
                <td style="text-align:center;">
                    <button class="trial-remove-btn" onclick="removeTrialInstructor('${item.name.replace(/'/g, "\\'")}')" title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </td>
            </tr>`;
    }).join('');

    renderMiniPagination('trial-pagination', trialPage, totalPages, (p) => {
        trialPage = p;
        renderTrialTable();
    });
}

// Initial render (from localStorage)
renderTrialTable();

// ==========================================
// LEAVE MANAGEMENT
// ==========================================

const leaveNameSelect = document.getElementById('leave-instructor-name');
const leaveDaySelect  = document.getElementById('leave-day-select');
const leaveReasonInput = document.getElementById('leave-reason');
const leaveAddBtn     = document.getElementById('leave-add-btn');
const leaveTbody      = document.getElementById('leave-tbody');
const leaveCountBadge = document.getElementById('leave-count');

function saveLeaveList() {
    localStorage.setItem('leaveList', JSON.stringify(leaveList));
}

// Enable/disable Add button
function checkLeaveFormReady() {
    leaveAddBtn.disabled = !leaveNameSelect.value || !leaveDaySelect.value;
}
leaveNameSelect.addEventListener('change', checkLeaveFormReady);
leaveDaySelect.addEventListener('change', checkLeaveFormReady);

// Populate leave instructor dropdown after sync
function populateLeaveInstructorDropdown() {
    const current = leaveNameSelect.value;
    leaveNameSelect.innerHTML = '<option value="" disabled selected>Select instructor...</option>';

    const allNames = new Set([...uniqueBaseTeachers]);
    leaveList.forEach(l => allNames.add(l.name));

    [...allNames].sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        leaveNameSelect.appendChild(opt);
    });

    if (current && leaveNameSelect.querySelector(`option[value="${current}"]`)) {
        leaveNameSelect.value = current;
    }
    leaveNameSelect.disabled = false;
}

// Add leave entry
leaveAddBtn.addEventListener('click', () => {
    const name = leaveNameSelect.value;
    const day  = leaveDaySelect.value;
    const reason = leaveReasonInput.value.trim();
    if (!name || !day) return;

    // Check duplicate
    if (leaveList.some(l => l.name === name && l.day === day)) {
        alert(`${name} is already marked on leave for ${day}.`);
        return;
    }

    leaveList.push({ name, day, reason });
    saveLeaveList();

    // Reset form
    leaveNameSelect.value = '';
    leaveDaySelect.value = '';
    leaveReasonInput.value = '';
    leaveAddBtn.disabled = true;

    renderLeaveTable();
    // Refresh availability if currently viewing
    updateAvailability();
    renderFinderCards();
});

// Remove leave entry
function removeLeaveEntry(name, day) {
    leaveList = leaveList.filter(l => !(l.name === name && l.day === day));
    saveLeaveList();
    renderLeaveTable();
    updateAvailability();
    renderFinderCards();
}

// Render the leave table (paginated, 5 per page)
let leavePage = 1;
const LEAVE_PAGE_SIZE = 5;

function renderLeaveTable() {
    leaveCountBadge.textContent = `${leaveList.length} On Leave`;

    if (leaveList.length === 0) {
        leaveTbody.innerHTML = '<tr><td colspan="4" class="empty-state-table">No instructors on leave.</td></tr>';
        document.getElementById('leave-pagination').innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(leaveList.length / LEAVE_PAGE_SIZE);
    if (leavePage > totalPages) leavePage = totalPages;
    if (leavePage < 1) leavePage = 1;
    const start = (leavePage - 1) * LEAVE_PAGE_SIZE;
    const pageItems = leaveList.slice(start, start + LEAVE_PAGE_SIZE);

    leaveTbody.innerHTML = pageItems.map(item => `
        <tr>
            <td style="font-weight:600;">${item.name}</td>
            <td><span class="leave-day-tag">${item.day}</span></td>
            <td>${item.reason ? `<span class="leave-reason-tag">${item.reason}</span>` : '<span style="color:var(--text-muted);font-style:italic;font-size:0.78rem;">No reason</span>'}</td>
            <td style="text-align:center;">
                <button class="trial-remove-btn" onclick="removeLeaveEntry('${item.name.replace(/'/g, "\\'")}', '${item.day}')" title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </td>
        </tr>`).join('');

    renderMiniPagination('leave-pagination', leavePage, totalPages, (p) => {
        leavePage = p;
        renderLeaveTable();
    });
}

// Initial render (from localStorage)
renderLeaveTable();

// ==========================================
// TRIAL AVAILABILITY OVERVIEW
// ==========================================

function renderTrialOverview() {
    const tbody = document.getElementById('trial-overview-tbody');
    if (!tbody) return;

    if (allClasses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state-table" style="padding: 2rem;">Sync the schedule to generate trial overview.</td></tr>';
        return;
    }

    // 1. Get all unique timeslots
    const timeSet = new Set();
    allClasses.forEach(c => {
        if (c.time) timeSet.add(c.time);
    });

    // Sort time slots chronologically
    const sortedTimes = Array.from(timeSet).sort((a, b) => {
        const pA = parseTimeSlot(a);
        const pB = parseTimeSlot(b);
        if (!pA) return 1;
        if (!pB) return -1;
        return pA.start - pB.start;
    });

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let html = '';

    sortedTimes.forEach(time => {
        html += `<tr>`;
        html += `<td style="font-weight: 600; font-size: 0.8rem; color: var(--text-main); white-space: nowrap;">${time}</td>`;

        days.forEach(day => {
            // Find if any trial priority instructor is available
            const availableTypes = new Set();

            trialPriorityList.forEach(instructor => {
                // Check if working this day
                if (instructor.workingStatus === 'parttime' && (!instructor.workingDays || !instructor.workingDays.includes(day))) {
                    return;
                }

                // Check if on leave
                const isOnLeave = leaveList.some(l => l.name === instructor.name && l.day === day);
                if (isOnLeave) return;

                // Check if busy
                const isBusy = allClasses.some(c => c.teacher === instructor.name && c.day === day && doTimeSlotsOverlap(c.time, time));
                if (isBusy) return;

                // Instructor is available!
                availableTypes.add(instructor.type);
            });

            let cellContent = '<span style="color: var(--text-muted); opacity: 0.5;">-</span>';
            if (availableTypes.has('junior-coder') && availableTypes.has('kinder-junior')) {
                cellContent = `<span class="badge" style="background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border);">All Types</span>`;
            } else if (availableTypes.has('junior-coder')) {
                cellContent = `<span class="badge" style="background: #ecfeff; color: #0891b2; border: 1px solid #cffafe;">Junior & Coder</span>`;
            } else if (availableTypes.has('kinder-junior')) {
                cellContent = `<span class="badge" style="background: #fff7ed; color: #ea580c; border: 1px solid #ffedd5;">Kinder & Junior</span>`;
            }

            html += `<td>${cellContent}</td>`;
        });

        html += `</tr>`;
    });

    if (sortedTimes.length === 0) {
        html = '<tr><td colspan="8" class="empty-state-table" style="padding: 2rem;">No time slots found.</td></tr>';
    }

    tbody.innerHTML = html;
}

// ── Init ─────────────────────────────────────────────
syncBtn.addEventListener('click', fetchAndParseSchedule);

// Navigation routing via hash
function handleHashChange() {
    let hash = window.location.hash.replace('#', '') || 'home';
    let targetId = 'view-' + hash;
    
    // Fallback if target doesn't exist or is hidden by feature toggles
    let targetView = document.getElementById(targetId);
    let navBtn = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    
    if (!targetView || (navBtn && navBtn.style.display === 'none')) {
        hash = 'home';
        targetId = 'view-home';
        targetView = document.getElementById(targetId);
        navBtn = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    }

    // Hide all
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dashboard-view').forEach(v => {
        v.classList.remove('active');
        v.style.display = 'none';
    });

    // Show active
    if (navBtn) navBtn.classList.add('active');
    if (targetView) {
        targetView.style.display = 'flex';
        // Force reflow for animation
        void targetView.offsetWidth;
        targetView.classList.add('active');
    }
}

// Listen for hash changes (e.g. back/forward buttons)
window.addEventListener('hashchange', handleHashChange);

// Handle clicks to update hash instead of directly showing tabs
document.querySelectorAll('.nav-item').forEach(navBtn => {
    navBtn.addEventListener('click', () => {
        const targetId = navBtn.getAttribute('data-target'); // e.g. "view-conflicts"
        const hash = targetId.replace('view-', '');
        window.location.hash = hash;
    });
});

// Run on initial load
window.addEventListener('DOMContentLoaded', handleHashChange);

// Update dropdowns in Home Dashboard
function populateHomeDropdowns() {
    homeDaySelect.innerHTML = '<option value="" disabled selected>Select a Day...</option>';
    DAY_NAMES.forEach(day => {
        if (uniqueTimes[day] && uniqueTimes[day].size > 0) {
            const opt = document.createElement('option');
            opt.value = day;
            opt.textContent = day;
            homeDaySelect.appendChild(opt);
        }
    });

    if (homeDaySelect.options.length > 1) {
        homeDaySelect.disabled = false;
        // Optionally select first available day
        homeDaySelect.selectedIndex = 1;
        populateHomeTimeDropdown();
    } else {
        homeDaySelect.disabled = true;
        homeTimeSelect.disabled = true;
    }
}

function populateHomeTimeDropdown() {
    const day = homeDaySelect.value;
    homeTimeSelect.innerHTML = '<option value="" disabled selected>Select a Time...</option>';
    
    if (day && uniqueTimes[day]) {
        // Sort times chronologically if possible
        const times = Array.from(uniqueTimes[day]).sort((a, b) => {
            const pA = parseTimeSlot(a);
            const pB = parseTimeSlot(b);
            if (!pA) return 1;
            if (!pB) return -1;
            return pA.start - pB.start;
        });

        times.forEach(time => {
            const opt = document.createElement('option');
            opt.value = time;
            opt.textContent = time;
            homeTimeSelect.appendChild(opt);
        });
        homeTimeSelect.disabled = false;
        if (homeTimeSelect.options.length > 1) {
            homeTimeSelect.selectedIndex = 1;
            updateHomeDashboard();
        }
    } else {
        homeTimeSelect.disabled = true;
    }
}

homeDaySelect.addEventListener('change', populateHomeTimeDropdown);
homeTimeSelect.addEventListener('change', updateHomeDashboard);

function updateHomeDashboard() {
    // Total Teachers
    kpiTotalTeachers.textContent = uniqueTeachers.size;

    const selectedDay = homeDaySelect.value;
    const selectedTime = homeTimeSelect.value;

    if (!selectedDay || !selectedTime || allClasses.length === 0) {
        kpiAvailTeachers.textContent = '0';
        kpiBusyTeachers.textContent = '0';
        return;
    }

    const available = new Set();
    const busy = new Set();
    const onLeave = new Set();

    // Check leave
    leaveList.forEach(l => {
        if (l.day === selectedDay) {
            onLeave.add(l.name);
        }
    });

    // Check busy vs available
    uniqueTeachers.forEach(teacher => {
        if (onLeave.has(teacher)) return; // Exclude from both

        const isBusy = allClasses.some(c => 
            c.teacher === teacher && 
            c.day === selectedDay && 
            doTimeSlotsOverlap(c.time, selectedTime)
        );

        if (isBusy) {
            busy.add(teacher);
        } else {
            available.add(teacher);
        }
    });

    kpiAvailTeachers.textContent = available.size;
    kpiBusyTeachers.textContent = busy.size;
}

// Hook into sync completion
const originalProcessParsedData = processParsedData;
processParsedData = function() {
    originalProcessParsedData();
    populateHomeDropdowns();
    updateHomeDashboard();
};

// ==========================================
// TRIAL INPUT FORM LOGIC
// ==========================================
const trialInputForm = document.getElementById('trial-input-form');
const trialInputStatus = document.getElementById('trial-input-status');
const trialSubmitBtn = document.getElementById('trial-submit-btn');

if (trialInputForm) {
    trialInputForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        trialInputStatus.textContent = '';
        trialInputStatus.className = 'status-message';
        trialSubmitBtn.disabled = true;
        trialSubmitBtn.innerHTML = 'Submitting...';

        const rowData = {
            colA: "Trial Leads",
            colB: document.getElementById('trial-program').value,
            colC: document.getElementById('trial-student').value.trim(),
            colD: document.getElementById('trial-instructor').value.trim(),
            colE: document.getElementById('trial-day').value,
            colF: document.getElementById('trial-time').value.trim(),
            colG: document.getElementById('trial-date').value.trim(),
            colH: document.getElementById('trial-remarks').value.trim()
        };

        try {
            const endpointUrl = 'https://script.google.com/macros/s/AKfycbwYAGeTzu9Qw7kFhJQNhMVszA2tDu6yvGDkcrzt3Sf5zHIFwXHbe5DHU20-skw9rn2sMg/exec';
            
            console.log("Sending data to spreadsheet:", rowData);
            
            // Use no-cors to bypass CORS errors. We won't get a readable response back,
            // but the request will succeed.
            await fetch(endpointUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rowData)
            });
            
            // Since we used no-cors, we assume success if it didn't throw a network error.
            trialInputStatus.textContent = 'Success! Data added to spreadsheet.';
            trialInputStatus.classList.add('success');
            
            // Show an alert popup to make it very obvious!
            alert('Success! Trial Lead added to spreadsheet.');
            
            trialInputForm.reset();
            
            trialSubmitBtn.disabled = false;
            trialSubmitBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Submit to Spreadsheet`;

        } catch (error) {
            console.error('Error submitting trial:', error);
            trialInputStatus.textContent = 'Failed to submit. Please check your internet connection.';
            trialInputStatus.classList.add('error');
            
            // Show an alert popup for error too
            alert('Failed to submit: Please check your internet connection.');
            
            trialSubmitBtn.disabled = false;
            trialSubmitBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Submit to Spreadsheet`;
        }
    });
}

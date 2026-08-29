// ===================== FIREBASE CONFIG =====================
const firebaseConfig = {
  apiKey: "AIzaSyAbWWK4e0TGCFoBQIgofxwUlgdHh1ty70o",
  authDomain: "duketennis-gh.firebaseapp.com",
  databaseURL: "https://duketennis-gh-default-rtdb.firebaseio.com",
  projectId: "duketennis-gh",
  storageBucket: "duketennis-gh.firebasestorage.app",
  messagingSenderId: "1060208106177",
  appId: "1:1060208106177:web:cb703ca666a492688b5240",
  measurementId: "G-1W1L3JMZ82"
};

const ADMIN_EMAILS = [
  'abrahamsosu16@gmail.com',
  'abrahamsosu59@gmail.com',
  'duketennis4@gmail.com'
];

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ===================== GLOBAL STATE =====================
let currentUser = null;
let userProfile = null;
let currentScreen = 'dashboard';
let currentConversationId = null;
let allUsersCache = [];
let currentAttendanceMonth = new Date().toISOString().slice(0,7);
let clientAttendanceMonth = new Date().toISOString().slice(0,7);
let messagingTab = 'chats';
let selectedBookingDate = null;
let undoStack = [];

// Live scoreboard state
let liveRoomCode = null;
let liveMatchListener = null;
let liveRole = null; // 'admin' or 'viewer'
let liveMatchData = null;

// ===================== UTILITY FUNCTIONS =====================
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getDecayedPoints(points, lastActive) {
  if (!lastActive) return points;
  const lastDate = lastActive.toDate ? lastActive.toDate() : new Date(lastActive);
  const now = new Date();
  const diffWeeks = Math.floor((now - lastDate) / (7 * 24 * 60 * 60 * 1000));
  if (diffWeeks <= 8) return points;
  const extraWeeks = diffWeeks - 8;
  return Math.max(0, Math.round(points * Math.pow(0.9, extraWeeks)));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
}

function getMonthlyFee(weeklySessions) {
  if (weeklySessions === 1) return 700;
  if (weeklySessions === 2) return 1200;
  if (weeklySessions === 3) return 1500;
  return 0;
}

function exportToCSV(filename, rows) {
  if (!rows.length) {
    alert('No data to export.');
    return;
  }
  const csvContent = rows.map(row => row.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showUndoButton(undoFunction) {
  undoStack.push(undoFunction);
  const undoBtn = document.createElement('button');
  undoBtn.className = 'btn-outline pill';
  undoBtn.textContent = 'Undo';
  undoBtn.style.position = 'fixed';
  undoBtn.style.bottom = '100px';
  undoBtn.style.right = '20px';
  undoBtn.style.zIndex = '1000';
  undoBtn.addEventListener('click', () => {
    const fn = undoStack.pop();
    if (fn) fn();
    undoBtn.remove();
  });
  document.body.appendChild(undoBtn);
  setTimeout(() => {
    if (document.body.contains(undoBtn)) undoBtn.remove();
  }, 5000);
}

// ===================== DARK MODE =====================
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.body.classList.add('dark-mode');
});

document.getElementById('themeToggleBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
});

// ===================== GOOGLE SIGN-IN =====================
document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try { await auth.signInWithPopup(provider); } catch (error) { alert('Google sign-in failed: ' + error.message); }
});

document.getElementById('logoutBtn').addEventListener('click', async () => { await auth.signOut(); });

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    try {
      await ensureUserProfile(user);
      if (!userProfile.gender || !userProfile.username || userProfile.username.trim() === '' || !userProfile.profilePic) {
        showOnboarding();
      } else {
        hideOnboarding();
      }
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appScreen').style.display = 'block';
      document.getElementById('bottomNav').style.display = 'flex';
      renderCurrentScreen();
    } catch (error) { alert('Error loading profile: ' + error.message); auth.signOut(); }
  } else {
    currentUser = null; userProfile = null;
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'none';
    hideOnboarding();
    if (liveMatchListener) { liveMatchListener(); liveMatchListener = null; }
  }
});

async function ensureUserProfile(user) {
  const userRef = db.collection('users').doc(user.uid);
  const docSnap = await userRef.get();
  if (docSnap.exists) {
    userProfile = { uid: user.uid, ...docSnap.data() };
    try { await userRef.update({ lastActive: firebase.firestore.FieldValue.serverTimestamp() }); } catch (e) {}
  } else {
    const isAdmin = ADMIN_EMAILS.includes(user.email);
    const newProfile = {
      uid: user.uid, email: user.email || '', name: user.displayName || 'Tennis Player',
      role: isAdmin ? 'admin' : 'client', skillCategory: 'Beginner', weeklySessions: 1,
      points: 0, matchesWon: 0, matchesLost: 0, username: '', gender: '',
      profilePic: '', coverPic: '', alertsEnabled: true, paidThroughMonth: '',
      phone: '', secondPhone: '', emergencyContact: '',
      lastActive: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await userRef.set(newProfile);
    userProfile = { uid: user.uid, ...newProfile };
  }
}

function showOnboarding() { document.getElementById('onboardingOverlay').style.display = 'flex'; }
function hideOnboarding() { document.getElementById('onboardingOverlay').style.display = 'none'; }

document.getElementById('saveUsernameBtn').addEventListener('click', async () => {
  const username = document.getElementById('usernameInput').value.trim();
  const gender = document.getElementById('genderInput').value;
  const profilePicFile = document.getElementById('profilePicInput').files[0];
  const errorEl = document.getElementById('usernameError');
  errorEl.textContent = '';
  if (!gender) { errorEl.textContent = 'Please select your gender.'; return; }
  if (!username) { errorEl.textContent = 'Username cannot be empty.'; return; }
  if (!profilePicFile) { errorEl.textContent = 'Please upload a profile picture.'; return; }

  const q = await db.collection('users').where('username', '==', username).get();
  if (!q.empty && q.docs[0].id !== userProfile.uid) { errorEl.textContent = 'Username already taken.'; return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const profilePicDataUrl = e.target.result;
    try {
      await db.collection('users').doc(userProfile.uid).update({
        username, gender, profilePic: profilePicDataUrl
      });
      userProfile.username = username; userProfile.gender = gender; userProfile.profilePic = profilePicDataUrl;
      hideOnboarding();
      renderCurrentScreen();
    } catch (error) {
      errorEl.textContent = 'Error saving profile: ' + error.message;
    }
  };
  reader.readAsDataURL(profilePicFile);
});

// ===================== NAVIGATION =====================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
});

function navigateTo(screen) {
  currentScreen = screen;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-screen="${screen}"]`).classList.add('active');
  renderCurrentScreen();
}

function renderCurrentScreen() {
  if (!currentUser || !userProfile) return;
  if (userProfile.role === 'client' && (!userProfile.username || userProfile.username.trim() === '')) {
    document.getElementById('mainContent').innerHTML = '';
    document.getElementById('pageTitle').textContent = 'Set Username';
    return;
  }
  const content = document.getElementById('mainContent');
  const title = document.getElementById('pageTitle');
  if (userProfile.role === 'admin') {
    renderAdmin();
  } else {
    switch (currentScreen) {
      case 'dashboard': renderClientDashboard(content); title.textContent = 'Dashboard'; break;
      case 'booking': renderBookingForm(content); title.textContent = 'Book a Session'; break;
      case 'bookings': renderMyBookings(content); title.textContent = 'My Bookings'; break;
      case 'announcements': renderAnnouncements(content); title.textContent = 'Coach News'; break;
      case 'alerts': renderAlerts(content); title.textContent = 'Alerts'; break;
      case 'rankings': renderRankings(content); title.textContent = 'Rankings & H2H'; break;
      case 'live': renderLiveScreen(content); title.textContent = 'Live Scoreboard'; break;
      case 'messages': renderMessaging(content); title.textContent = 'Messages'; break;
      default: renderClientDashboard(content); title.textContent = 'Dashboard';
    }
  }
}

// ===================== CLIENT DASHBOARD =====================
async function renderClientDashboard(container) {
  container.innerHTML = '<p>Loading...</p>';
  try {
    const now = new Date();
    const monthKey = clientAttendanceMonth;
    const weeklyLimit = userProfile.weeklySessions || 1;
    const totalSessions = weeklyLimit * 4;

    const attendanceRef = db.collection('attendance').doc(`${userProfile.uid}_${monthKey}`);
    const attendanceSnap = await attendanceRef.get();
    let sessions = Array(totalSessions).fill('none');
    if (attendanceSnap.exists) {
      const stored = attendanceSnap.data().sessions || [];
      sessions = stored.map(s => s === true ? 'attended' : s === false ? 'none' : s);
      while (sessions.length < totalSessions) sessions.push('none');
      if (sessions.length > totalSessions) sessions = sessions.slice(0, totalSessions);
    }
    const attendedCount = sessions.filter(s => s === 'attended').length;

    const bookingsSnap = await db.collection('bookings').where('userId', '==', userProfile.uid).get();
    const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const upcoming = bookings.filter(b => b.status === 'booked' && b.date >= now.toISOString().split('T')[0]);

    const reviewsSnap = await db.collection('reviews').where('userId', '==', userProfile.uid).get();
    const myReviews = reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pendingReviews = bookings.filter(b => b.status === 'attended' && !myReviews.some(r => r.bookingId === b.id));

    const annSnap = await db.collection('announcements').orderBy('createdAt', 'desc').limit(3).get();
    const announcements = annSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const currentMonth = now.toISOString().slice(0,7);
    const isPaid = userProfile.paidThroughMonth && userProfile.paidThroughMonth >= currentMonth;

    const progress = totalSessions > 0 ? Math.min(100, Math.round((attendedCount / totalSessions) * 100)) : 0;

    let attendanceGridHtml = '';
    for (let i = 0; i < totalSessions; i++) {
      const status = sessions[i];
      const color = status === 'attended' ? '#4CAF50' : status === 'booked' ? '#FFC107' : '#E0E0E0';
      const label = status === 'attended' ? '✓' : status === 'booked' ? 'B' : '-';
      attendanceGridHtml += `<div style="display:inline-block;width:30px;height:30px;border-radius:50%;background:${color};color:white;text-align:center;line-height:30px;margin:2px;font-weight:bold;">${label}</div>`;
    }

    let weeklyStripHtml = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-GH', { weekday: 'short' });
      const dateNum = d.getDate();
      const hasBooking = bookings.some(b => b.date === dateStr && b.status === 'booked');
      weeklyStripHtml += `
        <div class="weekly-day ${hasBooking ? 'booked' : ''}">
          <div style="font-weight:600;font-size:0.75rem;">${dayName}</div>
          <div style="font-size:1.2rem;font-weight:800;">${dateNum}</div>
          ${hasBooking ? '<div style="font-size:0.6rem;">Booked</div>' : ''}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="hero">
        <div>
          <h1>Welcome, ${escapeHtml(userProfile.username || userProfile.name)}</h1>
          <p>Rolider Sports Complex · Accra</p>
          <button class="btn-primary" onclick="navigateTo('booking')">Book a Session</button>
        </div>
      </div>

      <div class="card">
        <h3>Your Week</h3>
        <div class="weekly-strip">${weeklyStripHtml}</div>
      </div>

      ${!isPaid && userProfile.alertsEnabled ? `
        <div class="card" style="background:var(--ball);color:var(--black);">
          <h3>Payment Reminder</h3>
          <p>Your monthly fee of GHS ${getMonthlyFee(weeklyLimit)} is due. Please settle to continue booking future sessions.</p>
        </div>
      ` : ''}

      <div class="card">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn-outline" onclick="clientChangeMonth(-1)">◀ Prev</button>
          <input type="month" value="${monthKey}" onchange="clientSetMonthFromPicker(this.value)">
          <button class="btn-outline" onclick="clientChangeMonth(1)">Next ▶</button>
        </div>
      </div>

      ${pendingReviews.length > 0 ? `
        <div class="card" style="border-left:4px solid var(--ball);">
          <h3>Leave a Review</h3>
          <p>You have ${pendingReviews.length} session(s) awaiting review.</p>
          ${pendingReviews.map(b => `<button class="btn-outline" onclick="showReviewPrompt('${b.id}','${b.date}','${b.programType}')">Review ${escapeHtml(b.programType)} on ${formatDate(b.date)}</button>`).join('')}
        </div>
      ` : ''}

      <div class="card">
        <h3>Monthly Attendance (${monthKey})</h3>
        <p>${attendedCount} / ${totalSessions} sessions attended</p>
        <div style="background:var(--gray-200);border-radius:10px;height:12px;overflow:hidden;">
          <div style="width:${progress}%;background:var(--ball);height:100%;"></div>
        </div>
        <div style="margin-top:10px;">${attendanceGridHtml}</div>
        <p style="font-size:0.8rem;color:var(--gray-600);margin-top:8px;">Green = Attended, Yellow = Booked, Gray = Not Marked</p>
        <button class="btn-outline" onclick="exportMyAttendanceCSV('${monthKey}')">Download CSV</button>
      </div>

      <div class="grid-2">
        <button class="btn-primary" onclick="navigateTo('booking')">Book a Session</button>
        <button class="btn-outline" onclick="navigateTo('messages')">Message Coach</button>
      </div>

      <div class="card">
        <h3>Coach Announcements</h3>
        ${announcements.length === 0 ? '<p>No announcements yet.</p>' : announcements.map(a => `
          <div class="announcement-item">
            <h4>${escapeHtml(a.title)}</h4>
            <p>${escapeHtml(a.body)}</p>
            <small>${new Date(a.createdAt?.toDate()).toLocaleDateString()}</small>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <h3>My Reviews</h3>
        ${myReviews.length === 0 ? '<p>No reviews yet.</p>' : myReviews.map(r => `
          <div style="border-bottom:1px solid var(--gray-100);padding:8px 0;">
            <strong>${escapeHtml(r.programType || 'Session')}</strong> on ${formatDate(r.bookingDate || '')}
            <p>Rating: ${r.rating}/5</p>
            <p>${escapeHtml(r.comment || '')}</p>
            <small>${new Date(r.createdAt?.toDate()).toLocaleDateString()}</small>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <h3>Upcoming Sessions</h3>
        ${upcoming.length === 0 ? '<p>No upcoming sessions.</p>' : upcoming.map(b => `
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-100);">
            <div><strong>${escapeHtml(b.programType)}</strong><div>${formatDate(b.date)}</div></div>
            <span class="badge badge-green">${b.status}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    console.error('Dashboard error:', error);
    container.innerHTML = `<div class="card"><p>Error loading dashboard: ${error.message}</p></div>`;
  }
}

window.clientChangeMonth = function(delta) {
  const [year, month] = clientAttendanceMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  clientAttendanceMonth = d.toISOString().slice(0,7);
  renderCurrentScreen();
};

window.clientSetMonthFromPicker = function(value) {
  if (value) {
    clientAttendanceMonth = value;
    renderCurrentScreen();
  }
};

window.exportMyAttendanceCSV = async function(month) {
  const docId = `${userProfile.uid}_${month}`;
  const doc = await db.collection('attendance').doc(docId).get();
  const sessions = doc.exists ? doc.data().sessions || [] : [];
  const rows = [['Session', 'Status']];
  sessions.forEach((s, i) => rows.push([`Session ${i+1}`, s]));
  exportToCSV(`my_attendance_${month}.csv`, rows);
};

// ===================== BOOKING FORM =====================
async function renderBookingForm(container) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const currentMonth = now.toISOString().slice(0,7);
  const paidThroughMonth = userProfile.paidThroughMonth || '';
  const isPaid = paidThroughMonth >= currentMonth;

  let futureBookingsBeyondPaid = 0;
  if (!isPaid && paidThroughMonth) {
    const bookingsSnap = await db.collection('bookings')
      .where('userId', '==', userProfile.uid)
      .where('status', '!=', 'cancelled')
      .get();
    const bookings = bookingsSnap.docs.map(d => d.data());
    const paidMonth = paidThroughMonth + '-01';
    futureBookingsBeyondPaid = bookings.filter(b => b.date >= paidMonth).length;
  }

  const weeklyLimit = userProfile.weeklySessions || 1;
  const weekBookingsSnap = await db.collection('bookings').where('userId', '==', userProfile.uid).get();
  const weekBookings = weekBookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const activeWeekBookings = weekBookings.filter(b => (b.status === 'booked' || b.status === 'attended') && b.date >= weekStartStr);
  const weeklyCount = activeWeekBookings.length;

  let bookingRestrictionMsg = '';
  let canBook = true;
  if (!isPaid && paidThroughMonth && futureBookingsBeyondPaid >= 2) {
    bookingRestrictionMsg = '<p style="color:red;">You have reached the maximum of 2 future bookings without payment. Please settle your fees.</p>';
    canBook = false;
  } else if (weeklyCount >= weeklyLimit) {
    bookingRestrictionMsg = '<p style="color:red;">You have reached your weekly booking limit.</p>';
    canBook = false;
  }

  const datePickerHtml = generateDatePicker();

  container.innerHTML = `
    <div class="date-picker-container">
      <div class="date-picker-header">
        <h3>Tennis Action Now</h3>
        <div class="date-picker-nav">
          <button onclick="changeDatePickerWeek(-1)">◀</button>
          <button onclick="changeDatePickerWeek(1)">▶</button>
        </div>
      </div>
      <div class="date-picker-strip" id="datePickerStrip">
        ${datePickerHtml}
      </div>
    </div>

    <div class="card">
      <h3>Book a Session</h3>
      <p>Weekly bookings: ${weeklyCount} / ${weeklyLimit}</p>
      ${bookingRestrictionMsg}
      <form id="bookingForm">
        <label>Date</label>
        <input type="date" id="bookingDate" required min="${now.toISOString().split('T')[0]}" />
        <label>Program</label>
        <select id="programType">
          <option>Private Lesson</option>
          <option>Group Lesson</option>
          <option>Kids Training</option>
          <option>Cardio Tennis</option>
        </select>
        <button type="submit" class="btn-primary" ${canBook ? '' : 'disabled'}>Confirm Booking</button>
      </form>
    </div>
  `;

  document.querySelectorAll('.date-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.date-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const date = pill.dataset.date;
      selectedBookingDate = date;
      document.getElementById('bookingDate').value = date;
    });
  });

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('bookingDate').value;
    const program = document.getElementById('programType').value;
    if (!date) return alert('Please select a date.');

    if (!isPaid && paidThroughMonth) {
      const monthOfBooking = date.slice(0,7);
      if (monthOfBooking > paidThroughMonth) {
        const futureCount = await db.collection('bookings')
          .where('userId', '==', userProfile.uid)
          .where('date', '>=', paidThroughMonth + '-01')
          .where('status', '!=', 'cancelled')
          .get()
          .then(snap => snap.size);
        if (futureCount >= 2) {
          alert('You cannot book more than 2 sessions beyond your paid month. Please pay to continue.');
          return;
        }
      }
    }

    if (!confirm('Cancellation policy: Bookings must be made at least 48 hours in advance. Cancellations require 6 hours notice. Do you agree?')) {
      return;
    }

    try {
      const bookingRef = await db.collection('bookings').add({
        userId: userProfile.uid,
        clientName: userProfile.username || userProfile.name,
        programType: program,
        date,
        groupSession: program === 'Group Lesson',
        status: 'booked',
        manualEntry: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showUndoButton(async () => {
        await db.collection('bookings').doc(bookingRef.id).update({ status: 'cancelled' });
        alert('Booking undone.');
        renderCurrentScreen();
      });
      alert('Booking confirmed!');
      if (confirm('Would you like to leave a review now?')) {
        showReviewPrompt(bookingRef.id, date, program);
      } else {
        navigateTo('bookings');
      }
    } catch (error) { alert('Failed: ' + error.message); }
  });
}

function generateDatePicker() {
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = d.toLocaleDateString('en-GH', { weekday: 'short' });
    const dateNum = d.getDate();
    const dateStr = d.toISOString().split('T')[0];
    dates.push(`
      <div class="date-pill ${i === 0 ? 'active' : ''}" data-date="${dateStr}">
        <div class="day">${dayName}</div>
        <div class="date">${dateNum}</div>
        <div class="indicator"></div>
      </div>
    `);
  }
  return dates.join('');
}

window.changeDatePickerWeek = function(offset) {
  alert('Week navigation not implemented yet.');
};

// ===================== MY BOOKINGS =====================
async function renderMyBookings(container) {
  container.innerHTML = '<p>Loading...</p>';
  const snap = await db.collection('bookings').where('userId', '==', userProfile.uid).get();
  const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  bookings.sort((a,b) => b.date.localeCompare(a.date));
  container.innerHTML = bookings.length === 0 ? '<div class="card"><p>No bookings.</p></div>' : bookings.map(b => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;">
        <div><strong>${escapeHtml(b.programType)}</strong> ${b.groupSession ? '<span class="badge badge-blue">Group</span>' : ''} ${b.manualEntry ? '<span class="badge badge-yellow">Manual</span>' : ''}</div>
        <div>${formatDate(b.date)}</div>
      </div>
      <div style="text-align:right;"><span class="badge ${b.status==='booked'?'badge-green':b.status==='attended'?'badge-blue':'badge-red'}">${b.status}</span> ${b.status==='booked'?`<button class="btn-danger" onclick="cancelBooking('${b.id}')">Cancel</button>`:''}</div>
    </div>
  `).join('');
}

window.cancelBooking = async function(bookingId) {
  if (confirm('Cancel this booking?')) {
    await db.collection('bookings').doc(bookingId).update({ status: 'cancelled', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    showUndoButton(async () => {
      await db.collection('bookings').doc(bookingId).update({ status: 'booked' });
      alert('Cancellation undone.');
      renderCurrentScreen();
    });
    alert('Booking cancelled.');
    renderCurrentScreen();
  }
};

// ===================== ANNOUNCEMENTS =====================
async function renderAnnouncements(container) {
  container.innerHTML = '<p>Loading...</p>';
  const snap = await db.collection('announcements').orderBy('createdAt', 'desc').get();
  const announcements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  container.innerHTML = announcements.length === 0 ? '<div class="card"><p>No announcements.</p></div>' : announcements.map(a => `
    <div class="card"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.body)}</p><small>${new Date(a.createdAt?.toDate()).toLocaleString()}</small></div>
  `).join('');
}

// ===================== ALERTS =====================
async function renderAlerts(container) {
  container.innerHTML = '<p>Loading...</p>';
  try {
    const notifSnap = await db.collection('notifications')
      .where('sentTo', 'array-contains', userProfile.uid)
      .get();
    const notifications = notifSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    notifications.sort((a, b) => {
      const timeA = a.createdAt?.toDate?.() || new Date(0);
      const timeB = b.createdAt?.toDate?.() || new Date(0);
      return timeB - timeA;
    });
    container.innerHTML = notifications.length === 0
      ? '<div class="card"><p>No notifications.</p></div>'
      : notifications.map(n => {
          const isRead = n.readBy && n.readBy.includes(userProfile.uid);
          return `
            <div class="card" style="${isRead ? '' : 'border-left:4px solid var(--ball);'}">
              <h3>${escapeHtml(n.title)}</h3>
              <p>${escapeHtml(n.body)}</p>
              <small>${new Date(n.createdAt?.toDate()).toLocaleString()}</small>
              ${!isRead ? `<button class="btn-outline" onclick="markNotifRead('${n.id}')">Mark as read</button>` : ''}
            </div>
          `;
        }).join('');
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error loading notifications: ${error.message}</p></div>`;
  }
}

window.markNotifRead = async function(notifId) {
  const notifRef = db.collection('notifications').doc(notifId);
  const doc = await notifRef.get();
  if (doc.exists) {
    const readBy = doc.data().readBy || [];
    if (!readBy.includes(userProfile.uid)) {
      readBy.push(userProfile.uid);
      await notifRef.update({ readBy });
    }
  }
  renderAlerts(document.getElementById('mainContent'));
};

// ===================== RANKINGS & H2H =====================
async function renderRankings(container) {
  container.innerHTML = '<p>Loading...</p>';
  const usersSnap = await db.collection('users').where('role', '==', 'client').get();
  const allPlayers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => p.gender);
  
  const malePlayers = allPlayers.filter(p => p.gender === 'Male');
  const femalePlayers = allPlayers.filter(p => p.gender === 'Female');

  const combinedRanked = allPlayers
    .map(p => ({ ...p, effectivePoints: getDecayedPoints(p.points, p.lastActive) }))
    .sort((a,b) => b.effectivePoints - a.effectivePoints);

  const maleRanked = malePlayers.map(p => ({ ...p, effectivePoints: getDecayedPoints(p.points, p.lastActive) })).sort((a,b) => b.effectivePoints - a.effectivePoints);
  const femaleRanked = femalePlayers.map(p => ({ ...p, effectivePoints: getDecayedPoints(p.points, p.lastActive) })).sort((a,b) => b.effectivePoints - a.effectivePoints);

  const matchesSnap = await db.collection('matches').get();
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const h2hMap = {};
  allPlayers.forEach(p1 => {
    h2hMap[p1.uid] = {};
    allPlayers.forEach(p2 => {
      if (p1.uid !== p2.uid) h2hMap[p1.uid][p2.uid] = { wins: 0, losses: 0 };
    });
  });
  matches.forEach(m => {
    if (h2hMap[m.winnerId]?.[m.loserId]) h2hMap[m.winnerId][m.loserId].wins++;
    if (h2hMap[m.loserId]?.[m.winnerId]) h2hMap[m.loserId][m.winnerId].losses++;
  });

  container.innerHTML = `
    <div class="card" style="border-left:4px solid var(--ball);">
      <h3 style="color:var(--black); font-size:1.4rem;">🏆 DUKETENNIS Ranking (All)</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${combinedRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('')}
      </table>
      <button class="btn-outline" onclick="exportRankingsCSV('all')">Download CSV</button>
    </div>

    <div class="card">
      <h3>Men's Rankings</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${maleRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('') || '<tr><td colspan="4">No male players.</td></tr>'}
      </table>
      <button class="btn-outline" onclick="exportRankingsCSV('male')">Download CSV</button>
    </div>

    <div class="card">
      <h3>Women's Rankings</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${femaleRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('') || '<tr><td colspan="4">No female players.</td></tr>'}
      </table>
      <button class="btn-outline" onclick="exportRankingsCSV('female')">Download CSV</button>
    </div>

    <div class="card">
      <h3>My Head-to-Head Records</h3>
      <div style="margin-bottom:8px;">
        <input type="text" id="h2hSearchInput" placeholder="Search player..." oninput="searchH2H(this.value)">
      </div>
      <div id="h2hSearchResults"></div>
      <table>
        <tr><th>Opponent</th><th>Record</th></tr>
        ${allPlayers.filter(p => p.uid !== userProfile.uid).map(p => {
          const h2h = h2hMap[userProfile.uid]?.[p.uid] || { wins: 0, losses: 0 };
          return `<tr class="h2h-row" data-name="${(p.username || '').toLowerCase()}"><td>${escapeHtml(p.username || p.name)}</td><td>${h2h.wins} - ${h2h.losses}</td></tr>`;
        }).join('')}
      </table>
    </div>

    <div class="card">
      <h3>Compare Two Players</h3>
      <div style="display:flex;gap:8px;">
        <select id="comparePlayer1">
          <option value="">Select player 1</option>
          ${allPlayers.map(p => `<option value="${p.uid}">${escapeHtml(p.username || p.name)}</option>`).join('')}
        </select>
        <select id="comparePlayer2">
          <option value="">Select player 2</option>
          ${allPlayers.map(p => `<option value="${p.uid}">${escapeHtml(p.username || p.name)}</option>`).join('')}
        </select>
      </div>
      <div id="compareResult"></div>
    </div>
  `;

  window.h2hMapData = h2hMap;
  window.allPlayersData = allPlayers;

  function updateCompare() {
    const p1 = document.getElementById('comparePlayer1').value;
    const p2 = document.getElementById('comparePlayer2').value;
    const resultDiv = document.getElementById('compareResult');
    if (!p1 || !p2 || p1 === p2) {
      resultDiv.innerHTML = '<p>Select two different players.</p>';
      return;
    }
    const h2h = h2hMap[p1]?.[p2] || { wins: 0, losses: 0 };
    const name1 = allPlayers.find(p => p.uid === p1)?.username || 'Player1';
    const name2 = allPlayers.find(p => p.uid === p2)?.username || 'Player2';
    resultDiv.innerHTML = `
      <p><strong>${escapeHtml(name1)}</strong> vs <strong>${escapeHtml(name2)}</strong></p>
      <p>Record: ${h2h.wins} - ${h2h.losses}</p>
    `;
  }

  document.getElementById('comparePlayer1').addEventListener('change', updateCompare);
  document.getElementById('comparePlayer2').addEventListener('change', updateCompare);
}

window.searchH2H = function(query) {
  const rows = document.querySelectorAll('.h2h-row');
  query = query.toLowerCase();
  rows.forEach(row => {
    const name = row.dataset.name || '';
    row.style.display = name.includes(query) ? '' : 'none';
  });
};

window.exportRankingsCSV = async function(category) {
  const usersSnap = await db.collection('users').where('role', '==', 'client').get();
  const players = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => p.gender);
  let filtered = players;
  if (category === 'male') filtered = players.filter(p => p.gender === 'Male');
  if (category === 'female') filtered = players.filter(p => p.gender === 'Female');
  const ranked = filtered.map(p => ({ ...p, effectivePoints: getDecayedPoints(p.points, p.lastActive) }))
    .sort((a,b) => b.effectivePoints - a.effectivePoints);
  const rows = [['#', 'Player', 'Points', 'W/L']];
  ranked.forEach((p, i) => rows.push([i+1, p.username || p.name, p.effectivePoints, `${p.matchesWon}-${p.matchesLost}`]));
  exportToCSV('rankings.csv', rows);
};

// ===================== MESSAGING =====================
async function renderMessaging(container) {
  container.innerHTML = `
    <div class="messaging-sub-nav">
      <button class="messaging-sub-btn ${messagingTab === 'chats' ? 'active' : ''}" data-msgtab="chats">Chats</button>
      <button class="messaging-sub-btn ${messagingTab === 'groups' ? 'active' : ''}" data-msgtab="groups">Groups</button>
      <button class="messaging-sub-btn ${messagingTab === 'contacts' ? 'active' : ''}" data-msgtab="contacts">Contacts</button>
      <button class="messaging-sub-btn ${messagingTab === 'profile' ? 'active' : ''}" data-msgtab="profile">Profile</button>
    </div>
    <div id="messagingContent"></div>
  `;

  document.querySelectorAll('.messaging-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      messagingTab = btn.dataset.msgtab;
      renderMessaging(container);
    });
  });

  const subContainer = document.getElementById('messagingContent');
  switch (messagingTab) {
    case 'chats': renderChatsList(subContainer); break;
    case 'groups': renderGroupsList(subContainer); break;
    case 'contacts': renderContactsList(subContainer); break;
    case 'profile': renderProfile(subContainer); break;
    default: renderChatsList(subContainer);
  }
}

async function renderChatsList(container) {
  container.innerHTML = '<p>Loading chats...</p>';
  try {
    const usersSnap = await db.collection('users').get();
    allUsersCache = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const convSnap = await db.collection('conversations')
      .where('participants', 'array-contains', userProfile.uid)
      .get();
    const conversations = convSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = '';
    const generalConv = conversations.find(c => c.id === 'general');
    if (generalConv) {
      html += `<div class="card" style="cursor:pointer;" onclick="openConversation('general')">
        <strong>General Community</strong>
        <div>${generalConv.lastMessage || 'No messages'}</div>
      </div>`;
    } else {
      html += `<div class="card" style="cursor:pointer;" onclick="createGeneralChat()">
        <strong>General Community</strong>
        <div>Tap to create</div>
      </div>`;
    }

    const admins = allUsersCache.filter(u => ADMIN_EMAILS.includes(u.email));
    for (const admin of admins) {
      const coachConv = conversations.find(c => c.type === 'direct' && c.participants.includes(admin.uid));
      if (coachConv) {
        html += `<div class="card" style="cursor:pointer;" onclick="openConversation('${coachConv.id}')">
          <strong>Coach ${admin.username || admin.name}</strong>
          <div>${coachConv.lastMessage || 'No messages'}</div>
        </div>`;
      } else {
        html += `<div class="card" style="cursor:pointer;" onclick="startCoachChat('${admin.uid}')">
          <strong>Coach ${admin.username || admin.name}</strong>
          <div>Tap to message</div>
        </div>`;
      }
    }

    const otherDirectChats = conversations.filter(c => c.type === 'direct' && c.id !== 'general' && !admins.some(a => c.participants.includes(a.uid)));
    otherDirectChats.forEach(c => {
      const otherUid = c.participants.find(p => p !== userProfile.uid);
      const otherUser = allUsersCache.find(u => u.uid === otherUid);
      html += `<div class="card" style="cursor:pointer;" onclick="openConversation('${c.id}')">
        <strong>${otherUser?.username || 'Unknown'}</strong>
        <div>${c.lastMessage || 'No messages'}</div>
      </div>`;
    });

    html += `<button class="btn-outline" onclick="showNewDirect()">New Private Chat</button>`;

    container.innerHTML = html || '<p>No chats yet.</p>';
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

async function renderGroupsList(container) {
  container.innerHTML = '<p>Loading groups...</p>';
  try {
    const convSnap = await db.collection('conversations')
      .where('type', '==', 'group')
      .where('participants', 'array-contains', userProfile.uid)
      .get();
    const groups = convSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    container.innerHTML = groups.length === 0 ? '<div class="card"><p>No groups.</p></div>' :
      groups.map(g => `<div class="card" style="cursor:pointer;" onclick="openConversation('${g.id}')">
        <strong>Group</strong>
        <div>${g.lastMessage || 'No messages'}</div>
      </div>`).join('');
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

async function renderContactsList(container) {
  container.innerHTML = '<p>Loading contacts...</p>';
  try {
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.uid !== userProfile.uid);
    let html = '<div class="card"><h3>All Users</h3>';
    users.forEach(u => {
      html += `<div style="display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid var(--gray-100);">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--ball);display:flex;align-items:center;justify-content:center;font-weight:bold;">${u.username?.[0] || '?'}</div>
        <div style="flex:1;"><strong>${escapeHtml(u.username || u.name)}</strong><div style="font-size:0.8rem;color:var(--gray-600);">${u.role}</div></div>
        <button class="btn-outline" style="padding:4px 10px;" onclick="startDirectChat('${u.uid}')">Message</button>
      </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

async function renderProfile(container) {
  container.innerHTML = '<p>Loading profile...</p>';
  try {
    const userDoc = await db.collection('users').doc(userProfile.uid).get();
    const profile = userDoc.data() || userProfile;
    const profilePicUrl = profile.profilePic || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23ccc"/><text x="50" y="50" font-size="40" text-anchor="middle" dominant-baseline="central">👤</text></svg>';
    const coverUrl = profile.coverPic || '';

    container.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="profile-cover">
          ${coverUrl ? `<img src="${coverUrl}" alt="cover">` : ''}
        </div>
        <div style="padding:0 20px 20px;">
          <div class="profile-picture">
            <img src="${profilePicUrl}" alt="profile">
          </div>
          <h3 style="text-align:center;">${escapeHtml(profile.username || profile.name)}</h3>
          <p style="text-align:center;color:var(--gray-600);">${profile.role}</p>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <label class="btn-outline" style="flex:1;text-align:center;cursor:pointer;">
              Change Profile Picture
              <input type="file" accept="image/*" style="display:none;" onchange="updateProfilePic(this)">
            </label>
            <label class="btn-outline" style="flex:1;text-align:center;cursor:pointer;">
              Change Cover
              <input type="file" accept="image/*" style="display:none;" onchange="updateCoverPic(this)">
            </label>
          </div>
          <div style="margin-top:20px;">
            <h4>Contact Information</h4>
            <label>Phone (Primary)</label>
            <input type="tel" id="editPhone" value="${escapeHtml(profile.phone || '')}" placeholder="Enter primary phone">
            <label>Second Phone</label>
            <input type="tel" id="editSecondPhone" value="${escapeHtml(profile.secondPhone || '')}" placeholder="Enter second phone">
            <label>Emergency Contact</label>
            <input type="text" id="editEmergencyContact" value="${escapeHtml(profile.emergencyContact || '')}" placeholder="Enter emergency contact">
            <button class="btn-primary" onclick="saveContactInfo()">Save Contact Info</button>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

window.saveContactInfo = async function() {
  const phone = document.getElementById('editPhone').value.trim();
  const secondPhone = document.getElementById('editSecondPhone').value.trim();
  const emergencyContact = document.getElementById('editEmergencyContact').value.trim();
  try {
    const old = { phone: userProfile.phone, secondPhone: userProfile.secondPhone, emergencyContact: userProfile.emergencyContact };
    await db.collection('users').doc(userProfile.uid).update({
      phone, secondPhone, emergencyContact
    });
    userProfile.phone = phone;
    userProfile.secondPhone = secondPhone;
    userProfile.emergencyContact = emergencyContact;
    showUndoButton(async () => {
      await db.collection('users').doc(userProfile.uid).update(old);
      userProfile = { ...userProfile, ...old };
      alert('Contact info reverted.');
      renderProfile(document.getElementById('messagingContent'));
    });
    alert('Contact information saved.');
    renderProfile(document.getElementById('messagingContent'));
  } catch (error) {
    alert('Failed to save: ' + error.message);
  }
};

window.updateProfilePic = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const oldPic = userProfile.profilePic;
    try {
      await db.collection('users').doc(userProfile.uid).update({ profilePic: dataUrl });
      userProfile.profilePic = dataUrl;
      showUndoButton(async () => {
        await db.collection('users').doc(userProfile.uid).update({ profilePic: oldPic });
        userProfile.profilePic = oldPic;
        alert('Profile picture reverted.');
        renderProfile(document.getElementById('messagingContent'));
      });
      alert('Profile picture updated.');
      renderProfile(document.getElementById('messagingContent'));
    } catch (error) {
      alert('Update failed: ' + error.message);
    }
  };
  reader.readAsDataURL(file);
};

window.updateCoverPic = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const oldCover = userProfile.coverPic;
    try {
      await db.collection('users').doc(userProfile.uid).update({ coverPic: dataUrl });
      userProfile.coverPic = dataUrl;
      showUndoButton(async () => {
        await db.collection('users').doc(userProfile.uid).update({ coverPic: oldCover });
        userProfile.coverPic = oldCover;
        alert('Cover reverted.');
        renderProfile(document.getElementById('messagingContent'));
      });
      alert('Cover updated.');
      renderProfile(document.getElementById('messagingContent'));
    } catch (error) {
      alert('Update failed: ' + error.message);
    }
  };
  reader.readAsDataURL(file);
};

window.openConversation = function(convId) {
  currentConversationId = convId;
  renderChatArea(document.getElementById('messagingContent'));
};

window.startDirectChat = async function(otherUid) {
  const participants = [userProfile.uid, otherUid].sort();
  try {
    const existing = await db.collection('conversations')
      .where('participants', '==', participants)
      .where('type', '==', 'direct')
      .get();
    if (!existing.empty) {
      openConversation(existing.docs[0].id);
    } else {
      const convRef = await db.collection('conversations').add({
        participants,
        type: 'direct',
        lastMessage: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      openConversation(convRef.id);
    }
  } catch (error) { alert('Error: ' + error.message); }
};

window.startCoachChat = async function(adminUid) {
  await startDirectChat(adminUid);
};

window.createGeneralChat = async function() {
  try {
    await db.collection('conversations').doc('general').set({
      participants: [],
      type: 'general',
      lastMessage: '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    openConversation('general');
  } catch (error) { alert('Error: ' + error.message); }
};

window.showNewDirect = function() {
  const area = document.getElementById('messagingContent');
  area.innerHTML = `<div class="card"><h4>Start Direct</h4><select id="directUserSelect"><option>Select user...</option>${allUsersCache.filter(u=>u.uid!==userProfile.uid).map(u=>`<option value="${u.uid}">${escapeHtml(u.username||u.name)}</option>`).join('')}</select><button class="btn-primary" onclick="createDirectConversation()">Start</button></div>`;
};

window.createDirectConversation = async function() {
  const otherUid = document.getElementById('directUserSelect').value;
  if (!otherUid) return alert('Select a user');
  const participants = [userProfile.uid, otherUid].sort();
  try {
    const convRef = await db.collection('conversations').add({ participants, type:'direct', lastMessage:'', createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    openConversation(convRef.id);
  } catch (error) { alert('Failed: ' + error.message); }
};

function renderChatArea(container) {
  const convId = currentConversationId;
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">Chat</div>
      <div class="chat-messages" id="chatMessages">Loading...</div>
      <div class="chat-input">
        <input type="text" id="messageInput" placeholder="Type a message..." />
        <button class="btn-primary" id="sendMessageBtn" style="width:auto;">Send</button>
      </div>
    </div>
  `;

  const messagesDiv = document.getElementById('chatMessages');
  const messageInput = document.getElementById('messageInput');
  const messagesRef = db.collection('conversations').doc(convId).collection('messages');
  messagesRef.onSnapshot((snap) => {
    messagesDiv.innerHTML = '';
    if (snap.empty) { messagesDiv.innerHTML = '<p>No messages yet.</p>'; return; }
    const messages = [];
    snap.docs.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
    messages.sort((a,b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));
    messages.forEach(msg => {
      const sender = allUsersCache.find(u => u.uid === msg.senderId);
      const senderName = sender ? (sender.username || sender.name) : 'Unknown';
      const senderPic = sender?.profilePic || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23ccc"/><text x="50" y="50" font-size="40" text-anchor="middle" dominant-baseline="central">👤</text></svg>';
      const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : '';
      const div = document.createElement('div');
      div.className = `message ${msg.senderId === userProfile.uid ? 'sent' : 'received'}`;
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <img src="${senderPic}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
          <span style="font-weight:bold;font-size:0.75rem;">${escapeHtml(senderName)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
        <div class="meta"><span>${timeStr}</span></div>
      `;
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    try {
      const convRef = db.collection('conversations').doc(convId);
      const msgRef = await convRef.collection('messages').add({
        senderId: userProfile.uid,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await convRef.update({ lastMessage: text, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      showUndoButton(async () => {
        await msgRef.delete();
      });
      messageInput.value = '';
    } catch (error) { alert('Failed: ' + error.message); }
  }

  document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
}

window.deleteMessage = async function(convId, msgId) {
  if (confirm('Delete this message?')) await db.collection('conversations').doc(convId).collection('messages').doc(msgId).delete();
};

// ===================== REVIEW PROMPT =====================
window.showReviewPrompt = function(bookingId, date, programType) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:300;';
  modal.innerHTML = `
    <div class="card" style="max-width:400px;width:100%;">
      <h3>Review Session</h3>
      <p>${escapeHtml(programType)} on ${formatDate(date)}</p>
      <select id="reviewRating">
        <option value="5">5 - Excellent</option>
        <option value="4">4 - Good</option>
        <option value="3">3 - Average</option>
        <option value="2">2 - Poor</option>
        <option value="1">1 - Terrible</option>
      </select>
      <textarea id="reviewComment" rows="3" placeholder="Share your experience..."></textarea>
      <div>
        <button class="btn-primary" id="submitReviewBtn">Submit</button>
        <button class="btn-outline" id="cancelReviewBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('cancelReviewBtn').addEventListener('click', () => modal.remove());
  document.getElementById('submitReviewBtn').addEventListener('click', async () => {
    const rating = parseInt(document.getElementById('reviewRating').value);
    const comment = document.getElementById('reviewComment').value.trim();
    if (!rating) return;
    try {
      const reviewRef = await db.collection('reviews').add({
        bookingId, userId: userProfile.uid, rating, comment,
        programType, bookingDate: date,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showUndoButton(async () => {
        await reviewRef.delete();
        alert('Review undone.');
      });
      alert('Thank you for your review!');
      modal.remove();
      renderCurrentScreen();
    } catch (error) { alert('Failed: ' + error.message); }
  });
};

// ===================== ADMIN =====================
function renderAdmin() {
  const content = document.getElementById('mainContent');
  const title = document.getElementById('pageTitle');
  title.textContent = 'Coach Dashboard';
  content.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn active" data-admin-tab="bookings">Bookings</button>
      <button class="tab-btn" data-admin-tab="attendance">Attendance</button>
      <button class="tab-btn" data-admin-tab="announcements">Announcements</button>
      <button class="tab-btn" data-admin-tab="users">Users</button>
      <button class="tab-btn" data-admin-tab="rankings">Rankings</button>
      <button class="tab-btn" data-admin-tab="messages">Messages</button>
      <button class="tab-btn" data-admin-tab="reviews">Reviews</button>
      <button class="tab-btn" data-admin-tab="notifications">Notifications</button>
      <button class="tab-btn" data-admin-tab="billing">Billing</button>
      <button class="tab-btn" data-admin-tab="analytics">Analytics</button>
      <button class="tab-btn" data-admin-tab="live">Live Scoreboard</button>
    </div>
    <div id="adminContent"></div>
  `;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAdminTab(btn.dataset.adminTab);
    });
  });
  renderAdminTab('bookings');
}

async function renderAdminTab(tab) {
  const container = document.getElementById('adminContent');
  switch (tab) {
    case 'bookings': await renderAdminBookings(container); break;
    case 'attendance': await renderAdminAttendance(container); break;
    case 'announcements': await renderAdminAnnouncements(container); break;
    case 'users': await renderAdminUsers(container); break;
    case 'rankings': await renderAdminRankings(container); break;
    case 'messages': await renderAdminMessages(container); break;
    case 'reviews': await renderAdminReviews(container); break;
    case 'notifications': await renderAdminNotifications(container); break;
    case 'billing': await renderAdminBilling(container); break;
    case 'analytics': await renderAdminAnalytics(container); break;
    case 'live': await renderAdminLiveScoreboard(container); break;
  }
}

// ===================== LIVE SCOREBOARD (ADMIN) =====================
async function renderAdminLiveScoreboard(container) {
  container.innerHTML = `
    <div class="card live-admin-card">
      <h3>Create Live Match</h3>
      <button class="btn-primary" onclick="generateRoomCode()">Generate New Room</button>
      <div id="liveRoomDisplay" style="margin:10px 0;">
        ${liveRoomCode ? `<span class="live-room-code">${liveRoomCode}</span> <button class="btn-outline" onclick="copyRoomCode()">Copy</button>` : 'No room generated yet.'}
      </div>
      <hr style="margin:12px 0;">
      <label>Match Title</label>
      <input type="text" id="liveTitle" placeholder="e.g., Championship Final">
      <label>Subtitle</label>
      <input type="text" id="liveSubtitle" placeholder="e.g., Gentlemen's Singles">
      <label>Mode</label>
      <select id="liveMode" onchange="updateLiveMode()">
        <option value="singles">Singles</option>
        <option value="doubles">Doubles</option>
      </select>
      <div id="livePlayerInputs">
        <!-- Dynamic inputs based on mode -->
      </div>
      <button class="btn-primary" onclick="startLiveMatch()">Start Match</button>
    </div>
    <div id="liveAdminControls" style="display:none;">
      <!-- Live controls will appear here -->
    </div>
  `;

  updateLiveMode(); // initialize player inputs
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  liveRoomCode = code;
  document.getElementById('liveRoomDisplay').innerHTML = `<span class="live-room-code">${code}</span> <button class="btn-outline" onclick="copyRoomCode()">Copy</button>`;
  // Save to history
  const history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
  history.unshift(code);
  localStorage.setItem('roomHistory', JSON.stringify(history.slice(0,20)));
}

function copyRoomCode() {
  copyToClipboard(liveRoomCode);
}

function updateLiveMode() {
  const mode = document.getElementById('liveMode').value;
  const container = document.getElementById('livePlayerInputs');
  if (mode === 'singles') {
    container.innerHTML = `
      <label>Team 1 Player</label><input type="text" id="liveT1P1" placeholder="Player name">
      <label>Team 2 Player</label><input type="text" id="liveT2P1" placeholder="Player name">
    `;
  } else {
    container.innerHTML = `
      <label>Team 1 Player 1</label><input type="text" id="liveT1P1" placeholder="Player name">
      <label>Team 1 Player 2</label><input type="text" id="liveT1P2" placeholder="Partner name">
      <label>Team 2 Player 1</label><input type="text" id="liveT2P1" placeholder="Player name">
      <label>Team 2 Player 2</label><input type="text" id="liveT2P2" placeholder="Partner name">
    `;
  }
}

async function startLiveMatch() {
  if (!liveRoomCode) {
    alert('Generate a room code first.');
    return;
  }
  const title = document.getElementById('liveTitle').value.trim() || 'Live Match';
  const subtitle = document.getElementById('liveSubtitle').value.trim() || '';
  const mode = document.getElementById('liveMode').value;
  const t1p1 = document.getElementById('liveT1P1').value.trim() || 'Team 1';
  const t2p1 = document.getElementById('liveT2P1').value.trim() || 'Team 2';
  let t1p2 = '', t2p2 = '';
  if (mode === 'doubles') {
    t1p2 = document.getElementById('liveT1P2').value.trim() || 'Partner';
    t2p2 = document.getElementById('liveT2P2').value.trim() || 'Partner';
  }
  const initialState = {
    title,
    subtitle,
    mode,
    team1: { name: t1p1, partner: t1p2, points: 0, games: 0, sets: 0 },
    team2: { name: t2p1, partner: t2p2, points: 0, games: 0, sets: 0 },
    serving: 'team1',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('liveMatches').doc(liveRoomCode).set(initialState);
    // Subscribe to changes
    if (liveMatchListener) liveMatchListener();
    liveMatchListener = db.collection('liveMatches').doc(liveRoomCode)
      .onSnapshot((doc) => {
        if (doc.exists) {
          liveMatchData = doc.data();
          renderLiveAdminControls(document.getElementById('liveAdminControls'));
        }
      });
    document.getElementById('liveAdminControls').style.display = 'block';
    document.querySelector('.live-admin-card').style.display = 'none';
  } catch (error) {
    alert('Failed to start match: ' + error.message);
  }
}

function renderLiveAdminControls(container) {
  if (!liveMatchData) return;
  const d = liveMatchData;
  const pointsLabel = (points) => {
    const tennisPoints = ['Love', '15', '30', '40'];
    if (points < 4) return tennisPoints[points];
    if (d.team1.points === d.team2.points) return 'Deuce';
    return d.team1.points > d.team2.points ? 'AD' : '40';
  };
  container.innerHTML = `
    <div class="card">
      <h3>Live Controls - ${escapeHtml(d.title)}</h3>
      <div style="display:flex;gap:12px;justify-content:space-around;">
        <div>
          <h4>${escapeHtml(d.team1.name)}${d.team1.partner ? ' / ' + escapeHtml(d.team1.partner) : ''}</h4>
          <p>Points: ${pointsLabel(d.team1.points)}</p>
          <p>Games: ${d.team1.games}</p>
          <p>Sets: ${d.team1.sets}</p>
          <button class="btn-outline" onclick="updateLiveScore('team1', 'points', 1)">+ Point</button>
          <button class="btn-outline" onclick="updateLiveScore('team1', 'games', 1)">+ Game</button>
          <button class="btn-outline" onclick="updateLiveScore('team1', 'sets', 1)">+ Set</button>
        </div>
        <div>
          <h4>${escapeHtml(d.team2.name)}${d.team2.partner ? ' / ' + escapeHtml(d.team2.partner) : ''}</h4>
          <p>Points: ${pointsLabel(d.team2.points)}</p>
          <p>Games: ${d.team2.games}</p>
          <p>Sets: ${d.team2.sets}</p>
          <button class="btn-outline" onclick="updateLiveScore('team2', 'points', 1)">+ Point</button>
          <button class="btn-outline" onclick="updateLiveScore('team2', 'games', 1)">+ Game</button>
          <button class="btn-outline" onclick="updateLiveScore('team2', 'sets', 1)">+ Set</button>
        </div>
      </div>
      <div style="margin-top:12px;">
        <label>Serving</label>
        <select onchange="updateServing(this.value)">
          <option value="team1" ${d.serving === 'team1' ? 'selected' : ''}>${escapeHtml(d.team1.name)}</option>
          <option value="team2" ${d.serving === 'team2' ? 'selected' : ''}>${escapeHtml(d.team2.name)}</option>
        </select>
        <button class="btn-danger" onclick="endLiveMatch()">End Match</button>
      </div>
    </div>
  `;
}

window.updateLiveScore = async function(team, field, delta) {
  if (!liveMatchData) return;
  const updateObj = {};
  updateObj[`${team}.${field}`] = firebase.firestore.FieldValue.increment(delta);
  await db.collection('liveMatches').doc(liveRoomCode).update(updateObj);
};

window.updateServing = async function(value) {
  await db.collection('liveMatches').doc(liveRoomCode).update({ serving: value });
};

window.endLiveMatch = async function() {
  if (confirm('End match and delete room?')) {
    await db.collection('liveMatches').doc(liveRoomCode).delete();
    if (liveMatchListener) liveMatchListener();
    liveMatchListener = null;
    liveMatchData = null;
    liveRoomCode = null;
    renderAdminTab('live');
  }
};

// ===================== LIVE SCOREBOARD (VIEWER / CLIENT) =====================
async function renderLiveScreen(container) {
  container.innerHTML = `
    <div class="card">
      <h3>Join Live Match</h3>
      <p>Enter the 6-character room code provided by the coach.</p>
      <input type="text" id="joinRoomCode" maxlength="6" placeholder="e.g., ABC123" style="text-transform:uppercase;">
      <button class="btn-primary" onclick="joinLiveRoom()">Join</button>
    </div>
    <div id="viewerScoreboard"></div>
  `;
}

window.joinLiveRoom = function() {
  const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
  if (code.length !== 6) {
    alert('Please enter a 6-character code.');
    return;
  }
  // Check if room exists
  db.collection('liveMatches').doc(code).get().then((doc) => {
    if (doc.exists) {
      liveRoomCode = code;
      liveRole = 'viewer';
      if (liveMatchListener) liveMatchListener();
      liveMatchListener = db.collection('liveMatches').doc(code)
        .onSnapshot((snap) => {
          if (snap.exists) {
            liveMatchData = snap.data();
            renderViewerScoreboard(document.getElementById('viewerScoreboard'));
          } else {
            // Room deleted
            document.getElementById('viewerScoreboard').innerHTML = '<p>Match ended.</p>';
            if (liveMatchListener) liveMatchListener();
            liveMatchListener = null;
            liveRoomCode = null;
            liveMatchData = null;
          }
        });
    } else {
      alert('Room not found.');
    }
  }).catch((error) => {
    alert('Error joining room: ' + error.message);
  });
};

function renderViewerScoreboard(container) {
  if (!liveMatchData) return;
  const d = liveMatchData;
  const pointsLabel = (points) => {
    const tennisPoints = ['Love', '15', '30', '40'];
    if (points < 4) return tennisPoints[points];
    if (d.team1.points === d.team2.points) return 'Deuce';
    return d.team1.points > d.team2.points ? 'AD' : '40';
  };
  container.innerHTML = `
    <div class="live-scoreboard">
      <div style="text-align:center;margin-bottom:15px;">
        <h2>${escapeHtml(d.title)}</h2>
        ${d.subtitle ? `<p>${escapeHtml(d.subtitle)}</p>` : ''}
      </div>
      <div class="team">
        <div>
          <div class="team-name">${escapeHtml(d.team1.name)}${d.team1.partner ? ' / ' + escapeHtml(d.team1.partner) : ''}</div>
          ${d.serving === 'team1' ? '<span class="serving-badge">SERVING</span>' : ''}
        </div>
        <div class="team-score">${pointsLabel(d.team1.points)}</div>
      </div>
      <div class="team">
        <div>
          <div class="team-name">${escapeHtml(d.team2.name)}${d.team2.partner ? ' / ' + escapeHtml(d.team2.partner) : ''}</div>
          ${d.serving === 'team2' ? '<span class="serving-badge">SERVING</span>' : ''}
        </div>
        <div class="team-score">${pointsLabel(d.team2.points)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:20px;">
        <div>
          Games: ${d.team1.games}
          <br>Sets: ${d.team1.sets}
        </div>
        <div>
          Games: ${d.team2.games}
          <br>Sets: ${d.team2.sets}
        </div>
      </div>
    </div>
    <button class="btn-danger" onclick="leaveLiveRoom()">Leave Room</button>
  `;
  // Vibration on set win (if supported)
  if (navigator.vibrate) navigator.vibrate(200);
}

window.leaveLiveRoom = function() {
  if (liveMatchListener) liveMatchListener();
  liveMatchListener = null;
  liveRoomCode = null;
  liveMatchData = null;
  renderLiveScreen(document.getElementById('mainContent'));
};

// ===================== ADMIN MESSAGES =====================
async function renderAdminMessages(container) {
  container.innerHTML = '<div class="card"><p>Loading...</p></div>';
  const usersSnap = await db.collection('users').get();
  allUsersCache = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const convSnap = await db.collection('conversations').get();
  const conversations = convSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  container.innerHTML = `
    <div class="card">
      <h3>All Conversations</h3>
      ${conversations.map(c => {
        let displayName = c.id==='general' ? 'General Chat' : c.participants.map(pid => allUsersCache.find(u=>u.uid===pid)?.username || 'Unknown').join(', ');
        return `<div class="card" style="cursor:pointer;" onclick="adminOpenConversation('${c.id}')"><strong>${escapeHtml(displayName)}</strong><div>${c.lastMessage||'No messages'}</div><button class="btn-danger" onclick="deleteConversation('${c.id}')">Delete Thread</button></div>`;
      }).join('') || '<p>No conversations.</p>'}
    </div>
    <div id="adminChatArea"></div>
  `;
}
window.deleteConversation = async function(convId) {
  if (!confirm('Delete entire conversation? This removes all messages.')) return;
  const batch = db.batch();
  const messagesRef = db.collection('conversations').doc(convId).collection('messages');
  const snapshot = await messagesRef.get();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection('conversations').doc(convId));
  await batch.commit();
  alert('Conversation deleted.');
  renderAdminTab('messages');
};
window.adminOpenConversation = function(convId) {
  currentConversationId = convId;
  const chatArea = document.getElementById('adminChatArea');
  chatArea.innerHTML = `<div class="chat-container"><div class="chat-header">Chat</div><div class="chat-messages" id="adminChatMessages">Loading...</div><div class="chat-input"><input id="adminMessageInput" placeholder="Type..."><button class="btn-primary" id="adminSendMessageBtn">Send</button></div></div>`;
  const messagesDiv = document.getElementById('adminChatMessages');
  const messageInput = document.getElementById('adminMessageInput');
  const messagesRef = db.collection('conversations').doc(convId).collection('messages');
  messagesRef.onSnapshot((snap) => {
    messagesDiv.innerHTML = '';
    if (snap.empty) { messagesDiv.innerHTML = '<p>No messages yet.</p>'; return; }
    const messages = [];
    snap.docs.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
    messages.sort((a,b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));
    messages.forEach(msg => {
      const sender = allUsersCache.find(u => u.uid === msg.senderId);
      const senderName = sender ? (sender.username || sender.name) : 'Unknown';
      const senderPic = sender?.profilePic || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23ccc"/><text x="50" y="50" font-size="40" text-anchor="middle" dominant-baseline="central">👤</text></svg>';
      const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : '';
      const div = document.createElement('div');
      div.className = `message ${msg.senderId === currentUser.uid ? 'sent' : 'received'}`;
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <img src="${senderPic}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
          <span style="font-weight:bold;font-size:0.75rem;">${escapeHtml(senderName)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
        <div class="meta"><span>${timeStr}</span><button class="btn-danger" onclick="deleteMessage('${convId}','${msg.id}')">Delete</button></div>
      `;
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    const convRef = db.collection('conversations').doc(convId);
    const msgRef = await convRef.collection('messages').add({ senderId: currentUser.uid, text, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await convRef.update({ lastMessage: text, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    showUndoButton(async () => {
      await msgRef.delete();
    });
    messageInput.value = '';
  }
  document.getElementById('adminSendMessageBtn').addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => { if (e.key==='Enter') sendMessage(); });
};

// ===================== INITIALIZATION =====================
document.getElementById('appScreen').style.display = 'none';
document.getElementById('bottomNav').style.display = 'none';
hideOnboarding();

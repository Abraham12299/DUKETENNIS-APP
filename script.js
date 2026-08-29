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

// EmailJS configuration – replace with your own keys
const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
const EMAILJS_PUBLIC_KEY = 'ZYUhrEZYAlfaAgGQh'; // <-- Your Public Key

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ===================== GLOBAL STATE =====================
let currentUser = null;
let userProfile = null;
let currentScreen = 'dashboard';
let currentConversationId = null;
let allUsersCache = [];
let currentAttendanceMonth = new Date().toISOString().slice(0,7);
let clientAttendanceMonth = new Date().toISOString().slice(0,7);
let messagingTab = 'chats';

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

// ===================== GOOGLE SIGN-IN =====================
document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error('Google sign-in error:', error);
    alert('Google sign-in failed: ' + error.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await auth.signOut();
});

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    try {
      await ensureUserProfile(user);
      if (!userProfile.gender || !userProfile.username || userProfile.username.trim() === '') {
        showOnboarding();
      } else {
        hideOnboarding();
      }
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appScreen').style.display = 'block';
      document.getElementById('bottomNav').style.display = 'flex';
      renderCurrentScreen();
    } catch (error) {
      console.error('Profile loading error:', error);
      alert('Error loading profile: ' + error.message);
      auth.signOut();
    }
  } else {
    currentUser = null;
    userProfile = null;
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'none';
    hideOnboarding();
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
      uid: user.uid,
      email: user.email || '',
      name: user.displayName || 'Tennis Player',
      role: isAdmin ? 'admin' : 'client',
      skillCategory: 'Beginner',
      weeklySessions: 1,
      points: 0,
      matchesWon: 0,
      matchesLost: 0,
      username: '',
      gender: '',
      alertsEnabled: true,
      paidThroughMonth: '',
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
  const errorEl = document.getElementById('usernameError');
  errorEl.textContent = '';
  if (!gender) { errorEl.textContent = 'Please select your gender.'; return; }
  if (!username) { errorEl.textContent = 'Username cannot be empty.'; return; }
  const q = await db.collection('users').where('username', '==', username).get();
  if (!q.empty && q.docs[0].id !== userProfile.uid) {
    errorEl.textContent = 'Username already taken. Please choose another.';
    return;
  }
  await db.collection('users').doc(userProfile.uid).update({ username, gender });
  userProfile.username = username;
  userProfile.gender = gender;
  hideOnboarding();
  renderCurrentScreen();
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
    const reviewedIds = new Set(reviewsSnap.docs.map(d => d.data().bookingId));
    const pendingReviews = bookings.filter(b => b.status === 'attended' && !reviewedIds.has(b.id));

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

    container.innerHTML = `
      <div class="hero">
        <div>
          <h1>Welcome, ${escapeHtml(userProfile.username || userProfile.name)}</h1>
          <p>Rolider Sports Complex · Accra</p>
          <button class="btn-primary" onclick="navigateTo('booking')">Book a Session</button>
        </div>
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

// Fee calculator
function getMonthlyFee(weeklySessions) {
  if (weeklySessions === 1) return 700;
  if (weeklySessions === 2) return 1200;
  if (weeklySessions === 3) return 1500;
  return 0;
}

// ===================== BOOKING FORM with Date Picker =====================
let selectedBookingDate = null; // stores selected date from horizontal picker

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

  // Generate horizontal date picker (7 days from today)
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

  // Attach click events to date pills
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
      alert('Booking confirmed!');
      if (confirm('Would you like to leave a review now?')) {
        showReviewPrompt(bookingRef.id, date, program);
      } else {
        navigateTo('bookings');
      }
    } catch (error) { alert('Failed: ' + error.message); }
  });
}

// Helper to generate 7 date pills
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
  // Not fully implemented – would shift the 7-day window
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
      <h3 style="color:var(--black); font-size:1.4rem;">🏆 ATP Rankings (All)</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${combinedRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('')}
      </table>
    </div>

    <div class="card">
      <h3>Men's Rankings</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${maleRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('') || '<tr><td colspan="4">No male players.</td></tr>'}
      </table>
    </div>

    <div class="card">
      <h3>Women's Rankings</h3>
      <table>
        <tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>
        ${femaleRanked.map((p,i) => `<tr><td>${i+1}</td><td>${escapeHtml(p.username || p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('') || '<tr><td colspan="4">No female players.</td></tr>'}
      </table>
    </div>

    <div class="card">
      <h3>My Head-to-Head Records</h3>
      <table>
        <tr><th>Opponent</th><th>Record</th></tr>
        ${allPlayers.filter(p => p.uid !== userProfile.uid).map(p => {
          const h2h = h2hMap[userProfile.uid]?.[p.uid] || { wins: 0, losses: 0 };
          return `<tr><td>${escapeHtml(p.username || p.name)}</td><td>${h2h.wins} - ${h2h.losses}</td></tr>`;
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

    const adminUser = allUsersCache.find(u => ADMIN_EMAILS.includes(u.email));
    if (adminUser) {
      const coachConv = conversations.find(c => c.type === 'direct' && c.participants.includes(adminUser.uid));
      if (coachConv) {
        html += `<div class="card" style="cursor:pointer;" onclick="openConversation('${coachConv.id}')">
          <strong>Coach ${adminUser.username || adminUser.name}</strong>
          <div>${coachConv.lastMessage || 'No messages'}</div>
        </div>`;
      } else {
        html += `<div class="card" style="cursor:pointer;" onclick="startCoachChat('${adminUser.uid}')">
          <strong>Coach ${adminUser.username || adminUser.name}</strong>
          <div>Tap to message</div>
        </div>`;
      }
    }

    const otherDirectChats = conversations.filter(c => c.type === 'direct' && c.id !== 'general' && !(adminUser && c.participants.includes(adminUser.uid)));
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
    const profilePicUrl = profile.profilePic || 'default-avatar.png';
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
              <input type="file" accept="image/*" style="display:none;" onchange="uploadProfilePic(this)">
            </label>
            <label class="btn-outline" style="flex:1;text-align:center;cursor:pointer;">
              Change Cover
              <input type="file" accept="image/*" style="display:none;" onchange="uploadCoverPic(this)">
            </label>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

window.uploadProfilePic = async function(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const storageRef = storage.ref(`profile_pics/${userProfile.uid}`);
    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();
    await db.collection('users').doc(userProfile.uid).update({ profilePic: url });
    userProfile.profilePic = url;
    alert('Profile picture updated.');
    renderProfile(document.getElementById('messagingContent'));
  } catch (error) {
    alert('Upload failed: ' + error.message);
  }
};

window.uploadCoverPic = async function(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const storageRef = storage.ref(`cover_pics/${userProfile.uid}`);
    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();
    await db.collection('users').doc(userProfile.uid).update({ coverPic: url });
    userProfile.coverPic = url;
    alert('Cover updated.');
    renderProfile(document.getElementById('messagingContent'));
  } catch (error) {
    alert('Upload failed: ' + error.message);
  }
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
      const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : '';
      const div = document.createElement('div');
      div.className = `message ${msg.senderId === userProfile.uid ? 'sent' : 'received'}`;
      div.innerHTML = `<div style="font-weight:bold;font-size:0.75rem;">${escapeHtml(senderName)}</div><div>${escapeHtml(msg.text)}</div><div class="meta"><span>${timeStr}</span></div>`;
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    try {
      const convRef = db.collection('conversations').doc(convId);
      await convRef.collection('messages').add({
        senderId: userProfile.uid,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await convRef.update({ lastMessage: text, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
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
      await db.collection('reviews').add({
        bookingId, userId: userProfile.uid, rating, comment,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
  }
}

// ===================== ADMIN BOOKINGS =====================
async function renderAdminBookings(container) {
  container.innerHTML = '<p>Loading...</p>';
  const snap = await db.collection('bookings').get();
  const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  bookings.sort((a,b) => b.date.localeCompare(a.date));
  container.innerHTML = `
    <div class="card">
      <h3>All Bookings</h3>
      ${bookings.map(b => `
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-100);">
          <div><strong>${escapeHtml(b.clientName)}</strong> · ${escapeHtml(b.programType)} ${b.groupSession?'<span class="badge badge-blue">Group</span>':''} ${b.manualEntry?'<span class="badge badge-yellow">Manual</span>':''} <div>${formatDate(b.date)}</div></div>
          <div><span class="badge ${b.status==='booked'?'badge-green':b.status==='attended'?'badge-blue':'badge-red'}">${b.status}</span> ${b.status==='booked'?`<button class="btn-outline" onclick="markAttended('${b.id}')">Attended</button>`:''}</div>
        </div>
      `).join('') || '<p>No bookings.</p>'}
    </div>
  `;
}

window.markAttended = async function(bookingId) {
  await db.collection('bookings').doc(bookingId).update({ status:'attended', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  alert('Marked attended.');
  renderAdminTab('bookings');
};

// ===================== ADMIN ATTENDANCE =====================
async function renderAdminAttendance(container) {
  container.innerHTML = '<p>Loading...</p>';
  const month = currentAttendanceMonth;
  const clientsSnap = await db.collection('users').where('role', '==', 'client').get();
  const clients = clientsSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const attSnap = await db.collection('attendance').where('month', '==', month).get();
  const attendanceMap = {};
  attSnap.docs.forEach(d => attendanceMap[d.data().userId] = { id: d.id, sessions: d.data().sessions || [] });

  const maxSessions = Math.max(...clients.map(c => (c.weeklySessions || 1) * 4), 4);
  let tableHtml = `<table><tr><th>Client</th>${Array.from({length:maxSessions}, (_,i)=>`<th>S${i+1}</th>`).join('')}</tr>`;
  clients.forEach(client => {
    const totalSlots = (client.weeklySessions || 1) * 4;
    const record = attendanceMap[client.uid] || { sessions: Array(totalSlots).fill('none') };
    while (record.sessions.length < totalSlots) record.sessions.push('none');
    if (record.sessions.length > totalSlots) record.sessions = record.sessions.slice(0, totalSlots);
    
    tableHtml += `<tr><td>${escapeHtml(client.username || client.name)}</td>`;
    for (let i = 0; i < maxSessions; i++) {
      if (i < totalSlots) {
        const val = record.sessions[i] === 'attended' || record.sessions[i] === true ? 'attended' : (record.sessions[i] === 'booked' ? 'booked' : 'none');
        const bgColor = val === 'attended' ? '#4CAF50' : val === 'booked' ? '#FFC107' : '#E0E0E0';
        const label = val === 'attended' ? '✓' : val === 'booked' ? 'B' : '-';
        tableHtml += `<td class="attendance-cell" style="text-align:center;">
          <button class="attendance-btn" style="background:${bgColor};color:white;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;" data-user="${client.uid}" data-month="${month}" data-index="${i}" data-val="${val}">${label}</button>
        </td>`;
      } else {
        tableHtml += `<td></td>`;
      }
    }
    tableHtml += `</tr>`;
  });
  tableHtml += `</table>`;

  container.innerHTML = `
    <div class="card">
      <h3>Attendance for ${month}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <button class="btn-outline" onclick="changeMonth(-1)">◀ Prev</button>
        <input type="month" id="monthPicker" value="${month}" onchange="setMonthFromPicker(this.value)">
        <button class="btn-outline" onclick="changeMonth(1)">Next ▶</button>
        <button class="btn-outline" onclick="deleteCurrentMonth()">Delete Month</button>
        <button class="btn-outline" onclick="manualAttendance()">Add Manual Attendance</button>
        <button class="btn-outline" onclick="copyClientAttendance()">Copy Client Attendance</button>
        <button class="btn-outline" onclick="copyAllAttendance()">Copy All Attendance</button>
      </div>
      ${tableHtml}
      <p style="font-size:0.8rem;color:var(--gray-400);">Click a circle to toggle: Green = Attended, Yellow = Booked, Gray = None.</p>
    </div>
  `;

  document.querySelectorAll('.attendance-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = btn.dataset.user;
      const month = btn.dataset.month;
      const index = parseInt(btn.dataset.index);
      const currentVal = btn.dataset.val;
      const cycle = { 'none': 'booked', 'booked': 'attended', 'attended': 'none' };
      const nextVal = cycle[currentVal];
      await updateAttendance(userId, month, index, nextVal);
      renderAdminTab('attendance');
    });
  });
}

async function updateAttendance(userId, month, index, value) {
  const docId = `${userId}_${month}`;
  const attRef = db.collection('attendance').doc(docId);
  const doc = await attRef.get();
  if (doc.exists) {
    const sessions = doc.data().sessions || [];
    while (sessions.length <= index) sessions.push('none');
    sessions[index] = value;
    await attRef.update({ sessions });
  } else {
    const userDoc = await db.collection('users').doc(userId).get();
    const weeklySessions = userDoc.data().weeklySessions || 1;
    const totalSlots = weeklySessions * 4;
    const sessions = Array(totalSlots).fill('none');
    sessions[index] = value;
    await attRef.set({ userId, month, sessions });
  }
}

window.changeMonth = function(delta) {
  const [year, month] = currentAttendanceMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  currentAttendanceMonth = d.toISOString().slice(0,7);
  renderAdminTab('attendance');
};

window.setMonthFromPicker = function(value) {
  if (value) {
    currentAttendanceMonth = value;
    renderAdminTab('attendance');
  }
};

window.deleteCurrentMonth = async function() {
  if (!confirm(`Delete all attendance records for ${currentAttendanceMonth}?`)) return;
  const batch = db.batch();
  const snapshot = await db.collection('attendance').where('month', '==', currentAttendanceMonth).get();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  alert('Month deleted.');
  renderAdminTab('attendance');
};

// Manual attendance
window.manualAttendance = function() {
  const container = document.getElementById('adminContent');
  db.collection('users').get().then(snap => {
    allUsersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    container.innerHTML = `
      <div class="card">
        <h3>Manual Attendance</h3>
        <form id="manualAttendanceForm">
          <label>Client</label>
          <select id="manualClientSelect" required><option>Select client...</option>${allUsersCache.filter(u=>u.role==='client').map(u=>`<option value="${u.uid}">${escapeHtml(u.username||u.name)}</option>`).join('')}</select>
          <label>Date</label><input type="date" id="manualDate" required />
          <label>Program</label><select id="manualProgram"><option>Private Lesson</option><option>Group Lesson</option><option>Kids Training</option><option>Cardio Tennis</option></select>
          <button type="submit" class="btn-primary">Mark Attendance</button>
        </form>
      </div>
    `;
    document.getElementById('manualAttendanceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('manualClientSelect').value;
      const date = document.getElementById('manualDate').value;
      const program = document.getElementById('manualProgram').value;
      if (!userId || !date) return alert('Please fill all fields.');
      const user = allUsersCache.find(u => u.uid === userId);
      await db.collection('bookings').add({
        userId, clientName: user.username || user.name, programType: program, date,
        groupSession: program === 'Group Lesson', status: 'attended', manualEntry: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert('Manual attendance recorded.');
      renderAdminTab('attendance');
    });
  });
};

// ===================== COPY ATTENDANCE =====================
window.copyClientAttendance = function() {
  const month = currentAttendanceMonth;
  db.collection('users').where('role', '==', 'client').get().then(snap => {
    const clients = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const select = document.createElement('select');
    select.innerHTML = '<option value="">Select client</option>' + clients.map(c => `<option value="${c.uid}">${escapeHtml(c.username || c.name)}</option>`).join('');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:300;';
    modal.innerHTML = `<div class="card" style="max-width:400px;width:100%;"><h3>Copy Client Attendance</h3>${select.outerHTML}<button class="btn-primary" id="confirmCopyClient">Copy</button></div>`;
    document.body.appendChild(modal);
    document.getElementById('confirmCopyClient').addEventListener('click', async () => {
      const clientId = modal.querySelector('select').value;
      if (!clientId) return alert('Select a client');
      const attRef = db.collection('attendance').doc(`${clientId}_${month}`);
      const doc = await attRef.get();
      let sessions = [];
      if (doc.exists) sessions = doc.data().sessions || [];
      const client = clients.find(c => c.uid === clientId);
      const text = `Attendance for ${client.username || client.name} (${month}):\n` +
        sessions.map((s, i) => `Session ${i+1}: ${s}`).join('\n');
      navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
      modal.remove();
    });
  });
};

window.copyAllAttendance = async function() {
  const month = currentAttendanceMonth;
  const clientsSnap = await db.collection('users').where('role', '==', 'client').get();
  const clients = clientsSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const attSnap = await db.collection('attendance').where('month', '==', month).get();
  const attendanceMap = {};
  attSnap.docs.forEach(d => attendanceMap[d.data().userId] = d.data().sessions || []);
  const lines = [`Attendance for ${month}:`];
  clients.forEach(c => {
    const sessions = attendanceMap[c.uid] || [];
    const str = `${c.username || c.name}: ` + sessions.map(s => s === 'attended' ? 'A' : s === 'booked' ? 'B' : '-').join(', ');
    lines.push(str);
  });
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => alert('All attendance copied!'));
};

// ===================== ADMIN ANNOUNCEMENTS =====================
async function renderAdminAnnouncements(container) {
  container.innerHTML = `
    <div class="card">
      <h3>Post Announcement</h3>
      <form id="announcementForm"><label>Title</label><input id="annTitle"><label>Message</label><textarea id="annBody" rows="4"></textarea><button class="btn-primary">Post</button></form>
    </div>
    <div id="announcementList"></div>
  `;
  document.getElementById('announcementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('annTitle').value.trim();
    const body = document.getElementById('annBody').value.trim();
    if (!title || !body) return;
    await db.collection('announcements').add({ coachId: currentUser.uid, title, body, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    alert('Posted!');
    renderAdminTab('announcements');
  });
  const annSnap = await db.collection('announcements').orderBy('createdAt','desc').get();
  const anns = annSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById('announcementList').innerHTML = anns.length === 0 ? '<p>No announcements.</p>' : anns.map(a => `<div class="card"><h4>${escapeHtml(a.title)}</h4><p>${escapeHtml(a.body)}</p><small>${new Date(a.createdAt?.toDate()).toLocaleString()}</small><button class="btn-danger" onclick="deleteAnnouncement('${a.id}')">Delete</button></div>`).join('');
}
window.deleteAnnouncement = async function(id) { if (confirm('Delete?')) { await db.collection('announcements').doc(id).delete(); renderAdminTab('announcements'); } };

// ===================== ADMIN USERS =====================
async function renderAdminUsers(container) {
  container.innerHTML = '<p>Loading...</p>';
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  container.innerHTML = `
    <div class="card">
      <h3>Add New User</h3>
      <form id="addUserForm">
        <label>Name</label><input id="newUserName" required>
        <label>Email</label><input type="email" id="newUserEmail" required>
        <label>Password</label><input type="password" id="newUserPassword" required minlength="6">
        <label>Role</label><select id="newUserRole"><option value="client">Client</option><option value="admin">Admin</option></select>
        <label>Gender</label><select id="newUserGender"><option value="Male">Male</option><option value="Female">Female</option></select>
        <button type="submit" class="btn-primary">Create User</button>
      </form>
    </div>
    <div class="card">
      <h3>All Users</h3>
      <table><tr><th>Username</th><th>Name</th><th>Role</th><th>Gender</th><th>Weekly Sessions</th><th>Action</th></tr>
        ${users.map(u => `<tr>
          <td>${escapeHtml(u.username||'Not set')}</td>
          <td>${escapeHtml(u.name)}</td>
          <td><select onchange="updateUserRole('${u.uid}', this.value)"><option value="client" ${u.role==='client'?'selected':''}>Client</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></td>
          <td><select onchange="updateUserGender('${u.uid}', this.value)"><option value="Male" ${u.gender==='Male'?'selected':''}>Male</option><option value="Female" ${u.gender==='Female'?'selected':''}>Female</option></select></td>
          <td><select onchange="updateWeeklySessions('${u.uid}', parseInt(this.value))"><option value="1" ${(u.weeklySessions||1)===1?'selected':''}>1x</option><option value="2" ${(u.weeklySessions||1)===2?'selected':''}>2x</option><option value="3" ${(u.weeklySessions||1)===3?'selected':''}>3x</option></select></td>
          <td><button class="btn-danger" onclick="removeUser('${u.uid}')">Remove</button></td>
        </tr>`).join('')}
      </table>
    </div>
  `;

  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    const gender = document.getElementById('newUserGender').value;
    if (!name || !email || !password) return alert('Please fill all fields.');
    if (password.length < 6) return alert('Password must be at least 6 characters.');
    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      await userCredential.user.updateProfile({ displayName: name });
      await db.collection('users').doc(userCredential.user.uid).set({
        uid: userCredential.user.uid, email, name, role, gender,
        weeklySessions: 1, points: 0, matchesWon: 0, matchesLost: 0,
        username: '', lastActive: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert('User created successfully.');
      renderAdminTab('users');
    } catch (error) { alert('Failed to create user: ' + error.message); }
  });
}

window.updateUserRole = async function(uid, role) { await db.collection('users').doc(uid).update({ role }); alert('Role updated'); renderAdminTab('users'); };
window.updateUserGender = async function(uid, gender) { await db.collection('users').doc(uid).update({ gender }); alert('Gender updated'); renderAdminTab('users'); };
window.updateWeeklySessions = async function(uid, sessions) {
  if (!confirm('Changing weekly sessions will adjust the number of attendance slots for this client. Continue?')) return;
  await db.collection('users').doc(uid).update({ weeklySessions: sessions });
  alert('Weekly sessions updated.');
  renderAdminTab('users');
};
window.removeUser = async function(uid) {
  if (!confirm('Are you sure you want to remove this user? This will delete their account and all associated data.')) return;
  try {
    await db.collection('users').doc(uid).delete();
    const bookingsSnap = await db.collection('bookings').where('userId', '==', uid).get();
    const batch = db.batch();
    bookingsSnap.docs.forEach(doc => batch.delete(doc.ref));
    const attSnap = await db.collection('attendance').where('userId', '==', uid).get();
    attSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    alert('User removed.');
    renderAdminTab('users');
  } catch (error) { alert('Failed to remove user: ' + error.message); }
};

// ===================== ADMIN RANKINGS =====================
async function renderAdminRankings(container) {
  const playersSnap = await db.collection('users').where('role', '==', 'client').get();
  const players = playersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  container.innerHTML = `
    <div class="card">
      <h3>Adjust Player Points</h3>
      <form id="adjustPointsForm">
        <label>Player</label>
        <select id="adjustPlayerSelect" required><option value="">Select player</option>${players.map(p=>`<option value="${p.uid}">${escapeHtml(p.username||p.name)} (${p.points} pts)</option>`).join('')}</select>
        <label>Points to add (use negative to reduce)</label>
        <input type="number" id="pointsDelta" required value="0" />
        <button type="submit" class="btn-primary">Apply Adjustment</button>
      </form>
    </div>
    <div class="card">
      <h3>Record Match Result</h3>
      <form id="matchForm">
        <label>Winner</label><select id="winnerSelect"><option>Select winner</option>${players.map(p=>`<option value="${p.uid}">${escapeHtml(p.username||p.name)} (${p.points})</option>`).join('')}</select>
        <label>Loser</label><select id="loserSelect"><option>Select loser</option>${players.map(p=>`<option value="${p.uid}">${escapeHtml(p.username||p.name)} (${p.points})</option>`).join('')}</select>
        <button class="btn-primary">Submit Match</button>
      </form>
    </div>
    <div class="card">
      <h3>Current Rankings</h3>
      <table><tr><th>#</th><th>Player</th><th>Points</th><th>W/L</th></tr>${players.map(p=>({...p,effectivePoints:getDecayedPoints(p.points,p.lastActive)})).sort((a,b)=>b.effectivePoints-a.effectivePoints).map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.username||p.name)}</td><td>${p.effectivePoints}</td><td>${p.matchesWon}-${p.matchesLost}</td></tr>`).join('')}</table>
    </div>
  `;

  document.getElementById('adjustPointsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = document.getElementById('adjustPlayerSelect').value;
    const delta = parseInt(document.getElementById('pointsDelta').value);
    if (!uid || isNaN(delta)) return alert('Select player and enter a number.');
    await db.collection('users').doc(uid).update({ points: firebase.firestore.FieldValue.increment(delta) });
    alert('Points updated.');
    renderAdminTab('rankings');
  });

  document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const winnerUid = document.getElementById('winnerSelect').value;
    const loserUid = document.getElementById('loserSelect').value;
    if (!winnerUid || !loserUid || winnerUid===loserUid) return alert('Select two different players.');
    const winner = players.find(p=>p.uid===winnerUid);
    const loser = players.find(p=>p.uid===loserUid);
    let points = 50;
    if (winner.points < loser.points) points += 25;
    await db.collection('users').doc(winnerUid).update({ points: firebase.firestore.FieldValue.increment(points), matchesWon: firebase.firestore.FieldValue.increment(1), lastActive: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('users').doc(loserUid).update({ matchesLost: firebase.firestore.FieldValue.increment(1), lastActive: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection('matches').add({ winnerId: winnerUid, loserId: loserUid, date: new Date().toISOString().split('T')[0], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    alert(`Match recorded. Winner gained ${points} points.`);
    renderAdminTab('rankings');
  });
}

// ===================== ADMIN REVIEWS =====================
async function renderAdminReviews(container) {
  container.innerHTML = '<p>Loading reviews...</p>';
  try {
    const reviewsSnap = await db.collection('reviews').orderBy('createdAt', 'desc').get();
    const reviews = reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const usersSnap = await db.collection('users').get();
    const userMap = {};
    usersSnap.docs.forEach(d => userMap[d.id] = d.data());

    const grouped = {};
    reviews.forEach(r => {
      const date = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();
      const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      if (!grouped[monthKey]) grouped[monthKey] = [];
      grouped[monthKey].push(r);
    });

    const sortedMonths = Object.keys(grouped).sort().reverse();

    let html = `<div class="card"><h3>Client Reviews</h3>`;
    if (sortedMonths.length === 0) {
      html += `<p>No reviews yet.</p>`;
    } else {
      sortedMonths.forEach(month => {
        const monthLabel = new Date(month + '-01').toLocaleDateString('en-GH', { month: 'long', year: 'numeric' });
        html += `<h4 style="margin-top:12px;margin-bottom:8px;">${monthLabel}</h4>`;
        grouped[month].forEach(r => {
          const user = userMap[r.userId] || {};
          const name = user.username || user.name || 'Unknown';
          const dateStr = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : '';
          html += `
            <div class="announcement-item">
              <h4>${escapeHtml(name)}</h4>
              <p>Rating: ${r.rating}/5</p>
              <p>${escapeHtml(r.comment || 'No comment')}</p>
              <small>${dateStr}</small>
            </div>
          `;
        });
      });
    }
    html += `</div>`;
    container.innerHTML = html;
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error loading reviews: ${error.message}</p></div>`;
  }
}

// ===================== ADMIN NOTIFICATIONS =====================
async function renderAdminNotifications(container) {
  container.innerHTML = '<p>Loading...</p>';
  if (allUsersCache.length === 0) {
    const usersSnap = await db.collection('users').get();
    allUsersCache = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }
  const notificationsSnap = await db.collection('notifications').orderBy('createdAt', 'desc').get();
  const notifications = notificationsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  container.innerHTML = `
    <div class="card">
      <h3>Send Notification</h3>
      <form id="notificationForm">
        <label>Title</label>
        <input type="text" id="notifTitle" required />
        <label>Message</label>
        <textarea id="notifBody" rows="4" required></textarea>
        <label>Send To</label>
        <select id="notifTarget">
          <option value="all">All Clients</option>
          ${allUsersCache.filter(u => u.role === 'client').map(u => `<option value="${u.uid}">${escapeHtml(u.username || u.name)}</option>`).join('')}
        </select>
        <button type="submit" class="btn-primary">Send Notification</button>
      </form>
    </div>
    <div class="card">
      <h3>Sent Notifications</h3>
      ${notifications.length === 0 ? '<p>No notifications sent.</p>' : notifications.map(n => `
        <div style="border-bottom:1px solid var(--gray-100);padding:8px 0;">
          <strong>${escapeHtml(n.title)}</strong>
          <p>${escapeHtml(n.body)}</p>
          <small>${new Date(n.createdAt?.toDate()).toLocaleString()}</small>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('notificationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('notifTitle').value.trim();
    const body = document.getElementById('notifBody').value.trim();
    const target = document.getElementById('notifTarget').value;
    if (!title || !body) return alert('Please fill title and message.');
    let sentTo = [];
    if (target === 'all') {
      sentTo = allUsersCache.filter(u => u.role === 'client').map(u => u.uid);
    } else {
      sentTo = [target];
    }
    try {
      await db.collection('notifications').add({
        title, body, sentTo, createdBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), readBy: []
      });
      // Send email via EmailJS if configured
      if (EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
        for (const uid of sentTo) {
          const user = allUsersCache.find(u => u.uid === uid);
          if (user && user.email) {
            await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
              to_email: user.email,
              to_name: user.username || user.name,
              title: title,
              message: body
            });
          }
        }
      }
      alert('Notification sent.');
      renderAdminTab('notifications');
    } catch (error) {
      alert('Failed to send: ' + error.message);
    }
  });
}

// ===================== ADMIN BILLING =====================
async function renderAdminBilling(container) {
  container.innerHTML = '<p>Loading billing...</p>';
  try {
    const usersSnap = await db.collection('users').where('role', '==', 'client').get();
    const clients = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const currentMonth = new Date().toISOString().slice(0,7);

    let tableHtml = `<table>
      <tr><th>Client</th><th>Plan</th><th>Monthly Fee (GHS)</th><th>Paid Through</th><th>Status</th><th>Alerts</th><th>Action</th></tr>`;
    clients.forEach(client => {
      const weekly = client.weeklySessions || 1;
      const fee = getMonthlyFee(weekly);
      const paidThrough = client.paidThroughMonth || '';
      const isPaid = paidThrough >= currentMonth;
      tableHtml += `<tr>
        <td>${escapeHtml(client.username || client.name)}</td>
        <td>${weekly}x per week</td>
        <td>${fee}</td>
        <td>${paidThrough || 'Not set'}</td>
        <td><span class="badge ${isPaid ? 'badge-green' : 'badge-red'}">${isPaid ? 'Paid' : 'Unpaid'}</span></td>
        <td><input type="checkbox" ${client.alertsEnabled ? 'checked' : ''} onchange="toggleAlertsAdmin('${client.uid}', this.checked)"></td>
        <td>${isPaid ? '' : `<button class="btn-outline" onclick="markPaid('${client.uid}', '${currentMonth}')">Mark Paid</button>`}</td>
      </tr>`;
    });
    tableHtml += `</table>`;

    container.innerHTML = `
      <div class="card">
        <h3>Client Billing</h3>
        ${tableHtml}
        <button class="btn-primary" onclick="sendPaymentReminders()">Send Payment Reminders</button>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<div class="card"><p>Error: ${error.message}</p></div>`;
  }
}

window.toggleAlertsAdmin = async function(uid, enabled) {
  await db.collection('users').doc(uid).update({ alertsEnabled: enabled });
  renderAdminBilling(document.getElementById('adminContent'));
};

window.markPaid = async function(uid, month) {
  await db.collection('users').doc(uid).update({ paidThroughMonth: month });
  alert('Marked as paid through ' + month);
  renderAdminBilling(document.getElementById('adminContent'));
};

window.sendPaymentReminders = async function() {
  try {
    const usersSnap = await db.collection('users').where('role', '==', 'client').get();
    const clients = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const currentMonth = new Date().toISOString().slice(0,7);

    for (const client of clients) {
      if ((!client.paidThroughMonth || client.paidThroughMonth < currentMonth) && client.alertsEnabled) {
        const fee = getMonthlyFee(client.weeklySessions || 1);
        await db.collection('notifications').add({
          title: 'Payment Reminder',
          body: `Your monthly fee of GHS ${fee} is due. Please settle to continue booking future sessions.`,
          sentTo: [client.uid],
          createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          readBy: []
        });
        if (EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID') {
          emailjs.init(EMAILJS_PUBLIC_KEY);
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: client.email,
            to_name: client.username || client.name,
            title: 'Payment Reminder',
            message: `Your monthly fee of GHS ${fee} is due.`
          });
        }
      }
    }
    alert('Payment reminders sent.');
  } catch (error) {
    alert('Failed to send reminders: ' + error.message);
  }
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
      const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : '';
      const div = document.createElement('div');
      div.className = `message ${msg.senderId === currentUser.uid ? 'sent' : 'received'}`;
      div.innerHTML = `<div style="font-weight:bold;font-size:0.75rem;">${escapeHtml(senderName)}</div><div>${escapeHtml(msg.text)}</div><div class="meta"><span>${timeStr}</span><button class="btn-danger" onclick="deleteMessage('${convId}','${msg.id}')">Delete</button></div>`;
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    const convRef = db.collection('conversations').doc(convId);
    await convRef.collection('messages').add({ senderId: currentUser.uid, text, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await convRef.update({ lastMessage: text, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    messageInput.value = '';
  }
  document.getElementById('adminSendMessageBtn').addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => { if (e.key==='Enter') sendMessage(); });
};

// ===================== INITIALIZATION =====================
document.getElementById('appScreen').style.display = 'none';
document.getElementById('bottomNav').style.display = 'none';
hideOnboarding();

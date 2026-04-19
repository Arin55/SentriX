/*
 * SentriX - AI Grievance Intelligence Platform
 * Main JavaScript File
 */

// ===============================
// GLOBAL VARIABLES
// ===============================
let currentPage = 'home';
let isAuthenticated = false;
let currentUser = null;

// ===============================
// DOM READY
// ===============================
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
});

// ===============================
// APP INITIALIZATION
// ===============================
function initializeApp() {
    // Check if we should stay on current page or go to home
    const savedPage = sessionStorage.getItem('currentPage');
    const currentPath = window.location.pathname;

    // Determine which page we're on based on URL
    let pageName = 'home';
    if (currentPath.includes('dashboard.html')) pageName = 'udash';
    else if (currentPath.includes('admin.html')) pageName = 'admin';
    else if (currentPath.includes('submit.html')) pageName = 'submit';
    else if (currentPath.includes('track.html')) pageName = 'track';
    else if (currentPath.includes('login.html')) pageName = 'login';
    else if (currentPath.includes('signup.html')) pageName = 'signup';

    // Save current page to session storage
    sessionStorage.setItem('currentPage', pageName);

    // Check authentication status
    checkAuthStatus();

    // Initialize event listeners
    setupEventListeners();

    console.log('SentriX App Initialized - Current page:', pageName);
}

// ===============================
// PAGE NAVIGATION
// ===============================
function goPage(page) {
    // Save current page to session storage
    sessionStorage.setItem('currentPage', page);

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });

    // Show target page
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    currentPage = page;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show target page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
}

// ===============================
// AUTHENTICATION
// ===============================
function checkAuthStatus() {
    // Check if user is logged in (you can implement localStorage/sessionStorage here)
    const savedUser = localStorage.getItem('sentrix_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        isAuthenticated = true;
        updateUserInterface();
    }
}

function updateUserInterface() {
    const navGuest = document.getElementById('navGuest');
    const navUser = document.getElementById('navUser');

    if (isAuthenticated && currentUser) {
        navGuest.classList.add('hidden');
        navUser.classList.remove('hidden');

        // Update user info
        const navAv = document.getElementById('navAv');
        const navNm = document.getElementById('navNm');
        const dropNm = document.getElementById('dropNm');

        if (navAv) navAv.textContent = currentUser.name.charAt(0).toUpperCase();
        if (navNm) navNm.textContent = currentUser.name;
        if (dropNm) dropNm.textContent = currentUser.name;
    } else {
        navGuest.classList.remove('hidden');
        navUser.classList.add('hidden');
    }
}

function openAuth(type) {
    // Open login/signup modal
    const overlayId = type === 'login' ? 'ovLogin' : type === 'signup' ? 'ovSignup' : 'ovAdminLogin';
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

function closeOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function doLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPw').value;

    // Basic validation
    if (!email || !password) {
        toast('Please fill in all fields');
        return;
    }

    // Simulate login (replace with actual API call)
    currentUser = {
        name: email.split('@')[0],
        email: email,
        id: Date.now()
    };

    isAuthenticated = true;
    localStorage.setItem('sentrix_user', JSON.stringify(currentUser));

    updateUserInterface();
    closeOverlay('ovLogin');
    toast('Login successful!');

    // Redirect to dashboard
    goPage('udash');
}

function doSignup() {
    const firstName = document.getElementById('suFirst').value;
    const email = document.getElementById('suEmail').value;
    const password = document.getElementById('suPw').value;

    // Basic validation
    if (!firstName || !email || !password) {
        toast('Please fill in all required fields');
        return;
    }

    if (password.length < 8) {
        toast('Password must be at least 8 characters');
        return;
    }

    // Simulate signup (replace with actual API call)
    currentUser = {
        name: firstName,
        email: email,
        id: Date.now()
    };

    isAuthenticated = true;
    localStorage.setItem('sentrix_user', JSON.stringify(currentUser));

    updateUserInterface();
    closeOverlay('ovSignup');
    toast('Account created successfully!');

    // Show success modal
    setTimeout(() => {
        openAuth('success');
    }, 500);
}

function logoutUser() {
    currentUser = null;
    isAuthenticated = false;
    localStorage.removeItem('sentrix_user');

    updateUserInterface();
    toast('Logged out successfully');

    // Redirect to home
    goPage('home');
}

// ===============================
// PROTECTED ROUTES
// ===============================
function navToProtected(page) {
    if (!isAuthenticated) {
        toast('Please login to access this feature');
        openAuth('login');
        return;
    }
    goPage(page);
}

// ===============================
// MOBILE NAVIGATION
// ===============================
function toggleMobNav() {
    const navLinks = document.getElementById('navLinks');
    const hamBtn = document.getElementById('hamBtn');
    if (!navLinks) return;
    navLinks.classList.toggle('mob-open');
    if (hamBtn) {
        hamBtn.setAttribute('aria-expanded', navLinks.classList.contains('mob-open') ? 'true' : 'false');
    }
}

function closeMobNav() {
    const navLinks = document.getElementById('navLinks');
    const hamBtn = document.getElementById('hamBtn');
    if (!navLinks) return;
    navLinks.classList.remove('mob-open');
    if (hamBtn) {
        hamBtn.setAttribute('aria-expanded', 'false');
    }
}

// ===============================
// COMPLAINT SUBMISSION
// ===============================
function submitComplaint() {
    const category = document.getElementById('catSelect').value;
    const title = document.getElementById('compTitle').value;
    const description = document.getElementById('compDesc').value;
    const location = document.getElementById('compLoc').value;

    // Basic validation
    if (!category || !title || !description) {
        toast('Please fill in all required fields');
        return;
    }

    // Generate complaint ID
    const complaintId = 'SX-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 90000) + 10000);

    // Simulate AI analysis
    setTimeout(() => {
        // Update success modal
        document.getElementById('successId').textContent = complaintId;
        document.getElementById('saiCat').textContent = category;
        document.getElementById('saiSent').textContent = 'Normal';
        document.getElementById('saiPrio').textContent = (Math.random() * 10).toFixed(1) + '/10';
        document.getElementById('saiDept').textContent = 'Processing...';
        document.getElementById('saiEta').textContent = '24-48 hours';

        closeOverlay('ovSubmit');
        openAuth('success');

        // Reset form
        document.getElementById('compTitle').value = '';
        document.getElementById('compDesc').value = '';
        document.getElementById('compLoc').value = '';

        toast('Complaint submitted successfully!');
    }, 1500);
}

// ===============================
// COMPLAINT TRACKING
// ===============================
function doTrack() {
    const trackId = document.getElementById('trackId').value;

    if (!trackId) {
        toast('Please enter a complaint ID');
        return;
    }

    // Show tracking result (simulate)
    const trackResult = document.getElementById('trackResult');
    if (trackResult) {
        trackResult.style.display = 'block';
        toast('Tracking information loaded');
    }
}

// ===============================
// TOAST NOTIFICATIONS
// ===============================
function toast(message, duration = 3000) {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(15, 23, 42, 0.95);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        z-index: 10000;
        animation: slideInRight 0.3s ease-out;
        font-size: 14px;
        max-width: 300px;
    `;

    // Add to DOM
    document.body.appendChild(toast);

    // Remove after duration
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// ===============================
// EVENT LISTENERS
// ===============================
function setupEventListeners() {
    // Close mobile nav when clicking outside
    document.addEventListener('click', function (event) {
        const navLinks = document.getElementById('navLinks');
        const nav = document.querySelector('.nav');
        if (!navLinks || !nav) return;

        if (navLinks.classList.contains('mob-open') &&
            !nav.contains(event.target)) {
            closeMobNav();
        }
    });

    // Handle escape key for modals
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            // Close all open overlays
            document.querySelectorAll('.overlay').forEach(overlay => {
                if (overlay.style.display === 'flex') {
                    overlay.style.display = 'none';
                }
            });
        }
    });

    // Password visibility toggle
    window.togglePw = function (inputId, button) {
        const input = document.getElementById(inputId);
        if (input.type === 'password') {
            input.type = 'text';
            button.textContent = 'Hide';
        } else {
            input.type = 'password';
            button.textContent = 'Show';
        }
    };

    const hamBtn = document.getElementById('hamBtn');
    if (hamBtn) {
        hamBtn.setAttribute('aria-label', 'Toggle navigation menu');
        hamBtn.setAttribute('aria-expanded', 'false');
        hamBtn.setAttribute('type', 'button');
    }
}

// ===============================
// UTILITY FUNCTIONS
// ===============================
function generateId() {
    return 'SX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// ===============================
// ANIMATION HELPERS
// ===============================
// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ===============================
// GLOBAL FUNCTIONS (for inline onclick handlers)
// ===============================
window.goPage = goPage;
window.openAuth = openAuth;
window.closeOverlay = closeOverlay;
window.doLogin = doLogin;
window.doSignup = doSignup;
window.logoutUser = logoutUser;
window.navToProtected = navToProtected;
window.toggleMobNav = toggleMobNav;
window.closeMobNav = closeMobNav;
window.submitComplaint = submitComplaint;
window.doTrack = doTrack;
window.toast = toast;
window.togglePw = window.togglePw;

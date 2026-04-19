import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadString
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAutoZ2KI37OherocMt0ahKyN7Tl6r-n5Y",
  authDomain: "sentrix0.firebaseapp.com",
  projectId: "sentrix0",
  storageBucket: "sentrix0.appspot.com",
  messagingSenderId: "230241628309",
  appId: "1:230241628309:web:7a1d4bc125ae22fe546b9c",
  measurementId: "G-XTQR4LZ0KG"
};

const ADMIN_EMAIL = "arinsharma95944@gmail.com";
const ADMIN_PASSWORD = "Arin12345";
const USER_KEY = "sentrix_user";
const ROLE_KEY = "sentrix_role";
const USE_STORAGE_UPLOAD = false;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();
const complaintsRef = collection(db, "complaints");
const updatesRef = collection(db, "updates");
const complaintDocsById = new Map();
let complaintsCache = [];
let updatesCache = [];
let complaintsUnsub = null;
let updatesUnsub = null;
let backendLeafletMap = null;
let backendLeafletLayer = null;
let tenMinRefreshId = null;
let liveLocationState = { lat: null, lng: null, address: "" };

const path = window.location.pathname.toLowerCase();
const isIndexPage = path.endsWith("/") || path.endsWith("/index.html") || path.includes("index");
const isLoginPage = path.includes("login.html") && !path.includes("admin-login.html");
const isSignupPage = path.includes("signup.html");
const isAdminLoginPage = path.includes("admin-login.html");
const isDashboardPage = path.includes("dashboard.html");
const isAdminPage = path.includes("admin.html");

function toast(message) {
  if (typeof window.toast === "function") window.toast(message);
  else window.alert(message);
}

function setButtonLoading(button, isLoading, loadingText, fallbackText) {
  if (!button) return;
  const defaultText = button.dataset.defaultText || button.textContent || fallbackText;
  if (!button.dataset.defaultText) button.dataset.defaultText = defaultText;
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : defaultText;
}

function saveLocalUser(user, role = "user", name = "") {
  const payload = {
    id: user.uid,
    name: name || user.displayName || user.email?.split("@")[0] || "User",
    email: user.email || "",
    role
  };
  localStorage.setItem(USER_KEY, JSON.stringify(payload));
  localStorage.setItem(ROLE_KEY, role);
}

function clearLocalUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
  // Legacy keys used by index.html demo state
  localStorage.removeItem("sentrixUser");
  localStorage.removeItem("sentrixCurrentPage");
}

function getFullNameFromForm() {
  const firstName = document.getElementById("firstName")?.value.trim() || document.getElementById("suFirst")?.value.trim() || "";
  const lastName = document.getElementById("lastName")?.value.trim() || "";
  return `${firstName} ${lastName}`.trim();
}

function complaintId() {
  const y = new Date().getFullYear();
  return `SX-${y}-${Math.floor(Math.random() * 90000) + 10000}`;
}

function fmtDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value?.toDate) return value.toDate().getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });
    if (!res.ok) return "";
    const data = await res.json();
    const addr = data?.address || {};
    return (
      addr.suburb ||
      addr.neighbourhood ||
      addr.city_district ||
      addr.city ||
      addr.town ||
      addr.village ||
      data?.display_name ||
      ""
    );
  } catch {
    return "";
  }
}

function cleanLocationLabel(rawLocation, locationName) {
  if (locationName && String(locationName).trim()) return String(locationName).trim();
  const raw = String(rawLocation || "").trim();
  if (!raw) return "Pinned Location";
  if (/^lat\s*[-\d.]+,\s*lng\s*[-\d.]+$/i.test(raw)) return "Pinned Location";
  return raw;
}

async function uploadDataUrlToStorage(dataUrl, path) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return "";
  if (!USE_STORAGE_UPLOAD) return dataUrl;
  try {
    const ref = storageRef(storage, path);
    await uploadString(ref, dataUrl, "data_url");
    return await getDownloadURL(ref);
  } catch (error) {
    console.error("Storage upload failed:", error);
    return "";
  }
}

function statusClass(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("progress")) return "sc-prog";
  if (normalized.includes("resolve") || normalized.includes("close")) return "sc-res";
  if (normalized.includes("escal")) return "sc-esc";
  return "sc-open";
}

function statusColor(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("resolve") || normalized.includes("close")) return "#10b981";
  if (normalized.includes("progress")) return "#f59e0b";
  if (normalized.includes("escal")) return "#ef4444";
  return "#60a5fa";
}

function sentClass(sentiment) {
  const s = (sentiment || "").toLowerCase();
  if (s.includes("urgent") || s.includes("critical")) return "su";
  if (s.includes("angry")) return "sa";
  return "sn";
}

function resolveCategoryIcon(category) {
  const c = (category || "").toLowerCase();
  if (c.includes("water")) return "💧 Water";
  if (c.includes("road")) return "🛣️ Roads";
  if (c.includes("safety")) return "🛡️ Safety";
  if (c.includes("garbage")) return "🗑️ Garbage";
  if (c.includes("electric")) return "⚡ Electricity";
  return "🏙️ General";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function normalizeImageSourceToDataUrl(source) {
  if (!source) return "";
  if (typeof source !== "string") return "";
  if (source.startsWith("data:image/")) return source;
  if (source.startsWith("blob:") || /^https?:\/\//i.test(source)) {
    try {
      const blob = await fetch(source).then((r) => r.blob());
      return await readFileAsDataURL(blob);
    } catch (error) {
      console.error("Failed converting image source to data URL:", error);
      return "";
    }
  }
  return "";
}

async function extractAdminUpdateImage() {
  const fileInput = document.getElementById("adminUpdateImage");
  if (fileInput?.files?.[0]) {
    return readFileAsDataURL(fileInput.files[0]);
  }

  // Index page script keeps this in a global variable.
  const globalImage = window.updateImageData;
  if (typeof globalImage === "string" && globalImage.startsWith("data:image/")) {
    return globalImage;
  }

  const previewImg = document.getElementById("updateImagePreviewImg");
  const previewSrc = previewImg?.currentSrc || previewImg?.src || "";
  if (typeof previewSrc === "string") {
    const normalized = await normalizeImageSourceToDataUrl(previewSrc);
    if (normalized) return normalized;
  }

  return "";
}

function showAdminPanelUpdateNotice(message, ok = true) {
  const updatesSection = document.getElementById("asub-updates");
  if (!updatesSection) return;
  let box = document.getElementById("adminUpdateNotice");
  if (!box) {
    box = document.createElement("div");
    box.id = "adminUpdateNotice";
    box.style.cssText =
      "margin:0.75rem 0 1rem;padding:0.7rem 0.9rem;border-radius:8px;font-size:13px;font-weight:500;";
    const toolbar = updatesSection.querySelector(".tbl-toolbar");
    if (toolbar?.parentElement) toolbar.parentElement.insertBefore(box, toolbar.nextSibling);
    else updatesSection.prepend(box);
  }
  box.style.background = ok ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)";
  box.style.border = ok ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(239,68,68,0.35)";
  box.style.color = ok ? "#34d399" : "#fca5a5";
  box.textContent = message;
}

function collectComplaintEvidenceImages() {
  const images = [];

  // Primary source: rendered gallery thumbnails in submit form
  const galleryImgs = document.querySelectorAll("#gal img");
  galleryImgs.forEach((img) => {
    const src = img?.getAttribute("src") || "";
    if (src && !images.includes(src)) images.push(src);
  });

  // Secondary source: legacy runtime state, if exposed on window
  if (Array.isArray(window.S?.files)) {
    window.S.files.forEach((f) => {
      const src = f?.url || "";
      if (src && !images.includes(src)) images.push(src);
    });
  }

  // Keep images only (data URL / blob / remote URL)
  return images.filter((u) => typeof u === "string" && (u.startsWith("data:image/") || u.startsWith("blob:") || /^https?:\/\//i.test(u)));
}

function compressImageDataUrl(dataUrl, maxW = 960, maxH = 960, quality = 0.72) {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      const scale = Math.min(maxW / width, maxH / height, 1);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function geocodeFromLocation(location) {
  const text = (location || "").toLowerCase();
  if (text.includes("andheri")) return [19.1136, 72.8697];
  if (text.includes("bandra")) return [19.0596, 72.8295];
  if (text.includes("kurla")) return [19.0726, 72.8826];
  if (text.includes("malad")) return [19.1861, 72.8486];
  if (text.includes("dharavi")) return [19.0402, 72.8553];
  if (text.includes("mumbai")) return [19.076, 72.8777];
  return [19.076 + (Math.random() - 0.5) * 0.12, 72.8777 + (Math.random() - 0.5) * 0.12];
}

function getLiveLocation() {
  const locateOnce = (options) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: Number(position.coords.latitude),
            lng: Number(position.coords.longitude),
            accuracy: Number(position.coords.accuracy || 0)
          });
        },
        (error) => reject(error),
        options
      );
    });

  return new Promise(async (resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported in browser"));
      return;
    }
    try {
      // First attempt: precise GPS
      const high = await locateOnce({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
      resolve(high);
      return;
    } catch (highError) {
      try {
        // Fallback: network/coarse location
        const low = await locateOnce({
          enableHighAccuracy: false,
          timeout: 20000,
          maximumAge: 60000
        });
        resolve(low);
        return;
      } catch (lowError) {
        reject(lowError || highError);
      }
    }
  });
}

function renderMyComplaints() {
  if (!isIndexPage) return;
  const list = document.querySelector("#page-udash .cl");
  if (!list) return;
  const user = auth.currentUser;
  let localUser = null;
  try {
    localUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    localUser = null;
  }
  const mine = complaintsCache.filter((c) => {
    if (user?.uid && c.uid === user.uid) return true;
    if (localUser?.email && c.userEmail && String(c.userEmail).toLowerCase() === String(localUser.email).toLowerCase()) return true;
    return false;
  });
  const totalEl = document.querySelectorAll("#page-udash .ukpi .ukpi-val")[0];
  const resolvedEl = document.querySelectorAll("#page-udash .ukpi .ukpi-val")[1];
  const pendingEl = document.querySelectorAll("#page-udash .ukpi .ukpi-val")[2];
  const resolvedCount = mine.filter((c) => String(c.status || "").toLowerCase().includes("resolve")).length;
  const pendingCount = mine.filter((c) => !String(c.status || "").toLowerCase().includes("resolve")).length;
  if (totalEl) totalEl.textContent = String(mine.length);
  if (resolvedEl) resolvedEl.textContent = String(resolvedCount);
  if (pendingEl) pendingEl.textContent = String(pendingCount);

  if (!mine.length) {
    list.innerHTML = "<div class='ci'><div><div class='ci-title'>No complaints filed yet.</div><div class='ci-meta'>Submit your first complaint to see live status.</div></div></div>";
    return;
  }

  list.innerHTML = "";
  mine.slice(0, 20).forEach((c) => {
    const item = document.createElement("div");
    item.className = "ci";
    const complaintStatusClass = statusClass(c.status);
    const firstImage = Array.isArray(c.evidenceImages) && c.evidenceImages.length ? c.evidenceImages[0] : "";
    const locationText = cleanLocationLabel(c.location, c.locationName);
    item.innerHTML = `
      <div class="ci-icon">${resolveCategoryIcon(c.category).split(" ")[0]}</div>
      <div style="flex:1">
        <div class="ci-title">${c.title || c.description || "Complaint"}</div>
        <div class="ci-meta">
          <span class="ci-id">${c.complaintId || "N/A"}</span>
          <span class="ci-date">${fmtDate(c.createdAt)}</span>
          <span class="ci-date">📍 ${locationText}</span>
          <span class="badge badge-red" style="font-size:11px">${Number(c.priority || 0).toFixed(1)}</span>
        </div>
        ${firstImage ? `<div style="margin-top:.5rem"><img src="${firstImage}" alt="evidence" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"></div>` : ""}
      </div>
      <span class="sc ${complaintStatusClass}">${c.status || "Open"}</span>
    `;
    item.onclick = () => {
      const trackId = document.getElementById("trackId");
      if (trackId) {
        window.autoFillComplaint = (text) => {
          if (typeof window.goPage === "function") window.goPage("submit");
          setTimeout(() => {
            let newCat = null;
            if (/(road|pothole|street|highway|traffic)/i.test(text)) newCat = "Roads";
            else if (/(garbage|trash|waste|dump)/i.test(text)) newCat = "Garbage";
            else if (/(safe|police|crime|theft|fight|robbery)/i.test(text)) newCat = "Safety";
            else if (/(light|electric|power|wire|shock|pole)/i.test(text)) newCat = "Electricity";
            else if (/(water|leak|drain|pipe|flood)/i.test(text)) newCat = "Water";

            if (newCat && typeof window.pickCat === "function") window.pickCat(newCat);

            const titleInput = document.getElementById("ctitle");
            const descInput = document.getElementById("cdesc");
            const locInput = document.getElementById("cloc");

            if (titleInput) titleInput.value = "Voice Filed: " + text.substring(0, 20) + "...";
            if (descInput) descInput.value = text;
            if (locInput && !locInput.value) locInput.value = "Detecting via GPS...";

            alert("AI has processed your voice and autofilled the complaint form!");
            // We intentionally let the user press submit themselves to review the form
          }, 500);
        };
        trackId.value = c.complaintId || "";
      }
      if (typeof window.goPage === "function") window.goPage("track");
      if (typeof window.doTrack === "function") window.doTrack();
    };
    list.appendChild(item);
  });
}

function bindCameraFallback() {
  if (!isIndexPage) return;
  const openFallbackImagePicker = () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.capture = "environment";
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        if (!window.S) window.S = {};
        if (!Array.isArray(window.S.files)) window.S.files = [];
        const id = `fallback-${Date.now()}`;
        window.S.files.push({ id, url: dataUrl, name: file.name || "camera-image.jpg" });
        const gallery = document.getElementById("gal");
        if (gallery) {
          const div = document.createElement("div");
          div.className = "gi";
          div.id = "g-" + id;
          div.innerHTML = `<img src="${dataUrl}" alt="Camera fallback image" onclick="window.viewImg ? window.viewImg('${dataUrl}','Camera image') : window.open('${dataUrl}','_blank')"><button class="gi-rm" onclick="removeFile('${id}')">✕</button>`;
          gallery.prepend(div);
        }
        toast("Image added from camera fallback.");
      } catch (error) {
        console.error(error);
        toast("Failed to add fallback image.");
      }
    };
    picker.click();
  };

  window.startCamera = async function startCameraSafe() {
    const S = window.S || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Camera API not supported in this browser.");
      return;
    }
    try {
      if (S.camStream) S.camStream.getTracks().forEach((t) => t.stop());
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: S.camFacing || "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch {
        // Fallback for devices that reject facingMode constraints
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      S.camStream = stream;
      window.S = S;
      const video = document.getElementById("camVideo");
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
        video.classList.remove("hidden");
      }
      document.getElementById("camPlaceholder")?.classList.add("hidden");
      document.getElementById("camCanvas")?.classList.add("hidden");
      document.getElementById("btnStartCam")?.classList.add("hidden");
      document.getElementById("btnCapture")?.classList.remove("hidden");
      document.getElementById("btnFlip")?.classList.remove("hidden");
      document.getElementById("btnStopCam")?.classList.remove("hidden");
      document.getElementById("btnRetake")?.classList.add("hidden");
      document.getElementById("btnUsePic")?.classList.add("hidden");
      toast("Camera started.");
    } catch (error) {
      console.error(error);
      const code = error?.name || "CameraError";
      if (code === "NotAllowedError" || code === "SecurityError") {
        toast("Camera permission blocked. Allow camera in browser settings.");
      } else if (code === "NotFoundError" || code === "DevicesNotFoundError") {
        toast("No camera device found. Using file picker.");
      } else {
        toast(`Camera failed (${code}). Using fallback picker.`);
      }
      openFallbackImagePicker();
    }
  };
}

async function upsertUserProfile(user, details = {}) {
  try {
    const userRef = doc(db, "users", user.uid);
    const oldDoc = await getDoc(userRef);
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email || "",
        name: details.name || user.displayName || "",
        role: details.role || "user",
        phone: details.phone || "",
        location: details.location || "",
        updatedAt: serverTimestamp(),
        createdAt: oldDoc.exists() ? oldDoc.data().createdAt || serverTimestamp() : serverTimestamp()
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.error(error);
    toast(`DB save failed (${error?.code || "unknown"}). Check Firestore rules.`);
    return false;
  }
}

function routeUserAfterLogin(name) {
  if (isIndexPage && typeof window.loginUser === "function") {
    window.loginUser(name || "User");
    if (typeof window.closeOverlay === "function") {
      window.closeOverlay("ovLogin");
      window.closeOverlay("ovSignup");
    }
    if (typeof window.goPage === "function") window.goPage("udash");
  } else {
    window.location.href = "dashboard.html";
  }
}

function routeAdminAfterLogin() {
  if (isIndexPage && typeof window.goPage === "function") {
    if (typeof window.closeOverlay === "function") window.closeOverlay("ovAdminLogin");
    window.goPage("admin");
  } else {
    window.location.href = "admin.html";
  }
}

function bindUserLogin() {
  const loginImpl = async () => {
    const email = (document.getElementById("email")?.value || document.getElementById("loginEmail")?.value || "").trim();
    const password = document.getElementById("password")?.value || document.getElementById("loginPw")?.value || "";
    const remember = !!(document.getElementById("remember")?.checked || document.querySelector(".remember-check input[type='checkbox']")?.checked);
    const button = document.querySelector(".login-button") || document.querySelector("#ovLogin .btn.btn-primary");

    if (!email || !password) return toast("Please enter email and password.");
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return toast("Admin account must use admin login.");

    try {
      setButtonLoading(button, true, "Signing In...", "Sign In");
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const name = cred.user.displayName || cred.user.email?.split("@")[0] || "User";
      saveLocalUser(cred.user, "user", name);
      await upsertUserProfile(cred.user, { role: "user", name });
      toast("Login successful.");
      routeUserAfterLogin(name);
    } catch (error) {
      console.error(error);
      toast("Login failed. Check email/password.");
    } finally {
      setButtonLoading(button, false, "Signing In...", "Sign In");
    }
  };
  window.handleLogin = loginImpl;
  window.doLogin = loginImpl;
}

function bindSignup() {
  const signupImpl = async () => {
    const name = getFullNameFromForm();
    const firstName = name || "User";
    const email = (document.getElementById("email")?.value || document.getElementById("suEmail")?.value || "").trim();
    const phone = document.getElementById("phone")?.value.trim() || "";
    const location = document.getElementById("location")?.value.trim() || "";
    const password = document.getElementById("password")?.value || document.getElementById("suPw")?.value || "";
    const confirmPassword = document.getElementById("confirmPassword")?.value || password;
    const terms = document.getElementById("terms") ? !!document.getElementById("terms")?.checked : true;
    const button = document.getElementById("signupBtn") || document.querySelector("#ovSignup .btn.btn-primary");

    if (!email || !password) return toast("Please fill required fields.");
    if (!terms) return toast("Please accept terms.");
    if (password.length < 8) return toast("Password must be at least 8 characters.");
    if (password !== confirmPassword) return toast("Passwords do not match.");
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return toast("This email is reserved for admin.");

    try {
      setButtonLoading(button, true, "Creating Account...", "Create Account");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: firstName });
      saveLocalUser(cred.user, "user", firstName);
      await upsertUserProfile(cred.user, { role: "user", name: firstName, phone, location });
      toast("Signup successful.");
      routeUserAfterLogin(firstName);
    } catch (error) {
      console.error(error);
      if (error.code === "auth/email-already-in-use") toast("Email already exists.");
      else toast("Signup failed.");
    } finally {
      setButtonLoading(button, false, "Creating Account...", "Create Account");
    }
  };
  window.handleSignup = signupImpl;
  window.doSignup = signupImpl;
}

function bindAdminLogin() {
  const adminLoginImpl = async () => {
    const email = (document.getElementById("adminEmail")?.value || "").trim();
    const password = document.getElementById("adminPassword")?.value || document.getElementById("adminPw")?.value || "";
    const button = document.getElementById("adminLoginBtn") || document.querySelector("#ovAdminLogin .btn.btn-primary");

    if (!email || !password) return toast("Enter admin credentials.");
    if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) return toast("Only predefined admin credentials allowed.");

    try {
      setButtonLoading(button, true, "Signing In...", "Admin Sign In");
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      saveLocalUser(cred.user, "admin", "Admin");
      await upsertUserProfile(cred.user, { role: "admin", name: "Admin" });
      toast("Admin login successful.");
      routeAdminAfterLogin();
    } catch (error) {
      console.error(error);
      toast("Admin Firebase user not found.");
    } finally {
      setButtonLoading(button, false, "Signing In...", "Admin Sign In");
    }
  };
  window.handleAdminLogin = adminLoginImpl;
  window.doAdminLogin = adminLoginImpl;
}

function bindGoogleButtons() {
  const buttons = document.querySelectorAll(".social-button, .social-btn");
  buttons.forEach((button) => {
    const txt = button.textContent.toLowerCase();
    if (!txt.includes("google")) return;
    button.onclick = async (event) => {
      event.preventDefault();
      const isAdminFlow = button.closest("#ovAdminLogin") || isAdminLoginPage;
      if (isAdminFlow) {
        toast("Admin panel supports only predefined email + password login.");
        return;
      }
      try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        if (user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          await signOut(auth);
          clearLocalUser();
          return toast("Admin must use admin gateway.");
        }
        const name = user.displayName || user.email?.split("@")[0] || "User";
        saveLocalUser(user, "user", name);
        await upsertUserProfile(user, { role: "user", name });
        toast("Google login successful.");
        routeUserAfterLogin(name);
      } catch (error) {
        console.error(error);
        toast("Google sign-in failed.");
      }
    };
  });
}

function analyzeComplaint(title, description, isAgent = false) {
  const text = `${title} ${description}`.toLowerCase();
  
  let baseCat = "General";
  if (!isAgent && typeof document !== "undefined") {
    const selectedEl = document.querySelector('.cat-sel.selected .cat-sel-name');
    if (selectedEl) baseCat = selectedEl.textContent.trim();
  }
  
  let department = "Municipal Corp";
  if (baseCat === "Water") department = "Water Supply";
  else if (baseCat === "Roads") department = "Roads";
  else if (baseCat === "Safety") department = "Police Dept";
  else if (baseCat === "Electricity") department = "Electricity Dept";
  else if (baseCat === "Garbage") department = "Garbage";
  
  let category = baseCat;
  let priority = 5.0;

  if (/(urgent|critical|accident|attack|fire|emergency|immediately|fatal|danger)/.test(text)) {
    priority = (8.5 + Math.random() * 1.4).toFixed(1);
  } else if (/(theft|fraud|leak|damage|pothole|broken|spill)/.test(text)) {
    priority = (6.0 + Math.random() * 2.0).toFixed(1);
  } else {
    priority = (2.0 + Math.random() * 3.0).toFixed(1);
  }

  let sentiment = Number(priority) > 8.1 ? "Urgent" : Number(priority) > 7.0 ? "Angry" : "Normal";

  if (/(theft|fraud|attack|crime|murder|robbery|scam|police|harassment|cyber)/.test(text)) {
    department = "Police Dept";
    category = "Safety";
  } else if (/(light|power|electricity|wiring|shock|outage|blackout|pole)/.test(text)) {
    department = "Electricity Dept";
    category = "Electricity";
  } else if (/(water|leak|drainage|sewer|pipeline|flooding|plumbing|gutter)/.test(text)) {
    department = "Water Supply";
    category = "Water";
  } else if (/(pothole|road|highway|street|bridge|traffic|pavement|sidewalk)/.test(text)) {
    department = "Roads";
    category = "Roads";
  } else if (/(garbage|waste|trash|dump|sweep|dirt|cleaning|smell)/.test(text)) {
    department = "Garbage";
    category = "Garbage";
  }

  return { priority: Number(priority), sentiment, department, category };
}

function bindComplaintSubmit() {
  if (!isIndexPage) return;
  window.pinLoc = async function pinLocLive() {
    const mapArea = document.getElementById("mapArea");
    const mapLabel = mapArea?.querySelector(".map-lbl");
    const locInput = document.getElementById("cloc");
    try {
      if (!window.isSecureContext) {
        toast("Location works only on secure context. Use localhost/https.");
        return;
      }
      const loc = await getLiveLocation();
      const readable = await reverseGeocode(loc.lat, loc.lng);
      liveLocationState = {
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        address: readable || `Lat ${loc.lat.toFixed(5)}, Lng ${loc.lng.toFixed(5)}`,
        locationName: readable || "Pinned Location"
      };
      if (locInput) locInput.value = liveLocationState.address;
      if (mapArea) mapArea.classList.add("pinned");
      if (mapLabel) mapLabel.textContent = `📍 Live location pinned (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})`;
      toast(`Live location captured (±${Math.round(loc.accuracy)}m)`);
    } catch (error) {
      console.error(error);
      const code = error?.code;
      if (code === 1) toast("Location permission denied. Browser settings me allow karo.");
      else if (code === 2) toast("Location unavailable. GPS/network weak hai, retry karo.");
      else if (code === 3) toast("Location timeout. Open area me retry karo.");
      else toast("Live location fetch failed. Retry after enabling location.");

      // Fallback: derive map coordinates from typed location so flow can continue.
      const typed = (locInput?.value || "").trim();
      if (typed) {
        const [lat, lng] = geocodeFromLocation(typed);
        liveLocationState = {
          lat,
          lng,
          accuracy: null,
          address: typed,
          locationName: typed
        };
        if (mapArea) mapArea.classList.add("pinned");
        if (mapLabel) mapLabel.textContent = `📍 Approx location pinned (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        toast("GPS blocked, using typed location approximation.");
      }
    }
  };

  window.doSubmit = async () => {
    const user = auth.currentUser;
    if (!user) {
      toast("Please login first.");
      if (typeof window.openAuth === "function") window.openAuth("login");
      return;
    }
    const title = document.getElementById("ctitle")?.value.trim() || "";
    const description = document.getElementById("cdesc")?.value.trim() || "";
    const location = document.getElementById("cloc")?.value.trim() || "";
    
    const aiResult = analyzeComplaint(title, description);
    const category = aiResult.category;
    const priority = aiResult.priority;
    const sentiment = aiResult.sentiment;
    const dept = aiResult.department;
    
    const rawEvidenceImages = collectComplaintEvidenceImages();
    if (!title || !description || !location) return toast("Fill title, description and location.");
    if (liveLocationState.lat == null || liveLocationState.lng == null) {
      // Final safety fallback from typed location
      const [lat, lng] = geocodeFromLocation(location);
      liveLocationState = { lat, lng, accuracy: null, address: location, locationName: location };
      toast("Using typed location fallback for map.");
    }

    const id = complaintId();
    try {
      const evidenceImages = [];
      let storageUploadFailed = false;
      for (let i = 0; i < rawEvidenceImages.length; i++) {
        const raw = rawEvidenceImages[i];
        // If already remote URL, keep directly.
        if (/^https?:\/\//i.test(raw)) {
          evidenceImages.push(raw);
          continue;
        }
        // Blob URLs cannot be uploaded via uploadString; keep as-is fallback.
        if (raw.startsWith("blob:")) {
          storageUploadFailed = true;
          evidenceImages.push(raw);
          continue;
        }
        const compressed = await compressImageDataUrl(raw, 960, 960, 0.72);
        const uploaded = await uploadDataUrlToStorage(compressed || raw, `complaints/${id}/evidence-${i + 1}.jpg`);
        if (uploaded) evidenceImages.push(uploaded);
        else {
          storageUploadFailed = true;
          evidenceImages.push(compressed || raw);
        }
      }

      await addDoc(complaintsRef, {
        complaintId: id,
        uid: user.uid,
        userEmail: user.email || "",
        userName: user.displayName || JSON.parse(localStorage.getItem(USER_KEY) || "{}")?.name || "User",
        title,
        description,
        location,
        locationName: cleanLocationLabel(location, liveLocationState.locationName),
        lat: liveLocationState.lat,
        lng: liveLocationState.lng,
        locationAccuracy: liveLocationState.accuracy || null,
        category,
        priority,
        sentiment,
        status: "Pending",
        department: dept,
        dept: dept,
        assignedBy: "AI",
        eta: "24-48 hours",
        evidenceImages,
        evidenceCount: evidenceImages.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (document.getElementById("successId")) document.getElementById("successId").textContent = id;
      if (document.getElementById("saiCat")) document.getElementById("saiCat").textContent = category;
      if (document.getElementById("saiSent")) document.getElementById("saiSent").textContent = sentiment;
      if (document.getElementById("saiPrio")) document.getElementById("saiPrio").textContent = `${priority} / 10`;
      if (document.getElementById("saiDept")) document.getElementById("saiDept").textContent = "Municipal Corp";
      if (document.getElementById("saiEta")) document.getElementById("saiEta").textContent = "24-48 hours";
      if (typeof window.openOverlay === "function") window.openOverlay("ovSuccess");
      // Clear submit form and temporary evidence after successful backend save.
      const titleInput = document.getElementById("ctitle");
      const descInput = document.getElementById("cdesc");
      const locInput = document.getElementById("cloc");
      if (titleInput) titleInput.value = "";
      if (descInput) descInput.value = "";
      if (locInput) locInput.value = "";
      const fileInput = document.getElementById("fileInput");
      if (fileInput) fileInput.value = "";
      const gallery = document.getElementById("gal");
      if (gallery) gallery.innerHTML = "";
      if (window.S) {
        window.S.files = [];
        window.S.camPhoto = null;
      }
      liveLocationState = { lat: null, lng: null, address: "" };
      const mapArea = document.getElementById("mapArea");
      const mapLabel = mapArea?.querySelector(".map-lbl");
      if (mapArea) mapArea.classList.remove("pinned");
      if (mapLabel) mapLabel.textContent = "Tap to pin your location";
      if (typeof window.stopCamera === "function") window.stopCamera();
      if (storageUploadFailed) {
        toast("Image saved with fallback mode (storage upload failed).");
      }
      toast("Complaint saved in backend.");
    } catch (error) {
      console.error(error);
      toast("Failed to save complaint in backend.");
    }
  };
}

function bindTrackComplaint() {
  if (!isIndexPage) return;
  window.doTrack = async () => {
    const id = document.getElementById("trackId")?.value.trim() || "";
    const host = document.getElementById("trackResult");
    if (!id) return toast("Enter complaint ID.");
    if (!host) return;
    try {
      const q = query(complaintsRef, where("complaintId", "==", id), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        host.innerHTML = "<div class='tresult'><div class='tr-title'>No complaint found.</div></div>";
        return;
      }
      const c = snap.docs[0].data();
      const locationText = cleanLocationLabel(c.location, c.locationName);
      const statusValue = c.status || "Open";
      const timelineDone = {
        submitted: true,
        analysis: true,
        routed: true,
        assigned: ["in progress", "escalated", "resolved"].some((s) => statusValue.toLowerCase().includes(s)),
        action: ["in progress", "escalated", "resolved"].some((s) => statusValue.toLowerCase().includes(s)),
        resolved: statusValue.toLowerCase().includes("resolve")
      };
      const dot = (done, active = false) => (done ? "done" : active ? "active" : "pending");
      const evidenceHtml = Array.isArray(c.evidenceImages) && c.evidenceImages.length
        ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem">${c.evidenceImages
            .slice(0, 6)
            .map(
              (img, idx) =>
                `<img src="${img}" alt="evidence-${idx + 1}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onclick="window.viewImg ? window.viewImg('${img}','Complaint evidence') : window.open('${img}','_blank')">`
            )
            .join("")}</div>`
        : "";
      host.innerHTML = `
        <div class="tresult">
          <div class="tr-top">
            <div>
              <div class="tr-title">${c.title || "Complaint"}</div>
              <div class="tr-chips" style="margin-top:.625rem">
                <span class="tr-chip">${c.category || "General"}</span>
                <span class="tr-chip" style="font-family:'JetBrains Mono',monospace;font-size:11px">${c.complaintId || id}</span>
                <span class="tr-chip">${fmtDate(c.createdAt)}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div class="badge badge-blue">${c.sentiment || "Normal"}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--blue3)">${c.priority || 0} / 10</div>
            </div>
          </div>
          <div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">
            <span class="badge badge-amber">Status: ${statusValue}</span>
            <span class="badge badge-blue">${locationText}</span>
          </div>
          <div style="margin-top:1rem;color:var(--w2)">${c.description || ""}</div>
          <div class="timeline" style="margin-top:1rem">
            <div class="tl-item"><div class="tl-dot ${dot(timelineDone.submitted)}"></div><div><div class="tl-hd">Complaint submitted</div><div class="tl-time">${fmtDate(c.createdAt)}</div></div></div>
            <div class="tl-item"><div class="tl-dot ${dot(timelineDone.analysis)}"></div><div><div class="tl-hd">AI analysis complete</div><div class="tl-time">${fmtDate(c.createdAt)}</div></div></div>
            <div class="tl-item"><div class="tl-dot ${dot(timelineDone.routed)}"></div><div><div class="tl-hd">Routed to department</div><div class="tl-time">${fmtDate(c.createdAt)}</div></div></div>
            <div class="tl-item"><div class="tl-dot ${dot(timelineDone.assigned, !timelineDone.resolved)}"></div><div><div class="tl-hd">Assigned / In Progress</div><div class="tl-time">${statusValue}</div></div></div>
            <div class="tl-item"><div class="tl-dot ${dot(timelineDone.resolved, timelineDone.action && !timelineDone.resolved)}"></div><div><div class="tl-hd">Resolved confirmation</div><div class="tl-time">${timelineDone.resolved ? "Completed" : "Pending"}</div></div></div>
          </div>
          ${evidenceHtml}
        </div>
      `;
      toast("Tracking data fetched.");
    } catch (error) {
      console.error(error);
      toast("Track failed.");
    }
  };
}

async function renderUpdatesForUser() {
  const container = document.getElementById("updatesContainer");
  if (!container) return;
  try {
    const snap = await getDocs(query(updatesRef, orderBy("createdAt", "desc"), limit(20)));
    if (snap.empty) {
      container.innerHTML = "<div style='color:var(--w3)'>No updates available.</div>";
      return;
    }
    container.innerHTML = "";
    snap.forEach((d) => {
      const u = d.data();
      const card = document.createElement("div");
      card.style.cssText = "background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:1rem";
      card.innerHTML = `<h3 style="margin-bottom:.5rem">${u.title || "Update"}</h3><div style="font-size:12px;color:var(--w3);margin-bottom:.5rem">${u.complaintId || ""} · ${u.status || "Open"} · ${fmtDate(u.createdAt)}</div><div style="font-size:13px;color:var(--w2)">${u.description || ""}</div>`;
      container.appendChild(card);
    });
  } catch (error) {
    console.error(error);
  }
}

async function renderUpdatesForAdmin() {
  const list = document.getElementById("adminUpdatesList");
  if (!list) return;
  try {
    const snap = await getDocs(query(updatesRef, orderBy("createdAt", "desc"), limit(50)));
    if (snap.empty) {
      list.innerHTML = "<div style='text-align:center;padding:2rem;color:var(--w3)'>No updates created yet.</div>";
      return;
    }
    list.innerHTML = "";
    snap.forEach((d) => {
      const u = d.data();
      const item = document.createElement("div");
      item.style.cssText = "background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1rem";
      item.innerHTML = `<h4 style="margin-bottom:.4rem">${u.title || "Update"}</h4><div style="font-size:12px;color:var(--w3);margin-bottom:.5rem">${u.complaintId || ""} · ${u.status || "Open"} · ${fmtDate(u.createdAt)}</div><p style="font-size:13px;color:var(--w2)">${u.description || ""}</p>`;
      list.appendChild(item);
    });
  } catch (error) {
    console.error(error);
  }
}

window.currentAdminFilter = 'all';
window.applyAdminFilter = (filter) => {
    window.currentAdminFilter = filter;
    renderAllComplaintsTable();
};

function textMatchesDept(txt, filter) {
  if (!txt) return false;
  txt = txt.toLowerCase();
  filter = filter.toLowerCase();
  if (filter === 'electricity') return txt.includes('electric') || txt.includes('elec') || txt.includes('power');
  if (filter === 'water') return txt.includes('water');
  if (filter === 'roads') return txt.includes('road');
  if (filter === 'safety') return txt.includes('safe') || txt.includes('police') || txt.includes('crime');
  if (filter === 'garbage') return txt.includes('garb') || txt.includes('trash') || txt.includes('waste');
  return txt.includes(filter);
}

function updateAdminKPIs() {
  const openCount = complaintsCache.filter(c => String(c.status || "").toLowerCase() === "open" || String(c.status || "").toLowerCase() === "pending").length;
  const resolvedCount = complaintsCache.filter(c => String(c.status || "").toLowerCase().includes("resolve")).length;
  const inProgressCount = complaintsCache.filter(c => String(c.status || "").toLowerCase().includes("progress")).length;
  const total = complaintsCache.length || 1;
  const avgPriority = complaintsCache.reduce((acc, c) => acc + Number(c.priority || 0), 0) / total;

  const kpiOpen = document.getElementById("kpi-open-dash");
  const kpiResolved = document.getElementById("kpi-resolved-dash");
  const kpiAvg = document.getElementById("kpi-avgprio-dash");
  const kpiTotal = document.getElementById("kpi-total");
  const kpiRate = document.getElementById("kpi-rate");

  if (kpiOpen) kpiOpen.textContent = openCount;
  if (kpiResolved) kpiResolved.textContent = resolvedCount;
  if (kpiAvg) kpiAvg.textContent = avgPriority.toFixed(1);
  if (kpiTotal) kpiTotal.textContent = complaintsCache.length;
  if (kpiRate) kpiRate.textContent = ((resolvedCount / total) * 100).toFixed(1) + "%";

  const menuItems = document.querySelectorAll(".admin-menu-item");
  menuItems.forEach((btn) => {
    const text = btn.textContent.toLowerCase();
    let deptFilter = null;
    if (text.includes("water")) deptFilter = "Water";
    else if (text.includes("roads")) deptFilter = "Roads";
    else if (text.includes("safety")) deptFilter = "Safety";
    else if (text.includes("electric")) deptFilter = "Electricity";
    else if (text.includes("garbage")) deptFilter = "Garbage";
    
    if (deptFilter) {
      const activeComplaints = complaintsCache.filter(c => {
         return (textMatchesDept(c.department || "", deptFilter) || textMatchesDept(c.category || "", deptFilter) || textMatchesDept(c.dept || "", deptFilter)) && 
                !String(c.status || "").toLowerCase().includes("resolve");
      });
      const span = btn.querySelector("span");
      if (span) span.textContent = activeComplaints.length;
    }
  });

  // FEATURE 4: Fix Department Panel Count for specific index.html dashboard IDs
  const deptIds = {
    'sb-dept-water': { filter: 'Water', icon: '💧', label: 'Water' },
    'sb-dept-roads': { filter: 'Roads', icon: '🛣️', label: 'Roads' },
    'sb-dept-safety': { filter: 'Safety', icon: '🛡️', label: 'Safety' },
    'sb-dept-electricity': { filter: 'Electricity', icon: '⚡', label: 'Electricity' },
    'sb-dept-garbage': { filter: 'Garbage', icon: '🗑️', label: 'Garbage' }
  };
  
  for (const [id, info] of Object.entries(deptIds)) {
    const el = document.getElementById(id);
    if (el) {
      const activeComplaints = complaintsCache.filter(c => {
         return (textMatchesDept(c.department || "", info.filter) || textMatchesDept(c.category || "", info.filter) || textMatchesDept(c.dept || "", info.filter)) && 
                !String(c.status || "").toLowerCase().includes("resolve");
      });
      el.innerHTML = `<span class="sb-icon">${info.icon}</span>${info.label} (${activeComplaints.length})`;
    }
  }
}

function renderAdminComplaintsTable() {
  const tableBody = document.getElementById("adminTableBody");
  if (!tableBody) return;
  tableBody.innerHTML = "";
  
  complaintsCache.slice(0, 10).forEach((c) => {
    const row = document.createElement("tr");
    const id = c.complaintId || "N/A";
    const sClass = statusClass(c.status);
    const sText = c.status || "Open";
    const sentiment = c.sentiment || "Normal";
    const locationText = cleanLocationLabel(c.location, c.locationName);
    const actionHTML =
      sClass === "sc-open"
        ? `<button class="act-btn act-a" onclick="adminAssign('${id}')">Assign</button><button class="act-btn act-e" onclick="adminEscalate('${id}')">Escalate</button>`
        : sClass === "sc-prog"
          ? `<button class="act-btn" onclick="adminClose('${id}')">Close</button><button class="act-btn act-e" onclick="adminEscalate('${id}')">Escalate</button>`
          : sClass === "sc-esc"
            ? `<button class="act-btn" onclick="adminClose('${id}')">Close</button>`
            : `<span style="font-size:12px;color:rgba(255,255,255,0.5)">Resolved</span>`;
    const imageAction = Array.isArray(c.evidenceImages) && c.evidenceImages.length
      ? `<button class="act-btn" onclick="viewComplaintImages('${id}')">Image</button>`
      : "";
    const thumb = Array.isArray(c.evidenceImages) && c.evidenceImages.length
      ? `<img src="${c.evidenceImages[0]}" alt="evidence" style="display:inline-block;width:28px;height:28px;object-fit:cover;border-radius:6px;border:1px solid var(--border);margin-right:.45rem;vertical-align:middle">`
      : "";
    row.innerHTML = `
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${id}</td>
      <td>${thumb}${resolveCategoryIcon(c.category)}</td>
      <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.title || c.description || "Complaint"}</td>
      <td>${locationText}</td>
      <td><span class="pp ${(Number(c.priority) || 0) > 8 ? "pp-c" : "pp-h"}">${Number(c.priority || 0).toFixed(1)}</span></td>
      <td><span class="${sentClass(sentiment)}">${sentiment}</span></td>
      <td><span class="sc ${sClass}">${sText}</span></td>
      <td><div class="act-btns">${imageAction}${actionHTML}</div></td>
    `;
    tableBody.appendChild(row);
  });
}

function renderAllComplaintsTable() {
  if (!isIndexPage && !isAdminPage) return;
  
  const tbody = document.getElementById("allComplaintsTableBody") || document.querySelector("#asub-complaints tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let list = complaintsCache;

  if (window.currentAdminFilter !== 'all') {
      const f = window.currentAdminFilter.toLowerCase();
      if (['water', 'roads', 'safety', 'garbage', 'electricity'].includes(f)) {
          list = list.filter(c => {
             return textMatchesDept(c.department || "", f) || textMatchesDept(c.category || "", f) || textMatchesDept(c.dept || "", f);
          });
      } else if (f === 'assigned') {
          list = list.filter(c => ["in progress", "escalated"].some(s => String(c.status||"").toLowerCase().includes(s)));
      } else if (f === 'pending-resolved') {
          list = list.filter(c => String(c.status||"").toLowerCase().includes("resolve") || String(c.status||"").toLowerCase() === "open");
      }
  }

  list.slice(0, 200).forEach((c) => {
    const tr = document.createElement("tr");
    const id = c.complaintId || "N/A";
    const category = resolveCategoryIcon(c.category);
    const priority = Number(c.priority || 0).toFixed(1);
    const sentiment = c.sentiment || "Normal";
    const dept = c.dept || "Municipal";
    const filed = fmtDate(c.createdAt);
    const status = c.status || "Open";
    const statusCss = statusClass(status);
    const locationText = cleanLocationLabel(c.location, c.locationName);
    tr.innerHTML = `
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${id}</td>
      <td>${category}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.title || c.description || "Complaint"}</td>
      <td>${locationText}</td>
      <td><span class="pp ${Number(c.priority || 0) > 8 ? "pp-c" : "pp-h"}">${priority}</span></td>
      <td><span class="${sentClass(sentiment)}">${sentiment}</span></td>
      <td>${dept}</td>
      <td style="font-size:12px">${filed}</td>
      <td><span class="sc ${statusCss}">${status}</span></td>
      <td><button class="act-btn" onclick="window.viewComplaintMedia && window.viewComplaintMedia('${id}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });

  const allComplaintsSection = document.getElementById("admin-complaints") || document.querySelector("#asub-complaints");
  if (allComplaintsSection) {
      const titleEl = allComplaintsSection.querySelector(".tbl-name");
      if (titleEl) titleEl.textContent = `All Complaints (${list.length})`;
  }
}

function downloadComplaintsCsv() {
  if (!complaintsCache.length) {
    toast("No complaints available to export.");
    return;
  }
  const rows = [
    ["Complaint ID", "Category", "Title/Description", "Location", "Priority", "Sentiment", "Department", "Status", "User Email", "Created At"]
  ];
  complaintsCache.forEach((c) => {
    rows.push([
      c.complaintId || "",
      c.category || "",
      c.title || c.description || "",
      c.location || "",
      String(c.priority || ""),
      c.sentiment || "",
      c.dept || "",
      c.status || "",
      c.userEmail || "",
      fmtDate(c.createdAt)
    ]);
  });
  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sentrix-complaints-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("CSV exported.");
}

function bindAllComplaintsExport() {
  if (!isIndexPage) return;
  const exportBtn = document.querySelector("#asub-complaints .admin-topbar .btn.btn-primary.btn-sm");
  if (!exportBtn) return;
  exportBtn.onclick = (event) => {
    event.preventDefault();
    downloadComplaintsCsv();
  };
}

function initBackendHeatmap() {
  const mapHost = document.getElementById("realMap");
  if (!mapHost || !window.L) return;
  if (!backendLeafletMap) {
    backendLeafletMap = window.L.map("realMap", { zoomControl: false, attributionControl: false }).setView([19.076, 72.8777], 12);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20
    }).addTo(backendLeafletMap);
    backendLeafletLayer = window.L.layerGroup().addTo(backendLeafletMap);
  }
  backendLeafletLayer.clearLayers();
  const active = complaintsCache.filter((c) => !String(c.status || "").toLowerCase().includes("resolve"));
  active.forEach((c) => {
    const [lat, lng] =
      typeof c.lat === "number" && typeof c.lng === "number"
        ? [c.lat, c.lng]
        : geocodeFromLocation(c.location);
    const iconClass = Number(c.priority || 0) >= 8.5 ? "node-red" : Number(c.priority || 0) >= 7 ? "node-blue" : "node-cyan";
    const icon = window.L.divIcon({ className: `hmap-node ${iconClass}`, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
    window.L
      .marker([lat, lng], { icon })
      .bindPopup(`<div style="color:#fff;padding:4px"><strong>${c.complaintId}</strong><br>${c.title || c.description || ""}<br>Status: ${c.status || "Open"}</div>`, { className: "custom-lflt-popup" })
      .addTo(backendLeafletLayer);
  });
  const hudVal = document.querySelector(".hmap-hud .hud-val");
  if (hudVal) {
    const density = complaintsCache.length ? (Math.min(100, 60 + complaintsCache.length * 2.4)).toFixed(1) : "0.0";
    hudVal.innerHTML = `${density} <span class="hud-ch">↗ live</span>`;
  }
  setTimeout(() => backendLeafletMap.invalidateSize(), 100);
}

async function changeComplaintStatusById(complaintIdValue, nextStatus, adminNote) {
  const target = complaintDocsById.get(complaintIdValue);
  if (!target) {
    toast("Complaint not found in backend.");
    return;
  }
  try {
    await updateDoc(target.ref, {
      status: nextStatus,
      updatedAt: serverTimestamp()
    });
    await addDoc(updatesRef, {
      complaintId: complaintIdValue,
      title: `Complaint ${nextStatus}`,
      description: adminNote,
      location: target.data().location || "",
      status: nextStatus,
      userName: "Admin",
      createdBy: auth.currentUser?.uid || "admin",
      createdAt: serverTimestamp()
    });
    // Keep status actions silent to avoid notification noise.
  } catch (error) {
    console.error(error);
    toast("Failed to update complaint status.");
  }
}

function bindAdminActions() {
  if (!isIndexPage && !isAdminPage) return;
  window.adminAssign = (id) => changeComplaintStatusById(id, "In Progress", "Admin assigned a field unit.");
  window.adminClose = (id) => changeComplaintStatusById(id, "Resolved", "Admin marked complaint as resolved.");
  window.adminEscalate = (id) => changeComplaintStatusById(id, "Escalated", "Admin escalated complaint to higher authority.");
  window.viewComplaintImages = (id) => {
    const c = complaintsCache.find((x) => x.complaintId === id);
    if (!c || !Array.isArray(c.evidenceImages) || !c.evidenceImages.length) {
      toast("No complaint image attached.");
      return;
    }
    const first = c.evidenceImages[0];
    if (typeof window.viewImg === "function") {
      window.viewImg(first, `${id} evidence (${c.evidenceImages.length})`);
    } else {
      window.open(first, "_blank");
    }
    if (c.evidenceImages.length > 1) {
      toast(`Showing first image. Total images: ${c.evidenceImages.length}`);
    }
  };
}

window.runAdminAIAgent = async () => {
    const role = localStorage.getItem(ROLE_KEY);
    const isAdmin = role === "admin" || (auth.currentUser && auth.currentUser.email === ADMIN_EMAIL);
    if (!isAdmin) return;

    for (const c of complaintsCache) {
        if (!c.dept || c.dept === "Municipal Corp" || !c.category || c.category === "General") {
            const aiResult = analyzeComplaint(c.title, c.description, true);
            const target = complaintDocsById.get(c.complaintId);
            if (target && aiResult.department !== c.dept) {
                try {
                    await updateDoc(target.ref, {
                        dept: aiResult.department,
                        category: aiResult.category,
                        priority: aiResult.priority,
                        sentiment: aiResult.sentiment,
                        updatedAt: serverTimestamp()
                    });
                    console.log(`AI Agent Auto-Assigned ${c.complaintId} to ${aiResult.department}`);
                } catch (e) {
                    console.error("AI Assignment update failed", e);
                }
            }
        }
    }
};

function attachRealtimeListeners() {
  if (!isIndexPage && !isAdminPage) return;
  if (complaintsUnsub) complaintsUnsub();
  if (updatesUnsub) updatesUnsub();

  complaintsUnsub = onSnapshot(query(complaintsRef, orderBy("createdAt", "desc"), limit(200)), (snapshot) => {
    complaintsCache = snapshot.docs.map((d) => ({ ...d.data(), _docId: d.id }));
    complaintDocsById.clear();
    snapshot.docs.forEach((d) => {
      const data = d.data();
      if (data.complaintId) complaintDocsById.set(data.complaintId, d);
    });
    renderAdminComplaintsTable();
    renderAllComplaintsTable();
    renderMyComplaints();
    initBackendHeatmap();
    updateAdminKPIs();
    if (isAdminPage) window.runAdminAIAgent();
    
    // Secure UI race-condition: Ensure frontend DOM redraws use backend logic
    if (typeof window.updateAdminCounters !== "undefined" || isAdminPage) {
        window.updateAdminCounters = updateAdminKPIs;
    }
  });

  updatesUnsub = onSnapshot(query(updatesRef, orderBy("createdAt", "desc"), limit(100)), (snapshot) => {
    updatesCache = snapshot.docs
      .map((d) => ({ ...d.data(), _docId: d.id }))
      .sort((a, b) => toMillis(b.createdAt || b.date) - toMillis(a.createdAt || a.date));
    const adminList = document.getElementById("adminUpdatesList");
    const userContainer = document.getElementById("updatesContainer");
    if (adminList) {
      if (!updatesCache.length) adminList.innerHTML = "<div style='text-align:center;padding:2rem;color:var(--w3)'>No updates created yet.</div>";
      else {
        adminList.innerHTML = "";
        updatesCache.forEach((u) => {
          const img = u.image || u.imageUrl || u.updateImage || u.imageData || u.img || "";
          const item = document.createElement("div");
          item.style.cssText = "background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1rem";
          item.innerHTML = `<h4 style="margin-bottom:.4rem">${u.title || "Update"}</h4><div style="font-size:12px;color:var(--w3);margin-bottom:.35rem">${u.complaintId || ""} · ${u.status || "Open"} · ${fmtDate(u.createdAt || u.date)}</div><div style="font-size:12px;color:var(--w3);margin-bottom:.55rem">📍 ${u.location || "Location not set"}</div><p style="font-size:13px;color:var(--w2)">${u.description || ""}</p>${img ? `<img src="${img}" alt="update" style="margin-top:.5rem;width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : ""}`;
          adminList.appendChild(item);
        });
      }
    }
    if (userContainer) {
      if (!updatesCache.length) userContainer.innerHTML = "<div style='color:var(--w3)'>No updates available.</div>";
      else {
        userContainer.innerHTML = "";
        updatesCache.slice(0, 20).forEach((u) => {
          const img = u.image || u.imageUrl || u.updateImage || u.imageData || u.img || "";
          const card = document.createElement("div");
          card.style.cssText = "background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:1rem";
          card.innerHTML = `<h3 style="margin-bottom:.5rem">${u.title || "Update"}</h3><div style="font-size:12px;color:var(--w3);margin-bottom:.35rem">${u.complaintId || ""} · ${u.status || "Open"} · ${fmtDate(u.createdAt || u.date)}</div><div style="font-size:12px;color:var(--w3);margin-bottom:.55rem">📍 ${u.location || "Location not set"}</div><div style="font-size:13px;color:var(--w2)">${u.description || ""}</div>${img ? `<img src="${img}" alt="update" style="margin-top:.5rem;width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : ""}`;
          userContainer.appendChild(card);
        });
      }
    }
  });
}

function bindAdminUpdateForm() {
  if (!isIndexPage) return;
  const form = document.getElementById("adminUpdateForm");
  if (!form) return;
  const submitHandler = async () => {
    const role = localStorage.getItem(ROLE_KEY);
    const currentEmail = auth.currentUser?.email?.toLowerCase() || "";
    const hasAdminUiAccess =
      role === "admin" ||
      window.S?.adminLoggedIn === true ||
      currentEmail === ADMIN_EMAIL.toLowerCase() ||
      !!document.getElementById("page-admin");
    if (!hasAdminUiAccess) {
      toast("Only admin can post updates.");
      return;
    }
    if (!auth.currentUser || currentEmail !== ADMIN_EMAIL.toLowerCase()) {
      try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
      } catch (authError) {
        console.error("Admin re-auth failed:", authError);
        toast("Admin auth expired. Please login again from Admin Gateway.");
        return;
      }
    }
    const complaintIdRaw = document.getElementById("adminComplaintId")?.value.trim() || "";
    const complaintIdValue = complaintIdRaw || `ADHOC-${Date.now()}`;
    const title = document.getElementById("adminUpdateTitle")?.value.trim() || "";
    const description = document.getElementById("adminUpdateDescription")?.value.trim() || "";
    const location = document.getElementById("adminUpdateLocation")?.value.trim() || "";
    const status = document.getElementById("adminUpdateStatus")?.value || "Open";
    let image = await extractAdminUpdateImage();
    if (image) image = await compressImageDataUrl(image, 960, 960, 0.72);
    if (!title || !description || !location) return toast("Please fill all required fields.");
    try {
      // Keep post resilient: if image is too large, post text update anyway.
      if (image && image.length > 700000) {
        image = "";
        toast("Image too large; posting update without image.");
      }

      const updateId = `upd-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      let imageUrl = "";
      if (image) {
        imageUrl = await uploadDataUrlToStorage(image, `updates/${updateId}/image.jpg`);
        // If storage fails in storage mode, do not block update posting.
        if (!imageUrl && USE_STORAGE_UPLOAD) {
          image = "";
          toast("Image upload failed; posting update without image.");
          showAdminPanelUpdateNotice("Update posted without image (upload failed).", false);
        }
      }

      await addDoc(updatesRef, {
        complaintId: complaintIdValue,
        title,
        description,
        location,
        status,
        image: imageUrl || image || "",
        imageUrl: imageUrl || image || "",
        updateImage: imageUrl || image || "",
        imageData: imageUrl || image || "",
        userName: "Admin",
        createdBy: auth.currentUser?.uid || "admin-local",
        createdAt: serverTimestamp()
      });
      // Sync master complaint so heatmap/status/location reflect admin update.
      // Keep this non-blocking: update post should still succeed even if sync fails.
      const targetComplaint = complaintDocsById.get(complaintIdValue);
      if (targetComplaint) {
        try {
          await updateDoc(targetComplaint.ref, {
            location,
            locationName: location,
            status,
            updatedAt: serverTimestamp()
          });
        } catch (syncError) {
          console.error("Complaint sync failed after posting update:", syncError);
          toast("Update posted, but complaint status sync failed.");
        }
      }
      if (!image) {
        toast("Update posted without image. Please use file picker and try again for image.");
      }
      toast("Update posted to backend.");
      showAdminPanelUpdateNotice("Update posted successfully. User side will refresh live.");
      form.reset();
      await renderUpdatesForAdmin();
      await renderUpdatesForUser();
    } catch (error) {
      console.error(error);
      toast(`Failed to post update (${error?.code || "unknown"}).`);
      showAdminPanelUpdateNotice(`Post failed (${error?.code || "unknown"}).`, false);
    }
  };

  window.postAdminUpdate = submitHandler;

  form.onsubmit = async (event) => {
    event.preventDefault();
    await submitHandler();
  };
}

function bindDataFlows() {
  if (!isIndexPage && !isAdminPage) return;
  bindComplaintSubmit();
  bindTrackComplaint();
  bindAdminUpdateForm();
  bindAdminActions();
  bindCameraFallback();
  bindAllComplaintsExport();
  window.viewComplaintMedia = (id) => {
    const c = complaintsCache.find((x) => x.complaintId === id);
    if (!c) {
      toast("Complaint not found.");
      return;
    }
    const images = Array.isArray(c.evidenceImages) ? c.evidenceImages.filter(Boolean) : [];
    if (!images.length) {
      toast("No user image uploaded for this complaint.");
      return;
    }
    if (typeof window.viewImg === "function") {
      window.viewImg(images[0], `${id} evidence (${images.length})`);
    } else {
      window.open(images[0], "_blank");
    }
    if (images.length > 1) {
      toast(`Showing first image. Total uploaded: ${images.length}`);
    }
  };
  window.doTrackById = (id) => {
    const trackId = document.getElementById("trackId");
    if (trackId) trackId.value = id;
    if (typeof window.goPage === "function") window.goPage("track");
    if (typeof window.doTrack === "function") window.doTrack();
  };
  window.loadAdminUpdates = renderUpdatesForAdmin;
  window.loadUpdates = renderUpdatesForUser;
  attachRealtimeListeners();
  if (tenMinRefreshId) clearInterval(tenMinRefreshId);
  tenMinRefreshId = setInterval(() => {
    renderMyComplaints();
    renderAdminComplaintsTable();
    initBackendHeatmap();
    updateAdminKPIs();
  }, 10 * 60 * 1000);
  // Override old demo heatmap initializer to ensure backend-driven map.
  window.initLeafletHeatmap = initBackendHeatmap;
}

window.logoutUser = async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  } finally {
    clearLocalUser();
    if (isIndexPage) {
      if (window.S) {
        window.S.loggedIn = false;
        window.S.adminLoggedIn = false;
        window.S.userName = "";
      }
      const profileMenu = document.getElementById("profileMenu");
      if (profileMenu) profileMenu.style.display = "none";
      const navUser = document.getElementById("navUser");
      if (navUser) {
        navUser.classList.add("hidden");
        navUser.style.display = "none";
      }
      const navGuest = document.getElementById("navGuest");
      if (navGuest) navGuest.classList.remove("hidden");
      if (typeof window.goPage === "function") window.goPage("home");
      toast("Logged out successfully.");
      return;
    }
    window.location.href = "index.html";
  }
};

function protectRoutes() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearLocalUser();
      if (isDashboardPage) window.location.href = "login.html";
      if (isAdminPage) window.location.href = "admin-login.html";
      return;
    }
    const role = localStorage.getItem(ROLE_KEY);
    if (isIndexPage) {
      renderMyComplaints();
    }
    if (isAdminPage) {
      const strictAdmin = user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && role === "admin";
      if (!strictAdmin) {
        signOut(auth).finally(() => {
          clearLocalUser();
          toast("Admin access denied.");
          window.location.href = "admin-login.html";
        });
      }
    }
  });
}

if (isLoginPage || isIndexPage) bindUserLogin();
if (isSignupPage || isIndexPage) bindSignup();
if (isAdminLoginPage || isIndexPage) bindAdminLogin();
bindGoogleButtons();
bindDataFlows();
protectRoutes();

// --- FEATURE 3: Return Workflow ---
function initReturnWorkflow() {
  const form = document.getElementById("updatePostForm");
  if (!form) return;
  
  const imgInput = document.getElementById("updateImage");
  if (imgInput) {
    imgInput.type = "file";
    imgInput.accept = "image/*";
    imgInput.placeholder = "";
  }

  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = newForm.querySelector("button[type='submit']");
    const complaintId = document.getElementById("complaintId").value.trim();
    // The other fields from the form can be read, but image URL and status are essential
    const updateTitle = document.getElementById("updateTitle").value.trim() || "Status Update";
    const updateDescription = document.getElementById("updateDescription").value.trim() || "Department updated the status.";
    const updateStatus = document.getElementById("updateStatus").value;
    const fileInput = document.getElementById("updateImage");
    
    if (!complaintId) return toast("Enter Complaint ID.");
    
    setButtonLoading(btn, true, "Uploading...", "Post Update");
    try {
      const file = fileInput.files?.[0];
      let proofImageUrl = "";
      if (file) {
        const dataUrl = await readFileAsDataURL(file);
        proofImageUrl = await uploadDataUrlToStorage(dataUrl, `updates/${complaintId}-${Date.now()}.jpg`);
      }
      
      const q = query(complaintsRef, where("complaintId", "==", complaintId), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        toast("Complaint not found.");
        return;
      }
      const targetDoc = snap.docs[0];
      
      const updateData = {
        status: updateStatus,
        updatedAt: serverTimestamp(),
        updatedBy: "Department",
        resolvedAt: updateStatus === "Resolved" ? serverTimestamp() : null
      };

      if (proofImageUrl) updateData.proofImageUrl = proofImageUrl;

      await updateDoc(targetDoc.ref, updateData);

      // Create an update notification in updatesRef
      await addDoc(updatesRef, {
        complaintId: complaintId,
        title: updateTitle,
        description: updateDescription,
        status: updateStatus,
        proofImageUrl: proofImageUrl,
        userName: "Department",
        createdAt: serverTimestamp()
      });
      
      toast("Update posted successfully.");
      newForm.reset();
      
      // Auto-refresh the lists locally
      renderAdminComplaintsTable();
      renderAllComplaintsTable();
    } catch (err) {
      console.error(err);
      toast("Failed to post update.");
    } finally {
      setButtonLoading(btn, false, "Uploading...", "Post Update");
    }
  });
}

// --- FEATURE 1: Chatbot (User Portal) ---
function initChatbot() {
  if (!isIndexPage) return;

  const botStyles = document.createElement('style');
  botStyles.textContent = `
    .chat-widget {
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      font-family: 'Epilogue', sans-serif;
    }
    .chat-btn {
      width: 60px; height: 60px; border-radius: 50%;
      background: #0f172a; border: 2px solid #ACEDFF;
      color: #ACEDFF; font-size: 24px; cursor: pointer;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      transition: all 0.3s ease;
    }
    .chat-btn:hover { transform: scale(1.05); }
    .chat-window {
      position: absolute; bottom: 75px; right: 0;
      width: 320px; height: 450px; background: #0f172a;
      border: 1px solid rgba(172, 237, 255, 0.2);
      border-radius: 12px; display: none; flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden;
    }
    .chat-window.open { display: flex; animation: fadeUp 0.3s ease; }
    .chat-header {
      background: #1e293b; padding: 15px; color: #ACEDFF;
      font-weight: 600; display: flex; justify-content: space-between;
      align-items: center; border-bottom: 1px solid rgba(172, 237, 255, 0.1);
    }
    .chat-close { cursor: pointer; color: #fff; font-size: 20px; }
    .chat-body {
      flex: 1; padding: 15px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 10px;
    }
    .chat-msg { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 14px; }
    .chat-msg.bot { background: #334155; color: #fff; border-bottom-left-radius: 4px; align-self: flex-start; }
    .chat-msg.user { background: #ACEDFF; color: #000; border-bottom-right-radius: 4px; align-self: flex-end; font-weight: 500; }
    .chat-input-area {
      display: flex; padding: 10px; background: #1e293b;
      border-top: 1px solid rgba(172, 237, 255, 0.1); gap: 8px;
    }
    .chat-input {
      flex: 1; background: #0f172a; border: none; outline: none;
      color: #fff; padding: 10px 15px; border-radius: 20px; font-family: inherit; font-size: 14px;
    }
    .chat-mic-btn {
      background: transparent; color: #ACEDFF; border: none; cursor: pointer;
      font-size: 18px; padding: 0 10px;
    }
    .chat-mic-btn.recording { color: #ef4444; animation: pulse 1.5s infinite; }
    .typing-indicator { display: flex; gap: 4px; padding: 12px 14px; background: #334155; border-radius: 18px; width: fit-content; border-bottom-left-radius: 4px;}
    .typing-indicator span { width: 6px; height: 6px; background: #fff; border-radius: 50%; opacity: 0.2; }
    .typing-indicator span:nth-child(1) { animation: tblink 1.4s infinite alternate; }
    .typing-indicator span:nth-child(2) { animation: tblink 1.4s infinite alternate 0.2s; }
    .typing-indicator span:nth-child(3) { animation: tblink 1.4s infinite alternate 0.4s; }
    @keyframes tblink { to { opacity: 1; } }
  `;
  document.head.appendChild(botStyles);

  const widget = document.createElement('div');
  widget.className = 'chat-widget';
  widget.innerHTML = `
    <div class="chat-window" id="chatWindow">
      <div class="chat-header">
        <span>SentriX AI Assistant</span>
        <span class="chat-close" id="chatClose">×</span>
      </div>
      <div class="chat-body" id="chatBody"></div>
      <form class="chat-input-area" id="chatForm">
        <input type="text" class="chat-input" id="chatInput" placeholder="Type or speak..." autocomplete="off">
        <button type="button" class="chat-mic-btn" id="chatMic" title="Voice Input">🎤</button>
        <button type="submit" style="display:none;"></button>
      </form>
    </div>
    <div class="chat-btn" id="chatBtn" title="AI Assistant">💬</div>
  `;
  document.body.appendChild(widget);

  const chatBtn = document.getElementById('chatBtn');
  const chatWindow = document.getElementById('chatWindow');
  const chatClose = document.getElementById('chatClose');
  const chatBody = document.getElementById('chatBody');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const chatMic = document.getElementById('chatMic');

  chatBtn.onclick = () => chatWindow.classList.add('open');
  chatClose.onclick = () => chatWindow.classList.remove('open');

  function addMsg(text, sender) {
    const d = document.createElement('div');
    d.className = `chat-msg ${sender}`;
    d.textContent = text;
    chatBody.appendChild(d);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = `typing-indicator`;
    d.id = 'typingIndicator';
    d.innerHTML = `<span></span><span></span><span></span>`;
    chatBody.appendChild(d);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function hideTyping() {
    const t = document.getElementById('typingIndicator');
    if (t) t.remove();
  }

  const responses = {
    "hello": "Hello! I am the SentriX AI assistant. How can I help you today?",
    "hi": "Hi there! I am the SentriX AI assistant. How can I help you today?",
    "submit": "You can submit a complaint by navigating to the home section, filling out details like title and location, and tapping submit.",
    "report": "You can report an issue by filling out the form on the landing page with an image and description.",
    "track": "To track your complaint, go to 'My Activity' or enter your complaint ID in the tracking section to view live status.",
    "status": "Check the tracking page to see live complaint status updates, including assigned departments and ETA.",
    "emergency": "If this is a severe emergency (fire, accident, active crime), please call 112 or 100 immediately.",
    "water": "Water complaints are typically directed to the Water Supply department. They usually resolve within 48h.",
    "light": "Electrical issues are escalated to the Electricity Dept, taking 24-48 hours depending on severity.",
    "default": "I can help you file a complaint, or track an existing one. If you want to auto-fill a complaint, just describe it to me!"
  };

  const getResponse = (query) => {
    query = query.toLowerCase();
    
    // AI Agent Auto-Fill Logic
    const complaintKeywords = ["pothole", "leak", "fire", "garbage", "trash", "broken", "accident", "electricity", "power", "water", "road", "crime", "robbery", "harassment"];
    const hasComplaintKeyword = complaintKeywords.some(kw => query.includes(kw));

    if (hasComplaintKeyword && query.length > 10) {
      const cTitle = document.getElementById('ctitle');
      const cDesc = document.getElementById('cdesc');
      if (cTitle && cDesc) {
        cTitle.value = "AI Auto-filled Complaint";
        cDesc.value = query.charAt(0).toUpperCase() + query.slice(1);
        if (typeof window.goPage === 'function') window.goPage('submit');
        return "I have detected a complaint description! I've opened the submission form and auto-filled your details. Please add your location and submit!";
      }
    }

    for (let key in responses) {
      if (key !== 'default' && query.includes(key)) {
        return responses[key];
      }
    }
    return responses["default"];
  };

  setTimeout(() => addMsg("Hi there! Try asking how to submit or track a complaint, or simply dictate an issue.", "bot"), 500);

  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const val = chatInput.value.trim();
    if (!val) return;
    addMsg(val, "user");
    chatInput.value = "";
    
    showTyping();
    setTimeout(() => {
      hideTyping();
      addMsg(getResponse(val), "bot");
    }, 400); // Fast response per rules
  };

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => chatMic.classList.add('recording');
    recognition.onresult = (e) => {
      chatInput.value = e.results[0][0].transcript;
      chatForm.dispatchEvent(new Event('submit'));
    };
    recognition.onerror = () => chatMic.classList.remove('recording');
    recognition.onend = () => chatMic.classList.remove('recording');

    // Make mic button toggle
    chatMic.onclick = () => {
      if (chatMic.classList.contains('recording')) {
        recognition.stop();
      } else {
        recognition.start();
      }
    };
  } else {
    chatMic.style.display = 'none';
  }
}

// Hook functionality onto load without disrupting existing DOMContentLoaded items
setTimeout(() => {
  initReturnWorkflow();
  initChatbot();
}, 800);

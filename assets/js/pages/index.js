import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

function isConfigValid(cfg) {
	return (
		cfg && typeof cfg.apiKey === "string" && !cfg.apiKey.startsWith("YOUR_") && cfg.apiKey.length > 10 &&
		typeof cfg.authDomain === "string" && !cfg.authDomain.startsWith("YOUR_") &&
		typeof cfg.projectId === "string" && !cfg.projectId.startsWith("YOUR_") &&
		typeof cfg.appId === "string" && !cfg.appId.startsWith("YOUR_")
	);
}

if (!isConfigValid(firebaseConfig)) {
	window.location.href = "pages/auth.html";
	throw new Error("Invalid Firebase config");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const userNameEl = document.getElementById("user-name");
const signOutBtn = document.getElementById("sign-out");

onAuthStateChanged(auth, (user) => {
	if (!user) {
		window.location.href = "pages/auth.html";
		return;
	}
	userNameEl.textContent = user.displayName || user.email;
});

signOutBtn?.addEventListener("click", async () => {
	await signOut(auth);
	window.location.href = "pages/auth.html";
});

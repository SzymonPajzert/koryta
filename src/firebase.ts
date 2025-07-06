import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
  authDomain: "koryta-pl.firebaseapp.com",
  databaseURL: "https://koryta-pl-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "koryta-pl",
  storageBucket: "koryta-pl.firebasestorage.app",
  messagingSenderId: "735903577811",
  appId: "1:735903577811:web:6862ab6d2e0a46fa4e8626",
  measurementId: "G-PL6L1B0CZY"
};

if (isTest()) {
  firebaseConfig.apiKey = ""
  firebaseConfig.projectId = "demo-test-project"
}

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'europe-west1');

export function isTest() {
  return ((location.hostname === "localhost" || location.hostname == "127.0.0.1"));
}

if (isTest()) {
  connectDatabaseEmulator(db, "127.0.0.1", 9003);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001)
}


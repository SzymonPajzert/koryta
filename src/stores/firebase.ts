import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getDatabase(app);
export const auth = getAuth(app);

import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAMnBlMr6R0g3wNwpEJKRjRc9o4RCoLpUc",
    authDomain: "mcp-memory-srv-prust.firebaseapp.com",
    projectId: "mcp-memory-srv-prust",
    storageBucket: "mcp-memory-srv-prust.firebasestorage.app",
    messagingSenderId: "434175230947",
    appId: "1:434175230947:web:3de6467802a7c8813b96d6",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

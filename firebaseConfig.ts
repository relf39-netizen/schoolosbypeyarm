
import { initializeApp, getApps, getApp } from 'firebase/app';
// Consolidated all Firestore named exports into a single import statement.
// This resolves "no exported member" errors that can occur in certain TypeScript/Vite configurations 
// when splitting value and type imports from the same Firebase module.
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  updateDoc, 
  where, 
  doc, 
  getDoc, 
  addDoc, 
  deleteDoc, 
  getDocs, 
  setDoc,
  Timestamp,
  QuerySnapshot,
  DocumentData
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "วาง API Key ของคุณที่นี่",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "วาง Auth Domain ของคุณที่นี่",
    projectId: process.env.FIREBASE_PROJECT_ID || "วาง Project ID ของคุณที่นี่",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "วาง Storage Bucket ของคุณที่นี่",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "วาง Messaging Sender ID ของคุณที่นี่",
    appId: process.env.FIREBASE_APP_ID || "วาง App ID ของคุณที่นี่"
};

export const isConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey.length > 10;

let app: any = null;
let db: any = null;
let auth: any = null;

if (isConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (error) {
    console.warn("Firebase initialization failed:", error);
  }
}

// Export modular functions and properties for use across components
export { 
  db, 
  auth, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  updateDoc, 
  where, 
  doc, 
  getDoc, 
  addDoc, 
  deleteDoc, 
  getDocs, 
  setDoc,
  Timestamp
};

export type { QuerySnapshot, DocumentData };

export default app;

import { initializeApp, getApps, getApp } from 'firebase/app';

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

/**
 * Firebase Configuration
 *
 * หมายเหตุ:
 * ระบบปัจจุบันไม่ได้ใช้งาน Firebase แล้ว
 * แต่ยังคงไฟล์และ exports เดิมไว้ เพื่อไม่ให้กระทบ
 * Component เก่าที่อาจยัง import จากไฟล์นี้
 *
 * จึงปิดการ initialize Firebase ไว้โดยตั้งค่าเป็นค่าว่าง
 */

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

/**
 * ปิดการใช้งาน Firebase
 * ระบบปัจจุบันใช้ Server/API และ MySQL
 */
export const isConfigured = false;

let app: any = null;
let db: any = null;
let auth: any = null;

/**
 * เก็บโครงสร้าง initialization เดิมไว้
 * เผื่อจำเป็นต้องเปิด Firebase ในอนาคต
 *
 * ขณะนี้ isConfigured = false
 * ดังนั้นส่วนนี้จะไม่ทำงาน
 */
if (isConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (error) {
    console.warn("Firebase initialization failed:", error);
  }
}

/**
 * คง exports เดิมทั้งหมดไว้
 * เพื่อไม่ให้ Component อื่นที่ยัง import ฟังก์ชันเหล่านี้เสียหาย
 */
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

export type {
  QuerySnapshot,
  DocumentData
};

export default app;
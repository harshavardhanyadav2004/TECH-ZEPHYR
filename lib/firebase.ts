// lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: 'AIzaSyCNwfSoCblga6n48etIAjDBwuw5LB9u98I',
  authDomain: 'life-rpg-ac9c6.firebaseapp.com',
  projectId: 'life-rpg-ac9c6',
  storageBucket: 'life-rpg-ac9c6.firebasestorage.app',
  messagingSenderId: '96438688131',
  appId: '1:96438688131:web:a9dca798f543404816feb6',
  measurementId: 'G-MSP8B51R3S',
}

// Reuse the existing app instance on hot reloads / multiple imports.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Analytics only works in the browser and only if the browser supports it,
// so guard it — calling getAnalytics() during server-side rendering throws.
export let analytics: ReturnType<typeof getAnalytics> | undefined
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app)
  })
}
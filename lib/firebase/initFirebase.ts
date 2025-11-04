import { FirebaseApp, initializeApp, getApps } from 'firebase/app'
import { getStorage } from 'firebase/storage'

let app: FirebaseApp | undefined

export function initFirebase() {
  if (!app) {
    const config = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    }
    
    // Validate required config
    if (!config.apiKey || !config.storageBucket) {
      throw new Error('Firebase configuration is incomplete. Please check your .env.local file.')
    }
    
    if (!getApps().length) {
      app = initializeApp(config)
    } else {
      app = getApps()[0]
    }
  }
  return { app: app!, storage: getStorage(app!) }
}


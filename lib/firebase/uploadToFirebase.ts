"use client"

import { initFirebase } from './initFirebase'
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'

export async function uploadToFirebase(file: File, onProgress?: (p: number) => void) {
  const { storage } = initFirebase()
  const path = `uploads/${Date.now()}-${file.name}`
  const storageRef = ref(storage, path)
  const task = uploadBytesResumable(storageRef, file, { contentType: file.type })
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
      onProgress?.(progress)
    }, reject, () => resolve())
  })
  const url = await getDownloadURL(task.snapshot.ref)
  return { url, path }
}


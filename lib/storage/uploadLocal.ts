export async function uploadToLocal(file: File, onProgress?: (p: number) => void): Promise<{ url: string; path: string }> {
  const formData = new FormData()
  formData.append('file', file)
  
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100)
        onProgress?.(percent)
      }
    })
    
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText)
        resolve({ url: response.url, path: response.path })
      } else {
        const error = xhr.responseText ? JSON.parse(xhr.responseText) : { error: 'Upload failed' }
        reject(new Error(error.error || `Upload failed: ${xhr.statusText}`))
      }
    })
    
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
    
    xhr.open('POST', '/api/upload')
    xhr.send(formData)
  })
}


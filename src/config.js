// Configuration for development and production
// In development: uses local backend
// In production: uses environment variable or Render backend URL
export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080'; 
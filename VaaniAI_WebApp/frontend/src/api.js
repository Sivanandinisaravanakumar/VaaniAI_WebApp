import { supabase } from './supabase.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function requestHeaders(initial = {}, requireAuth = true) {
  const headers = new Headers(initial);
  if (requireAuth && supabase) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message || 'Could not read your login session.');
    const token = data?.session?.access_token;
    if (!token) throw new Error('Please sign in again to continue.');
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function handleResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { detail: await response.text() };
  if (!response.ok) {
    const message = typeof payload.detail === 'string'
      ? payload.detail
      : payload.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

async function apiFetch(path, options = {}, requireAuth = true) {
  const headers = await requestHeaders(options.headers || {}, requireAuth);
  return handleResponse(await fetch(`${API_BASE}${path}`, { ...options, headers }));
}

export function getHealth() {
  return apiFetch('/api/health', {}, false);
}

export function getPublicConfig() {
  return apiFetch('/api/config/public', {}, false);
}

export function getHistory() {
  return apiFetch('/api/history?limit=50');
}

export function getHistoryDetail(id) {
  return apiFetch(`/api/history/${encodeURIComponent(id)}`);
}

export function startInterview(body) {
  return apiFetch('/api/interviews/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function transcribeAnswer(interviewId, wavBlob, candidateName) {
  const form = new FormData();
  form.append('audio_file', wavBlob, 'vaaniai-answer.wav');
  form.append('candidate_name', candidateName);
  return apiFetch(`/api/interviews/${encodeURIComponent(interviewId)}/transcribe`, {
    method: 'POST',
    body: form,
  });
}

export function submitAnswer(interviewId, body) {
  return apiFetch(`/api/interviews/${encodeURIComponent(interviewId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function selectAttempt(interviewId, attemptNumber) {
  return apiFetch(`/api/interviews/${encodeURIComponent(interviewId)}/select-attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_number: attemptNumber }),
  });
}

export function audioDataUrl(base64, mime) {
  if (!base64 || !mime) return '';
  return `data:${mime};base64,${base64}`;
}

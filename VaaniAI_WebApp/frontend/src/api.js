const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

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

export async function getHealth() {
  return handleResponse(await fetch(`${API_BASE}/api/health`));
}

export async function getPublicConfig() {
  return handleResponse(await fetch(`${API_BASE}/api/config/public`));
}

export async function getHistory() {
  return handleResponse(await fetch(`${API_BASE}/api/history?limit=50`));
}

export async function getHistoryDetail(id) {
  return handleResponse(await fetch(`${API_BASE}/api/history/${id}`));
}

export async function startInterview(body) {
  return handleResponse(await fetch(`${API_BASE}/api/interviews/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function transcribeAnswer(interviewId, wavBlob, candidateName) {
  const form = new FormData();
  form.append('audio_file', wavBlob, 'vaaniai-answer.wav');
  form.append('candidate_name', candidateName);
  return handleResponse(await fetch(`${API_BASE}/api/interviews/${interviewId}/transcribe`, {
    method: 'POST',
    body: form,
  }));
}

export async function submitAnswer(interviewId, body) {
  return handleResponse(await fetch(`${API_BASE}/api/interviews/${interviewId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function selectAttempt(interviewId, attemptNumber) {
  return handleResponse(await fetch(`${API_BASE}/api/interviews/${interviewId}/select-attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_number: attemptNumber }),
  }));
}

export function audioDataUrl(base64, mime) {
  if (!base64 || !mime) return '';
  return `data:${mime};base64,${base64}`;
}

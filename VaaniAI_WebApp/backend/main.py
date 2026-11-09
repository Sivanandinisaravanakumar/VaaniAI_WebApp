from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import sqlite3
import time
import uuid
import wave
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from google import genai
    from google.genai import types
except ImportError:  # App can still run in local fallback mode.
    genai = None
    types = None

try:
    from gtts import gTTS
except ImportError:
    gTTS = None


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

GNANI_API_KEY = os.getenv("GNANI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

GNANI_STT_URL = os.getenv("GNANI_STT_URL", "https://api.vachana.ai/stt/v3").strip()
GNANI_TTS_URL = os.getenv(
    "GNANI_TTS_URL", "https://api.vachana.ai/api/v1/tts/inference"
).strip()
GNANI_STT_MODEL = os.getenv("GNANI_STT_MODEL", "prisma-v3.0").strip()
GNANI_TTS_MODEL = os.getenv("GNANI_TTS_MODEL", "timbre-v3.0").strip()
GNANI_TTS_VOICE = os.getenv("GNANI_TTS_VOICE", "Shivani").strip()
GNANI_TTS_LANGUAGE = os.getenv("GNANI_TTS_LANGUAGE", "en-IN").strip()
try:
    GNANI_TTS_SPEED = float(os.getenv("GNANI_TTS_SPEED", "1.0"))
except ValueError:
    GNANI_TTS_SPEED = 1.0
GNANI_TTS_SPEED = min(1.15, max(0.85, GNANI_TTS_SPEED))

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
GEMINI_FALLBACK_MODELS = [
    item.strip()
    for item in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.7-flash").split(",")
    if item.strip()
]
MAX_AUDIO_SECONDS = int(os.getenv("MAX_AUDIO_SECONDS", "120"))
CHUNK_SECONDS = int(os.getenv("GNANI_CHUNK_SECONDS", "28"))
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(ROOT_DIR / "vaaniai.db")))

FRONTEND_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")


# -----------------------------------------------------------------------------
# App setup
# -----------------------------------------------------------------------------

app = FastAPI(
    title="VaaniAI API",
    version="2.0.0",
    description="Voice-based English placement interview coach API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in FRONTEND_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interviews (
                id TEXT PRIMARY KEY,
                candidate_name TEXT NOT NULL,
                target_role TEXT NOT NULL,
                interview_type TEXT NOT NULL,
                total_questions INTEGER NOT NULL,
                question_number INTEGER NOT NULL,
                current_question TEXT NOT NULL,
                history_json TEXT NOT NULL,
                memory_json TEXT NOT NULL,
                pending_attempts_json TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                report_json TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT
            )
            """
        )
        conn.commit()


init_db()


# -----------------------------------------------------------------------------
# Local question bank and response schemas
# -----------------------------------------------------------------------------

QUESTION_BANK: Dict[str, List[str]] = {
    "Full Placement Interview": [
        "Could you introduce yourself and describe your academic background?",
        "Could you explain one academic or personal project and your contribution to it?",
        "Which programming language or technical skill are you most comfortable with, and how have you used it?",
        "Tell me about a technical challenge you faced and how you approached it.",
        "Why are you interested in this role, and what skills would you like to develop next?",
        "How do you work with a team when solving a difficult problem?",
        "Where do you see yourself growing professionally over the next few years?",
    ],
    "HR Interview": [
        "Could you introduce yourself and describe your academic background?",
        "What are your key strengths, and how have you demonstrated them?",
        "Tell me about a challenge you faced and how you handled it.",
        "How do you respond to feedback or suggestions from others?",
        "Why should we consider you for this role?",
        "What are your short-term and long-term career goals?",
    ],
    "Technical Interview": [
        "Could you introduce your technical background and strongest programming skills?",
        "Explain the difference between supervised and unsupervised machine learning.",
        "How would you preprocess a dataset before training a machine learning model?",
        "How would you evaluate a classification model beyond accuracy?",
        "Describe one technical project and the design decisions you made.",
        "How would you debug a program that produces an unexpected result?",
    ],
    "Project-Based Interview": [
        "Could you describe a project you have worked on and the problem it addresses?",
        "What was your specific contribution to the project?",
        "Which tools or technologies did you use, and why did you select them?",
        "What was the most difficult issue you faced during development?",
        "How did you test whether your project worked correctly?",
        "What would you improve if you continued developing this project?",
    ],
}

FIRST_QUESTION_SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
}

FEEDBACK_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "feedback": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "next_question": {"type": "string"},
    },
    "required": ["score", "feedback", "strengths", "improvements", "next_question"],
}

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_score": {"type": "integer"},
        "communication_score": {"type": "integer"},
        "answer_relevance_score": {"type": "integer"},
        "structure_score": {"type": "integer"},
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "practice_plan": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "overall_score", "communication_score", "answer_relevance_score",
        "structure_score", "summary", "strengths", "improvements", "practice_plan",
    ],
}


# -----------------------------------------------------------------------------
# Gemini helpers and transparent local fallback
# -----------------------------------------------------------------------------

_gemini_client = None
_gemini_client_key = None


def get_gemini_client():
    global _gemini_client, _gemini_client_key
    if not GEMINI_API_KEY or genai is None:
        raise RuntimeError("Gemini is not configured. Local interview mode will be used.")
    if _gemini_client is None or _gemini_client_key != GEMINI_API_KEY:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        _gemini_client_key = GEMINI_API_KEY
    return _gemini_client


def classify_gemini_error(error: Exception) -> str:
    msg = str(error).lower()
    if any(token in msg for token in ("429", "resource_exhausted", "quota", "rate limit", "requests per day")):
        return "quota"
    if any(token in msg for token in ("503", "unavailable", "high demand", "overloaded", "502", "504", "timed out")):
        return "temporary"
    if any(token in msg for token in ("404", "not found", "unknown model", "unsupported model")):
        return "model"
    return "other"


def gemini_json(prompt: str, schema: Dict[str, Any], max_output_tokens: int = 500) -> Dict[str, Any]:
    client = get_gemini_client()
    models: List[str] = []
    for name in [GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]:
        if name and name not in models:
            models.append(name)
    errors: List[str] = []
    for index, model in enumerate(models[:3]):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=schema,
                    temperature=0.25,
                    max_output_tokens=max_output_tokens,
                ),
            )
            text = (response.text or "").strip()
            if not text:
                raise RuntimeError(f"{model} returned an empty response")
            data = json.loads(text)
            if not isinstance(data, dict):
                raise RuntimeError("Gemini returned an invalid JSON object")
            return data
        except Exception as exc:
            kind = classify_gemini_error(exc)
            errors.append(f"{model}: {exc}")
            # Do not retry a quota-exhausted model. One configured backup may still work.
            if kind in {"quota", "model"}:
                continue
            if kind == "temporary" and index == 0:
                time.sleep(0.35)
                continue
            if kind == "other":
                # Authentication/configuration errors are common across the project.
                break
    raise RuntimeError("All configured Gemini models are unavailable. " + " | ".join(errors[-3:]))


def safe_int(value: Any, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def explicit_memory_facts(answer: str) -> List[str]:
    """Only store terms literally present in the candidate-verified transcript."""
    terms = [
        "Python", "Java", "C++", "SQL", "IoT", "Arduino", "Machine Learning",
        "Artificial Intelligence", "Cloud Monitoring System", "Smart Agriculture",
        "Loan Eligibility Prediction", "Infosys Springboard", "TensorFlow", "PyTorch",
        "scikit-learn", "Pandas", "NumPy", "Random Forest", "Logistic Regression",
    ]
    facts = []
    for term in terms:
        if re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", answer, re.IGNORECASE):
            facts.append(f"Candidate mentioned: {term}")
    return facts[:6]


def local_followup(interview_type: str, answer: str, prior_questions: List[str]) -> str:
    text = answer.lower()
    options: List[str] = []
    if any(word in text for word in ("python", "java", "sql", "programming")):
        options.append("Could you give one specific example of how you used that programming skill to solve a problem?")
    if any(word in text for word in ("cloud", "monitoring", "iot", "sensor")):
        options.append("What was your specific contribution to that project, and how did you test it?")
    if any(word in text for word in ("machine learning", "model", "dataset", "prediction")):
        options.append("Which model or algorithm would you choose, and how would you evaluate its performance?")
    options.extend(QUESTION_BANK.get(interview_type, QUESTION_BANK["Full Placement Interview"])[1:])
    seen = {q.casefold() for q in prior_questions}
    for option in options:
        if option.casefold() not in seen:
            return option
    return "Could you explain one specific example that demonstrates your problem-solving skills?"


def rule_based_feedback(answer: str, question_number: int, total_questions: int,
                        interview_type: str, prior_questions: List[str]) -> Dict[str, Any]:
    words = re.findall(r"\b[\w+#.-]+\b", answer)
    count = len(words)
    lower = answer.lower()
    score = 5
    if count < 15:
        score -= 2
    elif count >= 45:
        score += 1
    if count >= 90:
        score += 1
    if any(x in lower for x in ("for example", "such as", "because", "first", "then", "finally")):
        score += 1
    if any(x in lower for x in ("python", "java", "sql", "project", "machine learning", "model", "dataset")):
        score += 1
    score = max(2, min(8, score))
    strengths = [f"Your response contains {count} words."]
    if count >= 45:
        strengths.append("You provided enough detail to develop an interview answer.")
    if any(x in lower for x in ("for example", "such as", "because")):
        strengths.append("You included an explanation or example.")
    improvements = []
    if count < 45:
        improvements.append("Add more detail and explain the steps you personally took.")
    if not any(x in lower for x in ("for example", "such as", "for instance")):
        improvements.append("Include one specific example from your studies or project work.")
    if not improvements:
        improvements.append("State the result or what you learned to make the answer more complete.")
    next_question = "" if question_number >= total_questions else local_followup(interview_type, answer, prior_questions)
    return {
        "score": score,
        "feedback": "Gemini is unavailable. This is a basic rule-based practice review based on answer length and detail indicators; it is not an AI evaluation.",
        "strengths": strengths[:3],
        "improvements": improvements[:3],
        "next_question": next_question,
        "evaluation_mode": "Local rule-based fallback",
    }


# -----------------------------------------------------------------------------
# Interview question and report generation
# -----------------------------------------------------------------------------


def first_question(candidate_name: str, target_role: str, interview_type: str) -> Tuple[str, str]:
    prompt = (
        "You are VaaniAI, a friendly professional Indian campus placement interviewer. "
        "Conduct the interview in clear English. Ask only one first question. "
        f"Candidate: {candidate_name}. Role: {target_role}. Type: {interview_type}. "
        "For a full placement interview, start with self-introduction."
    )
    try:
        data = gemini_json(prompt, FIRST_QUESTION_SCHEMA, 120)
        question = str(data.get("question", "")).strip()
        if question:
            return question, "Gemini"
    except Exception:
        pass
    bank = QUESTION_BANK.get(interview_type, QUESTION_BANK["Full Placement Interview"])
    return f"Hello {candidate_name}, welcome to your placement interview. {bank[0]}", "Local question bank"


def evaluate_answer(candidate_name: str, target_role: str, interview_type: str,
                    question_number: int, total_questions: int, question: str,
                    answer: str, history: List[Dict[str, Any]], memory: List[str]) -> Dict[str, Any]:
    compact_history = [
        {"question": str(item.get("question", ""))[:250],
         "answer": str(item.get("verified_answer", ""))[:650]}
        for item in history[-3:]
    ]
    is_last = question_number >= total_questions
    prompt = f"""
You are VaaniAI, a fair, supportive professional placement interviewer.
Evaluate ONLY the candidate's verified answer. Never rewrite or change the transcript.
Do not invent candidate experience. Do not infer internship, project, tools, college or skills
unless they appear explicitly in the verified answer or earlier verified answers.
Do not penalize Indian English accent.
Candidate: {candidate_name}; target role: {target_role}; type: {interview_type}.
Question {question_number} of {total_questions}.
Current interview question: {question}
Verified candidate answer: {answer}
Earlier verified interview turns: {json.dumps(compact_history, ensure_ascii=False)}
Verified memory terms: {json.dumps(memory, ensure_ascii=False)}
Return a score 1-10, concise feedback, up to 2 strengths, up to 2 practical improvements.
If not the last question, produce exactly one useful next question based on a detail the candidate
actually stated. You may ask for clarification about a claim, but do not assert that the claim is true.
If last question, next_question must be empty.
"""
    try:
        data = gemini_json(prompt, FEEDBACK_SCHEMA, 450)
        data["score"] = safe_int(data.get("score"), 1, 10, 5)
        data["strengths"] = [str(x) for x in data.get("strengths", [])][:3]
        data["improvements"] = [str(x) for x in data.get("improvements", [])][:3]
        data["evaluation_mode"] = "Gemini AI evaluation"
        data["next_question"] = str(data.get("next_question", "")).strip()
        if is_last:
            data["next_question"] = ""
        elif not data["next_question"]:
            data["next_question"] = "Could you explain one specific example related to your answer?"
        return data
    except Exception:
        result = rule_based_feedback(answer, question_number, total_questions, interview_type,
                                     [str(item.get("question", "")) for item in history] + [question])
        result["fallback_reason"] = "AI provider unavailable or quota exhausted."
        return result


def final_report(candidate_name: str, role: str, interview_type: str,
                 history: List[Dict[str, Any]]) -> Dict[str, Any]:
    prompt = f"""
Create a concise placement interview practice report using ONLY the verified interview records.
Candidate: {candidate_name}; target role: {role}; interview type: {interview_type}.
Records: {json.dumps(history, ensure_ascii=False)[:9500]}
Return integer scores 0-100 for overall, communication, answer relevance and answer structure.
Give a concise summary, up to 3 strengths, up to 3 improvements and 3 practical practice steps.
Do not infer personality, facial expression, confidence from video, or unmentioned experience.
"""
    try:
        data = gemini_json(prompt, REPORT_SCHEMA, 550)
        for key in ("overall_score", "communication_score", "answer_relevance_score", "structure_score"):
            data[key] = safe_int(data.get(key), 0, 100, 60)
        for key in ("strengths", "improvements", "practice_plan"):
            data[key] = [str(x) for x in data.get(key, [])][:4]
        data["report_mode"] = "Gemini AI report"
        return data
    except Exception:
        scores = [safe_int(item.get("score"), 1, 10, 5) for item in history]
        average = round(sum(scores) / max(1, len(scores)) * 10)
        strengths = list(dict.fromkeys(
            s for item in history for s in item.get("strengths", [])
        ))[:3] or ["You completed the interview practice session."]
        improvements = list(dict.fromkeys(
            s for item in history for s in item.get("improvements", [])
        ))[:3] or ["Practise structured answers with specific examples."]
        return {
            "overall_score": average,
            "communication_score": average,
            "answer_relevance_score": average,
            "structure_score": average,
            "summary": "This is a local practice report because the AI provider was unavailable. Scores are approximate rule-based estimates, not an AI assessment or hiring decision.",
            "strengths": strengths,
            "improvements": improvements,
            "practice_plan": [
                "Practise each answer aloud and keep it focused on the question.",
                "Use one specific example to support important claims.",
                "Review your transcript and repeat the weakest answer.",
            ],
            "report_mode": "Local rule-based fallback",
        }


# -----------------------------------------------------------------------------
# Audio handling: Gnani Prisma STT and Timbre TTS with gTTS fallback
# -----------------------------------------------------------------------------


def wav_duration(audio_bytes: bytes) -> float:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            rate = wav.getframerate()
            if rate <= 0:
                raise ValueError("Invalid sample rate in WAV file.")
            return wav.getnframes() / rate
    except (wave.Error, EOFError) as exc:
        raise ValueError("Please record or upload a valid WAV audio file.") from exc


def split_wav(audio_bytes: bytes, seconds: int) -> List[bytes]:
    chunks: List[bytes] = []
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
        params = wav.getparams()
        rate = wav.getframerate()
        total = wav.getnframes()
        frames_per_chunk = max(rate * seconds, 1)
        for start in range(0, total, frames_per_chunk):
            wav.setpos(start)
            frames = wav.readframes(min(frames_per_chunk, total - start))
            out = io.BytesIO()
            with wave.open(out, "wb") as piece:
                piece.setparams(params)
                piece.writeframes(frames)
            chunks.append(out.getvalue())
    return chunks


def transcribe_with_gnani(audio_bytes: bytes, candidate_name: str) -> Dict[str, Any]:
    if not GNANI_API_KEY:
        raise RuntimeError("Gnani STT is not configured. You can type your answer manually.")
    duration = wav_duration(audio_bytes)
    if duration > MAX_AUDIO_SECONDS:
        raise ValueError(f"Recording is {duration:.1f}s. Maximum supported duration is {MAX_AUDIO_SECONDS}s.")
    chunks = split_wav(audio_bytes, CHUNK_SECONDS)
    transcripts: List[str] = []
    last_result: Dict[str, Any] = {}
    previous_text = ""
    for index, chunk in enumerate(chunks, start=1):
        data: Dict[str, str] = {
            "model": GNANI_STT_MODEL,
            "language_code": "en-IN",
            "format": "verbatim",
            "topic": "English Indian college placement interview; preserve every word spoken.",
            "keyterms": json.dumps([
                candidate_name, "VaaniAI", "Python", "Java", "SQL", "IoT",
                "Cloud Monitoring System", "Machine Learning", "Artificial Intelligence",
                "Infosys Springboard", "Loan Eligibility Prediction",
            ]),
            "speaker_names": json.dumps([candidate_name]),
        }
        if previous_text:
            data["previous_text"] = previous_text[-500:]
        response = requests.post(
            GNANI_STT_URL,
            headers={"X-API-Key-ID": GNANI_API_KEY},
            files={"audio_file": (f"answer_{index}.wav", chunk, "audio/wav")},
            data=data,
            timeout=(8, 75),
        )
        try:
            result = response.json()
        except ValueError:
            result = {}
        if not response.ok or not result.get("success"):
            message = result.get("error", {}).get("message", response.text[:350]) if isinstance(result, dict) else response.text[:350]
            raise RuntimeError(f"Gnani transcription failed on audio part {index}: {message}")
        text = str(result.get("transcript", "")).strip()
        if text:
            transcripts.append(text)
            previous_text = text
        last_result = result
    transcript = " ".join(transcripts).strip()
    if not transcript:
        raise RuntimeError("No speech was detected. Please try again or type your answer manually.")
    return {
        "original_transcript": transcript,
        "duration_seconds": round(duration, 2),
        "detected_language": last_result.get("detected_language_code", "en-IN"),
        "model": last_result.get("model", GNANI_STT_MODEL),
        "chunks_processed": len(chunks),
    }


_audio_cache: "OrderedDict[str, Tuple[bytes, str, str]]" = OrderedDict()
_AUDIO_CACHE_LIMIT = 128


def cache_audio(key: str, value: Tuple[bytes, str, str]) -> None:
    _audio_cache[key] = value
    _audio_cache.move_to_end(key)
    while len(_audio_cache) > _AUDIO_CACHE_LIMIT:
        _audio_cache.popitem(last=False)


def make_question_audio(text: str) -> Tuple[bytes, str, str]:
    clean_text = " ".join(text.split()).strip()
    cache_key = hashlib.sha256(
        f"{clean_text}|{GNANI_TTS_MODEL}|{GNANI_TTS_VOICE}|{GNANI_TTS_LANGUAGE}|{GNANI_TTS_SPEED}".encode()
    ).hexdigest()
    if cache_key in _audio_cache:
        _audio_cache.move_to_end(cache_key)
        return _audio_cache[cache_key]

    timbre_error = ""
    if GNANI_API_KEY:
        payload = {
            "text": clean_text,
            "voice": GNANI_TTS_VOICE,
            "model": GNANI_TTS_MODEL,
            "language": GNANI_TTS_LANGUAGE,
            "speed": GNANI_TTS_SPEED,
            "audio_config": {
                "sample_rate": 48000,
                "num_channels": 1,
                "sample_width": 2,
                "encoding": "linear_pcm",
                "container": "wav",
            },
        }
        try:
            response = requests.post(
                GNANI_TTS_URL,
                headers={"X-API-Key-ID": GNANI_API_KEY, "Content-Type": "application/json", "Accept": "audio/wav"},
                json=payload,
                timeout=(5, 35),
            )
            if response.ok and response.content and response.content[:4] == b"RIFF":
                result = (response.content, "audio/wav", f"Gnani Timbre ({GNANI_TTS_MODEL}, {GNANI_TTS_VOICE})")
                cache_audio(cache_key, result)
                return result
            timbre_error = f"Timbre HTTP {response.status_code}: {response.text[:250]}"
        except requests.RequestException as exc:
            timbre_error = str(exc)
    else:
        timbre_error = "GNANI_API_KEY is not configured."

    if gTTS is not None:
        try:
            out = io.BytesIO()
            gTTS(text=clean_text, lang="en", tld="co.in", slow=False).write_to_fp(out)
            result = (out.getvalue(), "audio/mpeg", "gTTS fallback")
            cache_audio(cache_key, result)
            return result
        except Exception as exc:
            timbre_error += f"; gTTS fallback failed: {exc}"
    raise RuntimeError("Unable to generate interviewer audio: " + timbre_error)


def audio_payload(audio: Tuple[bytes, str, str]) -> Dict[str, str]:
    raw, mime, source = audio
    return {
        "audio_base64": base64.b64encode(raw).decode("ascii"),
        "audio_mime": mime,
        "voice_source": source,
    }


# -----------------------------------------------------------------------------
# Database/session helpers
# -----------------------------------------------------------------------------


def get_interview(interview_id: str) -> Dict[str, Any]:
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM interviews WHERE id = ?", (interview_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    data = dict(row)
    for column, key in (
        ("history_json", "history"),
        ("memory_json", "memory"),
        ("pending_attempts_json", "pending_attempts"),
        ("report_json", "report"),
    ):
        raw = data.get(column)
        data[key] = json.loads(raw) if raw else ([] if key in {"history", "memory", "pending_attempts"} else None)
    return data


def save_interview(data: Dict[str, Any]) -> None:
    with db_connect() as conn:
        conn.execute(
            """
            UPDATE interviews SET
                question_number = ?, current_question = ?, history_json = ?, memory_json = ?,
                pending_attempts_json = ?, completed = ?, report_json = ?, completed_at = ?
            WHERE id = ?
            """,
            (
                data["question_number"], data["current_question"],
                json.dumps(data["history"], ensure_ascii=False),
                json.dumps(data["memory"], ensure_ascii=False),
                json.dumps(data["pending_attempts"], ensure_ascii=False),
                int(bool(data["completed"])),
                json.dumps(data["report"], ensure_ascii=False) if data.get("report") else None,
                data.get("completed_at"), data["id"],
            ),
        )
        conn.commit()


# -----------------------------------------------------------------------------
# Request models
# -----------------------------------------------------------------------------

class StartInterviewRequest(BaseModel):
    candidate_name: str = Field(min_length=1, max_length=80)
    target_role: str = Field(default="AI Engineer", max_length=100)
    interview_type: str = Field(default="Full Placement Interview")
    total_questions: int = Field(default=5, ge=3, le=7)


class SubmitAnswerRequest(BaseModel):
    question_number: int = Field(ge=1, le=7)
    attempt_number: int = Field(ge=1, le=2)
    original_transcript: str = Field(default="", max_length=12000)
    verified_answer: str = Field(min_length=1, max_length=12000)
    duration_seconds: float = Field(default=0, ge=0, le=MAX_AUDIO_SECONDS)
    transcript_source: str = Field(default="Gnani Prisma")


class SelectAttemptRequest(BaseModel):
    attempt_number: int = Field(ge=1, le=2)


# -----------------------------------------------------------------------------
# API endpoints
# -----------------------------------------------------------------------------

@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "app": "VaaniAI",
        "version": "2.0.0",
        "gnani_stt_configured": bool(GNANI_API_KEY),
        "gemini_configured": bool(GEMINI_API_KEY),
        "tts_configured": bool(GNANI_API_KEY),
        "primary_gemini_model": GEMINI_MODEL,
    }


@app.post("/api/interviews/start")
def start_interview(payload: StartInterviewRequest) -> Dict[str, Any]:
    name = payload.candidate_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Please enter your name.")
    if payload.interview_type not in QUESTION_BANK:
        raise HTTPException(status_code=422, detail="Select a valid interview type.")
    started = time.perf_counter()
    question, question_source = first_question(name, payload.target_role.strip(), payload.interview_type)
    question_ms = round((time.perf_counter() - started) * 1000)
    voice_source = "Unavailable"
    audio_base64 = ""
    audio_mime = ""
    tts_ms = 0
    tts_warning = ""
    tts_started = time.perf_counter()
    try:
        audio = make_question_audio(question)
        audio_base64, audio_mime, voice_source = audio_payload(audio).values()
    except Exception as exc:
        tts_warning = str(exc)
    tts_ms = round((time.perf_counter() - tts_started) * 1000)

    interview_id = str(uuid.uuid4())
    now = utc_now()
    record = {
        "id": interview_id,
        "candidate_name": name,
        "target_role": payload.target_role.strip() or "Graduate role",
        "interview_type": payload.interview_type,
        "total_questions": payload.total_questions,
        "question_number": 1,
        "current_question": question,
        "history": [],
        "memory": [],
        "pending_attempts": [],
        "completed": False,
        "report": None,
        "started_at": now,
        "completed_at": None,
    }
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO interviews (
                id, candidate_name, target_role, interview_type, total_questions,
                question_number, current_question, history_json, memory_json,
                pending_attempts_json, completed, report_json, started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL)
            """,
            (
                interview_id, record["candidate_name"], record["target_role"],
                record["interview_type"], record["total_questions"], 1, question,
                "[]", "[]", "[]", now,
            ),
        )
        conn.commit()
    return {
        "interview_id": interview_id,
        "candidate_name": name,
        "target_role": record["target_role"],
        "interview_type": record["interview_type"],
        "question_number": 1,
        "total_questions": payload.total_questions,
        "question": question,
        "question_source": question_source,
        "audio_base64": audio_base64,
        "audio_mime": audio_mime,
        "voice_source": voice_source,
        "timings_ms": {"question_generation": question_ms, "voice_generation": tts_ms},
        "warning": tts_warning,
    }


@app.post("/api/interviews/{interview_id}/transcribe")
async def transcribe_answer(
    interview_id: str,
    audio_file: UploadFile = File(...),
    candidate_name: str = Form(default="Candidate"),
) -> Dict[str, Any]:
    get_interview(interview_id)
    if not audio_file.filename or not audio_file.filename.lower().endswith(".wav"):
        raise HTTPException(status_code=415, detail="Please record an answer and send it as WAV audio.")
    audio_bytes = await audio_file.read()
    if len(audio_bytes) > 18 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large. Maximum upload size is 18 MB.")
    started = time.perf_counter()
    try:
        result = transcribe_with_gnani(audio_bytes, candidate_name.strip() or "Candidate")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    result["timings_ms"] = {"transcription": round((time.perf_counter() - started) * 1000)}
    return result


@app.post("/api/interviews/{interview_id}/answer")
def submit_answer(interview_id: str, payload: SubmitAnswerRequest) -> Dict[str, Any]:
    data = get_interview(interview_id)
    if data["completed"]:
        raise HTTPException(status_code=409, detail="This interview has already been completed.")
    if payload.question_number != data["question_number"]:
        raise HTTPException(status_code=409, detail="The submitted answer does not match the current question.")
    if payload.attempt_number != len(data["pending_attempts"]) + 1:
        raise HTTPException(status_code=409, detail="Unexpected attempt number. Please refresh the interview.")
    verified = payload.verified_answer.strip()
    if not verified:
        raise HTTPException(status_code=422, detail="Please verify or type your answer before submitting.")
    started = time.perf_counter()
    feedback = evaluate_answer(
        data["candidate_name"], data["target_role"], data["interview_type"],
        data["question_number"], data["total_questions"], data["current_question"],
        verified, data["history"], data["memory"],
    )
    eval_ms = round((time.perf_counter() - started) * 1000)
    attempt = {
        "attempt_number": payload.attempt_number,
        "original_transcript": payload.original_transcript,
        "verified_answer": verified,
        "transcript_source": payload.transcript_source,
        "duration_seconds": payload.duration_seconds,
        "feedback": feedback,
        "created_at": utc_now(),
    }
    data["pending_attempts"].append(attempt)
    save_interview(data)
    return {
        "attempt": attempt,
        "attempts": data["pending_attempts"],
        "can_retry": len(data["pending_attempts"]) == 1,
        "question_number": data["question_number"],
        "total_questions": data["total_questions"],
        "timings_ms": {"evaluation": eval_ms},
    }


@app.post("/api/interviews/{interview_id}/select-attempt")
def select_attempt(interview_id: str, payload: SelectAttemptRequest) -> Dict[str, Any]:
    data = get_interview(interview_id)
    attempts = data["pending_attempts"]
    selected = next((item for item in attempts if item["attempt_number"] == payload.attempt_number), None)
    if not selected:
        raise HTTPException(status_code=404, detail="Selected attempt not found.")

    feedback = selected["feedback"]
    history_item = {
        "question": data["current_question"],
        "original_transcript": selected["original_transcript"],
        "verified_answer": selected["verified_answer"],
        "transcript_source": selected["transcript_source"],
        "duration_seconds": selected["duration_seconds"],
        "score": feedback.get("score", 5),
        "feedback": feedback.get("feedback", ""),
        "strengths": feedback.get("strengths", []),
        "improvements": feedback.get("improvements", []),
        "attempts": attempts,
        "selected_attempt": selected["attempt_number"],
    }
    data["history"].append(history_item)
    data["memory"] = list(dict.fromkeys(data["memory"] + explicit_memory_facts(selected["verified_answer"])))[:12]
    data["pending_attempts"] = []

    if data["question_number"] >= data["total_questions"]:
        report_started = time.perf_counter()
        report = final_report(data["candidate_name"], data["target_role"], data["interview_type"], data["history"])
        report_ms = round((time.perf_counter() - report_started) * 1000)
        data["completed"] = True
        data["report"] = report
        data["completed_at"] = utc_now()
        save_interview(data)
        return {
            "completed": True,
            "report": report,
            "history": data["history"],
            "memory": data["memory"],
            "timings_ms": {"report_generation": report_ms},
        }

    next_q = str(feedback.get("next_question", "")).strip()
    if not next_q:
        next_q = local_followup(
            data["interview_type"], selected["verified_answer"],
            [str(item.get("question", "")) for item in data["history"]],
        )
    data["question_number"] += 1
    data["current_question"] = next_q
    save_interview(data)

    tts_started = time.perf_counter()
    audio_base64, audio_mime, voice_source = "", "", "Unavailable"
    warning = ""
    try:
        audio = make_question_audio(next_q)
        audio_base64 = base64.b64encode(audio[0]).decode("ascii")
        audio_mime = audio[1]
        voice_source = audio[2]
    except Exception as exc:
        warning = str(exc)
    return {
        "completed": False,
        "question_number": data["question_number"],
        "total_questions": data["total_questions"],
        "question": next_q,
        "question_audio_base64": audio_base64,
        "question_audio_mime": audio_mime,
        "voice_source": voice_source,
        "memory": data["memory"],
        "history": data["history"],
        "warning": warning,
        "timings_ms": {"voice_generation": round((time.perf_counter() - tts_started) * 1000)},
    }


@app.get("/api/history")
def list_history(limit: int = 30) -> Dict[str, Any]:
    limit = max(1, min(100, limit))
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT id, candidate_name, target_role, interview_type, total_questions, started_at, completed_at, report_json, completed FROM interviews ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    items = []
    for row in rows:
        report = json.loads(row["report_json"]) if row["report_json"] else None
        items.append({
            "id": row["id"],
            "candidate_name": row["candidate_name"],
            "target_role": row["target_role"],
            "interview_type": row["interview_type"],
            "total_questions": row["total_questions"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
            "completed": bool(row["completed"]),
            "overall_score": report.get("overall_score") if report else None,
        })
    return {"items": items}


@app.get("/api/history/{interview_id}")
def history_detail(interview_id: str) -> Dict[str, Any]:
    data = get_interview(interview_id)
    return {
        "id": data["id"],
        "candidate_name": data["candidate_name"],
        "target_role": data["target_role"],
        "interview_type": data["interview_type"],
        "total_questions": data["total_questions"],
        "history": data["history"],
        "memory": data["memory"],
        "report": data["report"],
        "completed": data["completed"],
        "started_at": data["started_at"],
        "completed_at": data["completed_at"],
    }


@app.get("/api/config/public")
def public_config() -> Dict[str, Any]:
    """Return only non-secret, user-safe configuration for the frontend."""
    return {
        "app_name": "VaaniAI",
        "max_audio_seconds": MAX_AUDIO_SECONDS,
        "question_types": list(QUESTION_BANK.keys()),
        "question_counts": [3, 5, 7],
    }

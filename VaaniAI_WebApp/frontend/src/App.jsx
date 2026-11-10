import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, AudioLines, BarChart3,
  BookOpen, BrainCircuit, BriefcaseBusiness, Check, CheckCircle2, ChevronRight,
  CircleHelp, Clock3, Cloud, Download, FileAudio, FileText, Headphones,
  History, Home, LoaderCircle, LockKeyhole, Menu, MessageSquareText, Mic,
  MicOff, Pause, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Target,
  TrendingUp, Volume2, WandSparkles, X, Zap,
} from 'lucide-react';
import { supabase } from './supabase.js';
import {
  audioDataUrl, getHealth, getHistory, getHistoryDetail, getPublicConfig,
  selectAttempt, startInterview, submitAnswer, transcribeAnswer,
} from './api.js';

const INTERVIEW_TYPES = [
  { value: 'Full Placement Interview', label: 'Full placement', description: 'A balanced HR and technical interview.', icon: BriefcaseBusiness },
  { value: 'HR Interview', label: 'HR interview', description: 'Communication, teamwork and goals.', icon: MessageSquareText },
  { value: 'Technical Interview', label: 'Technical', description: 'Programming and core technical concepts.', icon: BrainCircuit },
  { value: 'Project-Based Interview', label: 'Project-based', description: 'Explain projects, decisions and contributions.', icon: Cloud },
];

function formatDate(value) {
  if (!value) return 'Not completed';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function encodeWav(audioBuffer, targetSampleRate = 16000) {
  const channels = audioBuffer.numberOfChannels;
  const sourceRate = audioBuffer.sampleRate;
  const sourceLength = audioBuffer.length;
  const mono = new Float32Array(sourceLength);
  for (let channel = 0; channel < channels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < sourceLength; i += 1) mono[i] += channelData[i] / channels;
  }
  const targetLength = Math.max(1, Math.floor(sourceLength * targetSampleRate / sourceRate));
  const resampled = new Float32Array(targetLength);
  const ratio = sourceRate / targetSampleRate;
  for (let i = 0; i < targetLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, sourceLength - 1);
    const fraction = position - left;
    resampled[i] = mono[left] * (1 - fraction) + mono[right] * fraction;
  }
  const bytesPerSample = 2;
  const dataSize = resampled.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < resampled.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function mediaBlobToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Your browser does not support audio recording. Try a recent Chrome or Edge browser.');
  const context = new AudioContextClass();
  try {
    const data = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(data.slice(0));
    return encodeWav(decoded, 16000);
  } finally {
    await context.close();
  }
}

function useRecorder(onReady) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  const stopTracks = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError('');
    setSeconds(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('Microphone recording is not supported by this browser. Use Chrome or Edge on localhost or HTTPS.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => setError('Recording failed. Please check microphone permissions and try again.');
      recorder.onstop = async () => {
        clearInterval(timerRef.current);
        stopTracks();
        setProcessing(true);
        try {
          const source = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const wav = await mediaBlobToWav(source);
          const duration = Math.max(0, (Date.now() - startedAtRef.current) / 1000);
          onReady(wav, duration);
        } catch (conversionError) {
          setError(conversionError.message || 'Could not convert the recording.');
        } finally {
          setProcessing(false);
        }
      };
      recorder.start(250);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 120 && recorderRef.current?.state === 'recording') recorderRef.current.stop();
      }, 250);
    } catch (recordError) {
      stopTracks();
      setError(recordError.message || 'Could not access the microphone.');
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') {
      setRecording(false);
      recorderRef.current.stop();
    }
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stopTracks();
  }, []);

  return { recording, processing, seconds, error, start, stop };
}

function MetricCard({ label, value, suffix = '', icon: Icon, tone = 'blue', note }) {
  return <div className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}{suffix}</div>
    {note && <div className="metric-note">{note}</div>}
  </div>;
}

function ScoreRing({ score }) {
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  return <div className="score-ring" style={{ '--score': `${safe * 3.6}deg` }}>
    <div className="score-ring-inner"><strong>{safe}</strong><span>/ 100</span></div>
  </div>;
}

function VaaniAIApp({ user, onSignOut }) {
  const [page, setPage] = useState('overview');
  const [health, setHealth] = useState(null);
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState({ max_audio_seconds: 120, question_types: INTERVIEW_TYPES.map((item) => item.value), question_counts: [3, 5, 7] });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const [candidateName, setCandidateName] = useState(user?.user_metadata?.full_name || '');
  const [targetRole, setTargetRole] = useState('AI Engineer');
  const [interviewType, setInterviewType] = useState('Full Placement Interview');
  const [totalQuestions, setTotalQuestions] = useState(5);

  const [interview, setInterview] = useState(null);
  const [audioBlob, setAudioBlob] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [verifiedAnswer, setVerifiedAnswer] = useState('');
  const [transcriptSource, setTranscriptSource] = useState('Gnani Prisma');
  const [transcriptionLoading, setTranscriptionLoading] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [selectingLoading, setSelectingLoading] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [report, setReport] = useState(null);
  const [reportDetail, setReportDetail] = useState(null);
  const [timings, setTimings] = useState({ transcription: null, evaluation: null, voice: null });
  const [manualMode, setManualMode] = useState(false);

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [healthData, historyData, configData] = await Promise.all([getHealth(), getHistory(), getPublicConfig()]);
      setHealth(healthData);
      setHistory(historyData.items || []);
      setConfig(configData);
    } catch (loadError) {
      setError(`Could not connect to VaaniAI backend: ${loadError.message}`);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshDashboard(); }, [refreshDashboard]);
  const audioPreviewUrl = useMemo(() => audioBlob ? URL.createObjectURL(audioBlob) : '', [audioBlob]);
  useEffect(() => () => { if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl); }, [audioPreviewUrl]);

  const completedHistory = history.filter((item) => item.completed && typeof item.overall_score === 'number');
  const averageScore = completedHistory.length
    ? Math.round(completedHistory.reduce((sum, item) => sum + item.overall_score, 0) / completedHistory.length)
    : 0;
  const bestScore = completedHistory.length ? Math.max(...completedHistory.map((item) => item.overall_score)) : 0;

  const audioPlayerUrl = interview?.audioBase64
    ? audioDataUrl(interview.audioBase64, interview.audioMime)
    : '';

  const resetAnswerDraft = () => {
    setAudioBlob(null);
    setRecordDuration(0);
    setOriginalTranscript('');
    setVerifiedAnswer('');
    setTranscriptSource('Gnani Prisma');
    setEvaluation(null);
    setManualMode(false);
    setTimings((current) => ({ ...current, transcription: null, evaluation: null }));
  };

  const beginInterview = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const result = await startInterview({
        candidate_name: candidateName.trim(),
        target_role: targetRole.trim() || 'Graduate role',
        interview_type: interviewType,
        total_questions: Number(totalQuestions),
      });
      setInterview({
        id: result.interview_id,
        candidateName: result.candidate_name,
        targetRole: result.target_role,
        interviewType: result.interview_type,
        questionNumber: result.question_number,
        totalQuestions: result.total_questions,
        question: result.question,
        audioBase64: result.audio_base64,
        audioMime: result.audio_mime,
        voiceSource: result.voice_source,
        memory: [],
      });
      setAttempts([]);
      setAttemptNumber(1);
      setReport(null);
      setReportDetail(null);
      setPage('interview');
      setTimings({ transcription: null, evaluation: null, voice: result.timings_ms?.voice_generation ?? null });
      resetAnswerDraft();
      if (result.warning) setNotice(result.warning);
      else setNotice('Your interview room is ready. Listen to the question, then record your answer.');
    } catch (startError) {
      setError(startError.message);
    } finally {
      setLoading(false);
    }
  };

  const processRecordedAudio = async (wav, duration) => {
    setAudioBlob(wav);
    setRecordDuration(duration);
    setOriginalTranscript('');
    setVerifiedAnswer('');
    setTranscriptionLoading(true);
    setError('');
    setNotice('Audio recorded. VaaniAI is creating your original transcript with Gnani Prisma...');
    try {
      const result = await transcribeAnswer(interview.id, wav, interview.candidateName);
      setOriginalTranscript(result.original_transcript);
      setVerifiedAnswer(result.original_transcript);
      setTranscriptSource('Gnani Prisma');
      setTimings((current) => ({ ...current, transcription: result.timings_ms?.transcription ?? null }));
      setNotice(`Transcript ready. Recording duration: ${result.duration_seconds}s. Review it before submitting.`);
      setManualMode(false);
    } catch (transcribeError) {
      setOriginalTranscript('');
      setVerifiedAnswer('');
      setTranscriptSource('Manual entry (STT unavailable)');
      setManualMode(true);
      setError(`Speech transcription is unavailable: ${transcribeError.message} You can still type your answer below and continue.`);
    } finally {
      setTranscriptionLoading(false);
    }
  };

  const recorder = useRecorder(processRecordedAudio);

  const handleSubmitAnswer = async () => {
    if (!verifiedAnswer.trim()) {
      setError('Please verify the transcript or type your answer before submitting.');
      return;
    }
    setEvaluationLoading(true);
    setError('');
    setNotice('Evaluating your verified answer...');
    try {
      const result = await submitAnswer(interview.id, {
        question_number: interview.questionNumber,
        attempt_number: attemptNumber,
        original_transcript: originalTranscript,
        verified_answer: verifiedAnswer.trim(),
        duration_seconds: recordDuration,
        transcript_source: transcriptSource,
      });
      setAttempts(result.attempts || []);
      setEvaluation(result.attempt?.feedback || null);
      setTimings((current) => ({ ...current, evaluation: result.timings_ms?.evaluation ?? null }));
      setNotice('Answer reviewed. You can retry once or choose this attempt to continue.');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setEvaluationLoading(false);
    }
  };

  const retrySameQuestion = () => {
    setAttemptNumber(2);
    resetAnswerDraft();
    setNotice('Second attempt started. Try to apply the feedback from your first attempt.');
    setError('');
  };

  const chooseAttempt = async (number) => {
    setSelectingLoading(true);
    setError('');
    try {
      const result = await selectAttempt(interview.id, number);
      if (result.completed) {
        setReport(result.report);
        setReportDetail({
          candidate_name: interview.candidateName,
          target_role: interview.targetRole,
          interview_type: interview.interviewType,
          history: result.history,
          memory: result.memory,
          report: result.report,
          completed: true,
        });
        setPage('report');
        await refreshDashboard();
      } else {
        setInterview((current) => ({
          ...current,
          questionNumber: result.question_number,
          totalQuestions: result.total_questions,
          question: result.question,
          audioBase64: result.question_audio_base64,
          audioMime: result.question_audio_mime,
          voiceSource: result.voice_source,
          memory: result.memory || [],
        }));
        setAttempts([]);
        setAttemptNumber(1);
        resetAnswerDraft();
        setPage('interview');
        setTimings({ transcription: null, evaluation: null, voice: result.timings_ms?.voice_generation ?? null });
        setNotice(result.warning || 'Next question is ready.');
      }
    } catch (selectError) {
      setError(selectError.message);
    } finally {
      setSelectingLoading(false);
    }
  };

  const openReport = async (id) => {
    setLoading(true);
    setError('');
    try {
      const detail = await getHistoryDetail(id);
      setReportDetail(detail);
      setReport(detail.report);
      setPage('report');
    } catch (openError) {
      setError(openError.message);
    } finally {
      setLoading(false);
    }
  };

  const navigate = (destination) => {
    setPage(destination);
    setMobileNav(false);
    setError('');
    setNotice('');
    if (destination === 'history' || destination === 'overview') refreshDashboard();
  };

  const currentAttempts = attempts;
  const timerText = `${String(Math.floor(recorder.seconds / 60)).padStart(2, '0')}:${String(recorder.seconds % 60).padStart(2, '0')}`;

  const renderSidebar = () => <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
    <div className="brand-lockup">
      <div className="brand-mark"><AudioLines size={23} strokeWidth={2.2}/></div>
      <div><div className="brand-name">vaani<span>ai</span></div><div className="brand-caption">INTERVIEW COACH</div></div>
      <button className="icon-btn sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18}/></button>
    </div>
    <div className="workspace-label">WORKSPACE</div>
    <nav className="main-nav">
      <button className={page === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}><Home size={18}/> Overview</button>
      <button className={page === 'interview' ? 'nav-item active' : 'nav-item'} onClick={() => interview ? navigate('interview') : navigate('overview')}><Mic size={18}/> Interview room</button>
      <button className={page === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('history')}><History size={18}/> Interview history</button>
    </nav>
    <div className="sidebar-spacer"/>
    <div className="sidebar-tip">
      <div className="tip-icon"><Sparkles size={17}/></div>
      <strong>Small steps. Strong answers.</strong>
      <p>Practise consistently and track your progress over time.</p>
    </div>
    <div className="sidebar-footer"><span className="status-dot"/> Local development workspace <span className="version">v2.0</span></div>
  </aside>;

  const renderOverview = () => <>
    <section className="hero-panel">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot"/> YOUR PERSONAL INTERVIEW COACH</div>
        <h1>Show up prepared.<br/><span>Speak with confidence.</span></h1>
        <p>Practise real placement interviews in English. Get thoughtful follow-up questions, review your answers and see how you improve.</p>
        <button className="primary-btn" onClick={() => setPage('setup')}><Plus size={18}/> Start a new interview <ArrowRight size={17}/></button>
        <div className="hero-proof"><ShieldCheck size={15}/> Original speech transcript stays unchanged</div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="visual-glow"/>
        <div className="visual-avatar"><div className="avatar-halo"/><div className="avatar-face"><div className="avatar-hair"/><div className="avatar-eye left"/><div className="avatar-eye right"/><div className="avatar-smile"/><div className="avatar-neck"/><div className="avatar-shirt"/></div></div>
        <div className="visual-wave"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div>
        <div className="floating-chip chip-top"><span className="mini-pulse"/> AI interviewer ready</div>
        <div className="floating-chip chip-bottom"><AudioLines size={15}/> Voice-first practice</div>
      </div>
    </section>

    <div className="section-heading"><div><div className="section-kicker">YOUR PROGRESS</div><h2>A clearer view of your growth</h2><p>Your completed practice sessions, all in one place.</p></div><button className="text-btn" onClick={() => navigate('history')}>View history <ArrowRight size={15}/></button></div>
    <div className="metrics-grid">
      <MetricCard label="Completed interviews" value={completedHistory.length} icon={History} tone="violet" note="Saved on this computer"/>
      <MetricCard label="Average performance" value={averageScore} suffix={completedHistory.length ? '/100' : ''} icon={BarChart3} tone="blue" note="Across completed sessions"/>
      <MetricCard label="Personal best" value={bestScore} suffix={completedHistory.length ? '/100' : ''} icon={Target} tone="green" note="Your highest overall score"/>
      <MetricCard label="Interview practice" value={completedHistory.reduce((sum, item) => sum + (item.total_questions || 0), 0)} icon={MessageSquareText} tone="amber" note="Questions in completed sessions"/>
    </div>

    <div className="bottom-grid">
      <div className="panel feature-panel">
        <div className="panel-heading"><div><div className="section-kicker">BUILT FOR REAL PRACTICE</div><h3>More than a question list</h3></div><div className="panel-spark"><WandSparkles size={18}/></div></div>
        <div className="feature-list">
          <div className="feature-row"><div className="feature-icon violet"><BrainCircuit size={19}/></div><div><strong>Adaptive conversations</strong><p>Follow-up questions connect to what you have actually said.</p></div></div>
          <div className="feature-row"><div className="feature-icon blue"><FileAudio size={19}/></div><div><strong>Voice and transcript review</strong><p>Speak naturally, then verify your original speech transcript.</p></div></div>
          <div className="feature-row"><div className="feature-icon green"><TrendingUp size={19}/></div><div><strong>Learn from every attempt</strong><p>Retry an answer and compare your progress before moving on.</p></div></div>
        </div>
      </div>
      <div className="panel recent-panel">
        <div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h3>Recent interviews</h3></div><button className="round-link" onClick={() => navigate('history')}><ArrowRight size={17}/></button></div>
        {completedHistory.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><BookOpen size={20}/></div><strong>Your first practice starts here</strong><p>Complete an interview to see your report and progress.</p><button className="text-btn" onClick={() => setPage('setup')}>Start practising <ArrowRight size={14}/></button></div> : completedHistory.slice(0, 3).map((item) => <button className="recent-item" key={item.id} onClick={() => openReport(item.id)}><div className="recent-badge"><BriefcaseBusiness size={16}/></div><div className="recent-info"><strong>{item.interview_type}</strong><span>{formatDate(item.completed_at)}</span></div><div className="recent-score">{item.overall_score}<small>/100</small></div><ChevronRight size={16} className="muted-icon"/></button>)}
      </div>
    </div>
  </>;

  const renderSetup = () => <div className="setup-wrap">
    <button className="back-link" onClick={() => navigate('overview')}><ArrowLeft size={16}/> Back to overview</button>
    <div className="setup-header"><div className="section-kicker">LET'S GET YOU READY</div><h1>Set up your interview</h1><p>Choose the kind of practice you want. Your interviewer will tailor the conversation to your target role.</p></div>
    <form className="setup-card" onSubmit={beginInterview}>
      <div className="form-section-title"><span className="step-number">01</span><div><strong>Your details</strong><small>Tell us who is preparing today.</small></div></div>
      <div className="form-grid">
        <label className="field"><span>Candidate name</span><input required maxLength={80} value={candidateName} onChange={(event) => setCandidateName(event.target.value)} placeholder="e.g. Sivanandini"/></label>
        <label className="field"><span>Target role</span><input maxLength={100} value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="e.g. AI Engineer"/></label>
      </div>
      <div className="form-divider"/>
      <div className="form-section-title"><span className="step-number">02</span><div><strong>Choose your interview</strong><small>Select the practice format that fits your goal.</small></div></div>
      <div className="interview-type-grid">
        {INTERVIEW_TYPES.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} className={`type-option ${interviewType === value ? 'selected' : ''}`} onClick={() => setInterviewType(value)}><div className="type-icon"><Icon size={19}/></div><strong>{label}</strong><p>{description}</p><span className="radio-mark">{interviewType === value && <Check size={12}/>}</span></button>)}
      </div>
      <div className="form-grid one-column">
        <label className="field"><span>Number of questions</span><select value={totalQuestions} onChange={(event) => setTotalQuestions(Number(event.target.value))}><option value={3}>3 questions · Quick practice</option><option value={5}>5 questions · Standard session</option><option value={7}>7 questions · Deep practice</option></select></label>
      </div>
      <div className="setup-note"><ShieldCheck size={17}/><span>Your original transcript is never silently rewritten. You review it before AI evaluation.</span></div>
      <button className="primary-btn full-width" type="submit" disabled={loading || !candidateName.trim()}>{loading ? <LoaderCircle className="spin" size={18}/> : <Sparkles size={18}/>} Start AI interview <ArrowRight size={17}/></button>
    </form>
  </div>;

  const beginRecording = () => {
    if (recorder.seconds >= 120) return;
    recorder.start();
  };

  const renderInterview = () => {
    if (!interview) return <div className="empty-state"><strong>No active interview</strong><p>Start a new interview to begin practising.</p><button className="primary-btn" onClick={() => setPage('setup')}>Start interview <ArrowRight size={16}/></button></div>;
    const percent = (interview.questionNumber / interview.totalQuestions) * 100;
    const hasReview = Boolean(evaluation);
    return <div className="interview-layout">
      <div className="interview-topline"><button className="back-link" onClick={() => navigate('overview')}><ArrowLeft size={16}/> Dashboard</button><div className="interview-candidate"><div className="candidate-avatar">{interview.candidateName.slice(0, 1).toUpperCase()}</div><div><strong>{interview.candidateName}</strong><span>{interview.targetRole}</span></div></div></div>
      <div className="interview-progress-card"><div className="progress-meta"><span>{interview.interviewType}</span><strong>Question {interview.questionNumber} <i>/ {interview.totalQuestions}</i></strong></div><div className="progress-track"><div style={{ width: `${percent}%` }}/></div><div className="progress-foot"><span>Interview progress</span><span>{Math.round(percent)}% complete</span></div></div>

      <div className="interview-room-grid">
        <div className="interview-main-column">
          <div className="interviewer-panel">
            <div className="interviewer-panel-top"><span className="live-label"><span/> INTERVIEWER</span><span className="voice-label"><AudioLines size={14}/> {interview.voiceSource || 'Voice unavailable'}</span></div>
            <div className="interviewer-content"><div className="interviewer-avatar"><div className="avatar-halo small"/><div className="avatar-face small-face"><div className="avatar-hair"/><div className="avatar-eye left"/><div className="avatar-eye right"/><div className="avatar-smile"/><div className="avatar-neck"/><div className="avatar-shirt"/></div></div><div className="interviewer-greeting"><span>VaaniAI Interviewer</span><h2>Let's talk about your experience.</h2><p>A thoughtful conversation, one question at a time.</p></div></div>
            <div className="question-box"><div className="question-label"><Sparkles size={15}/> YOUR QUESTION</div><p>{interview.question}</p>{audioPlayerUrl && <audio controls preload="none" src={audioPlayerUrl} className="question-audio">Your browser does not support audio playback.</audio>}{!audioPlayerUrl && <div className="audio-fallback-note">Question audio could not be generated. You can still read and answer the question.</div>}</div>
          </div>

          <div className="answer-panel">
            <div className="answer-panel-head"><div><div className="section-kicker">YOUR TURN</div><h3>{hasReview ? 'Review your answer' : 'Record your answer'}</h3><p>Speak in English. You can record up to 120 seconds.</p></div><div className="recording-duration"><Clock3 size={15}/>{timerText}</div></div>
            {!hasReview && <>
              <div className={`record-zone ${recorder.recording ? 'is-recording' : ''}`}>
                <div className="record-pulse"><div className="record-core">{recorder.processing ? <LoaderCircle className="spin" size={24}/> : recorder.recording ? <AudioLines size={25}/> : <Mic size={25}/>}</div></div>
                <strong>{recorder.recording ? 'Listening to your answer…' : recorder.processing ? 'Preparing your recording…' : audioBlob ? 'Recording captured' : 'Ready when you are'}</strong>
                <span>{recorder.recording ? 'Speak clearly and naturally. Select stop when you finish.' : recorder.processing ? 'Converting your browser audio into a compatible WAV file.' : 'Allow microphone access to begin your answer.'}</span>
                {recorder.recording ? <button className="stop-btn" onClick={recorder.stop}><Pause size={17} fill="currentColor"/> Stop recording</button> : <button className="record-btn" onClick={beginRecording} disabled={recorder.processing || transcriptionLoading || Boolean(audioBlob)}><Mic size={17}/> {audioBlob ? 'Recording captured' : 'Start recording'}</button>}
                {audioBlob && <button className="text-btn" onClick={() => { setAudioBlob(null); setRecordDuration(0); setOriginalTranscript(''); setVerifiedAnswer(''); setManualMode(false); setTranscriptSource('Gnani Prisma'); }}>Record again <RefreshCw size={14}/></button>}
              </div>
              {recorder.error && <div className="inline-alert error-alert">{recorder.error}</div>}
              {!audioBlob && !recorder.recording && !recorder.processing && <button className="text-btn manual-entry-link" onClick={() => { setManualMode(true); setTranscriptSource('Manual entry'); setError(''); }}>Type answer instead <ArrowRight size={14}/></button>}
              {audioBlob && <div className="audio-preview"><div className="audio-preview-icon"><Headphones size={17}/></div><div><strong>Your original recording</strong><span>{recordDuration.toFixed(1)} seconds · WAV · 16 kHz mono</span></div><audio controls src={audioPreviewUrl}/></div>}
              {transcriptionLoading && <div className="processing-line"><LoaderCircle className="spin" size={17}/> Gnani Prisma is transcribing your answer…</div>}
              {(originalTranscript || manualMode) && <div className="transcript-review"><div className="transcript-heading"><div><div className="section-kicker">TRANSCRIPT VERIFICATION</div><h4>Check what you said</h4></div><span className={`source-pill ${manualMode ? 'manual' : ''}`}>{transcriptSource}</span></div>
                {originalTranscript && <label className="field"><span>Original transcript · read-only</span><textarea value={originalTranscript} readOnly rows={4}/></label>}
                <label className="field"><span>{manualMode ? 'Type your answer (manual mode)' : 'Verified answer · you can edit this copy'}</span><textarea value={verifiedAnswer} onChange={(event) => setVerifiedAnswer(event.target.value)} rows={5} placeholder="Your answer will appear here. You can also type it manually if transcription is unavailable."/></label>
                <div className="transcript-hint"><ShieldCheck size={15}/> The original transcript remains unchanged. Only your verified answer is sent for feedback.</div>
                <button className="primary-btn full-width" onClick={handleSubmitAnswer} disabled={evaluationLoading || transcriptionLoading || !verifiedAnswer.trim()}>{evaluationLoading ? <LoaderCircle className="spin" size={18}/> : <CheckCircle2 size={18}/>} Submit verified answer <ArrowRight size={16}/></button>
              </div>}
            </>}

            {hasReview && <div className="evaluation-card">
              <div className="evaluation-score-row"><div><div className="section-kicker">ATTEMPT {attemptNumber} REVIEW</div><h3>Your answer feedback</h3></div><div className="score-pill"><strong>{evaluation.score}</strong><span>/10</span></div></div>
              <p className="evaluation-summary">{evaluation.feedback}</p>
              <div className="feedback-columns"><div><h4><CheckCircle2 size={15}/> What went well</h4>{(evaluation.strengths || []).map((item, index) => <p className="feedback-bullet" key={index}>{item}</p>)}</div><div><h4><Target size={15}/> What to improve</h4>{(evaluation.improvements || []).map((item, index) => <p className="feedback-bullet" key={index}>{item}</p>)}</div></div>
              {evaluation.evaluation_mode?.includes('fallback') && <div className="inline-alert warning-alert">{evaluation.evaluation_mode}: the score is a rough practice estimate, not an AI assessment.</div>}
              <div className="evaluation-actions">{attemptNumber === 1 && <button className="secondary-btn" onClick={retrySameQuestion}><RefreshCw size={16}/> Try this answer again</button>}<button className="primary-btn" onClick={() => chooseAttempt(attemptNumber)} disabled={selectingLoading}>{selectingLoading ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} Use this answer <ArrowRight size={16}/></button></div>
              {currentAttempts.length > 1 && <div className="attempt-compare"><h4>Compare your attempts</h4>{currentAttempts.map((item) => <div className="attempt-line" key={item.attempt_number}><span>Attempt {item.attempt_number}</span><div className="attempt-bar"><div style={{ width: `${item.feedback.score * 10}%` }}/></div><strong>{item.feedback.score}/10</strong></div>)}</div>}
            </div>}
          </div>
        </div>

        <aside className="interview-side-column">
          <div className="side-card session-card"><div className="side-card-heading"><span className="mini-icon violet"><BrainCircuit size={16}/></span><strong>Interview context</strong></div><div className="context-row"><span>Candidate</span><strong>{interview.candidateName}</strong></div><div className="context-row"><span>Target role</span><strong>{interview.targetRole}</strong></div><div className="context-row"><span>Format</span><strong>{interview.interviewType}</strong></div><div className="context-row"><span>Language</span><strong>English</strong></div></div>
          <div className="side-card memory-card"><div className="side-card-heading"><span className="mini-icon blue"><Sparkles size={16}/></span><strong>What VaaniAI remembers</strong></div><p className="side-card-desc">Details mentioned in your verified answers, used to create connected questions.</p>{(interview.memory || []).length ? <ul className="memory-list">{interview.memory.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <div className="memory-empty">Your verified details will appear here as the interview progresses.</div>}</div>
          <div className="side-card privacy-card"><LockKeyhole size={17}/><div><strong>Your words stay yours</strong><p>VaaniAI does not silently correct or rewrite your original transcript.</p></div></div>
          <div className="timing-card"><div className="side-card-heading"><span className="mini-icon amber"><Zap size={16}/></span><strong>Response timings</strong></div><div className="timing-line"><span>Transcription</span><strong>{timings.transcription == null ? '—' : `${(timings.transcription / 1000).toFixed(1)}s`}</strong></div><div className="timing-line"><span>AI evaluation</span><strong>{timings.evaluation == null ? '—' : `${(timings.evaluation / 1000).toFixed(1)}s`}</strong></div><div className="timing-line"><span>Voice generation</span><strong>{timings.voice == null ? '—' : `${(timings.voice / 1000).toFixed(1)}s`}</strong></div></div>
        </aside>
      </div>
    </div>;
  };

  const renderReport = () => {
    if (!report || !reportDetail) return <div className="empty-state"><strong>No report selected</strong><p>Complete an interview or open a saved report from history.</p><button className="primary-btn" onClick={() => navigate('history')}>View history <ArrowRight size={16}/></button></div>;
    const reportHistory = reportDetail.history || [];
    const saveReport = () => downloadText(
      `VaaniAI_Report_${(reportDetail.candidate_name || 'Candidate').replace(/[^a-z0-9_-]/gi, '_')}.json`,
      JSON.stringify({ ...reportDetail, report }, null, 2),
      'application/json',
    );
    return <div className="report-page">
      <div className="report-banner"><div className="report-banner-icon"><CheckCircle2 size={22}/></div><div><div className="section-kicker">SESSION COMPLETE</div><h1>Your interview, reviewed.</h1><p>Your practice report is ready. Use it to decide what to work on next.</p></div><button className="secondary-btn light-btn" onClick={saveReport}><Download size={16}/> Download report</button></div>
      <div className="report-summary-grid"><div className="panel overall-score-panel"><div className="section-kicker">OVERALL PERFORMANCE</div><div className="overall-score-content"><ScoreRing score={report.overall_score}/><div><h2>{report.overall_score >= 80 ? 'Strong progress' : report.overall_score >= 65 ? 'Good foundation' : 'Room to grow'}</h2><p>{report.summary}</p><span className="report-mode-tag">{report.report_mode || 'Practice report'}</span></div></div></div><div className="panel score-breakdown"><div className="section-kicker">SKILL BREAKDOWN</div>{[['Communication', report.communication_score], ['Answer relevance', report.answer_relevance_score], ['Answer structure', report.structure_score]].map(([label, value]) => <div className="score-meter" key={label}><div><span>{label}</span><strong>{value}/100</strong></div><div className="meter-track"><div style={{ width: `${value}%` }}/></div></div>)}</div></div>
      <div className="report-columns"><div className="panel report-points"><div className="panel-heading"><h3><CheckCircle2 size={18}/> Your strengths</h3></div>{(report.strengths || []).map((point, index) => <div className="report-point positive" key={index}><span><Check size={14}/></span>{point}</div>)}</div><div className="panel report-points"><div className="panel-heading"><h3><Target size={18}/> Areas to improve</h3></div>{(report.improvements || []).map((point, index) => <div className="report-point" key={index}><span><ArrowDownRight size={14}/></span>{point}</div>)}</div></div>
      <div className="panel practice-plan"><div className="panel-heading"><div><div className="section-kicker">YOUR NEXT STEPS</div><h3>Personal practice plan</h3></div><div className="panel-spark"><BookOpen size={18}/></div></div><div className="practice-list">{(report.practice_plan || []).map((point, index) => <div className="practice-item" key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{point}</p></div>)}</div></div>
      <div className="panel transcript-panel"><div className="panel-heading"><div><div className="section-kicker">SESSION REVIEW</div><h3>Questions and your verified answers</h3></div><span className="completed-count">{reportHistory.length} questions</span></div>{reportHistory.map((item, index) => <details className="question-review" key={index}><summary><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className="question-review-text">{item.question}</span><span className="question-score">{item.score}/10</span><ChevronRight size={16}/></summary><div className="question-review-body"><div><span>Original transcript</span><p>{item.original_transcript || 'Not available (manual entry).'}</p></div><div><span>Verified answer</span><p>{item.verified_answer}</p></div><div><span>AI feedback</span><p>{item.feedback}</p></div><div className="review-feedback-grid"><section><b>Strengths</b>{(item.strengths || []).map((s, i) => <p key={i}>• {s}</p>)}</section><section><b>Improvements</b>{(item.improvements || []).map((s, i) => <p key={i}>• {s}</p>)}</section></div></div></details>)}</div>
      <div className="report-bottom-actions"><button className="secondary-btn" onClick={() => navigate('history')}><History size={16}/> View interview history</button><button className="primary-btn" onClick={() => { resetAnswerDraft(); setPage('setup'); }}><Plus size={17}/> Start another interview</button></div>
    </div>;
  };

  const renderHistory = () => <div className="history-page">
    <div className="page-header"><div><div className="section-kicker">YOUR PRACTICE JOURNEY</div><h1>Interview history</h1><p>Revisit completed sessions and learn from your previous answers.</p></div><button className="primary-btn" onClick={() => setPage('setup')}><Plus size={17}/> New interview</button></div>
    {completedHistory.length === 0 ? <div className="panel empty-state"><div className="empty-icon"><History size={22}/></div><h3>No completed interviews yet</h3><p>Your completed interview reports will appear here.</p><button className="primary-btn" onClick={() => setPage('setup')}>Start your first interview <ArrowRight size={16}/></button></div> : <>
      <div className="metrics-grid history-metrics"><MetricCard label="Completed sessions" value={completedHistory.length} icon={History} tone="violet"/><MetricCard label="Average score" value={averageScore} suffix="/100" icon={BarChart3} tone="blue"/><MetricCard label="Best score" value={bestScore} suffix="/100" icon={TrendingUp} tone="green"/></div>
      <div className="panel history-table-panel"><div className="panel-heading"><div><div className="section-kicker">ALL SESSIONS</div><h3>Previous interviews</h3></div><button className="round-link" onClick={refreshDashboard}><RefreshCw size={16}/></button></div><div className="history-table"><div className="history-table-head"><span>INTERVIEW</span><span>ROLE</span><span>DATE</span><span>SCORE</span><span/></div>{completedHistory.map((item) => <button className="history-row" key={item.id} onClick={() => openReport(item.id)}><span className="history-name"><span className="history-file-icon"><FileText size={16}/></span><span><strong>{item.interview_type}</strong><small>{item.candidate_name}</small></span></span><span>{item.target_role}</span><span>{formatDate(item.completed_at)}</span><span className="history-score">{item.overall_score}<small>/100</small></span><ChevronRight size={17}/></button>)}</div><button className="download-history" onClick={async () => { try { const all = await getHistory(); downloadText('VaaniAI_History_Summary.json', JSON.stringify(all.items, null, 2), 'application/json'); } catch (downloadError) { setError(downloadError.message); } }}><Download size={15}/> Download history summary</button></div>
    </>}
  </div>;

  return <div className="app-shell">
    {renderSidebar()}
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumb">Workspace <ChevronRight size={13}/> <strong>{page === 'overview' ? 'Overview' : page === 'setup' ? 'New interview' : page === 'interview' ? 'Interview room' : page === 'report' ? 'Performance report' : 'Interview history'}</strong></div></div><div className="topbar-right"><div className={`backend-status ${health?.status === 'ok' ? 'online' : 'offline'}`}><span/>{health?.status === 'ok' ? 'Backend connected' : 'Backend offline'}</div><div className="topbar-user-email">{user?.email || 'Local demo'}</div>{user?.email && <button className="signout-btn" onClick={onSignOut} title="Sign out"><LockKeyhole size={14}/> Sign out</button>}<div className="topbar-avatar">{candidateName ? candidateName.slice(0, 1).toUpperCase() : (user?.email?.slice(0, 1).toUpperCase() || 'S')}</div></div></header>
      <div className="page-content">
        {error && <div className="global-alert error-alert"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && !error && <div className="global-alert info-alert"><span>{notice}</span><button onClick={() => setNotice('')}><X size={16}/></button></div>}
        {page === 'overview' && renderOverview()}
        {page === 'setup' && renderSetup()}
        {page === 'interview' && renderInterview()}
        {page === 'report' && renderReport()}
        {page === 'history' && renderHistory()}
        <footer className="app-footer"><span>© 2026 VaaniAI</span><span>Your voice. Your words. Your interview.</span><span className="footer-secure"><LockKeyhole size={12}/> API keys stay on the backend</span></footer>
      </div>
    </main>
  </div>;
}

function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          setMessage('Account created. Opening your VaaniAI workspace…');
        } else {
          setMessage('Account created. Please check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (authError) {
      setError(authError.message || 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-page">
    <div className="auth-glow auth-glow-one"/><div className="auth-glow auth-glow-two"/>
    <div className="auth-shell">
      <div className="auth-brand"><div className="auth-brand-mark"><AudioLines size={26}/></div><div><strong>vaani<span>ai</span></strong><small>PERSONAL INTERVIEW COACH</small></div></div>
      <div className="auth-card">
        <div className="auth-kicker">YOUR PLACEMENT JOURNEY STARTS HERE</div>
        <h1>{mode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h1>
        <p className="auth-subtitle">Practise English interviews, get thoughtful feedback, and grow with every attempt.</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <label className="auth-field"><span>Full name</span><input required maxLength={80} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" autoComplete="name"/></label>}
          <label className="auth-field"><span>Email address</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email"/></label>
          <label className="auth-field"><span>Password</span><input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}/></label>
          {error && <div className="auth-message auth-error">{error}</div>}
          {message && <div className="auth-message auth-success">{message}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <ShieldCheck size={18}/>} {mode === 'signin' ? 'Sign in to VaaniAI' : 'Create account'}</button>
        </form>
        <div className="auth-switch">{mode === 'signin' ? "Don't have an account?" : 'Already have an account?'} <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage(''); }}>{mode === 'signin' ? 'Create one' : 'Sign in'}</button></div>
      </div>
      <div className="auth-footnote"><LockKeyhole size={13}/> Your interview history is private to your account.</div>
    </div>
  </div>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session || null);
        setCheckingSession(false);
      }
    }).catch(() => {
      if (alive) setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setCheckingSession(false);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Without frontend Supabase settings the app remains usable for local-only development.
  if (!supabase) return <VaaniAIApp user={null} onSignOut={() => {}}/>;
  if (checkingSession) return <div className="auth-loading"><LoaderCircle className="spin" size={22}/> Checking your secure session…</div>;
  if (!session) return <AuthScreen/>;
  return <VaaniAIApp key={session.user.id} user={session.user} onSignOut={() => supabase.auth.signOut()}/>;
}

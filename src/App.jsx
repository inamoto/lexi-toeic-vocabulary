import { useEffect, useMemo, useState } from 'react';
import { freshState, levels, storageKey, vocabulary } from './vocabulary.js';
import { supabase } from './lib/supabase.js';
import AuthForm from './components/AuthForm.jsx';
import { saveLearningData, syncLearningData } from './lib/learningSync.js';

function loadState() {
  try {
    return { ...freshState(), ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
  } catch {
    return freshState();
  }
}

function StatCard({ label, value, unit, caption, icon, tone }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><div className="stat-value"><strong>{value}</strong><span>{unit}</span></div><p>{caption}</p></article>;
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function HistoryPanel({ history = {} }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const periodStart = new Date(today);
  periodStart.setMonth(today.getMonth() - 6);
  const firstDay = new Date(periodStart);
  firstDay.setDate(periodStart.getDate() - periodStart.getDay());
  const totalDays = Math.floor((today - firstDay) / 86400000) + 1;
  const days = Array.from({ length: totalDays }, (_, index) => {
    const day = new Date(firstDay);
    day.setDate(firstDay.getDate() + index);
    return day;
  });
  const periodKeys = days.map(dateKey);
  const totalAnswers = periodKeys.reduce((total, key) => total + (history[key]?.answered || 0), 0);
  const totalMinutes = periodKeys.reduce((total, key) => total + (history[key]?.minutes || 0), 0);
  const maxAnswers = Math.max(1, ...periodKeys.map(key => history[key]?.answered || 0));

  return <article className="panel history-panel" id="history">
    <div className="panel-heading"><div><p className="eyebrow">LEARNING HISTORY</p><h2>過去6か月の学習履歴</h2></div><span className="history-period">回答数と学習時間</span></div>
    <div className="history-summary"><div><strong>{totalAnswers}</strong><span>回答</span></div><div><strong>{totalMinutes}</strong><span>分</span></div></div>
    <div className="history-calendar-wrap"><div className="history-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div><div className="history-grid">{days.map(day => { const key = dateKey(day); const record = history[key]; const answers = record?.answered || 0; const level = answers === 0 ? 0 : Math.min(4, Math.ceil(answers / maxAnswers * 4)); const isFuture = day > today; return <span className={`history-cell history-level-${level} ${isFuture ? 'is-future' : ''}`} key={key} title={isFuture ? '' : `${key}: ${answers}問 / ${record?.minutes || 0}分`} aria-label={isFuture ? undefined : `${key}、${answers}問回答、${record?.minutes || 0}分`} />; })}</div></div>
    <div className="history-legend"><span>少ない</span><i className="history-cell history-level-0" /><i className="history-cell history-level-1" /><i className="history-cell history-level-2" /><i className="history-cell history-level-3" /><i className="history-cell history-level-4" /><span>多い</span></div>
  </article>;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function playAnswerSound(isCorrect) {
  const audio = new Audio(isCorrect ? '/correct.mp3' : '/incorrect.mp3');
  audio.play().catch(() => {});
}

function playCompleteSound() {
  const audio = new Audio('/complete.mp3');
  audio.play().catch(() => {});
}

let speechWarmedUp = false;

function warmUpSpeechSynthesis(onReady) {
  if (!('speechSynthesis' in window)) return;
  const synthesis = window.speechSynthesis;
  if (speechWarmedUp) {
    onReady?.();
    return;
  }
  synthesis.cancel();
  synthesis.resume();
  const englishVoice = synthesis.getVoices().find(voice => /^en(-|_)/i.test(voice.lang));
  speechWarmedUp = true;
  const warmup = new SpeechSynthesisUtterance('a');
  warmup.lang = englishVoice?.lang || 'en-US';
  if (englishVoice) warmup.voice = englishVoice;
  warmup.rate = 1;
  warmup.volume = 0;
  warmup.onend = () => onReady?.();
  warmup.onerror = () => onReady?.();
  synthesis.speak(warmup);
}

function speakEnglish(text) {
  if (!('speechSynthesis' in window)) return;
  const synthesis = window.speechSynthesis;
  const speak = () => {
    synthesis.cancel();
    synthesis.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    const englishVoice = synthesis.getVoices().find(voice => /^en(-|_)/i.test(voice.lang));
    utterance.lang = englishVoice?.lang || 'en-US';
    if (englishVoice) utterance.voice = englishVoice;
    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.volume = 1;
    synthesis.speak(utterance);
  };
  if (speechWarmedUp) speak();
  else warmUpSpeechSynthesis(speak);
}

function isQuizEligible(item) {
  return item.word.trim().split(/\\s+/).length === 1 || item.pos === 'phrasal verb' || item.pos === 'idiom';
}

function App() {
  const [state, setState] = useState(loadState);
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [session, setSession] = useState(null);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [choiceSets, setChoiceSets] = useState({});
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [complete, setComplete] = useState(false);
  const [showProgressDetail, setShowProgressDetail] = useState(false);
  const [progressDetailLevel, setProgressDetailLevel] = useState(null);
  const [revealedWords, setRevealedWords] = useState({});

  const available = useMemo(() => vocabulary.filter(item => item.level === Number(state.level) && isQuizEligible(item)), [state.level]);
  const due = available.filter(item => !state.reviews[item.word] || new Date(state.reviews[item.word]).getTime() <= Date.now());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthSession(data.session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAuthSession(nextSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authSession) return undefined;
    setShowAuth(false);
    let active = true;
    syncLearningData(authSession.user.id, state)
      .then(mergedState => {
        if (!active) return;
        setState(mergedState);
        localStorage.setItem(storageKey, JSON.stringify(mergedState));
      })
      .catch(error => console.error('学習データの同期に失敗しました:', error));
    return () => { active = false; };
  }, [authSession]);

  useEffect(() => {
    if (session) warmUpSpeechSynthesis();
  }, [session]);

  const persist = next => {
    setState(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const update = updater => setState(current => {
    const next = updater(current);
    localStorage.setItem(storageKey, JSON.stringify(next));
    if (authSession) {
      saveLearningData(authSession.user.id, next)
        .catch(error => console.error('学習データの保存に失敗しました:', error));
    }
    return next;
  });

  function startSession() {
    const unseen = available.filter(item => !state.learned.includes(item.word));
    const pool = unseen.length ? unseen : (due.length ? due : available);
    const questions = shuffle(pool).slice(0, 10);
    if (!questions.length) return;
    setSession(questions);
    setSessionStartedAt(Date.now());
    setAnswers({});
    setChoiceSets(Object.fromEntries(questions.map((item, index) => [index, choicesFor(item)])));
    setExpandedQuestions({});
    setComplete(false);
  }

  function submitAnswer(index, choice) {
    if (!session || answers[index]) return;
    const item = session[index];
    const isCorrect = choice === item.meaning;
    playAnswerSound(isCorrect);
    setAnswers(current => ({ ...current, [index]: { choice, correct: item.meaning, isCorrect } }));
    update(current => ({
      ...current,
      learned: [...new Set([...current.learned, item.word])],
      mastered: isCorrect ? [...new Set([...current.mastered, item.word])] : current.mastered.filter(word => word !== item.word),
      wrong: isCorrect ? current.wrong : [...new Set([...current.wrong, item.word])],
      reviews: { ...current.reviews, [item.word]: new Date(Date.now() + (isCorrect ? 24 : 0) * 60 * 60 * 1000).toISOString() },
    }));
  }

  function toggleQuestion(index, item) {
    const willOpen = !expandedQuestions[index];
    setExpandedQuestions(current => ({ ...current, [index]: willOpen }));
    if (willOpen) speakEnglish(item.word);
    else window.speechSynthesis?.cancel();
  }

  function markAsLearning(item) {
    update(current => ({
      ...current,
      learned: [...new Set([...current.learned, item.word])],
      mastered: current.mastered.filter(word => word !== item.word),
      reviews: { ...current.reviews, [item.word]: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    }));
  }

  function markAsMastered(item) {
    update(current => ({
      ...current,
      learned: [...new Set([...current.learned, item.word])],
      mastered: [...new Set([...current.mastered, item.word])],
      reviews: { ...current.reviews, [item.word]: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    }));
  }

  function markAsReview(item) {
    update(current => ({
      ...current,
      learned: [...new Set([...current.learned, item.word])],
      mastered: current.mastered.filter(word => word !== item.word),
      reviews: { ...current.reviews, [item.word]: new Date().toISOString() },
    }));
  }

  function finishSession() {
    if (!session || Object.keys(answers).length < session.length) return;
    const elapsedMinutes = Math.min(5, Math.max(1, Math.round((Date.now() - (sessionStartedAt || Date.now())) / 60000)));
    const todayKey = dateKey();
    update(current => ({
      ...current,
      weekMinutes: current.weekMinutes + elapsedMinutes,
      lastSession: new Date().toDateString(),
      history: {
        ...current.history,
        [todayKey]: {
          answered: (current.history?.[todayKey]?.answered || 0) + session.length,
          minutes: (current.history?.[todayKey]?.minutes || 0) + elapsedMinutes,
        },
      },
    }));
    playCompleteSound();
    setComplete(true);
  }

  function choicesFor(question) {
    const distractors = shuffle(vocabulary
      .filter(item => item.word !== question.word && item.level === Number(state.level) && isQuizEligible(item))
      .map(item => item.meaning)
      .filter((meaning, index, meanings) => meaning !== question.meaning && meanings.indexOf(meaning) === index))
      .slice(0, 3);
    return shuffle([question.meaning, ...distractors]);
  }

  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter(answer => answer.isCorrect).length;

  if (authLoading) return <main className="auth-shell"><p className="auth-loading">読み込み中...</p></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#home" aria-label="Lexi ホーム"><span className="brand-mark">L</span><span>lexi<span className="brand-dot">.</span></span></a>
      <p className="nav-caption">学習スペース</p>
      <nav aria-label="メインナビゲーション">
        {[['home', '⌂', 'ホーム'], ['study', '▤', '今日の学習'], ['words', '▣', '単語帳'], ['progress', '↗', '進捗']].map(([id, icon, label]) => <a key={id} className={`nav-link ${activeNav === id ? 'active' : ''}`} href={`#${id}`} onClick={() => setActiveNav(id)}><span className="nav-icon">{icon}</span>{label}</a>)}
      </nav>
      <div className="sidebar-bottom"><div className="streak-icon">✳</div><div><strong>{state.lastSession === new Date().toDateString() ? '今日の学習完了' : '学習を始めよう'}</strong><small>毎日の小さな積み重ね</small></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar">{authSession ? <div className="profile"><span className="avatar">学</span><span className="profile-email">{authSession.user.email}</span><button className="logout-button" type="button" onClick={() => supabase.auth.signOut()}>ログアウト</button></div> : <button className="login-button" type="button" onClick={() => setShowAuth(true)}>ログイン / 登録</button>}</header>
      <section className="level-selection-panel" id="home"><div><p className="eyebrow">LEARNING LEVEL</p><h1>目標スコアを選択</h1><p>選択したレベルの問題が出題されます。</p></div><label htmlFor="level-select">目標スコア<select id="level-select" value={state.level} onChange={event => update(current => ({ ...current, level: Number(event.target.value) }))}>{levels.map(level => <option key={level} value={level}>{level}点</option>)}</select></label></section>
      <section className="stats-grid" aria-label="学習状況">
        <StatCard label="今日の復習" value={due.length} unit="語" caption="忘れる前に、もう一度" icon="↻" tone="peach" />
        <StatCard label="学習した単語" value={available.filter(item => state.learned.includes(item.word)).length} unit="語" caption="このレベルの学習記録" icon="▤" tone="mint" />
        <StatCard label="習得した単語" value={available.filter(item => state.mastered.includes(item.word)).length} unit="語" caption="自信を持って使える語彙" icon="✦" tone="lilac" />
        <StatCard label="今週の学習" value={state.weekMinutes} unit="分" caption="毎日の積み重ねが目標" icon="◷" tone="blue" />
      </section>
      <section className="content-grid">
        <button className="primary-button session-start-button" onClick={startSession}>学習をはじめる <span>→</span></button>
        <article className="panel progress-panel" id="progress"><div className="panel-heading"><div><p className="eyebrow">YOUR JOURNEY</p><h2>レベル別の進捗</h2></div><button className="text-link text-button" onClick={() => { setProgressDetailLevel(null); setShowProgressDetail(true); }}>詳細 <span>→</span></button></div><div className="level-list">{levels.map(level => { const words = vocabulary.filter(item => item.level <= level); const count = words.filter(item => state.mastered.includes(item.word)).length; const percent = words.length ? Math.round(count / words.length * 100) : 0; return <div className="level-row progress-level-button" key={level} role="button" tabIndex="0" onClick={() => { setProgressDetailLevel(level); setShowProgressDetail(true); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setProgressDetailLevel(level); setShowProgressDetail(true); } }}><span className="level-label">{level}点</span><div className="level-track"><div className={`level-fill ${level === Number(state.level) ? 'selected' : ''}`} style={{ width: `${percent}%` }} /></div><span className="level-percent">{percent}%</span></div>; })}</div><p className="disclaimer">スコア帯は学習の目安です。TOEIC公式の必須語彙リストではありません。</p></article>
      </section>
      <HistoryPanel history={state.history} />

    </main>
    {showProgressDetail && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowProgressDetail(false); }}><section className="progress-detail-dialog" role="dialog" aria-modal="true" aria-label="レベル別の学習進捗"><div className="dialog-top"><div><p className="eyebrow">VOCABULARY PROGRESS</p><h2>{progressDetailLevel ? `${progressDetailLevel}点の単語一覧` : 'レベル別の単語一覧'}</h2></div><button className="icon-button" onClick={() => { setShowProgressDetail(false); setProgressDetailLevel(null); }} aria-label="閉じる">×</button></div><div className="progress-legend"><span><i className="status-dot status-unlearned" />未学習</span><span><i className="status-dot status-learning" />学習中</span><span><i className="status-dot status-mastered" />習得</span><span><i className="status-dot status-review" />復習対象</span></div><div className="progress-detail-list">{(progressDetailLevel ? [progressDetailLevel] : levels).map(level => { const levelWords = vocabulary.filter(item => item.level === level); return <section className="progress-detail-level" key={level}><div className="progress-detail-heading"><h3>{level}点</h3><span>{levelWords.filter(item => state.mastered.includes(item.word)).length} / {levelWords.length} 習得</span></div><div className="vocabulary-status-grid">{levelWords.map(item => { const isMastered = state.mastered.includes(item.word); const isDue = !state.reviews[item.word] || new Date(state.reviews[item.word]).getTime() <= Date.now(); const isLearned = state.learned.includes(item.word); const status = isMastered ? 'status-mastered' : isDue && isLearned ? 'status-review' : isLearned ? 'status-learning' : 'status-unlearned'; return <button type="button" className={`vocabulary-status-item ${status} ${revealedWords[item.word] ? 'is-revealed' : ''} ${(revealedWords[item.word] ? item.meaning : item.word).length > 14 ? 'is-long' : ''} ${(revealedWords[item.word] ? item.meaning : item.word).length > 22 ? 'is-extra-long' : ''}`} key={item.word} onClick={() => { const isRevealed = revealedWords[item.word]; setRevealedWords(current => ({ ...current, [item.word]: !current[item.word] })); if (isRevealed) window.speechSynthesis?.cancel(); else speakEnglish(item.word); }} aria-label={`${item.word}の意味を${revealedWords[item.word] ? '英語に戻す' : '表示する'}`}><strong>{revealedWords[item.word] ? item.meaning : item.word}</strong></button>; })}</div></section>; })}</div></section></div>}
    {session && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSession(null); }}><section className="study-dialog study-dialog-scroll" role="dialog" aria-modal="true" aria-label="10問の語彙クイズ"><div className="dialog-top quiz-sticky-header"><div><span className="pill">{state.level} POINT</span><strong className="quiz-count">{answeredCount} / {session.length} 回答済み</strong></div><button className="icon-button" onClick={() => setSession(null)} aria-label="閉じる">×</button></div><div className="quiz-progress"><span style={{ width: `${answeredCount / session.length * 100}%` }} /></div>{complete ? <div className="quiz-result"><p className="eyebrow">SESSION COMPLETE</p><h3>今日の学習、おつかれさま！</h3><div className="result-score">{Math.round(correctCount / session.length * 100)}<small>%</small></div><p>{session.length}問中 {correctCount}問正解<br />{correctCount === session.length ? 'すばらしい！この調子で続けましょう。' : '間違えた語は復習リストに追加しました。'}</p><button className="primary-button" onClick={() => setSession(null)}>ホームに戻る <span>→</span></button></div> : <div className="question-list">{session.map((item, index) => { const answer = answers[index]; const choices = choiceSets[index] || choicesFor(item); const isExpanded = Boolean(expandedQuestions[index] || answer); const isMastered = state.mastered.includes(item.word); const isReviewDue = state.learned.includes(item.word) && !isMastered && (!state.reviews[item.word] || new Date(state.reviews[item.word]).getTime() <= Date.now()); return <article className={`question-card ${answer ? 'is-answered' : ''}`} key={item.word}><p className="quiz-type">{index + 1} / {session.length} · 英語から日本語</p><button type="button" className="question-word-toggle" onClick={() => toggleQuestion(index, item)} aria-expanded={isExpanded}><h2 className="quiz-prompt">{item.word}</h2><span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span></button>{isExpanded ? <><p className="quiz-hint">意味として最も近いものを選んでください</p><div className="answer-list">{choices.map(choice => <button key={choice} className={`answer-option ${answer && choice === answer.correct ? 'correct' : ''} ${answer && choice === answer.choice && !answer.isCorrect ? 'incorrect' : ''}`} disabled={Boolean(answer)} onClick={() => submitAnswer(index, choice)}>{choice}</button>)}</div>{answer && <><div className="quiz-feedback">{!answer.isCorrect && <strong>正解：{answer.correct}</strong>}<span className="quiz-definition">{item.definition}</span><button type="button" className="sentence-speak-button" onClick={() => speakEnglish(item.example)} aria-label="例文を読み上げる"><em>{item.example}</em><span aria-hidden="true">🔊</span></button><span className="quiz-translation">{item.translation}</span></div><button type="button" className={`secondary-button ${answer.isCorrect && isReviewDue ? 'is-review' : !answer.isCorrect && isMastered ? 'is-mastered' : ''}`} disabled={answer.isCorrect ? isReviewDue : isMastered} onClick={() => (answer.isCorrect ? markAsReview(item) : markAsMastered(item))}>{answer.isCorrect ? isReviewDue ? '復習対象' : '復習対象にする' : isMastered ? '学習済み' : '学習済みにする'}</button></>}</> : null}</article>; })}<button className="primary-button finish-button" disabled={answeredCount < session.length} onClick={finishSession}>{answeredCount < session.length ? `あと${session.length - answeredCount}問回答してください` : '結果を見る'} <span>→</span></button></div>}</section></div>}
    {showAuth && <div className="auth-modal" role="dialog" aria-modal="true" aria-label="ログイン"><AuthForm onClose={() => setShowAuth(false)} /></div>}
  </div>;
}

export default App;

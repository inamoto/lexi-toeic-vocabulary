import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

function authErrorMessage(error) {
  if (error?.message?.toLowerCase().includes('invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (error?.message?.toLowerCase().includes('user already registered')) {
    return 'このメールアドレスはすでに登録されています。';
  }
  if (error?.message?.toLowerCase().includes('password')) {
    return 'パスワードは6文字以上で入力してください。';
  }
  return '認証に失敗しました。入力内容を確認してください。';
}

export default function AuthForm({ onClose }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLogin = mode === 'login';

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    setError('');

    if (password.length < 6) {
      setError('パスワードは6文字以上で入力してください。');
      return;
    }

    setIsSubmitting(true);
    const result = isLogin
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
    setIsSubmitting(false);

    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }

    if (isLogin) {
      setMessage('ログインしました。');
    } else if (result.data.session) {
      setMessage('アカウントを作成しました。');
    } else {
      setMessage('確認メールを送信しました。メール内のリンクを開いてください。');
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage('');
    setError('');
  }

  return <main className="auth-shell">
    <section className="auth-card" aria-labelledby="auth-title">
      {onClose && <button className="auth-close" type="button" onClick={onClose} aria-label="閉じる">×</button>}
      <div className="auth-brand"><span className="brand-mark">L</span><span>lexi<span className="brand-dot">.</span></span></div>
      <p className="eyebrow">TOEIC VOCABULARY</p>
      <h1 id="auth-title">{isLogin ? '学習を続ける' : 'アカウントを作成'}</h1>
      <p className="auth-description">学習状況を保存して、どの端末からでも続きから学習できます。</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="auth-email">メールアドレス</label>
        <input id="auth-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required />
        <label htmlFor="auth-password">パスワード</label>
        <input id="auth-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={isLogin ? 'current-password' : 'new-password'} minLength="6" required />
        {error && <p className="auth-message auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message auth-success" role="status">{message}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? '処理中…' : isLogin ? 'ログイン' : '新規登録'}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => switchMode(isLogin ? 'signup' : 'login')}>{isLogin ? 'アカウントを作成する' : 'ログイン画面に戻る'}</button>
    </section>
  </main>;
}

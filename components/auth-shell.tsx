'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound, X, Globe2 } from 'lucide-react'
import { FaGithub, FaLinkedin } from "react-icons/fa";
import { LifeRpg } from '@/components/life-rpg'
import { auth, db } from '@/lib/firebase'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'

type Mode = 'login' | 'signup'
type FormState = { firstName: string; lastName: string; username: string; email: string; phone: string; password: string; confirmPassword: string }
const emptyForm: FormState = { firstName: '', lastName: '', username: '', email: '', phone: '', password: '', confirmPassword: '' }

const USERNAME_RE = /^[a-z0-9_]+$/
const PHONE_RE = /^\d{10}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

const quests = [['Study machine learning', 'WISDOM', '+50 XP'], ['Complete gym workout', 'STRENGTH', '+40 XP'], ['Practice guitar', 'DISCIPLINE', '+30 XP'], ['Meditation', 'FOCUS', '+25 XP']]

export function AuthShell() {
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined) // undefined = still checking
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useState<Mode | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [usernameTaken, setUsernameTaken] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u)
      setVerified(!!u?.emailVerified)
    })
    return unsub
  }, [])

  // Poll for verification while a signed-in user hasn't clicked their email
  // link yet, so they land in the app the moment it's confirmed — no
  // logging out and back in required.
  useEffect(() => {
    if (!authUser || verified) return
    const interval = setInterval(async () => {
      try {
        await authUser.reload()
        if (auth.currentUser?.emailVerified) setVerified(true)
      } catch {
        // ignore transient reload errors; the interval will retry
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [authUser, verified])

  // Live username-availability check against Firestore (debounced).
  useEffect(() => {
    if (mode !== 'signup' || !form.username) {
      setUsernameTaken(false)
      return
    }
    const handle = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, 'usernames', form.username))
        setUsernameTaken(snap.exists())
      } catch {
        // ignore transient lookup errors; final uniqueness is enforced by Firestore rules on write
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [form.username, mode])

  if (authUser === undefined) return <main className="rpg-landing" />
  if (authUser && verified) return <LifeRpg />

  const openAuth = (next: Mode) => {
    if (authUser) return // already have an account pending verification — no modal, just the banner below
    setMode(next)
    setForm(emptyForm)
    setShowPassword(false)
    setShowConfirm(false)
    setUsernameTaken(false)
    setFieldErrors({})
    setAuthError(null)
  }

  async function resendVerification() {
    if (!authUser) return
    setResending(true)
    try {
      await sendEmailVerification(authUser)
      setResendCooldown(true)
      setTimeout(() => setResendCooldown(false), 30000)
    } finally {
      setResending(false)
    }
  }

  function validateSignup() {
    const errors: Record<string, string> = {}
    if (!form.firstName.trim()) errors.firstName = 'Required'
    if (!form.lastName.trim()) errors.lastName = 'Required'
    if (!USERNAME_RE.test(form.username)) errors.username = 'Lowercase letters, numbers, underscores only'
    if (!PHONE_RE.test(form.phone)) errors.phone = 'Must be exactly 10 digits'
    if (!EMAIL_RE.test(form.email)) errors.email = 'Enter a valid email address'
    if (!PASSWORD_RE.test(form.password)) errors.password = 'Min 8 chars, upper, lower, number, symbol'
    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthError(null)

    if (mode === 'signup') {
      if (!validateSignup() || usernameTaken) return
      setSubmitting(true)
      try {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)
        await sendEmailVerification(cred.user)
        await setDoc(doc(db, 'usernames', form.username), { uid: cred.user.uid })
        await setDoc(doc(db, 'users', cred.user.uid), {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          username: form.username,
          phone: form.phone,
          email: form.email,
          level: 1,
          xp: 0,
          gold: 0,
          streak: 0,
          bestStreak: 0,
          lastLoginDate: null,
          equippedTheme: null,
          ownedThemes: [] as string[],
          consumables: { doubleXp: false, fiveGold: false, shields: 0 },
          badges: [] as { id: string; name: string; type: string; earnedAt: number }[],
          attributes: { Focus: 0, Vitality: 0, Wisdom: 0, Discipline: 0 },
          createdAt: serverTimestamp(),
        })
        // Firebase signs the new user in automatically after signup.
        // authUser/verified state above will keep them on the landing
        // page (with the verify banner) until they click the email link.
        setMode(null)
      } catch (err: any) {
        setAuthError(err.message?.replace('Firebase: ', '') ?? 'Something went wrong. Try again.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    // login
    setSubmitting(true)
    try {
      await signInWithEmailAndPassword(auth, form.email, form.password)
      setMode(null)
    } catch (err) {
      setAuthError('Incorrect email or password')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="rpg-landing">
    {authUser && !verified && (
      <div className="verify-banner" role="alert">
        <div>
          <strong>Verify your email to enter the world.</strong>
          <span>We sent a link to {authUser.email}. Click it, then come back here — this updates automatically.</span>
        </div>
        <div className="verify-banner-actions">
          <button className="outline-gold" disabled={resending || resendCooldown} onClick={resendVerification}>
            {resendCooldown ? 'Link sent' : resending ? 'Sending…' : 'Resend link'}
          </button>
          <button className="nav-login" onClick={() => signOut(auth)}>Log out</button>
        </div>
      </div>
    )}

    <header className="landing-nav">
      <div className="landing-brand"><span>✦</span> LIFE RPG</div>
      <nav><a href="#how">How It Works</a><a href="#character">Character</a><a href="#quests">Quests</a><a href="#rewards">Rewards</a></nav>
      {authUser ? (
        <div className="landing-actions"><span className="nav-login">Awaiting verification…</span></div>
      ) : (
        <div className="landing-actions"><button className="nav-login" onClick={() => openAuth('login')}>Log in</button><button className="nav-start" onClick={() => openAuth('signup')}>Start journey</button></div>
      )}
    </header>

    <section className="rpg-hero">
      <div className="hero-atmosphere" />
      <div className="hero-copy-rpg"><p className="rpg-eyebrow">LIFE RPG / PERSONAL PROGRESSION SYSTEM</p><h1>TURN YOUR<br /><em>REAL LIFE</em><br />INTO AN RPG.</h1><p className="rpg-lede">Your goals are the quests. Your actions are the XP. Build the character you were meant to become.</p><div className="hero-buttons"><button className="gold-button" onClick={() => openAuth('signup')}>Start your journey <ArrowRight size={15} /></button><a className="ghost-button" href="#how">See how it works <ArrowDown size={14} /></a></div></div>
      <div className="character-display"><div className="character-halo" /><div className="hero-avatar-frame"><img className="landing-avatar-art" src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-eGBK8xTK45cH2ArDh4VXLa6ySCGw4m.png" alt="Split light-and-shadow hero avatar" /></div><div className="hud-chip hud-level"><span>LEVEL</span><strong>12</strong><small>840 / 1000 XP</small></div><div className="hud-chip hud-streak"><span>STREAK</span><strong>7 DAYS</strong><small>Consistency +12%</small></div><div className="hud-chip hud-stat"><span>FOCUS</span><strong>42</strong><small>+2 this week</small></div></div>
      <div className="scroll-cue">SCROLL TO ENTER <ArrowDown size={13} /></div>
    </section>

    <section className="transformation-section" id="how"><div className="section-heading"><p className="rpg-eyebrow">THE CORE LOOP</p><h2>REAL LIFE BECOMES<br /><em>THE GAME.</em></h2><p>Every meaningful action becomes a visible step forward.</p></div><div className="transform-grid"><div className="transform-card real-life"><span className="card-label">REAL LIFE</span><strong>Study machine<br />learning for 2 hours</strong><small>A goal waiting to become momentum.</small></div><div className="transform-arrow"><ArrowRight size={20} /></div><div className="transform-card quest-card-feature"><span className="card-label">WISDOM QUEST</span><strong>Ship your first<br />portfolio project</strong><div className="reward-row"><b>+50 XP</b><b>+20 GOLD</b><b>INT +2</b></div></div></div></section>

    <section className="character-section" id="character"><div className="section-heading"><p className="rpg-eyebrow">CHARACTER SCREEN</p><h2>PROGRESS YOU<br /><em>CAN SEE.</em></h2></div><div className="character-panel"><div className="panel-identity"><div className="panel-avatar"><span>LVL</span><strong>12</strong></div><p className="card-label">THE PATHFINDER</p><h3>The Pathfinder</h3><div className="xp-line"><span>840 / 1000 XP</span><b>84%</b></div><div className="xp-track"><i /></div><div className="panel-metrics"><div><strong>7</strong><span>DAY STREAK</span></div><div><strong>840</strong><span>GOLD</span></div><div><strong>24</strong><span>QUESTS DONE</span></div></div></div><div className="stats-list">{[['FOCUS', '42', '84%', 'cyan'], ['STRENGTH', '31', '62%', 'gold'], ['DISCIPLINE', '38', '76%', 'violet'], ['WISDOM', '27', '54%', 'teal'], ['VITALITY', '24', '48%', 'blue']].map(([label, value, width, tone]) => <div className="stat-line" key={label}><div><span>{label}</span><strong>{value}</strong></div><div className="stat-track"><i className={tone} style={{ width }} /></div></div>)}</div></div></section>

    <section className="quests-section" id="quests"><div className="section-heading inline-heading"><div><p className="rpg-eyebrow">YOUR ADVENTURES</p><h2>CHOOSE YOUR<br /><em>QUEST.</em></h2></div><button className="outline-gold" onClick={() => openAuth('signup')}>+ Create quest</button></div><div className="quest-grid-landing">{quests.map(([name, type, xp], index) => <article className="quest-tile" key={name}><span className="quest-index">0{index + 1}</span><div><span className="card-label">{type} QUEST</span><h3>{name}</h3></div><strong>{xp}</strong></article>)}</div></section>

    <section className="level-section"><div className="level-stage"><span className="level-old">LEVEL 11</span><ArrowDown size={20} /><strong>LEVEL 12</strong><div className="level-rewards"><span>+160 XP</span><span>+80 GOLD</span><span>ATTRIBUTE UP</span></div></div><div><p className="rpg-eyebrow">THE MOMENT IT CLICKS</p><h2>EVERY DAY IS A<br /><em>LEVEL UP.</em></h2><p>Small wins compound into a character you can be proud of.</p></div></section>

    <section className="rewards-section" id="rewards"><div className="section-heading"><p className="rpg-eyebrow">THE REWARD VAULT</p><h2>EARN YOUR<br /><em>RELICS.</em></h2></div><div className="rewards-grid">{[['CYBER THEME','500 GOLD','◈'],['WARRIOR BADGE','750 GOLD','✦'],['GOLDEN AVATAR','1000 GOLD','◇'],['ANCIENT THEME','1500 GOLD','⬡']].map(([name, price, icon]) => <div className="reward-card" key={name}><div className="reward-icon">{icon}</div><span>{name}</span><strong>{price}</strong></div>)}</div></section>

    <footer className="final-cta"><p className="rpg-eyebrow">YOUR NEXT CHAPTER</p><h2>YOUR NEXT LEVEL<br /><em>STARTS TODAY.</em></h2><p>Your goals are the quests. Your actions are the XP. Your progress is your character.</p><button className="gold-button" onClick={() => openAuth('signup')}>Start your journey <ArrowRight size={15} /></button><div className="social-links"><a href="https://www.linkedin.com/in/edgeofbecoming/" aria-label="Linkedin"><FaLinkedin size={15} /></a><a href="https://github.com/harshavardhanyadav2004" aria-label="GitHub"><FaGithub size={15} /></a><a href="https://harsha-vardhan-boora.vercel.app/" aria-label="Portfolio"><Globe2 size={15} /></a></div></footer>

    {mode && !authUser && <div className="auth-overlay" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'Log in' : 'Create your account'}>
      <div className="auth-modal">
        <button className="modal-close" onClick={() => setMode(null)} aria-label="Close"><X size={18} /></button>
        <div className="modal-mark">✦</div>
        <p className="modal-kicker">LIFE RPG / ACCOUNT</p>
        <h2>{mode === 'login' ? 'Welcome back.' : 'Enter the world.'}</h2>


        <p className="modal-copy">{mode === 'login' ? 'Continue your progression.' : 'Create your character and begin.'}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <div className="name-row">
            <Field label="First name" icon={<UserRound size={15} />} value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} required error={fieldErrors.firstName} />
            <Field label="Last name" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} required error={fieldErrors.lastName} />
          </div>}
          {mode === 'signup' && <>
            <Field label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v.toLowerCase() })} required error={fieldErrors.username} />
            {usernameTaken && <div className="username-warning" role="alert">Username is already taken. Try another.</div>}
          </>}
          <Field label="Email address" type="email" icon={<Mail size={15} />} value={form.email} onChange={(v) => setForm({ ...form, email: v })} required error={fieldErrors.email} />
          {mode === 'signup' && <p className="verification-note">We&apos;ll send a verification link to your email after signup.</p>}
          {mode === 'signup' && <Field label="Phone number" type="tel" icon={<Phone size={15} />} value={form.phone} onChange={(v) => setForm({ ...form, phone: v.replace(/\D/g, '').slice(0, 10) })} required error={fieldErrors.phone} />}
          <PasswordField label="Password" value={form.password} visible={showPassword} onToggle={() => setShowPassword(!showPassword)} onChange={(v) => setForm({ ...form, password: v })} error={fieldErrors.password} />
          {mode === 'signup' && <PasswordField label="Confirm password" value={form.confirmPassword} visible={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} onChange={(v) => setForm({ ...form, confirmPassword: v })} error={fieldErrors.confirmPassword} />}
          {authError && <p className="form-error">{authError}</p>}
          <button className="form-submit" type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Enter world' : 'Create character'} <ArrowRight size={16} />
          </button>
        </form>
        <p className="switch-mode">{mode === 'login' ? 'New player?' : 'Already have a character?'} <button onClick={() => openAuth(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Create one' : 'Log in'}</button></p>
      </div>
    </div>}
  </main>
}

function Field({ label, icon, type = 'text', value, onChange, required, error }: { label: string; icon?: React.ReactNode; type?: string; value: string; onChange: (value: string) => void; required?: boolean; error?: string }) {
  return <label className="field">
    <span>{label}</span>
    <div className="input-wrap">{icon}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} /></div>
    {error && <small className="form-error">{error}</small>}
  </label>
}

function PasswordField({ label, value, visible, onToggle, onChange, error }: { label: string; value: string; visible: boolean; onToggle: () => void; onChange: (value: string) => void; error?: string }) {
  return <label className="field">
    <span>{label}</span>
    <div className="input-wrap">
      <LockKeyhole size={15} />
      <input type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} required minLength={8} />
      <button type="button" className="password-toggle" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
    {error && <small className="form-error">{error}</small>}
  </label>
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, Backpack, Check, ChevronRight, CircleHelp, Coins, Flame, LayoutDashboard, Menu, Plus, ScrollText, Settings, Shield, ShoppingBag, Sparkles, Trophy, UserRound, X, Zap, Gem, LockKeyhole } from 'lucide-react'
import { auth, db } from '@/lib/firebase'
import { signOut, verifyBeforeUpdateEmail } from 'firebase/auth'
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'

type Section = 'Dashboard' | 'Quests' | 'Character' | 'Shop' | 'Inventory' | 'Activity' | 'Settings'
type QuestType = 'Focus' | 'Vitality' | 'Wisdom' | 'Discipline'
type Quest = { id: string; title: string; detail: string; type: QuestType; reward: number; xp: number; done?: boolean }
type Badge = { id: string; name: string; description: string; type: 'Level badge'; earnedAt: number }
type Profile = {
  firstName: string; lastName: string; username: string; email: string
  xp: number; gold: number; streak: number; bestStreak: number; lastLoginDate: string | null
  equippedTheme: string | null; ownedThemes: string[]
  consumables: { doubleXp: boolean; fiveGold: boolean; shields: number }
  badges: Badge[]
  attributes: Record<QuestType, number>
}
type ActivityDay = { loggedIn?: boolean; xp?: number; byType?: Partial<Record<QuestType, number>> }
type ThemeShopItem = { name: string; description: string; cost: number; icon: typeof Zap; type: 'Theme'; themeId: string }
type ConsumableShopItem = { name: string; description: string; cost: number; icon: typeof Zap; type: 'Consumable'; effect: 'double-xp' | 'five-gold' | 'shield' }
type ShopItem = ThemeShopItem | ConsumableShopItem

const nav: { label: Section; icon: typeof LayoutDashboard }[] = [
  { label: 'Dashboard', icon: LayoutDashboard }, { label: 'Quests', icon: ScrollText }, { label: 'Character', icon: UserRound }, { label: 'Shop', icon: ShoppingBag }, { label: 'Inventory', icon: Backpack }, { label: 'Activity', icon: Activity }, { label: 'Settings', icon: Settings },
]

const levelNames = ['Initiate', 'Seeker', 'Apprentice', 'Disciplined', 'Builder', 'Striver', 'Consistent', 'Explorer', 'Challenger', 'Adept', 'Pathfinder', 'Wayfinder', 'Vanguard', 'Ascendant', 'Sentinel', 'Architect', 'Catalyst', 'Mentor', 'Pioneer', 'Luminary', 'Sage', 'Guardian', 'Strategist', 'Mastermind', 'Trailblazer', 'Conqueror', 'Visionary', 'Commander', 'Warden', 'Paragon', 'Sovereign', 'Alchemist', 'Oracle', 'Champion', 'Legend', 'Mythic', 'Eternal', 'Transcendent', 'Radiant', 'Unbound', 'Awakened', 'Exemplar', 'Apex', 'Nexus', 'Zenith', 'Infinite', 'Elevated', 'Unstoppable', 'Ascended', 'Legendary']
const milestones = [[7, 'First Flame'], [25, 'Momentum'], [50, 'Unstoppable'], [100, 'Centurion'], [200, 'Iron Will'], [250, 'Vanguard'], [300, 'Ascendant'], [365, 'Legendary']] as const

const questRewards: Record<QuestType, { xp: number; reward: number; icon: typeof Zap; color: string }> = {
  Focus: { xp: 120, reward: 200, icon: Zap, color: 'cyan' },
  Wisdom: { xp: 200, reward: 200, icon: Gem, color: 'violet' },
  Discipline: { xp: 400, reward: 250, icon: ScrollText, color: 'green' },
  Vitality: { xp: 500, reward: 500, icon: Flame, color: 'amber' },
}

// Attribute bars are derived from cumulative XP earned per quest type (see
// completeQuest). Tune these two constants to change how fast a stat grows
// and how much XP maxes out its bar.
const ATTRIBUTE_XP_PER_POINT = 20
const ATTRIBUTE_XP_FOR_FULL_BAR = 2000

const shopItems: ShopItem[] = [
  { name: 'Focus Potion', description: 'Double XP on your next completed quest', cost: 1000, icon: Zap, type: 'Consumable', effect: 'double-xp' },
  { name: '5× Gold Multiplier', description: 'Multiply Gold from your next completed quest by five', cost: 2000, icon: Coins, type: 'Consumable', effect: 'five-gold' },
  { name: 'Streak Shield', description: 'Protect your streak for one missed day', cost: 5000, icon: Shield, type: 'Consumable', effect: 'shield' },
  { name: 'Cyber Theme', description: 'Electric blue focus mode', cost: 500, icon: Zap, type: 'Theme', themeId: 'cyber' },
  { name: 'Warrior Theme', description: 'Forged for disciplined days', cost: 750, icon: Shield, type: 'Theme', themeId: 'warrior' },
  { name: 'Golden Avatar', description: 'A gilded identity for your profile', cost: 1000, icon: Trophy, type: 'Theme', themeId: 'golden' },
  { name: 'Ancient Theme', description: 'A timeless world for your journey', cost: 1500, icon: Gem, type: 'Theme', themeId: 'ancient' },
]

const themeIcons: Record<string, typeof Zap> = { cyber: Zap, warrior: Shield, golden: Trophy, ancient: Gem }
const attributeRows: { type: QuestType; color: string }[] = [
  { type: 'Focus', color: 'cyan' },
  { type: 'Vitality', color: 'amber' },
  { type: 'Wisdom', color: 'violet' },
  { type: 'Discipline', color: 'green' },
]

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LifeRpg() {
  const uid = auth.currentUser?.uid as string
  const [section, setSection] = useState<Section>('Dashboard')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])
  const [activity, setActivity] = useState<Record<string, ActivityDay>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [milestonesOpen, setMilestonesOpen] = useState(false)

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 2800) }

  // live profile
  useEffect(() => {
    if (!uid) return
    return onSnapshot(doc(db, 'users', uid), (snap) => { if (snap.exists()) setProfile(snap.data() as Profile) })
  }, [uid])

  // live quests
  useEffect(() => {
    if (!uid) return
    return onSnapshot(collection(db, 'users', uid, 'quests'), (snap) => {
      setQuests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Quest, 'id'>) })))
    })
  }, [uid])

  // live activity (for heatmap + xp-today + per-attribute "today" delta)
  useEffect(() => {
    if (!uid) return
    return onSnapshot(collection(db, 'users', uid, 'activity'), (snap) => {
      const map: Record<string, ActivityDay> = {}
      snap.docs.forEach((d) => { map[d.id] = d.data() as ActivityDay })
      setActivity(map)
    })
  }, [uid])

  // record one login per calendar day + advance streak
  useEffect(() => {
    if (!uid || !profile) return
    const key = todayKey()
    if (profile.lastLoginDate === key) return
    ;(async () => {
      const last = profile.lastLoginDate
      let nextStreak = 1
      let shieldUsed = false
      if (last) {
        const diffDays = Math.round((new Date(key).getTime() - new Date(last).getTime()) / 86400000)
        if (diffDays === 1) {
          nextStreak = (profile.streak || 0) + 1
        } else if (diffDays === 0) {
          nextStreak = profile.streak || 1
        } else if ((profile.consumables?.shields || 0) > 0) {
          nextStreak = (profile.streak || 0) + 1
          shieldUsed = true
        } else {
          nextStreak = 1
        }
      }
      await updateDoc(doc(db, 'users', uid), {
        lastLoginDate: key,
        streak: nextStreak,
        bestStreak: Math.max(profile.bestStreak || 0, nextStreak),
        ...(shieldUsed ? { 'consumables.shields': (profile.consumables?.shields || 0) - 1 } : {}),
      })
      await setDoc(doc(db, 'users', uid, 'activity', key), { loggedIn: true, xp: 0 }, { merge: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profile?.lastLoginDate])

  // apply equipped theme app-wide
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', profile?.equippedTheme ?? 'default')
  }, [profile?.equippedTheme])

  // once a pending email change is verified, auth.currentUser.email flips —
  // sync that back into the Firestore profile doc so Settings/Character reflect it
  useEffect(() => {
    if (!uid || !profile) return
    const currentEmail = auth.currentUser?.email
    if (currentEmail && currentEmail !== profile.email) {
      updateDoc(doc(db, 'users', uid), { email: currentEmail })
    }
  }, [uid, profile?.email])

  const completed = useMemo(() => quests.filter((q) => q.done).length, [quests])
  const xp = profile?.xp ?? 0
  const level = Math.min(50, Math.floor(xp / 250) + 1)
  const levelName = levelNames[level - 1]
  const initials = ((profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '')).toUpperCase() || 'AR'

  async function completeQuest(id: string) {
    if (!profile) return
    const quest = quests.find((q) => q.id === id)
    if (!quest || quest.done) return
    const doubleXp = !!profile.consumables?.doubleXp
    const fiveGold = !!profile.consumables?.fiveGold
    const earnedXp = doubleXp ? quest.xp * 2 : quest.xp
    const earnedGold = fiveGold ? quest.reward * 5 : quest.reward
    const nextXp = xp + earnedXp
    const nextLevel = Math.min(50, Math.floor(nextXp / 250) + 1)

    // Bank the XP against the quest's type so Character's attribute bars
    // reflect what was actually done, not a static number.
    const nextAttributes: Record<QuestType, number> = {
      Focus: profile.attributes?.Focus || 0,
      Vitality: profile.attributes?.Vitality || 0,
      Wisdom: profile.attributes?.Wisdom || 0,
      Discipline: profile.attributes?.Discipline || 0,
    }
    nextAttributes[quest.type] = (nextAttributes[quest.type] || 0) + earnedXp

    const newBadges: Badge[] = [...(profile.badges || []), {
      id: `quest-${id}-${Date.now()}`, name: `${quest.type} Badge · ${quest.title}`,
      description: `Earned by completing a ${quest.type.toLowerCase()} quest`, type: 'Level badge', earnedAt: Date.now(),
    }]
    if (nextLevel > level) {
      newBadges.push({ id: `level-${nextLevel}`, name: `${levelNames[nextLevel - 1]} · Level ${nextLevel}`, description: 'Unlocked by reaching a new level', type: 'Level badge', earnedAt: Date.now() })
    }

    await updateDoc(doc(db, 'users', uid, 'quests', id), { done: true, completedAt: serverTimestamp() })
    await updateDoc(doc(db, 'users', uid), {
      xp: nextXp,
      gold: (profile.gold || 0) + earnedGold,
      badges: newBadges,
      attributes: nextAttributes,
      'consumables.doubleXp': false,
      'consumables.fiveGold': false,
    })

    const key = todayKey()
    const todayEntry = activity[key]
    const todayXp = (todayEntry?.xp || 0) + earnedXp
    const todayByType: Partial<Record<QuestType, number>> = {
      ...(todayEntry?.byType || {}),
      [quest.type]: (todayEntry?.byType?.[quest.type] || 0) + earnedXp,
    }
    await setDoc(doc(db, 'users', uid, 'activity', key), { loggedIn: true, xp: todayXp, byType: todayByType }, { merge: true })
    notify(`+${earnedXp} XP  ·  +${earnedGold} Gold · Badge earned`)
  }

  async function createQuest(quest: { title: string; detail: string; type: QuestType }) {
    const rewards = questRewards[quest.type]
    await addDoc(collection(db, 'users', uid, 'quests'), {
      title: quest.title, detail: quest.detail, type: quest.type, xp: rewards.xp, reward: rewards.reward, done: false, createdAt: serverTimestamp(),
    })
  }

  async function buyItem(item: ShopItem) {
    if (!profile) return
    if (profile.gold < item.cost) return notify('Not enough Gold')
    if (item.type === 'Theme' && profile.ownedThemes?.includes(item.themeId)) return notify('Already in inventory')
    const ref = doc(db, 'users', uid)
    if (item.type === 'Theme') {
      await updateDoc(ref, { gold: profile.gold - item.cost, ownedThemes: [...(profile.ownedThemes || []), item.themeId] })
      notify(`${item.name} added to inventory`)
      return
    }
    const patch: Record<string, any> = { gold: profile.gold - item.cost }
    if (item.effect === 'double-xp') patch['consumables.doubleXp'] = true
    if (item.effect === 'five-gold') patch['consumables.fiveGold'] = true
    if (item.effect === 'shield') patch['consumables.shields'] = (profile.consumables?.shields || 0) + 1
    await updateDoc(ref, patch)
    notify(item.effect === 'shield' ? 'Streak Shield purchased and ready.' : `${item.name} purchased — applies to your next completed quest.`)
  }

  async function equipTheme(themeId: string) {
    if (!profile) return
    const next = profile.equippedTheme === themeId ? null : themeId
    await updateDoc(doc(db, 'users', uid), { equippedTheme: next })
    notify(next ? `${themeId} equipped` : 'Theme unequipped')
  }

  async function saveNames(firstName: string, lastName: string) {
    await updateDoc(doc(db, 'users', uid), { firstName, lastName })
    notify('Profile details updated')
  }

  async function changeEmail(newEmail: string) {
    if (!auth.currentUser) return
    await verifyBeforeUpdateEmail(auth.currentUser, newEmail)
    notify('Verification link sent — confirm it to finish the email change.')
  }

  const go = (next: Section) => { setSection(next); setMenuOpen(false) }

  if (!profile) return <div className="auth-loading">Loading your journey…</div>

  return <div className={`rpg-app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((c) => !c)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronRight size={16} /></button>
      <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>LIFE RPG</span><button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <button className="profile-mini" onClick={() => go('Character')}><div className="avatar">{initials}</div><div><strong>{profile.firstName} {profile.lastName}</strong><small>Level {level} · {levelName}</small></div><ChevronRight size={15} className="muted" /></button>
      <nav className="nav-list" aria-label="Primary navigation">{nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${section === label ? 'active' : ''}`} onClick={() => go(label)}><Icon size={18} /><span>{label}</span>{label === 'Quests' && <b className="nav-badge">{quests.filter((q) => !q.done).length}</b>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="streak-box"><div className="streak-title"><Flame size={15} /> CURRENT STREAK</div><strong>{profile.streak} DAYS</strong><button className="milestone-link" onClick={() => setMilestonesOpen(true)}>View milestones <ChevronRight size={13} /></button></div>
        <button className="sidebar-footer" onClick={() => signOut(auth)}><CircleHelp size={15} /> Log out</button>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21} /></button><div className="breadcrumbs"><span>YOUR JOURNEY</span><ChevronRight size={14} /><strong>{section.toUpperCase()}</strong></div><div className="top-actions"><div className="currency"><Coins size={17} /> {profile.gold.toLocaleString()} Gold</div><button className="top-avatar" onClick={() => go('Character')} aria-label="Open profile">{initials}</button></div></header>
      {section === 'Dashboard' && <Dashboard profile={profile} quests={quests} completed={completed} level={level} levelName={levelName} activity={activity} onComplete={completeQuest} onViewAll={() => go('Quests')} />}
      {section === 'Quests' && <Quests quests={quests} onComplete={completeQuest} onCreate={createQuest} />}
      {section === 'Character' && <Character profile={profile} level={level} levelName={levelName} activity={activity} />}
      {section === 'Shop' && <Shop gold={profile.gold} ownedThemes={profile.ownedThemes || []} onBuy={buyItem} />}
      {section === 'Inventory' && <Inventory profile={profile} onEquip={equipTheme} />}
      {section === 'Activity' && <ActivityView activity={activity} />}
      {section === 'Settings' && <SettingsView profile={profile} onSaveNames={saveNames} onChangeEmail={changeEmail} onDone={() => go('Dashboard')} />}
      {toast && <div className="reward-toast"><div className="toast-icon"><Trophy size={19} /></div><div><strong>Journey update</strong><span>{toast}</span></div><Check size={18} className="toast-check" /></div>}
    </main>
    {milestonesOpen && <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Streak milestones"><div className="auth-modal milestone-modal"><button className="modal-close" onClick={() => setMilestonesOpen(false)} aria-label="Close"><X size={18} /></button><div className="eyebrow">STREAK REWARDS</div><h2>Milestones</h2><p className="modal-copy">Keep showing up. Every threshold unlocks a new mark.</p><div className="milestone-list"><div className="milestone-head"><span>DAYS</span><span>MILESTONE</span><span>STATUS</span></div>{milestones.map(([days, name]) => { const unlocked = profile.streak >= days; return <div className={`milestone-row ${unlocked ? 'unlocked' : ''}`} key={days}><strong>{days} DAYS</strong><span className="milestone-name">{name}</span><span className="milestone-status">{unlocked ? <><Check size={13} /> UNLOCKED</> : <><LockKeyhole size={13} /> LOCKED</>}</span></div> })}</div></div></div>}
  </div>
}

function PageHeader({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub: string; action?: React.ReactNode }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{sub}</p></div>{action}</div> }

function Dashboard({ profile, quests, completed, level, levelName, activity, onComplete, onViewAll }: { profile: Profile; quests: Quest[]; completed: number; level: number; levelName: string; activity: Record<string, ActivityDay>; onComplete: (id: string) => void; onViewAll: () => void }) {
  const today = quests.filter((q) => !q.done)
  const streak = profile.streak
  const nextMilestone = milestones.find(([days]) => days > streak) ?? milestones[milestones.length - 1]
  const xp = profile.xp
  const xpToday = activity[todayKey()]?.xp || 0
  const completionPct = quests.length ? Math.round((completed / quests.length) * 100) : 0

  return <div className="content-wrap">
    <div className="welcome"><div><div className="eyebrow">{new Date().toDateString().toUpperCase()}</div><h1>Bonjour, {profile.firstName || 'Adventurer'}.</h1><p>Your next level is closer than you think.</p></div><div className="level-ring"><span>LEVEL</span><strong>{level}</strong></div></div>
    <div className="progress-card"><div className="progress-copy"><div><span className="label">LEVEL {level} · {levelName.toUpperCase()}</span><strong>{xp.toLocaleString()} <small>/ {(level + 1) * 250} XP</small></strong></div><div className="xp-rank">{(250 - (xp % 250)).toLocaleString()} XP to level {level + 1}</div></div><div className="progress-track"><span style={{ width: `${(xp % 250) / 2.5}%` }} /></div></div>
    <div className="dashboard-highlight-row">
      <div className="momentum-card"><div className="eyebrow">MOMENTUM</div><strong>{streak} day streak</strong><p>Keep showing up and your next reward is close.</p><div className="streak-progress"><i style={{ width: `${Math.min(100, (streak / nextMilestone[0]) * 100)}%` }} /></div></div>
      <div className="next-unlock-card"><div className="next-unlock-icon"><Shield size={24} /></div><div className="next-unlock-content"><div className="eyebrow">NEXT UNLOCK</div><h3>{nextMilestone[1]}</h3><p>Reach {nextMilestone[0]} days to unlock this streak badge</p></div><ChevronRight size={22} className="next-unlock-arrow" /></div>
    </div>
    <div className="stat-grid">
      <Stat icon={Zap} label="XP TODAY" value={String(xpToday)} delta="Live" color="cyan" />
      <Stat icon={Flame} label="BEST STREAK" value={`${profile.bestStreak} days`} delta="Synced" color="amber" />
      <Stat icon={Coins} label="GOLD" value={profile.gold.toLocaleString()} delta="Synced" color="violet" />
      <Stat icon={Trophy} label="COMPLETION" value={`${completionPct}%`} delta="Live" color="green" />
    </div>
    <div className="section-heading"><div><div className="eyebrow">DAILY OBJECTIVES</div><h2>Today&apos;s quests <span>{quests.filter((q) => q.done).length}/{quests.length || 0} complete</span></h2></div><button className="text-button" onClick={onViewAll}>View all <ChevronRight size={15} /></button></div>
    {today.length === 0
      ? <div className="empty-state"><p>No created quests yet. Head to Quests to add your first one.</p></div>
      : <div className="quest-grid">{today.map((quest) => <QuestCard key={quest.id} quest={quest} onComplete={onComplete} />)}</div>}
  </div>
}

function Stat({ icon: Icon, label, value, delta, color }: { icon: typeof Zap; label: string; value: string; delta: string; color: string }) { return <div className="stat-card"><div className={`stat-icon ${color}`}><Icon size={17} /></div><span className="label">{label}</span><strong>{value}</strong><small className="positive">{delta}</small></div> }

function QuestCard({ quest, onComplete }: { quest: Quest; onComplete: (id: string) => void }) {
  const meta = questRewards[quest.type]
  const Icon = meta.icon
  return <div className={`quest-card ${quest.done ? 'completed' : ''}`}><div className={`quest-icon ${meta.color}`}><Icon size={21} /></div><div className="quest-info"><div className="quest-meta"><span>PERSONAL QUEST</span><span className="reward"><Coins size={13} /> {quest.reward}</span></div><h3>{quest.title}</h3><p>{quest.detail}</p><div className="quest-reward"><span><Zap size={13} /> {quest.xp} XP</span><button className="complete-button" onClick={() => onComplete(quest.id)} disabled={quest.done}>{quest.done ? <><Check size={15} /> Complete</> : 'Complete'}</button></div></div></div>
}

function Quests({ quests, onComplete, onCreate }: { quests: Quest[]; onComplete: (id: string) => void; onCreate: (quest: { title: string; detail: string; type: QuestType }) => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [type, setType] = useState<QuestType>('Focus')
  const [creating, setCreating] = useState(false)
  const active = quests.filter((quest) => !quest.done)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || !detail.trim()) return
    await onCreate({ title: title.trim(), detail: detail.trim(), type })
    setTitle(''); setDetail(''); setCreating(false)
  }

  return <div className="content-wrap">
    <PageHeader eyebrow="QUEST LOG" title="Your quests" sub="Small actions. Compounding gains." action={<button className="outline-button" onClick={() => setCreating(true)}><Plus size={16} /> New quest</button>} />
    {creating && <div className="quest-modal-overlay" role="dialog" aria-modal="true">
      <form className="panel quest-create-form" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={() => setCreating(false)} aria-label="Close quest form"><X size={17} /></button>
        <label><span>QUEST TITLE</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What do you want to achieve?" required /></label>
        <label><span>DESCRIPTION</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Describe the outcome" required /></label>
        <label><span>QUEST TYPE</span><select value={type} onChange={(event) => setType(event.target.value as QuestType)}>{(['Focus', 'Vitality', 'Wisdom', 'Discipline'] as QuestType[]).map((option) => <option key={option}>{option}</option>)}</select></label>
        <div className="quest-reward-preview">{questRewards[type].xp} XP · {questRewards[type].reward} Gold</div>
        <button className="form-submit" type="submit">Save quest</button>
      </form>
    </div>}
    {active.length === 0
      ? <div className="empty-state"><p>No created quests yet.</p></div>
      : <div className="quest-list">{active.map((quest) => <QuestCard key={quest.id} quest={quest} onComplete={onComplete} />)}</div>}
  </div>
}

function Character({ profile, level, levelName, activity }: { profile: Profile; level: number; levelName: string; activity: Record<string, ActivityDay> }) {
  const initials = ((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')).toUpperCase() || 'AR'
  const todayEntry = activity[todayKey()]

  return <div className="content-wrap">
    <PageHeader eyebrow="CHARACTER SHEET" title={`${profile.firstName} ${profile.lastName}`} sub={`The ${levelName} · Level ${level}`} />
    <div className="character-grid">
      <div className="panel character-card">
        <div className="large-avatar">{initials}</div>
        <div className="class-tag">THE {levelName.toUpperCase()}</div>
        <h2>{profile.firstName} {profile.lastName}</h2>
        <p>Building a life worth showing up for.</p>
        <div className="character-stats">
          <div><span>USERNAME</span><strong>@{profile.username}</strong></div>
          <div><span>XP</span><strong>{profile.xp.toLocaleString()}</strong></div>
          <div><span>GOLD</span><strong>{profile.gold.toLocaleString()}</strong></div>
          <div><span>STREAK</span><strong>{profile.streak} days</strong></div>
        </div>
      </div>
      <div className="panel attributes">
        <div className="eyebrow">ATTRIBUTES</div><h2>Core stats</h2>
        {attributeRows.map(({ type, color }) => {
          const totalXp = profile.attributes?.[type] || 0
          const value = Math.round(totalXp / ATTRIBUTE_XP_PER_POINT)
          const percent = Math.min(100, Math.round((totalXp / ATTRIBUTE_XP_FOR_FULL_BAR) * 100))
          const todayGain = todayEntry?.byType?.[type] || 0
          return <div className="attribute" key={type}>
            <div><span>{type.toUpperCase()}</span><small className="positive">{todayGain > 0 ? `+${todayGain} today` : '—'}</small><strong>{value}</strong></div>
            <div className="attribute-track"><i className={color} style={{ width: `${percent}%` }} /></div>
          </div>
        })}
      </div>
    </div>
  </div>
}

function Shop({ gold, ownedThemes, onBuy }: { gold: number; ownedThemes: string[]; onBuy: (item: ShopItem) => void }) {
  const consumables = shopItems.filter((i): i is ConsumableShopItem => i.type === 'Consumable')
  const themes = shopItems.filter((i): i is ThemeShopItem => i.type === 'Theme')
  return <div className="content-wrap">
    <PageHeader eyebrow="THE MARKETPLACE" title="Spend your rewards" sub="Invest in the player you&apos;re becoming." />
    <div className="section-heading compact"><div><div className="eyebrow">CONSUMABLES</div><h2>Single-use boosts</h2></div></div>
    <div className="shop-grid">
      {consumables.map((item) => { const Icon = item.icon; const affordable = gold >= item.cost; return <div className="panel shop-card" key={item.name}><div className="shop-icon"><Icon size={24} /></div><div className="eyebrow">{item.type.toUpperCase()}</div><h2>{item.name}</h2><p>{item.description}</p><button className="buy-button" disabled={!affordable} onClick={() => onBuy(item)}><Coins size={15} /> {item.cost} <span>{affordable ? 'Purchase' : 'Not enough Gold'}</span></button></div> })}
    </div>
    <div className="section-heading compact" style={{ marginTop: 32 }}><div><div className="eyebrow">THEMES</div><h2>Personalize your world</h2></div></div>
    <div className="shop-grid theme-grid">
      {themes.map((item) => { const Icon = item.icon; const affordable = gold >= item.cost; const owned = ownedThemes.includes(item.themeId); return <div className="panel shop-card" key={item.name}><div className="shop-icon"><Icon size={24} /></div><div className="eyebrow">{item.type.toUpperCase()}</div><h2>{item.name}</h2><p>{item.description}</p><button className="buy-button" disabled={!affordable || owned} onClick={() => onBuy(item)}><Coins size={15} /> {item.cost} <span>{owned ? 'Owned' : affordable ? 'Purchase' : 'Not enough Gold'}</span></button></div> })}
    </div>
  </div>
}

function Inventory({ profile, onEquip }: { profile: Profile; onEquip: (themeId: string) => void }) {
  const streakBadges = milestones.filter(([days]) => profile.streak >= days)
  const levelBadges = profile.badges.filter((b) => b.type === 'Level badge')
  return <div className="content-wrap">
    <PageHeader eyebrow="YOUR LOADOUT" title="Inventory" sub="Milestones, levels, and themes collected along the way." />
    <div className="inventory-groups">
      <section className="inventory-group">
        <div className="eyebrow">STREAK MILESTONE BADGES</div>
        <div className="inventory-grid">
          {streakBadges.length === 0 && <p className="modal-copy">No milestones reached yet.</p>}
          {streakBadges.map(([days, name]) => <div className="panel inventory-item" key={days}><div className="shop-icon"><Flame size={22} /></div><div><h3>{name}</h3><p>Streak milestone badge · {days} days</p></div></div>)}
        </div>
      </section>
      <section className="inventory-group">
        <div className="eyebrow">LEVEL BADGES</div>
        <div className="inventory-grid">
          {levelBadges.length === 0 && <p className="modal-copy">Complete quests to earn level badges.</p>}
          {levelBadges.map((badge) => <div className="panel inventory-item" key={badge.id}><div className="shop-icon"><Trophy size={22} /></div><div><h3>{badge.name}</h3><p>{badge.description}</p></div></div>)}
        </div>
      </section>
      <section className="inventory-group">
        <div className="eyebrow">THEMES</div>
        <div className="inventory-grid">
          {(profile.ownedThemes || []).length === 0 && <p className="modal-copy">No themes owned yet.</p>}
          {(profile.ownedThemes || []).map((themeId) => {
            const Icon = themeIcons[themeId] ?? Sparkles
            const equipped = profile.equippedTheme === themeId
            return <div className={`panel inventory-item ${equipped ? 'is-equipped' : ''}`} key={themeId}><div className="shop-icon"><Icon size={22} /></div><div><h3>{themeId}</h3><p>Theme</p></div><button className="outline-button small" onClick={() => onEquip(themeId)}>{equipped ? 'Unequip' : 'Equip'}</button></div>
          })}
        </div>
      </section>
    </div>
  </div>
}

function ActivityView({ activity }: { activity: Record<string, ActivityDay> }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' })
  const cells = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const entry = activity[key]
    let cls = ''
    if (entry?.loggedIn) cls = (entry.xp || 0) >= 300 ? 'hot' : (entry.xp || 0) > 0 ? 'warm' : 'logged'
    return { day, cls }
  })
  const activeDays = Object.values(activity).filter((a) => a?.loggedIn).length
  return <div className="content-wrap">
    <PageHeader eyebrow="ACTIVITY LOG" title="Your momentum" sub="Consistency is a superpower." />
    <div className="panel activity-panel">
      <div className="panel-heading"><div><div className="eyebrow">QUEST COMPLETIONS</div><h3>{monthLabel}</h3></div><span className="positive">{activeDays} active days</span></div>
      <div className="heatmap">{cells.map(({ day, cls }) => <i key={day} className={cls} title={`Day ${day}`} />)}</div>
    </div>
  </div>
}

function SettingsView({ profile, onSaveNames, onChangeEmail, onDone }: { profile: Profile; onSaveNames: (first: string, last: string) => Promise<void>; onChangeEmail: (email: string) => Promise<void>; onDone: () => void }) {
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [email, setEmail] = useState(profile.email)
  const [editingEmail, setEditingEmail] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try { await onSaveNames(firstName.trim(), lastName.trim()); onDone() } finally { setSaving(false) }
  }

  return <div className="content-wrap settings-centered">
    <PageHeader eyebrow="SYSTEM CONFIG" title="Settings" sub="Update your profile and account details." />
    <div className="settings-layout">
      <div className="panel settings-panel">
        <div className="settings-section-heading"><div className="eyebrow">PROFILE DETAILS</div><h2>Personal information</h2><p>Keep your profile current.</p></div>
        <form className="profile-form" onSubmit={submit}>
          <div className="settings-name-row">
            <label><span>FIRST NAME</span><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
            <label><span>LAST NAME</span><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
          </div>
          <label><span>USERNAME</span><input value={profile.username} disabled /></label>
          <div className="email-change">
            <label><span>EMAIL ADDRESS</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!editingEmail} /></label>
            {!editingEmail && <button className="outline-button" type="button" onClick={() => setEditingEmail(true)}>Change email</button>}
            {editingEmail && <div className="email-actions">
              <button className="outline-button" type="button" onClick={async () => { await onChangeEmail(email); setVerificationSent(true); setEditingEmail(false) }}>Send verification link</button>
              {verificationSent && <small>Verification link sent. Confirm it from your email / check the spam folder — the change applies once verified.</small>}
            </div>}
          </div>
          <button className="form-submit" type="submit" disabled={saving}><Check size={15} /> {saving ? 'Saving…' : 'Save changes'}</button>
        </form>
      </div>
    </div>
  </div>
}

export { levelNames, milestones }
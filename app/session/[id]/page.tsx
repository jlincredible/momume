'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type HangoutType = 'Gym' | 'Study' | 'Hike' | 'Chat' | 'Vibe' | 'Custom';

type Session = {
  id: string;
  placeId: string;
  friendId: string;
  minutes: number;
  startedAt: string;
  hangoutType: HangoutType;
  tags: string[];
  moodScore: 1 | 2 | 3 | 4 | 5;
  notes: string;
  moments: Array<{ id: string; kind: 'photo' | 'video' }>;
};

// ✅ 先用假資料（之後你接後端/DB 再換掉）
const DEMO: Session[] = [
  { id: 's1', placeId: 'library', friendId: 'f_alex', minutes: 40, startedAt: '2026-02-01T10:00:00Z', hangoutType: 'Study', tags: ['focus', 'deep work'], moodScore: 4, notes: 'Quiet morning. Good pace.', moments: [{ id: 'm1', kind: 'photo' }] },
  { id: 's2', placeId: 'library', friendId: 'f_jordan', minutes: 55, startedAt: '2026-02-02T10:00:00Z', hangoutType: 'Chat', tags: ['career', 'ideas'], moodScore: 3, notes: 'Talked a lot, less focus than expected.', moments: [{ id: 'm2', kind: 'photo' }, { id: 'm3', kind: 'video' }] },
  { id: 's3', placeId: 'library', friendId: 'f_casey', minutes: 70, startedAt: '2026-02-03T10:00:00Z', hangoutType: 'Study', tags: ['pomodoro', 'reading'], moodScore: 5, notes: 'Best session this week.', moments: [{ id: 'm4', kind: 'photo' }] },
  { id: 's4', placeId: 'cafe', friendId: 'f_emily', minutes: 110, startedAt: '2026-02-04T10:00:00Z', hangoutType: 'Vibe', tags: ['coffee', 'music'], moodScore: 4, notes: 'Nice ambience. Long flow.', moments: [{ id: 'm5', kind: 'photo' }, { id: 'm6', kind: 'photo' }] },
  { id: 's5', placeId: 'cafe', friendId: 'f_alex', minutes: 30, startedAt: new Date().toISOString(), hangoutType: 'Custom', tags: ['quick check-in'], moodScore: 3, notes: 'Short but helpful.', moments: [] },
  { id: 's6', placeId: 'park', friendId: 'f_casey', minutes: 85, startedAt: '2026-02-06T10:00:00Z', hangoutType: 'Hike', tags: ['walk', 'fresh air'], moodScore: 5, notes: 'Cleared my head.', moments: [{ id: 'm7', kind: 'video' }] },
];

const FRIEND_NAMES: Record<string, string> = {
  f_alex: 'Alex',
  f_emily: 'Emily',
  f_jordan: 'Jordan',
  f_casey: 'Casey',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export default function SessionPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? '');

  const session = useMemo(() => DEMO.find((s) => s.id === id) ?? null, [id]);

  const [selectedType, setSelectedType] = useState<HangoutType>(session?.hangoutType ?? 'Study');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [mood, setMood] = useState<number>(session?.moodScore ?? 4);

  if (!session) {
    return (
      <div style={pageBg()}>
        <div style={panel()}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Session not found</div>
          <button style={btn()} onClick={() => router.push('/three')}>
            Back to map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageBg()}>
      <div style={header()}>
        <button style={btn()} onClick={() => router.push('/three')}>
          ← Back
        </button>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          {FRIEND_NAMES[session.friendId] ?? session.friendId} · {session.placeId} · {fmtTime(session.startedAt)}
        </div>
      </div>

      <div style={panel()}>
        <div style={{ opacity: 0.75, letterSpacing: 2, fontSize: 12, marginBottom: 8 }}>TYPE OF HANGOUT</div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['Gym', 'Study', 'Hike', 'Chat', 'Vibe', 'Custom'] as HangoutType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              style={chip(selectedType === t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 18, opacity: 0.75, letterSpacing: 2, fontSize: 12 }}>MOMENTS</div>
        <div
          style={{
            marginTop: 10,
            borderRadius: 18,
            border: '1px dashed rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.04)',
            padding: 18,
            display: 'grid',
            placeItems: 'center',
            height: 180,
          }}
        >
          <div style={{ opacity: 0.75, display: 'grid', placeItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 26 }}>📷</div>
            <div style={{ fontSize: 12, letterSpacing: 2 }}>POST PHOTOS/VIDEOS</div>
          </div>
        </div>

        <div style={{ marginTop: 18, opacity: 0.75, letterSpacing: 2, fontSize: 12 }}>EXPERIENCE</div>
        <div style={{ marginTop: 10 }}>
          <div style={{ opacity: 0.75, marginBottom: 8 }}>How was the session?</div>
          <input
            type="range"
            min={1}
            max={5}
            value={mood}
            onChange={(e) => setMood(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ marginTop: 6, opacity: 0.85 }}>Mood: {mood}/5</div>
        </div>

        <div style={{ marginTop: 18, opacity: 0.75, letterSpacing: 2, fontSize: 12 }}>NOTES</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Write something..."
          style={{
            marginTop: 10,
            width: '100%',
            minHeight: 120,
            borderRadius: 14,
            padding: 12,
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'white',
            outline: 'none',
            resize: 'vertical',
          }}
        />

        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button style={btn()} onClick={() => router.push('/three')}>
            Done
          </button>
          <button style={btnSecondary()} onClick={() => alert('下一步：接資料庫後存檔')}>
            Save (stub)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== styles ====== */

function pageBg(): React.CSSProperties {
  return {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 50% 20%, #141c26 0%, #0b0f14 55%, #070a0e 100%)',
    padding: 18,
    color: 'white',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    display: 'grid',
    placeItems: 'start center',
  };
}

function header(): React.CSSProperties {
  return {
    width: 'min(420px, 95vw)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  };
}

function panel(): React.CSSProperties {
  return {
    width: 'min(420px, 95vw)',
    borderRadius: 22,
    padding: 16,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(16, 20, 28, 0.78)',
    backdropFilter: 'blur(10px)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  };
}

function chip(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    borderRadius: 16,
    padding: '10px 14px',
    border: active ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.10)',
    background: active ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)',
    color: 'white',
    fontWeight: 700,
  };
}

function btn(): React.CSSProperties {
  return {
    cursor: 'pointer',
    borderRadius: 14,
    padding: '10px 14px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.10)',
    color: 'white',
    fontWeight: 700,
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    cursor: 'pointer',
    borderRadius: 14,
    padding: '10px 14px',
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(0,0,0,0.20)',
    color: 'white',
    opacity: 0.9,
  };
}

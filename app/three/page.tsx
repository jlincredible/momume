'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { RoundedBox, Environment, Html, Line, shaderMaterial } from '@react-three/drei';
import { useRouter } from 'next/navigation';

/* =========================
   Types
========================= */

type HangoutType = 'Gym' | 'Study' | 'Hike' | 'Chat' | 'Vibe' | 'Custom';

type Session = {
  id: string; placeId: string; lat: number; lng: number; friendId: string;
  minutes: number; startedAt: string; hangoutType: HangoutType;
  tags: string[]; moodScore: 1|2|3|4|5; notes: string;
  moments: Array<{ id: string; kind: 'photo'|'video'; thumb?: string }>;
};

type PlaceAggregate = {
  placeId: string; lat: number; lng: number;
  blocks: Array<{
    sessionId: string; friendId: string; minutes: number; color: string;
    startedAt: string; oops: number; hangoutType: HangoutType; tags: string[];
    moodScore: 1|2|3|4|5; notes: string;
    moments: Array<{ id: string; kind: 'photo'|'video'; thumb?: string }>;
  }>;
};

type TimeFilter = 'all' | 'year' | 'month' | 'today';

/* =========================
   Constants
========================= */

const PX_PER_MIN = 0.02;
const MIN_H = 0.4;
const MAX_H = 3.5;
const MAX_BUILDING_H = 5.5;
const BASE_ZOOM = 14.5;
const PHOTO_THRESHOLD = 3;

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function heightFromMinutes(min: number) { return clamp(min * PX_PER_MIN, MIN_H, MAX_H); }

function computeStackVisualTopY(blocks: PlaceAggregate['blocks'], isSelectedBuilding: boolean): number {
  if (blocks.length === 0) return 0;
  const gap = isSelectedBuilding ? 0.25 : 0.02;
  const rawTotalH = blocks.reduce((s, b) => s + heightFromMinutes(b.minutes), 0);
  const ratio = rawTotalH > MAX_BUILDING_H ? MAX_BUILDING_H / rawTotalH : 1;
  const sumRenderH = rawTotalH * ratio;
  const floorCount = isSelectedBuilding ? new Set(blocks.map((b) => b.friendId)).size : blocks.length;
  return sumRenderH + Math.max(0, floorCount - 1) * gap;
}

/* =========================
   Time helpers
========================= */

const TZ = 'Asia/Taipei';
function getTZDate(iso: string) { return new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ })); }
function getNowTZ() { return new Date(new Date().toLocaleString('en-US', { timeZone: TZ })); }
function isTodayISO(iso: string) { const d = getTZDate(iso), now = getNowTZ(); return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate(); }
function isThisMonthISO(iso: string) { const d = getTZDate(iso), now = getNowTZ(); return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); }
function isThisYearISO(iso: string) { const d = getTZDate(iso), now = getNowTZ(); return d.getFullYear()===now.getFullYear(); }
function fmtTime(iso: string) { const d = getTZDate(iso), pad = (n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function moodLabel(score: number) { if(score>=5)return'Excellent';if(score>=4)return'Good';if(score>=3)return'Ok';if(score>=2)return'Low';return'Bad'; }

/* =========================
   Data
========================= */

const FRIEND_COLORS: Record<string,string> = { 
  f_alex:'#E04242',   
  f_emily:'#4A89F3',  
  f_jordan:'#C4A674', 
  f_casey:'#21B188'   
};
const FRIEND_NAMES:  Record<string,string> = { f_alex:'Liam', f_emily:'Sarah', f_jordan:'Chris', f_casey:'Jade' };

const BASE_TIME = Date.now();
const daysAgo = (days: number) => new Date(BASE_TIME - days * 86400000).toISOString();
const THUMB_SIZE = 896;
const picsum = (seed: string) => `https://picsum.photos/seed/${seed}/${THUMB_SIZE}/${THUMB_SIZE}`;
const IMG_CAFE  = picsum('cafe1');
const IMG_STUDY = picsum('study1');
const IMG_PARK  = picsum('park1');
const IMG_VIBE  = picsum('vibe1');
const IMG_GYM   = picsum('gym1');
const IMG_R1    = picsum('randA');
const IMG_R2    = picsum('randB');
const IMG_R3    = picsum('randC');

const DEMO_SESSIONS: Session[] = [
  { id:'s1', placeId:'xinyi_library',   lat:25.0375, lng:121.5625, friendId:'f_alex',   minutes:40,  startedAt:daysAgo(40), hangoutType:'Study', tags:['focus'],    moodScore:4, notes:'Quiet morning.',          moments:[{id:'m1',  kind:'photo',thumb:IMG_STUDY}] },
  { id:'s2', placeId:'xinyi_library',   lat:25.0375, lng:121.5625, friendId:'f_jordan', minutes:55,  startedAt:daysAgo(35), hangoutType:'Chat',  tags:['career'],   moodScore:3, notes:'Talked a lot.',           moments:[{id:'m2',  kind:'photo',thumb:IMG_R1}]   },
  { id:'s3', placeId:'xinyi_library',   lat:25.0375, lng:121.5625, friendId:'f_casey',  minutes:70,  startedAt:daysAgo(12), hangoutType:'Study', tags:['reading'],  moodScore:5, notes:'Best session.',           moments:[{id:'m4',  kind:'photo',thumb:IMG_STUDY}] },
  { id:'s4', placeId:'xinyi_cafe',      lat:25.0350, lng:121.5680, friendId:'f_emily',  minutes:110, startedAt:daysAgo(30), hangoutType:'Vibe',  tags:['coffee'],   moodScore:4, notes:'Nice ambience.',          moments:[{id:'m5',  kind:'photo',thumb:IMG_CAFE}]  },
  { id:'s5', placeId:'xinyi_cafe',      lat:25.0350, lng:121.5680, friendId:'f_alex',   minutes:30,  startedAt:daysAgo(0),  hangoutType:'Custom',tags:['check-in'], moodScore:3, notes:'Today meeting.',          moments:[{id:'mc1', kind:'photo',thumb:IMG_R2}]    },
  { id:'e5', placeId:'xinyi_cafe',      lat:25.0350, lng:121.5680, friendId:'f_emily',  minutes:60,  startedAt:daysAgo(2),  hangoutType:'Vibe',  tags:['morning'],  moodScore:4, notes:'Quick catch up.',         moments:[{id:'me5', kind:'photo',thumb:IMG_CAFE}]  },
  { id:'e3', placeId:'taipei_101',      lat:25.0339, lng:121.5645, friendId:'f_emily',  minutes:180, startedAt:daysAgo(10), hangoutType:'Vibe',  tags:['dinner'],   moodScore:5, notes:'Amazing view.',           moments:[{id:'m101',kind:'photo',thumb:IMG_VIBE}]  },
  { id:'a1', placeId:'taipei_101',      lat:25.0339, lng:121.5645, friendId:'f_alex',   minutes:45,  startedAt:daysAgo(5),  hangoutType:'Custom',tags:['work'],     moodScore:3, notes:'Quick lunch meeting.',    moments:[{id:'ma1', kind:'photo',thumb:IMG_R3}]    },
  { id:'e1', placeId:'ntu_campus',      lat:25.0173, lng:121.5373, friendId:'f_emily',  minutes:120, startedAt:daysAgo(14), hangoutType:'Study', tags:['campus'],   moodScore:4, notes:'Studied together.',       moments:[{id:'ntu1',kind:'photo',thumb:IMG_STUDY}] },
  { id:'e2', placeId:'daan_park',       lat:25.0300, lng:121.5350, friendId:'f_emily',  minutes:90,  startedAt:daysAgo(12), hangoutType:'Hike',  tags:['walk'],     moodScore:5, notes:'Nice sunset walk.',       moments:[{id:'p1',  kind:'photo',thumb:IMG_PARK}]  },
  { id:'e4', placeId:'zhongshan_cafe',  lat:25.0526, lng:121.5200, friendId:'f_emily',  minutes:150, startedAt:daysAgo(8),  hangoutType:'Chat',  tags:['coffee'],   moodScore:4, notes:'Deep talks.',             moments:[{id:'z1',  kind:'photo',thumb:IMG_CAFE}]  },
  { id:'j1', placeId:'ntu_campus',      lat:25.0173, lng:121.5373, friendId:'f_jordan', minutes:200, startedAt:daysAgo(60), hangoutType:'Gym',   tags:['baseball'], moodScore:5, notes:'Team practice.',          moments:[{id:'g1',  kind:'photo',thumb:IMG_GYM}]   },
  { id:'j2', placeId:'zhongshan_cafe',  lat:25.0526, lng:121.5200, friendId:'f_jordan', minutes:100, startedAt:daysAgo(4),  hangoutType:'Chat',  tags:['chill'],    moodScore:4, notes:'Corner cafe chill.',      moments:[{id:'z2',  kind:'photo',thumb:IMG_R1}]    },
  { id:'j3', placeId:'daan_park',       lat:25.0300, lng:121.5350, friendId:'f_jordan', minutes:100, startedAt:daysAgo(1),  hangoutType:'Hike',  tags:['chill'],    moodScore:5, notes:'Night walk.',             moments:[{id:'p2',  kind:'photo',thumb:IMG_PARK}]  },
  { id:'c1', placeId:'daan_park',       lat:25.0300, lng:121.5350, friendId:'f_casey',  minutes:60,  startedAt:daysAgo(0),  hangoutType:'Hike',  tags:['run'],      moodScore:4, notes:'Morning 5K run.',         moments:[{id:'p3',  kind:'photo',thumb:IMG_R2}]    },
];

function generateDenseSessions(): Session[] {
  const placeId = 'taipei_memory_hub', lat = 25.022, lng = 121.538;
  const friendIds = Object.keys(FRIEND_COLORS);
  const types: HangoutType[] = ['Chat','Study','Vibe','Custom','Gym'];
  return Array.from({length:25},(_,i)=>{
    const hasPhoto = i % 3 !== 0;
    return {
      id:`dense_${i}`, placeId, lat, lng,
      friendId: friendIds[i % friendIds.length],
      minutes: 20 + ((i*17)%100),
      startedAt: daysAgo(i+1),
      hangoutType: types[i%types.length],
      tags: ['sim', types[i%types.length].toLowerCase()],
      moodScore: (1+(i%5)) as any,
      notes: `Memory block ${i}.`,
      moments: hasPhoto ? [{id:`m_${i}`,kind:'photo' as const,thumb:picsum(`mem${i}`)}] : [],
    };
  });
}

const ALL_SESSIONS = [...DEMO_SESSIONS, ...generateDenseSessions()];

function aggregateSessions(sessions: Session[]): PlaceAggregate[] {
  const map = new Map<string,PlaceAggregate>();
  for (const s of sessions) {
    if (!map.has(s.placeId)) map.set(s.placeId, { placeId:s.placeId, lat:s.lat, lng:s.lng, blocks:[] });
    map.get(s.placeId)!.blocks.push({
      sessionId:s.id, friendId:s.friendId, minutes:s.minutes,
      color: FRIEND_COLORS[s.friendId]??'#888888', startedAt:s.startedAt,
      oops: Math.max(0,Math.round(s.minutes/18)-1),
      hangoutType:s.hangoutType, tags:s.tags, moodScore:s.moodScore, notes:s.notes, moments:s.moments,
    });
  }
  return Array.from(map.values()).map(p => {
    p.blocks.sort((a,b)=>new Date(a.startedAt).getTime()-new Date(b.startedAt).getTime());
    return p;
  });
}

/* =========================
   Materials
========================= */

export type BlockVisualState = 'active' | 'filtered-dimmed' | 'muted';
const MAT_CACHE = new Map<string,THREE.Material>();

function buildMaterial(hex: string, vs: BlockVisualState, density: number) {
  const key = `${hex}|${vs}|${Math.floor(density*10)}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key)!;
  const accent = new THREE.Color(hex);
  const dark   = new THREE.Color('#0b1020');
  let mat: THREE.Material;
  
  if (vs === 'active') {
    mat = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.15, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: accent, emissiveIntensity: 0.15 * density });
  } else if (vs === 'filtered-dimmed') {
    mat = new THREE.MeshPhysicalMaterial({ color: dark.clone().lerp(accent, 0.2), roughness: 0.5, metalness: 0.1, clearcoat: 0.3, emissive: accent, emissiveIntensity: 0.05 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: dark.clone().multiplyScalar(0.4), roughness: 0.9, metalness: 0, emissive: new THREE.Color('#000'), emissiveIntensity: 0 });
  }
  MAT_CACHE.set(key, mat);
  return mat;
}

function ArchitecturalBlock({w=0.5,d=0.5,h,color,visualState,densityBoost,onPick}:{ w?:number;d?:number;h:number;color:string;visualState:BlockVisualState;densityBoost:number;onPick?:()=>void; }) {
  const mat = useMemo(()=>buildMaterial(color,visualState,densityBoost),[color,visualState,densityBoost]);
  return (
    <group onPointerDown={e=>{e.stopPropagation();onPick?.();}}>
      <RoundedBox args={[w,h,d]} radius={0.04} smoothness={4} material={mat}/>
      <mesh position={[0,h/2-0.015*Math.min(1,densityBoost),0]}>
        <boxGeometry args={[w+0.015,0.02,d+0.015]}/>
        <meshStandardMaterial color={visualState==='active'?'#03050a':'#020305'} roughness={0.8}/>
      </mesh>
    </group>
  );
}

/* =========================
   Holographic shader
========================= */

const HolographicMaterial = shaderMaterial(
  {uTime:0,uTex:null,uColorB:new THREE.Color('#2DD4BF'),uOpacity:1.0,uHover:0,uActive:0,uDepth:0,uClarity:1.0},
  `varying vec2 vUv;varying vec3 vWorldPos,vNormalW;uniform float uHover,uActive,uTime;
   void main(){vUv=uv;vec3 pos=position;float flutterAmt=0.0022*(1.-max(uActive,uHover));
   pos.y+=sin(uTime*1.8+uv.y*8.)*flutterAmt;
   vec4 wp=modelMatrix*vec4(pos,1.);vWorldPos=wp.xyz;vNormalW=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`,
  `varying vec2 vUv;varying vec3 vWorldPos,vNormalW;
   uniform sampler2D uTex;uniform float uTime,uOpacity,uHover,uActive,uDepth,uClarity;uniform vec3 uColorB;
   void main(){
     float e=smoothstep(.12,.92,distance(vUv,vec2(.5)));
     float rs=(0.00025+0.0006*uHover+0.001*uActive)*e;
     vec4 tR=texture2D(uTex,vUv+vec2(rs,0.)),tG=texture2D(uTex,vUv),tB=texture2D(uTex,vUv-vec2(rs,0.));
     vec4 tc=vec4(tR.r,tG.g,tB.b,tG.a);
     float scanAmt=mix(0.012,0.035,1.-uClarity);
     float scan=sin(vUv.y*420.-uTime*4.2)*scanAmt+1.;
     tc.rgb*=mix(scan,1.,uClarity);
     float f=max(0.,dot(normalize(cameraPosition-vWorldPos),vNormalW));
     float bw=0.018+uHover*.008+uActive*.01;
     float b=step(1.-bw,vUv.x)+step(vUv.x,bw)+step(1.-bw,vUv.y)+step(vUv.y,bw);
     vec3 col=mix(tc.rgb,uColorB*(1.15+uHover*0.15),b*f*0.85);
     float df=clamp(1.-((uDepth-5.)/14.),0.78,1.);
     df=mix(df,1.,uActive);
     df=mix(1.,df,0.55+0.45*uClarity);
     float bright=0.92+f*0.38+uHover*0.18+uActive*0.35;
     float a=tc.a*uOpacity*mix(0.94,1.,uHover*0.5+uActive)*df;
     gl_FragColor=vec4(col*bright,a);
   }`
);
extend({ HolographicMaterial });

/* =========================
   CyberFunnel
========================= */

function CyberFunnel({ color, totalMinutes, blockCount }: { color:string; totalMinutes:number; blockCount:number }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<THREE.Mesh[]>([]);
  const partRefs = useRef<THREE.Mesh[]>([]);
  const beamRefs = useRef<THREE.Mesh[]>([]);
  const coreRef  = useRef<THREE.Mesh>(null);

  const LEVELS = 5;
  const funnelData = useMemo(()=>Array.from({length:LEVELS},(_,i)=>{
    const t = i/(LEVELS-1);
    return { y: t*1.8, radius: 0.22+t*0.65, opacity: 0.6-t*0.3, speed: 0.3+t*0.15 };
  }),[]);

  const beamAngles = useMemo(()=>Array.from({length:6},(_,i)=>(i/6)*Math.PI*2),[]);
  const particles = useMemo(()=>Array.from({length:18},(_,i)=>({ angle:(i/18)*Math.PI*2, speed:0.5+((i*7)%10)*0.08, yBase: (i/18)*1.8, phase:(i*0.41)%( Math.PI*2), size:0.025+((i*3)%5)*0.008 })),[]);

  useFrame(({clock})=>{
    const t = clock.elapsedTime;
    if (!groupRef.current) return;
    groupRef.current.position.y = Math.sin(t*0.9)*0.04;
    groupRef.current.rotation.y = t*0.1;
    ringRefs.current.forEach((r,i)=>{ if(!r)return; r.rotation.z=t*funnelData[i].speed*(i%2?-1:1); });
    partRefs.current.forEach((p,i)=>{
      if(!p)return; const pd=particles[i]; const ang=pd.angle+t*pd.speed; const yLoop=((t*0.3+pd.yBase)%1.8); const r=0.22+(yLoop/1.8)*0.65;
      p.position.set(Math.cos(ang)*r*0.9, yLoop, Math.sin(ang)*r*0.9);
      const pulse=0.7+Math.sin(t*2.2+pd.phase)*0.3; p.scale.setScalar(pulse); (p.material as THREE.MeshBasicMaterial).opacity=0.5*pulse;
    });
    beamRefs.current.forEach((b,i)=>{
      if(!b)return; const pulse=0.85+Math.sin(t*1.6+i*1.05)*0.15; b.scale.y=pulse; (b.material as THREE.MeshBasicMaterial).opacity=0.15*pulse;
    });
    if (coreRef.current) { const s=1+Math.sin(t*2.8)*0.1; coreRef.current.scale.setScalar(s); }
  });

  return (
    <group ref={groupRef}>
      {funnelData.map((fd,i)=>(
        <mesh key={i} ref={r=>{if(r)ringRefs.current[i]=r;}} position={[0,fd.y,0]} rotation={[-Math.PI/2,0,0]}>
          <torusGeometry args={[fd.radius,0.018,12,80]}/>
          <meshBasicMaterial color={color} transparent opacity={fd.opacity} blending={THREE.AdditiveBlending} depthWrite={false}/>
        </mesh>
      ))}
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[0.28,48]}/><meshBasicMaterial color={color} transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      <mesh position={[0,1.9,0]}><sphereGeometry args={[0.07,14,14]}/><meshBasicMaterial color="#ffffff" transparent opacity={0.65} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      {beamAngles.map((ang,i)=>{
        const br=0.5+((i%3)*0.12);
        return (<mesh key={i} ref={r=>{if(r)beamRefs.current[i]=r;}} position={[Math.cos(ang)*br,0.9,Math.sin(ang)*br]}><cylinderGeometry args={[0.01,0.025,1.8,6,1,true]}/><meshBasicMaterial color={color} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>);
      })}
      {particles.map((pd,i)=>(<mesh key={i} ref={r=>{if(r)partRefs.current[i]=r;}}><sphereGeometry args={[pd.size,5,5]}/><meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>))}
      <mesh ref={coreRef}><sphereGeometry args={[0.13,20,20]}/><meshBasicMaterial color={color} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      <Html center transform={false} occlude={false} distanceFactor={10} position={[1.2,0.9,0]}>
        <div style={{ pointerEvents:'none', color:'white', fontFamily:'Inter,system-ui,sans-serif', width:128, padding:'10px 13px', borderRadius:12, background:'rgba(8,14,24,0.75)', border:`1px solid ${color}44`, backdropFilter:'blur(8px)', boxShadow:`0 0 20px ${color}22` }}>
          <div style={{fontSize:9,letterSpacing:'0.15em',opacity:0.55,marginBottom:3}}>PLACE ENERGY</div>
          <div style={{fontSize:22,fontWeight:800,lineHeight:1}}>{Math.round(totalMinutes)}m</div>
          <div style={{fontSize:11,opacity:0.65,marginTop:3}}>{blockCount} sessions</div>
          <div style={{fontSize:9,opacity:0.4,marginTop:6,lineHeight:1.4}}>add {PHOTO_THRESHOLD}+ photos<br/>to unlock gallery</div>
        </div>
      </Html>
    </group>
  );
}

/* =========================
   MemoryMetaChip
========================= */

function MemoryMetaChip({color,title,subtitle,active}:{color:string;title:string;subtitle:string;active:boolean}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({clock})=>{ if(!ref.current)return; ref.current.position.y=THREE.MathUtils.lerp(ref.current.position.y,active?0.38+Math.sin(clock.elapsedTime*1.5)*0.01:0.22,0.12); });
  return (
    <group ref={ref} position={[1.45,0.22,0.08]}>
      <mesh><planeGeometry args={[1.0,0.45]}/><meshBasicMaterial color="#0d1626" transparent opacity={active?0.85:0} depthWrite={false}/></mesh>
      <mesh position={[0,0,0.002]}><planeGeometry args={[1.04,0.49]}/><meshBasicMaterial color={color} transparent opacity={active?0.3:0} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      {active&&<Html center transform={false} occlude={false} style={{pointerEvents:'none',width:'140px',transform:'translate(-50%,-50%)',color:'white',fontFamily:'system-ui,sans-serif',textShadow:'0 0 10px rgba(0,0,0,0.8)'}}>
        <div style={{fontSize:13,fontWeight:700,lineHeight:1.15}}>{title}</div>
        <div style={{fontSize:11,opacity:0.72,marginTop:4}}>{subtitle}</div>
      </Html>}
    </group>
  );
}

/* =========================
   MemoryCard
========================= */

function MemoryCard({m,index,total,scrollRef,isActive,expandedMode,onMakeActive,onCancelActive,onSnapToCenter,onSelectSession,dragRef,ringRadius,isMobile}:{
  m:any;index:number;total:number;scrollRef:React.MutableRefObject<number>;isActive:boolean;
  expandedMode:boolean;
  onMakeActive:()=>void;onCancelActive:()=>void;onSnapToCenter:(i:number)=>void;
  onSelectSession:(id:string, fromPhoto?:boolean)=>void;dragRef:React.MutableRefObject<{dragged:boolean}>;
  ringRadius:number;isMobile:boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef   = useRef<any>(null);
  const bgRef    = useRef<THREE.MeshBasicMaterial>(null);
  const {camera,gl} = useThree();
  const worldPos = useMemo(()=>new THREE.Vector3(),[]);
  const [tex,setTex] = useState<THREE.Texture|null>(null);
  const [hovered,setHovered] = useState(false);
  const pressTimer = useRef<NodeJS.Timeout|null>(null);
  const longPressTriggeredRef = useRef(false);
  const [panelOpen,setPanelOpen] = useState(false);

  const frameWireMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const frameGlowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const frameMeshRef = useRef<THREE.Mesh>(null);

  useEffect(()=>{
    if(!isActive){
      setPanelOpen(false);
      return;
    }
    setPanelOpen(false);
    const raf = requestAnimationFrame(()=>setPanelOpen(true));
    return ()=>cancelAnimationFrame(raf);
  },[isActive]);

  useEffect(()=>{
    if(!m.thumb)return;
    let ok=true;
    const loader = new THREE.TextureLoader();
    loader.load(m.thumb,t=>{
      if(!ok)return;
      t.colorSpace=THREE.SRGBColorSpace;
      t.generateMipmaps=true;
      t.minFilter=THREE.LinearMipmapLinearFilter;
      t.magFilter=THREE.LinearFilter;
      const maxA = typeof gl.capabilities.getMaxAnisotropy==='function'?gl.capabilities.getMaxAnisotropy():1;
      t.anisotropy=Math.min(16,maxA);
      setTex(t);
    },undefined,e=>console.warn(e));
    return()=>{ok=false;};
  },[m.thumb,gl]);

  useFrame((state)=>{
    if(!groupRef.current)return;
    let off=index-scrollRef.current;
    const half=total/2;
    if(off>half)off-=total;
    if(off<-half)off+=total;
    const abs=Math.abs(off);
    const isFront=abs<0.22;
    const n=Math.max(total,1);
    const theta=(2*Math.PI/n)*(index-scrollRef.current);
    const R=ringRadius;
    let tx=R*Math.sin(theta);
    let tz=R*Math.cos(theta);
    let ty=Math.sin(state.clock.elapsedTime*1.35+index*0.62)*0.055;
    const frontLift=(1-Math.min(abs,1.15))*0.22;
    ty+=frontLift;
    const coverPush=(1-Math.min(abs,1))*0.38;
    const cx=-Math.sin(theta),cz=-Math.cos(theta);
    tx+=cx*coverPush;
    tz+=cz*coverPush;
    let sc=0.72+Math.max(0,1-Math.min(abs,1.2)/1.2)*0.58+(isFront||hovered?0.1:0);
    const coverTilt=THREE.MathUtils.clamp(-off*(Math.PI/Math.max(n*0.85,4)),-0.95,0.95);
    const shouldRetreat = expandedMode && !isActive;

    if(isActive){
      tx = 0;
      tz = R * 1.18;
      ty = 0.36 + frontLift * 0.4;
      sc = 2.35;
    } else if (shouldRetreat) {
      const retreat = 0.55 + Math.min(abs, 1) * 0.6;
      tx *= 0.18;
      tz -= retreat;
      ty -= retreat * 0.08;
      sc *= 0.72;
    }

    groupRef.current.position.x=THREE.MathUtils.lerp(groupRef.current.position.x,tx,0.16);
    groupRef.current.position.y=THREE.MathUtils.lerp(groupRef.current.position.y,ty,0.16);
    groupRef.current.position.z=THREE.MathUtils.lerp(groupRef.current.position.z,tz,0.16);
    groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x,Math.max(0.01,sc),0.16));

    groupRef.current.getWorldPosition(worldPos);
    const dx=camera.position.x-worldPos.x;
    const dz=camera.position.z-worldPos.z;
    const coverTiltForFace = isActive ? coverTilt * 0.06 : coverTilt;
    const faceY=Math.atan2(dx,dz)+coverTiltForFace*(shouldRetreat?0.75:1);
    groupRef.current.rotation.y=THREE.MathUtils.lerp(groupRef.current.rotation.y,faceY,0.22);

    if(matRef.current){
      matRef.current.uniforms.uTime.value=state.clock.elapsedTime;
      matRef.current.uniforms.uDepth.value=worldPos.distanceTo(camera.position);
      const hoverTarget = expandedMode ? 0 : ((isFront||hovered)?1:0);
      matRef.current.uniforms.uHover.value=THREE.MathUtils.lerp(matRef.current.uniforms.uHover.value, hoverTarget,0.16);
      matRef.current.uniforms.uActive.value=THREE.MathUtils.lerp(matRef.current.uniforms.uActive.value,isActive?1:0,0.16);
      if(matRef.current.uniforms.uOpacity)
        matRef.current.uniforms.uOpacity.value=THREE.MathUtils.lerp(matRef.current.uniforms.uOpacity.value,isActive?1:(expandedMode?0.62:1),0.16);
      if(matRef.current.uniforms.uClarity){
        const clarityTarget = isActive ? 1 : (expandedMode ? 0.55 : (isFront||hovered ? 1 : 0.72));
        matRef.current.uniforms.uClarity.value=THREE.MathUtils.lerp(matRef.current.uniforms.uClarity.value,clarityTarget,0.12);
      }
    }
    if(bgRef.current){
      const bgTarget = isActive ? 0.34 : (shouldRetreat ? 0.035 : (isFront ? 0.14 : 0.06));
      bgRef.current.opacity=THREE.MathUtils.lerp(bgRef.current.opacity,bgTarget,0.16);
    }

    if(frameWireMatRef.current){
      const target = isActive ? 0.55 : 0;
      frameWireMatRef.current.opacity = THREE.MathUtils.lerp(frameWireMatRef.current.opacity, target, 0.16);
    }
    if(frameGlowMatRef.current){
      const t = state.clock.elapsedTime;
      const pulse = 0.75 + Math.sin(t * 6) * 0.25;
      const target = isActive ? 0.35 * pulse : 0;
      frameGlowMatRef.current.opacity = THREE.MathUtils.lerp(frameGlowMatRef.current.opacity, target, 0.16);
    }
  });

  const htmlPos = isMobile ? [0, -1.5, 0] : [-1.6, 0.2, 0];

  return (
    <group ref={groupRef}
      onPointerDown={e=>{
        e.stopPropagation();
        if(dragRef.current.dragged)return;
        longPressTriggeredRef.current=false;
        pressTimer.current=setTimeout(()=>{
          longPressTriggeredRef.current=true;
          onSnapToCenter(index);
          onMakeActive();
          onSelectSession(m.sessionId, true); 
        },320);
      }}
      onPointerUp={e=>{
        e.stopPropagation();if(pressTimer.current)clearTimeout(pressTimer.current);
        if(dragRef.current.dragged)return;
        if(longPressTriggeredRef.current)return; 
        if(isActive){onCancelActive();return;}
        let off=index-scrollRef.current;
        const h=total/2;if(off>h)off-=total;if(off<-h)off+=total;
        if(Math.abs(off)<0.4) {
          onMakeActive();
          onSelectSession(m.sessionId, true); 
        } else onSnapToCenter(index);
      }}
      onPointerOut={()=>{if(pressTimer.current)clearTimeout(pressTimer.current);longPressTriggeredRef.current=false;setHovered(false);document.body.style.cursor='';}}
      onPointerOver={()=>{setHovered(true);document.body.style.cursor='pointer';}}
    >
      <mesh position={[0,0,-0.02]}><planeGeometry args={[1.5,1.5]}/><meshBasicMaterial ref={bgRef} color={m.color} transparent opacity={0.05} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      <mesh ref={frameMeshRef} position={[0,0,-0.045]}><planeGeometry args={[1.55,1.55]}/><meshBasicMaterial ref={frameGlowMatRef} color={m.color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      <mesh position={[0,0,-0.04]}><planeGeometry args={[1.55,1.55]}/><meshBasicMaterial ref={frameWireMatRef} color={m.color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} wireframe/></mesh>
      {tex?(
        <mesh><planeGeometry args={[1.35,1.35]}/>
          {/* @ts-ignore */}
          <holographicMaterial ref={matRef} uTex={tex} uColorB={new THREE.Color(m.color)} uClarity={1} transparent depthWrite={true}/>
        </mesh>
      ):(
        <mesh><planeGeometry args={[1.35,1.35]}/><meshBasicMaterial color="#222" wireframe/></mesh>
      )}
      {!expandedMode && (
        <MemoryMetaChip color={m.color} title={m.hangoutType??'Memory'} subtitle={m.startedAt?fmtTime(m.startedAt):`Session ${m.sessionId}`} active={isActive} />
      )}

      {isActive && (
        <Html center transform={false} occlude={false} distanceFactor={10} position={htmlPos as [number,number,number]}>
          <div
            style={{
              pointerEvents: 'auto', 
              width: 260,
              padding: '16px 20px',
              borderRadius: 20,
              color: 'white',
              fontFamily: 'system-ui, sans-serif',
              background: 'rgba(22, 28, 40, 0.85)',
              border: `1px solid ${m.color}66`,
              backdropFilter: 'blur(20px)',
              boxShadow: `0 18px 50px ${m.color}22, 0 12px 32px rgba(0,0,0,0.6)`,
              opacity: panelOpen ? 1 : 0,
              transform: panelOpen ? 'translateY(0px) scale(1)' : 'translateY(10px) scale(0.95)',
              transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{m.hangoutType ?? 'Memory'}</span>
              <div style={{width: 12, height: 12, borderRadius: '50%', background: m.color, boxShadow: `0 0 10px ${m.color}`}} />
            </div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>{m.startedAt ? fmtTime(m.startedAt) : ''}</div>
            <div style={{ fontSize: 14, opacity: 0.9, marginTop: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {m.placeId} / <span style={{fontWeight: 'bold'}}>{Math.round(m.minutes ?? 0)}m</span> / {FRIEND_NAMES[m.friendId] ?? m.friendId}
            </div>
            <div style={{ marginTop: 14, fontSize: 15, lineHeight: 1.4, opacity: 0.95 }}>
              {m.notes || (Array.isArray(m.tags) ? m.tags[0] : null) || moodLabel(m.moodScore ?? 3)}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

/* =========================
   MemoriesAboveBuilding
========================= */

function MemoriesAboveBuilding({blocks,placeId,stackTopY,selectedSessionId,onSelectSession,isMobile,mapRef,activePhotoId,setActivePhotoId}:{
  blocks: PlaceAggregate['blocks'];
  placeId: string;
  stackTopY: number; 
  selectedSessionId: string | null;
  onSelectSession:(sessionId:string, fromPhoto?:boolean)=>void;
  isMobile:boolean;
  mapRef:React.MutableRefObject<mapboxgl.Map|null>;
  activePhotoId: string | null;
  setActivePhotoId: React.Dispatch<React.SetStateAction<string|null>>;
}) {
  const moments = useMemo(()=>
    blocks.flatMap((b)=>b.moments.map((m)=>({
      ...m, sessionId: b.sessionId, placeId, friendId: b.friendId, minutes: b.minutes,
      color: b.color, startedAt: b.startedAt, hangoutType: b.hangoutType, tags: b.tags, moodScore: b.moodScore, notes: b.notes,
    }))),
  [blocks, placeId]);

  const dominantColor = useMemo(()=>{
    const freq:Record<string,number>={};
    for(const b of blocks) freq[b.friendId]=(freq[b.friendId]??0)+b.minutes;
    const top=Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];
    return top?(FRIEND_COLORS[top[0]]??'#7ef9ff'):'#7ef9ff';
  },[blocks]);

  const totalMinutes = useMemo(()=>blocks.reduce((s,b)=>s+b.minutes,0),[blocks]);
  const galleryY = stackTopY + 0.55;

  const scrollRef = useRef(0);
  const targetRef = useRef(0);
  const groupRef  = useRef<THREE.Group>(null);
  const dragRef   = useRef({isDragging:false, startX:0, startScroll:0, dragged:false});
  const ringRadius = useMemo(() => clamp(1.55 + moments.length * 0.028, 1.62, 2.35), [moments.length]);

  const snapToCenter = useCallback((idx:number)=>{
    const total=moments.length;
    let cur=Math.round(targetRef.current)%total;
    if(cur<0)cur+=total;
    let d=idx-cur;
    if(d>total/2)d-=total;
    if(d<-total/2)d+=total;
    targetRef.current+=d;
  },[moments.length]);

  useFrame((state,delta)=>{
    if(!groupRef.current)return;
    if(!dragRef.current.isDragging&&!activePhotoId) targetRef.current+=0.25*delta;
    scrollRef.current=THREE.MathUtils.lerp(scrollRef.current,targetRef.current,8.5*delta);
    groupRef.current.position.y=THREE.MathUtils.lerp(
      groupRef.current.position.y,
      galleryY+Math.sin(state.clock.elapsedTime*1.35)*0.05,
      0.1
    );
  });

  const onWallDown=(e:any)=>{
    e.stopPropagation();
    if(mapRef.current){mapRef.current.dragPan.disable();mapRef.current.scrollZoom.disable();}
    dragRef.current={isDragging:true,startX:e.clientX,startScroll:targetRef.current,dragged:false};
    setActivePhotoId(null);
  };
  const onWallMove=(e:any)=>{
    if(!dragRef.current.isDragging)return;e.stopPropagation();
    const dx=e.clientX-dragRef.current.startX;
    if(Math.abs(dx)>5)dragRef.current.dragged=true;
    targetRef.current=dragRef.current.startScroll-dx*(isMobile?0.008:0.012);
  };
  const onWallUp=(e:any)=>{
    e.stopPropagation();
    if(mapRef.current){mapRef.current.dragPan.enable();mapRef.current.scrollZoom.enable();}
    dragRef.current.isDragging=false;
    targetRef.current=Math.round(targetRef.current);
  };

  useEffect(()=>{
    if(!selectedSessionId){ setActivePhotoId(null); return; }
    const hit = moments.find(m=>m.sessionId===selectedSessionId);
    if(hit) setActivePhotoId(hit.id);
  },[selectedSessionId, moments, setActivePhotoId]);

  if (moments.length < PHOTO_THRESHOLD) {
    return (
      <group position={[0, galleryY, 0]}>
        <CyberFunnel color={dominantColor} totalMinutes={totalMinutes} blockCount={blocks.length}/>
      </group>
    );
  }

  return (
    <group ref={groupRef} position={[0, galleryY, 0]}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.42,0]}><ringGeometry args={[ringRadius*0.82,ringRadius*1.08,48]}/><meshBasicMaterial color="#2DD4BF" transparent opacity={0.045} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.41,0]}><ringGeometry args={[ringRadius*1.02,ringRadius*1.14,64]}/><meshBasicMaterial color="#7ef9ff" transparent opacity={0.028} blending={THREE.AdditiveBlending} depthWrite={false}/></mesh>
      {moments.map((m,i)=>(
        <MemoryCard key={m.id} m={m} index={i} total={moments.length} ringRadius={ringRadius}
          scrollRef={scrollRef} dragRef={dragRef} isMobile={isMobile}
          isActive={activePhotoId===m.id}
          expandedMode={activePhotoId!==null}
          onMakeActive={()=>setActivePhotoId(m.id)}
          onCancelActive={()=>setActivePhotoId(null)}
          onSnapToCenter={snapToCenter}
          onSelectSession={onSelectSession}
        />
      ))}
      <mesh position={[0,0,0]} onPointerDown={onWallDown} onPointerMove={onWallMove} onPointerUp={onWallUp} onPointerOut={onWallUp} onPointerCancel={onWallUp}>
        <planeGeometry args={[10,4]}/>
        <meshBasicMaterial transparent opacity={0} depthWrite={false}/>
      </mesh>
    </group>
  );
}

/* =========================
   BuildingStack
========================= */

function BuildingStack({blocks,buildingBaseState,selectedSessionId,isSelectedBuilding,onPickBuilding,onPickFloor}:{
  blocks:PlaceAggregate['blocks'];buildingBaseState:'active'|'muted';selectedSessionId:string|null;
  isSelectedBuilding:boolean;onPickBuilding:()=>void;onPickFloor:(id:string)=>void;
}) {
  const floorsRef = useRef<(THREE.Group|null)[]>([]);
  const gapRef    = useRef(0);

  const {compressedBlocks,densityBoost} = useMemo(()=>{
    const rawTotalH = blocks.reduce((s,b)=>s+heightFromMinutes(b.minutes),0);
    const ratio = rawTotalH>MAX_BUILDING_H ? MAX_BUILDING_H/rawTotalH : 1;
    const density = Math.max(1,1/ratio);

    if(isSelectedBuilding){
      const byFriend = new Map<string,{friendId:string;color:string;rawH:number;primarySessionId:string;primaryStartedAt:string;}>();
      for(const b of blocks){
        const cur = byFriend.get(b.friendId);
        if(!cur){
          byFriend.set(b.friendId,{ friendId: b.friendId, color: b.color, rawH: heightFromMinutes(b.minutes), primarySessionId: b.sessionId, primaryStartedAt: b.startedAt });
          continue;
        }
        cur.rawH += heightFromMinutes(b.minutes);
        if(new Date(b.startedAt).getTime() > new Date(cur.primaryStartedAt).getTime()){
          cur.primarySessionId = b.sessionId; cur.primaryStartedAt = b.startedAt;
        }
      }
      const segments = Array.from(byFriend.values()).sort((a,b)=>b.rawH-a.rawH);
      let y=0;
      const mapped = segments.map(seg=>{
        const h = seg.rawH * ratio; const cy = y + h/2; y += h;
        return { sessionId: seg.primarySessionId, friendId: seg.friendId, color: seg.color, startedAt: seg.primaryStartedAt, renderH: h, currentY: cy };
      });
      return {compressedBlocks: mapped as any, densityBoost: density};
    }
    let y=0;
    const mapped=blocks.map(b=>{const h=heightFromMinutes(b.minutes)*ratio;const cy=y+h/2;y+=h;return{...b,renderH:h,currentY:cy};});
    return {compressedBlocks:mapped,densityBoost:density};
  },[blocks,isSelectedBuilding]);

  useFrame((_,delta)=>{
    const target=isSelectedBuilding?0.25:0.02;
    gapRef.current=THREE.MathUtils.lerp(gapRef.current,target,10*delta);
    for(let i=0;i<compressedBlocks.length;i++){
      if(floorsRef.current[i]) floorsRef.current[i]!.position.y=compressedBlocks[i].currentY+i*gapRef.current;
    }
  });

  return (
    <group onPointerDown={e=>{if(!isSelectedBuilding){e.stopPropagation();onPickBuilding();}}}>
      {compressedBlocks.map((b:any, i:number)=>{
        let vs:BlockVisualState='active';
        if(buildingBaseState==='muted') vs='muted';
        else if(selectedSessionId){
          if(isSelectedBuilding){
            const activeFriendId = blocks.find(x=>x.sessionId===selectedSessionId)?.friendId ?? null;
            vs = activeFriendId && b.friendId===activeFriendId ? 'active' : 'filtered-dimmed';
          } else {
            vs = b.sessionId===selectedSessionId?'active':'filtered-dimmed';
          }
        }
        return (
          <group key={b.sessionId} ref={r=>{floorsRef.current[i]=r;}}>
            <ArchitecturalBlock h={b.renderH} color={b.color} visualState={vs} densityBoost={densityBoost}
              onPick={()=>{if(!isSelectedBuilding)onPickBuilding();else onPickFloor(b.sessionId);}}
            />
          </group>
        );
      })}
    </group>
  );
}

function PulseRing({isActive,isHover,muted,onPick}:{isActive:boolean;isHover:boolean;muted:boolean;onPick:()=>void}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({clock})=>{
    if(!isActive)return;
    const t=clock.getElapsedTime();
    if(meshRef.current)meshRef.current.scale.setScalar(1+(Math.sin(t*4)+1)*0.15);
    if(matRef.current)matRef.current.opacity=(Math.sin(t*4)+1)*0.15+0.05;
  });
  if(muted)return null;
  return (
    <group position={[0,0.01,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={e=>{e.stopPropagation();onPick();}}>
      <mesh><ringGeometry args={[0.45,0.6,44]}/><meshBasicMaterial color="#fff" transparent opacity={isActive?0.4:isHover?0.28:0.18}/></mesh>
      {isActive&&<mesh ref={meshRef} position={[0,0,0.001]}><ringGeometry args={[0.6,0.75,44]}/><meshBasicMaterial ref={matRef} color="#2DD4BF" transparent opacity={0.3}/></mesh>}
    </group>
  );
}

/* =========================
   Trajectory
========================= */

function SingleTrajectoryLine({sequence,places,mapRef,mapReady,timeFilter,friendFilter}:{ sequence:{lng:number;lat:number;placeId:string;friendId:string}[]; places:PlaceAggregate[];mapRef:React.MutableRefObject<mapboxgl.Map|null>;mapReady:boolean; timeFilter:TimeFilter;friendFilter:string; }) {
  const lineRef = useRef<any>(null); const {camera,size} = useThree(); const startRef = useRef<number|null>(null);
  useEffect(()=>{startRef.current=null;},[sequence]);
  const vec=useMemo(()=>new THREE.Vector3(),[]); const w1=useMemo(()=>new THREE.Vector3(),[]); const w2=useMemo(()=>new THREE.Vector3(),[]); const mid=useMemo(()=>new THREE.Vector3(),[]); const tc=useMemo(()=>new THREE.Color(),[]); const ca=useMemo(()=>new THREE.Color(),[]); const cb=useMemo(()=>new THREE.Color(),[]);
  const getBH = useCallback((placeId:string)=>{
    const p=places.find(x=>x.placeId===placeId); if(!p)return 0;
    const vb=p.blocks.filter(b=>{ if(b.tags.includes('sim'))return false; const tm=timeFilter==='all'||(timeFilter==='year'&&isThisYearISO(b.startedAt))||(timeFilter==='month'&&isThisMonthISO(b.startedAt))||(timeFilter==='today'&&isTodayISO(b.startedAt)); return tm&&(friendFilter==='all'||b.friendId===friendFilter); });
    return Math.min(vb.reduce((s,b)=>s+heightFromMinutes(b.minutes),0),MAX_BUILDING_H);
  },[places,timeFilter,friendFilter]);
  useFrame(({clock})=>{
    if(!mapReady||!mapRef.current||sequence.length<2||!lineRef.current||size.width===0)return;
    if(startRef.current===null)startRef.current=clock.getElapsedTime();
    const lt=clock.getElapsedTime()-startRef.current; const map=mapRef.current; const zs=Math.pow(2,map.getZoom()-BASE_ZOOM); const pos:number[]=[]; const c:number[]=[]; let nan=false;
    const getW=(lng:number,lat:number,pid:string,t:THREE.Vector3)=>{ const pt=map.project([lng,lat]); vec.set((pt.x/size.width)*2-1,-(pt.y/size.height)*2+1,0.5); vec.unproject(camera);vec.sub(camera.position).normalize(); const d=-camera.position.y/vec.y; t.copy(camera.position).add(vec.multiplyScalar(d)); t.y+=(getBH(pid)+0.15)*zs; if(Number.isNaN(t.x)||Number.isNaN(t.y)||Number.isNaN(t.z))nan=true; };
    const segs=sequence.length-1,pps=32,ppc=pps+1,total=segs*ppc; const travel=segs*1.6,pause=1.8,cyc=travel+pause; const head=clamp((lt%cyc)/travel,0,1)*total; const TAIL=28,HB=5.0,TF=2.2;
    for(let i=0;i<segs;i++){
      const sA=sequence[i],sB=sequence[i+1]; getW(sA.lng,sA.lat,sA.placeId,w1);getW(sB.lng,sB.lat,sB.placeId,w2); ca.set(FRIEND_COLORS[sA.friendId]??'#fff');cb.set(FRIEND_COLORS[sB.friendId]??'#fff'); if(nan)return;
      const dist=w1.distanceTo(w2); mid.copy(w1).lerp(w2,0.5);mid.y+=Math.max(1.5*zs,dist*0.25); const curve=new THREE.QuadraticBezierCurve3(w1,mid,w2); const pts=curve.getPoints(pps);
      for(let j=0;j<pts.length;j++){
        const pi=i*ppc+j; pos.push(pts[j].x,pts[j].y,pts[j].z); const dh=head-pi; let intensity=0.08;
        if(dh>=0&&dh<=TAIL){const tt=1-dh/TAIL;intensity=Math.pow(tt,TF)*HB;if(dh<3)intensity+=(1-dh/3)*HB*0.6;}
        tc.copy(ca).lerp(cb,j/pps).multiplyScalar(intensity); c.push(tc.r,tc.g,tc.b);
      }
    }
    if(!nan&&pos.length>0){ lineRef.current.geometry.setPositions(pos); lineRef.current.geometry.setColors(c); if(lineRef.current.material){lineRef.current.material.vertexColors=true;lineRef.current.material.needsUpdate=true;} }
  });
  return <Line ref={lineRef} points={[[0,0,0],[0,1,0]]} vertexColors={[[1,1,1],[1,1,1]]} color="#fff" lineWidth={4.2} transparent opacity={0.85} depthTest={false}/>;
}

function TrajectoryManager({places,sessions,timeFilter,friendFilter,selectedPlaceId,mapRef,mapReady}:{ places:PlaceAggregate[];sessions:Session[];timeFilter:TimeFilter;friendFilter:string|'all'; selectedPlaceId:string|null;mapRef:React.MutableRefObject<mapboxgl.Map|null>;mapReady:boolean; }) {
  if(selectedPlaceId!==null||timeFilter==='all')return null;
  const valid=useMemo(()=>sessions.filter(s=>{ if(s.tags.includes('sim'))return false; const tm=timeFilter==='year'?isThisYearISO(s.startedAt):timeFilter==='month'?isThisMonthISO(s.startedAt):timeFilter==='today'?isTodayISO(s.startedAt):true; return tm&&(friendFilter==='all'||s.friendId===friendFilter); }),[sessions,timeFilter,friendFilter]);
  const seq=useMemo(()=>{ const sorted=[...valid].sort((a,b)=>new Date(a.startedAt).getTime()-new Date(b.startedAt).getTime()); const out:{lng:number;lat:number;placeId:string;friendId:string}[]=[]; let last=null; for(const s of sorted)if(s.placeId!==last){out.push({lng:s.lng,lat:s.lat,placeId:s.placeId,friendId:s.friendId});last=s.placeId;} return out; },[valid]);
  if(seq.length<2)return null;
  return <group><SingleTrajectoryLine key={`${timeFilter}-${friendFilter}`} sequence={seq} places={places} mapRef={mapRef} mapReady={mapReady} timeFilter={timeFilter} friendFilter={friendFilter}/></group>;
}

/* =========================
   Holographic Environment & Life Systems
========================= */

function HolographicEnvironment() {
  const groupRef = useRef<THREE.Group>(null);
  const cloudGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const birdGeo = useMemo(() => new THREE.BoxGeometry(0.2, 0.02, 0.05), []);
  useFrame((state, delta) => {
    if (!groupRef.current) return; const t = state.clock.elapsedTime; groupRef.current.position.y = Math.sin(t * 0.5) * 0.2;
    groupRef.current.children.forEach((child, i) => {
      if (child.userData.type === 'cloud') { child.position.x += child.userData.speed * delta; if (child.position.x > 20) child.position.x = -20; }
      else if (child.userData.type === 'bird') { child.position.x = child.userData.origin[0] + Math.sin(t * child.userData.speed) * 8; child.position.z = child.userData.origin[2] + Math.cos(t * child.userData.speed) * 4; child.rotation.y = -(t * child.userData.speed) + Math.PI; child.position.y = child.userData.origin[1] + Math.sin(t * 2 + i) * 0.2; }
    });
  });
  return (
    <group ref={groupRef} position={[0, 6, 0]}>
      {Array.from({ length: 4 }).map((_, i) => (<group key={`cloud-${i}`} position={[-15 + i * 8, 2 + Math.random() * 2, -5 + Math.random() * 10]} userData={{ type: 'cloud', speed: 0.2 + Math.random() * 0.3 }} scale={1 + Math.random()}><mesh geometry={cloudGeo} position={[0, 0, 0]}><meshBasicMaterial color="#2DD4BF" transparent opacity={0.03} blending={THREE.AdditiveBlending}/></mesh><mesh geometry={cloudGeo} position={[0.8, 0, 0]} scale={0.8}><meshBasicMaterial color="#2DD4BF" transparent opacity={0.03} blending={THREE.AdditiveBlending}/></mesh></group>))}
      {Array.from({ length: 5 }).map((_, i) => (<group key={`bird-${i}`} userData={{ type: 'bird', speed: 0.1 + Math.random() * 0.1, origin: [0, Math.random(), 0] }}><mesh geometry={birdGeo} position={[0.1, 0, 0]} rotation={[0, Math.PI / 6, 0]}><meshBasicMaterial color="#7ef9ff" transparent opacity={0.4} blending={THREE.AdditiveBlending} /></mesh><mesh geometry={birdGeo} position={[-0.1, 0, 0]} rotation={[0, -Math.PI / 6, 0]}><meshBasicMaterial color="#7ef9ff" transparent opacity={0.4} blending={THREE.AdditiveBlending} /></mesh></group>))}
    </group>
  );
}

// 2. 光軌交通系統 (車輛在 Places 之間穿梭 - 修正轉向並放大5倍)
function CyberTrafficSystem({ places, mapRef, mapReady }: { places: PlaceAggregate[], mapRef: React.MutableRefObject<mapboxgl.Map|null>, mapReady: boolean }) {
  const carCount = Math.min(places.length * 2, 30);
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const stateRef = useRef<Float32Array>(new Float32Array(0));
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const vec = useMemo(() => new THREE.Vector3(), []);
  const curPos = useMemo(() => new THREE.Vector3(), []);
  const nextPos = useMemo(() => new THREE.Vector3(), []);
  const targetPos = useMemo(() => new THREE.Vector3(), []); // 優化: 避免使用 clone
  const { camera, size } = useThree();

  useEffect(() => {
    if (places.length < 2) return;
    stateRef.current = new Float32Array(carCount * 7); 
    
    for (let i = 0; i < carCount; i++) {
      const p1 = places[Math.floor(Math.random() * places.length)];
      const p2 = places[Math.floor(Math.random() * places.length)];
      const idx = i * 7;
      stateRef.current[idx] = p1.lng; stateRef.current[idx+1] = p1.lat;
      stateRef.current[idx+2] = p2.lng; stateRef.current[idx+3] = p2.lat;
      stateRef.current[idx+4] = Math.random(); 
      // ⚠️ 速度降為 0.25 倍 (0.001~0.003 -> 0.00025~0.0005)
      stateRef.current[idx+5] = 0.00025 + Math.random() * 0.0005; 
    }
  }, [places, carCount]);

  const headGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.18, 8, 8);
    g.translate(0, 0.85, 0); 
    return g;
  }, []);
  const bodyGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.12, 0.18, 0.6, 6);
    g.translate(0, 0.3, 0); 
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#2DD4BF', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }), []);

  useFrame((state) => {
    if (!mapReady || !mapRef.current || size.width === 0 || !headMeshRef.current || !bodyMeshRef.current || stateRef.current.length === 0) return;
    const map = mapRef.current;
    const zs = Math.pow(2, map.getZoom() - BASE_ZOOM);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < carCount; i++) {
      const idx = i * 7;
      let progress = stateRef.current[idx+4] + stateRef.current[idx+5];
      
      if (progress >= 1) {
        progress = 0;
        stateRef.current[idx] = stateRef.current[idx+2];
        stateRef.current[idx+1] = stateRef.current[idx+3];
        const nextP = places[Math.floor(Math.random() * places.length)];
        stateRef.current[idx+2] = nextP.lng;
        stateRef.current[idx+3] = nextP.lat;
      }
      stateRef.current[idx+4] = progress;

      const cLng = THREE.MathUtils.lerp(stateRef.current[idx], stateRef.current[idx+2], progress);
      const cLat = THREE.MathUtils.lerp(stateRef.current[idx+1], stateRef.current[idx+3], progress);
      const nextProgress = progress + 0.001; 
      const nLng = THREE.MathUtils.lerp(stateRef.current[idx], stateRef.current[idx+2], Math.min(nextProgress, 1));
      const nLat = THREE.MathUtils.lerp(stateRef.current[idx+1], stateRef.current[idx+3], Math.min(nextProgress, 1));

      const pt = map.project([cLng, cLat]);
      vec.set((pt.x / size.width) * 2 - 1, -(pt.y / size.height) * 2 + 1, 0.5);
      vec.unproject(camera).sub(camera.position).normalize();
      curPos.copy(camera.position).add(vec.multiplyScalar(-camera.position.y / vec.y));

      const ptNext = map.project([nLng, nLat]);
      vec.set((ptNext.x / size.width) * 2 - 1, -(ptNext.y / size.height) * 2 + 1, 0.5);
      vec.unproject(camera).sub(camera.position).normalize();
      nextPos.copy(camera.position).add(vec.multiplyScalar(-camera.position.y / vec.y));

      dummy.position.copy(curPos);
      
      // ⚠️ 修正: 強制面向水平目標，確保絕對直立
      targetPos.copy(dummy.position);
      targetPos.x += nextPos.x - curPos.x;
      targetPos.z += nextPos.z - curPos.z;
      if (curPos.distanceToSquared(nextPos) > 1e-10) {
        dummy.lookAt(targetPos);
      }

      // 稍微提高並加上走路彈跳
      const bounce = Math.abs(Math.sin(t * 15 + i)); 
      dummy.position.y += 0.05 * zs + bounce * 0.05 * zs; 

      // ⚠️ 修正: 放大 5 倍 (0.08 -> 0.4)
      dummy.scale.set(0.4 * zs, 0.4 * zs, 0.4 * zs);
      
      dummy.updateMatrix();
      headMeshRef.current.setMatrixAt(i, dummy.matrix);
      bodyMeshRef.current.setMatrixAt(i, dummy.matrix);
    }
    headMeshRef.current.instanceMatrix.needsUpdate = true;
    bodyMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (places.length < 2) return null;
  return (
    <group>
      <instancedMesh ref={headMeshRef} args={[headGeo, mat, carCount]} depthWrite={false} />
      <instancedMesh ref={bodyMeshRef} args={[bodyGeo, mat, carCount]} depthWrite={false} />
    </group>
  );
}

// 3. 全息行人系統 (在 Places 附近徘徊 - 同步修正並放大)
function PopulationSystem({ places, mapRef, mapReady }: { places: PlaceAggregate[], mapRef: React.MutableRefObject<mapboxgl.Map|null>, mapReady: boolean }) {
  const agentCount = Math.min(places.length * 5, 100);
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const stateRef = useRef<Float32Array>(new Float32Array(0));
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const vec = useMemo(() => new THREE.Vector3(), []);
  const curPos = useMemo(() => new THREE.Vector3(), []);
  const nextPos = useMemo(() => new THREE.Vector3(), []);
  const targetPos = useMemo(() => new THREE.Vector3(), []); // 優化
  const { camera, size } = useThree();

  useEffect(() => {
    if (places.length === 0) return;
    stateRef.current = new Float32Array(agentCount * 5); 
    for (let i = 0; i < agentCount; i++) {
      const p = places[Math.floor(Math.random() * places.length)];
      const idx = i * 5;
      stateRef.current[idx] = p.lng;
      stateRef.current[idx+1] = p.lat;
      stateRef.current[idx+2] = (Math.random() - 0.5) * 0.002; 
      stateRef.current[idx+3] = (Math.random() - 0.5) * 0.002;
      // ⚠️ 速度降為 0.25 倍
      stateRef.current[idx+4] = 0.04 + Math.random() * 0.08;
    }
  }, [places, agentCount]);

  const headGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.18, 8, 8);
    g.translate(0, 0.85, 0); 
    return g;
  }, []);
  const bodyGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.12, 0.18, 0.6, 6);
    g.translate(0, 0.3, 0); 
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7ef9ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }), []);

  useFrame((state) => {
    if (!mapReady || !mapRef.current || size.width === 0 || !headMeshRef.current || !bodyMeshRef.current || stateRef.current.length === 0) return;
    const map = mapRef.current;
    const zs = Math.pow(2, map.getZoom() - BASE_ZOOM);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < agentCount; i++) {
      const idx = i * 5;
      const baseLng = stateRef.current[idx];
      const baseLat = stateRef.current[idx+1];
      const speed = stateRef.current[idx+4]; 
      
      const curLng = baseLng + stateRef.current[idx+2] * Math.sin(t * speed);
      const curLat = baseLat + stateRef.current[idx+3] * Math.cos(t * speed);
      
      const nextLng = baseLng + stateRef.current[idx+2] * Math.sin((t + 0.05) * speed);
      const nextLat = baseLat + stateRef.current[idx+3] * Math.cos((t + 0.05) * speed);

      const pt = map.project([curLng, curLat]);
      vec.set((pt.x / size.width) * 2 - 1, -(pt.y / size.height) * 2 + 1, 0.5);
      vec.unproject(camera).sub(camera.position).normalize();
      curPos.copy(camera.position).add(vec.multiplyScalar(-camera.position.y / vec.y));

      const ptNext = map.project([nextLng, nextLat]);
      vec.set((ptNext.x / size.width) * 2 - 1, -(ptNext.y / size.height) * 2 + 1, 0.5);
      vec.unproject(camera).sub(camera.position).normalize();
      nextPos.copy(camera.position).add(vec.multiplyScalar(-camera.position.y / vec.y));

      dummy.position.copy(curPos);
      
      // ⚠️ 修正: 強制面向水平目標
      targetPos.copy(dummy.position);
      targetPos.x += nextPos.x - curPos.x;
      targetPos.z += nextPos.z - curPos.z;
      if (curPos.distanceToSquared(nextPos) > 1e-10) {
        dummy.lookAt(targetPos);
      }

      const bounce = Math.abs(Math.sin(t * speed * 2)); 
      dummy.position.y += bounce * 0.05 * zs; 
      
      dummy.rotateX(Math.sin(t * speed * 1) * 0.1); 

      // ⚠️ 修正: 放大 5 倍
      dummy.scale.set(0.4 * zs, 0.4 * zs, 0.4 * zs);
      
      dummy.updateMatrix();
      headMeshRef.current.setMatrixAt(i, dummy.matrix);
      bodyMeshRef.current.setMatrixAt(i, dummy.matrix);
    }
    headMeshRef.current.instanceMatrix.needsUpdate = true;
    bodyMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (places.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={headMeshRef} args={[headGeo, mat, agentCount]} depthWrite={false} />
      <instancedMesh ref={bodyMeshRef} args={[bodyGeo, mat, agentCount]} depthWrite={false} />
    </group>
  );
}

/* =========================
   Place summary
========================= */

function getPlaceSummary(place:PlaceAggregate) {
  const totalMinutes=place.blocks.reduce((s,b)=>s+b.minutes,0);
  const totalOops=place.blocks.reduce((s,b)=>s+b.oops,0);
  const byF=new Map<string,{minutes:number;oops:number}>();
  for(const b of place.blocks){const c=byF.get(b.friendId)??{minutes:0,oops:0};c.minutes+=b.minutes;c.oops+=b.oops;byF.set(b.friendId,c);}
  const topFriends=Array.from(byF.entries()).map(([friendId,v])=>({friendId,name:FRIEND_NAMES[friendId]??friendId,minutes:v.minutes,oops:v.oops,color:FRIEND_COLORS[friendId]??'#888'})).sort((a,b)=>b.minutes-a.minutes);
  return {totalMinutes,totalOops,topFriends};
}

/* =========================
   MapSyncedPlaces
========================= */

function MapSyncedPlaces({places,mapRef,mapReady,selectedPlaceId,selectedSessionId,hoverPlaceId,timeFilter,friendFilter,
  setSelectedPlaceId,setSelectedSessionId,setHoverPlaceId,router,isMobile,onFocusPlace,onFocusPhoto,setMapInteractivity,activePhotoId,setActivePhotoId}:{
  places:PlaceAggregate[];mapRef:React.MutableRefObject<mapboxgl.Map|null>;mapReady:boolean;
  selectedPlaceId:string|null;selectedSessionId:string|null;hoverPlaceId:string|null;
  timeFilter:TimeFilter;friendFilter:string|'all';
  setSelectedPlaceId:React.Dispatch<React.SetStateAction<string|null>>;
  setSelectedSessionId:React.Dispatch<React.SetStateAction<string|null>>;
  setHoverPlaceId:React.Dispatch<React.SetStateAction<string|null>>;
  router:ReturnType<typeof useRouter>;isMobile:boolean;
  onFocusPlace:(place:PlaceAggregate,isExpand?:boolean)=>void;
  onFocusPhoto:(place:PlaceAggregate)=>void;
  setMapInteractivity:(enable:boolean)=>void;
  activePhotoId:string|null;
  setActivePhotoId:React.Dispatch<React.SetStateAction<string|null>>;
}) {
  const outerRefs = useRef<Record<string,THREE.Group|null>>({}); const innerRefs = useRef<Record<string,THREE.Group|null>>({});
  const {camera,size} = useThree(); const vec=useMemo(()=>new THREE.Vector3(),[]); const pos=useMemo(()=>new THREE.Vector3(),[]);

  useFrame(()=>{
    if(!mapReady||size.width===0)return; const map=mapRef.current;if(!map)return;
    const zs=Math.pow(2,map.getZoom()-BASE_ZOOM);
    for(const p of places){
      const out=outerRefs.current[p.placeId],inn=innerRefs.current[p.placeId]; if(!out||!inn)continue;
      const pt=map.project([p.lng,p.lat]); vec.set((pt.x/size.width)*2-1,-(pt.y/size.height)*2+1,0.5);
      vec.unproject(camera);vec.sub(camera.position).normalize(); const d=-camera.position.y/vec.y;
      pos.copy(camera.position).add(vec.multiplyScalar(d)); if(!Number.isNaN(pos.x)){out.position.copy(pos);inn.scale.setScalar(zs);}
    }
  });

  return (
    <group>
      {places.map(p=>{
        const visibleBlocks=p.blocks.filter(b=>{
          if(b.tags.includes('sim'))return friendFilter==='all'||b.friendId===friendFilter;
          const tm=timeFilter==='all'||(timeFilter==='year'&&isThisYearISO(b.startedAt))||(timeFilter==='month'&&isThisMonthISO(b.startedAt))||(timeFilter==='today'&&isTodayISO(b.startedAt));
          return tm&&(friendFilter==='all'||b.friendId===friendFilter);
        });
        if(visibleBlocks.length===0)return null;

        const isSel=selectedPlaceId===p.placeId; const isOther=selectedPlaceId!==null&&!isSel;
        const baseState:('active'|'muted')=isOther?'muted':'active'; const isHover=hoverPlaceId===p.placeId;
        const scH=baseState==='active'&&isHover?1.15:1.0; const yOff=(baseState==='muted'?-0.03:0)+(baseState==='active'&&isHover?0.035:0);
        const stackTopY = computeStackVisualTopY(visibleBlocks, isSel); const anchorY = Math.max(0.9, stackTopY * 0.55);
        const summary=isSel?getPlaceSummary({...p,blocks:visibleBlocks}):null; const selBlock=isSel&&selectedSessionId?visibleBlocks.find(b=>b.sessionId===selectedSessionId)??null:null;

        return (
          <group key={p.placeId} ref={r=>{outerRefs.current[p.placeId]=r;}} position={[0,yOff,0]} scale={[scH,scH,scH]}
            onPointerOver={e=>{e.stopPropagation();setHoverPlaceId(p.placeId);document.body.style.cursor='pointer';setMapInteractivity(false);}}
            onPointerOut={e=>{e.stopPropagation();setHoverPlaceId(c=>c===p.placeId?null:c);document.body.style.cursor='';setMapInteractivity(true);}}
            onPointerDown={e=>{e.stopPropagation();if(!isSel){setSelectedPlaceId(p.placeId);setSelectedSessionId(null);setActivePhotoId(null);onFocusPlace(p,true);}}}
          >
            <group ref={r=>{innerRefs.current[p.placeId]=r;}}>
              <PulseRing isActive={isSel} isHover={isHover} muted={baseState==='muted'} onPick={()=>{setSelectedPlaceId(p.placeId);setSelectedSessionId(null);setActivePhotoId(null);onFocusPlace(p,true);}}/>

              <BuildingStack blocks={visibleBlocks} buildingBaseState={baseState} selectedSessionId={selectedSessionId} isSelectedBuilding={isSel}
                onPickBuilding={()=>{setSelectedPlaceId(p.placeId);setSelectedSessionId(null);setActivePhotoId(null);onFocusPlace(p,true);}}
                onPickFloor={sid=>{setSelectedPlaceId(p.placeId);setSelectedSessionId(sid);setActivePhotoId(null);onFocusPlace(p,true);}}
              />

              {isSel&&(
                <MemoriesAboveBuilding
                  blocks={p.blocks} placeId={p.placeId} stackTopY={stackTopY} selectedSessionId={selectedSessionId} isMobile={isMobile} mapRef={mapRef}
                  activePhotoId={activePhotoId} setActivePhotoId={setActivePhotoId}
                  onSelectSession={(sid, fromPhoto)=>{
                    setSelectedPlaceId(p.placeId);
                    setSelectedSessionId(sid);
                    if(fromPhoto) onFocusPhoto(p);
                    else onFocusPlace(p, true);
                  }}
                />
              )}
            </group>

            {!isMobile&&isSel&&summary&&!activePhotoId&&(
              <group position={[0,anchorY,0]}>
                <Html center transform={false} occlude={false} distanceFactor={14}
                  style={{pointerEvents:'auto',transform:'translate(180px,-40px) scale(0.78)',transformOrigin:'top left',maxWidth:'86vw',background:'rgba(32,38,48,0.92)',backdropFilter:'blur(12px)',borderRadius:16,border:'1px solid rgba(255,255,255,0.15)',boxShadow:'0 12px 32px rgba(0,0,0,0.5)'}}
                  onPointerEnter={()=>{document.body.style.cursor='default';setMapInteractivity(false);}}
                  onPointerLeave={()=>{document.body.style.cursor='';setMapInteractivity(true);}}
                >
                  {selBlock?(
                    <SessionCard placeId={p.placeId} session={selBlock}
                      onBack={()=>{setSelectedSessionId(null);onFocusPlace(p,true);}}
                      onOpenFull={()=>router.push(`/session/${selBlock.sessionId}`)}
                      onClose={()=>{setSelectedPlaceId(null);setSelectedSessionId(null);onFocusPlace(p,false);}}
                    />
                  ):(
                    <PlaceCard placeId={p.placeId} summary={summary} timeFilter={timeFilter} friendFilter={friendFilter}
                      onPickFriend={()=>{}}
                      onClose={()=>{setSelectedPlaceId(null);setSelectedSessionId(null);onFocusPlace(p,false);}}
                    />
                  )}
                </Html>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* =========================
   Page
========================= */

export default function ThreePage() {
  const router = useRouter();
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const places = useMemo<PlaceAggregate[]>(()=>aggregateSessions(ALL_SESSIONS),[]);
  const [selectedPlaceId,setSelectedPlaceId]     = useState<string|null>(null);
  const [selectedSessionId,setSelectedSessionId] = useState<string|null>(null);
  const [hoverPlaceId,setHoverPlaceId]           = useState<string|null>(null);
  const [timeFilter,setTimeFilter]               = useState<TimeFilter>('month');
  const [friendFilter,setFriendFilter]           = useState<string|'all'>('all');
  const [isFilterOpen,setIsFilterOpen]           = useState(false);
  const [activePhotoId, setActivePhotoId]        = useState<string|null>(null); 

  const mapContainerRef = useRef<HTMLDivElement|null>(null);
  const mapRef          = useRef<mapboxgl.Map|null>(null);
  const [mapReady,setMapReady] = useState(false);

  const [isMobile,setIsMobile] = useState(false);
  useEffect(()=>{
    const m=window.matchMedia('(max-width:520px)');
    const fn=()=>setIsMobile(m.matches);fn();
    m.addEventListener?.('change',fn);return()=>m.removeEventListener?.('change',fn);
  },[]);

  useEffect(()=>{
    if(!mapContainerRef.current||mapRef.current||!MAPBOX_TOKEN)return;
    mapboxgl.accessToken=MAPBOX_TOKEN;
    const map=new mapboxgl.Map({container:mapContainerRef.current,style:'mapbox://styles/mapbox/dark-v11',center:[121.538,25.022],zoom:BASE_ZOOM,bearing:15,pitch:60,antialias:true});
    mapRef.current=map;
    map.on('load',()=>{
      setMapReady(true);
      map.setFog({color:'#0b1020','high-color':'#0f1724','horizon-blend':0.15,'space-color':'#000000','star-intensity':0.15});
    });
    return()=>{map.remove();mapRef.current=null;};
  },[MAPBOX_TOKEN]);

  const setMapInteractivity=useCallback((enable:boolean)=>{
    const map=mapRef.current;if(!map)return;
    if(enable){map.dragPan.enable();map.scrollZoom.enable();map.doubleClickZoom.enable();map.touchZoomRotate.enable();}
    else{map.dragPan.disable();map.scrollZoom.disable();map.doubleClickZoom.disable();map.touchZoomRotate.disable();}
  },[]);

  const focusPlace=useCallback((place:PlaceAggregate,isExpand=false)=>{
    const map=mapRef.current;if(!map)return;
    const curZ=map.getZoom();
    map.flyTo({center:[place.lng,place.lat],offset:(isExpand?(isMobile?[0,150]:[0,120]):(isMobile?[0,150]:[0,60])) as [number,number],zoom:isExpand?16.2:Math.max(curZ,15.5),pitch:isExpand?65:60,duration:1200,essential:true});
  },[isMobile]);

  const focusPhoto=useCallback((place:PlaceAggregate)=>{
    const map=mapRef.current;if(!map)return;
    const curZ=map.getZoom();
    map.flyTo({
      center:[place.lng,place.lat],
      offset:[0, isMobile ? 240 : 160] as [number,number],
      zoom: Math.max(curZ, 15.8),
      pitch: 55, 
      duration: 1000,
      essential: true
    });
  },[isMobile]);

  /* Mobile sheet */
  const [sheetH,setSheetH]   = useState(0);
  const snap   = useRef({min:0,mid:0,max:0});
  const sdRef  = useRef({dragging:false,startY:0,startH:0});
  const [sheet,setSheet]     = useState<{placeId:string|null;sessionId:string|null;isOpen:boolean}>({placeId:null,sessionId:null,isOpen:false});
  const sheetCurRef = useRef(sheet); sheetCurRef.current=sheet;
  const toRef  = useRef<NodeJS.Timeout|null>(null);

  useEffect(()=>{
    if(toRef.current)clearTimeout(toRef.current);
    const cur=sheetCurRef.current;
    if(selectedPlaceId){
      if(cur.isOpen&&(cur.placeId!==selectedPlaceId||cur.sessionId!==selectedSessionId)){
        setSheet(p=>({...p,isOpen:false}));
        toRef.current=setTimeout(()=>setSheet({placeId:selectedPlaceId,sessionId:selectedSessionId,isOpen:true}),240);
      } else setSheet({placeId:selectedPlaceId,sessionId:selectedSessionId,isOpen:true});
    } else {
      setSheet(p=>({...p,isOpen:false}));
      toRef.current=setTimeout(()=>setSheet({placeId:null,sessionId:null,isOpen:false}),300);
    }
  },[selectedPlaceId,selectedSessionId]);

  const dispPlace   = sheet.placeId?places.find(p=>p.placeId===sheet.placeId)??null:null;
  const dispBlock   = dispPlace&&sheet.sessionId?dispPlace.blocks.find(b=>b.sessionId===sheet.sessionId)??null:null;
  const dispSummary = dispPlace?getPlaceSummary(dispPlace):null;
  
  const sheetOpen   = sheet.isOpen && !activePhotoId;

  useEffect(()=>{
    if(!isMobile)return;
    const calc=()=>{const vh=window.innerHeight;snap.current={min:Math.round(vh*.28),mid:Math.round(vh*.45),max:Math.round(vh*.72)};setSheetH(h=>h<=0?snap.current.mid:clamp(h,snap.current.min,snap.current.max));};
    calc();window.addEventListener('resize',calc);return()=>window.removeEventListener('resize',calc);
  },[isMobile]);
  useEffect(()=>{if(!isMobile||!sheet.isOpen)return;setSheetH(snap.current.mid);},[isMobile,sheet.isOpen]);

  const snapNearest=useCallback((h:number)=>{
    const {min,mid,max}=snap.current;
    let best=min,bd=Math.abs(h-min);
    for(const c of[mid,max]){const d=Math.abs(h-c);if(d<bd){best=c;bd=d;}}
    setSheetH(best);
  },[]);

  const timeLabel={'all':'All Time','year':'This Year','month':'This Month','today':'Today'}[timeFilter];
  const friendLabel=friendFilter==='all'?'All Friends':FRIEND_NAMES[friendFilter];

  return (
    <div style={{width:'100vw',height:'100vh',position:'relative',overflow:'hidden'}}>
      <div ref={mapContainerRef as any} style={{position:'absolute',inset:0}}/>

      {/* Filter */}
      <div style={{position:'absolute',top:16,right:16,zIndex:40,fontFamily:'system-ui,sans-serif'}}>
        <button onClick={()=>setIsFilterOpen(!isFilterOpen)}
          onPointerEnter={()=>setMapInteractivity(false)} onPointerLeave={()=>setMapInteractivity(true)}
          style={{display:'flex',alignItems:'center',gap:8,background:'rgba(16,20,28,0.85)',backdropFilter:'blur(16px)',border:'1px solid rgba(255,255,255,0.15)',padding:'10px 18px',borderRadius:999,color:'white',fontWeight:600,fontSize:14,boxShadow:'0 8px 32px rgba(0,0,0,0.4)',cursor:'pointer'}}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          {`${timeLabel}  ${friendLabel}`}
          {friendFilter!=='all'&&<div style={{width:8,height:8,borderRadius:'50%',background:FRIEND_COLORS[friendFilter],boxShadow:`0 0 8px ${FRIEND_COLORS[friendFilter]}`}}/>}
        </button>

        {isFilterOpen&&(
          <>
            <div style={{position:'fixed',inset:0,zIndex:-1}} onClick={()=>setIsFilterOpen(false)}/>
            <div onPointerEnter={()=>setMapInteractivity(false)} onPointerLeave={()=>setMapInteractivity(true)}
              style={{position:'absolute',top:'100%',right:0,marginTop:8,width:200,background:'rgba(20,24,34,0.95)',backdropFilter:'blur(24px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:16,padding:8,boxShadow:'0 12px 48px rgba(0,0,0,0.6)',display:'flex',flexDirection:'column',gap:4}}
            >
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',padding:'6px 12px',textTransform:'uppercase',letterSpacing:1,fontWeight:700}}>Time</div>
              {[{id:'all',label:'All Time'},{id:'year',label:'This Year'},{id:'month',label:'This Month'},{id:'today',label:'Today'}].map(item=>(
                <button key={item.id} onClick={()=>{setTimeFilter(item.id as any);setSelectedPlaceId(null);setSelectedSessionId(null);setIsFilterOpen(false);}} style={menuBtnStyle(timeFilter===item.id)}>{item.label}</button>
              ))}
              <div style={{height:1,background:'rgba(255,255,255,0.08)',margin:'6px 0'}}/>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',padding:'6px 12px',textTransform:'uppercase',letterSpacing:1,fontWeight:700}}>Friends</div>
              <button onClick={()=>{setFriendFilter('all');setSelectedPlaceId(null);setSelectedSessionId(null);setIsFilterOpen(false);}} style={menuBtnStyle(friendFilter==='all')}>All Friends</button>
              {Object.keys(FRIEND_NAMES).map(fid=>(
                <button key={fid} onClick={()=>{setFriendFilter(fid);setSelectedPlaceId(null);setSelectedSessionId(null);setIsFilterOpen(false);}} style={menuBtnStyle(friendFilter===fid)}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:FRIEND_COLORS[fid],opacity:friendFilter===fid?1:0.6}}/>
                    {FRIEND_NAMES[fid]}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{position:'absolute',inset:0,zIndex:10,pointerEvents:'none'}}>
        <Canvas eventSource={mapContainerRef as unknown as React.RefObject<HTMLElement>} style={{pointerEvents:'none'}} shadows={false} camera={{position:[9,7,9],fov:40}}
          gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.35}}
          onPointerMissed={()=>{
            if(selectedPlaceId){const pl=places.find(p=>p.placeId===selectedPlaceId);if(pl)focusPlace(pl,false);}
            setSelectedPlaceId(null);setSelectedSessionId(null);setHoverPlaceId(null);
            setActivePhotoId(null); 
            document.body.style.cursor='';setMapInteractivity(true);
          }}
        >
          <ambientLight intensity={0.35}/>
          <directionalLight position={[6,10,4]} intensity={1.6}/>
          <directionalLight position={[-6,4,8]} intensity={0.55}/>
          <directionalLight position={[0,6,-10]} intensity={0.75}/>
          <Environment preset="night"/>

          <TrajectoryManager places={places} sessions={ALL_SESSIONS} timeFilter={timeFilter} friendFilter={friendFilter} selectedPlaceId={selectedPlaceId} mapRef={mapRef} mapReady={mapReady}/>

          <HolographicEnvironment />
          <CyberTrafficSystem places={places} mapRef={mapRef} mapReady={mapReady} />
          <PopulationSystem places={places} mapRef={mapRef} mapReady={mapReady} />

          <MapSyncedPlaces places={places} mapRef={mapRef} mapReady={mapReady}
            selectedPlaceId={selectedPlaceId} selectedSessionId={selectedSessionId} hoverPlaceId={hoverPlaceId}
            timeFilter={timeFilter} friendFilter={friendFilter}
            setSelectedPlaceId={setSelectedPlaceId} setSelectedSessionId={setSelectedSessionId} setHoverPlaceId={setHoverPlaceId}
            router={router} isMobile={isMobile} onFocusPlace={focusPlace} onFocusPhoto={focusPhoto} setMapInteractivity={setMapInteractivity}
            activePhotoId={activePhotoId} setActivePhotoId={setActivePhotoId}
          />

          <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.01,0]}>
            <planeGeometry args={[2000,2000]}/><meshBasicMaterial transparent opacity={0}/>
          </mesh>
        </Canvas>
      </div>

      {isMobile&&(
        <div style={{position:'absolute',left:12,right:12,bottom:`calc(12px + env(safe-area-inset-bottom))`,zIndex:30,pointerEvents:sheetOpen?'auto':'none'}}
          onPointerDown={e=>e.stopPropagation()}
        >
          <div style={{width:'100%',height:sheetH>0?sheetH:'auto',maxHeight:'78vh',overflow:'hidden',borderRadius:16,background:'rgba(32,38,48,0.95)',border:'1px solid rgba(255,255,255,0.15)',backdropFilter:'blur(12px)',boxShadow:'0 8px 32px rgba(0,0,0,0.6)',display:'flex',flexDirection:'column',touchAction:'none',transform:sheetOpen?'translateY(0)':'translateY(120%)',opacity:sheetOpen?1:0,transition:sdRef.current.dragging?'none':'transform 0.4s cubic-bezier(0.32,0.72,0,1), opacity 0.3s ease, height 0.3s cubic-bezier(0.2,0.8,0.2,1)'}}>
            <div style={{padding:'10px 0 6px',display:'grid',placeItems:'center',cursor:'grab'}}
              onPointerDown={e=>{e.preventDefault();e.stopPropagation();(e.currentTarget as any).setPointerCapture(e.pointerId);sdRef.current={dragging:true,startY:e.clientY,startH:sheetH||snap.current.mid};}}
              onPointerMove={e=>{if(!sdRef.current.dragging)return;e.preventDefault();setSheetH(clamp(sdRef.current.startH-(e.clientY-sdRef.current.startY),snap.current.min,snap.current.max));}}
              onPointerUp={e=>{if(!sdRef.current.dragging)return;sdRef.current.dragging=false;(e.currentTarget as any).releasePointerCapture(e.pointerId);snapNearest(sheetH||snap.current.mid);}}
            >
              <div style={{width:44,height:5,borderRadius:999,background:'rgba(255,255,255,0.25)'}}/>
            </div>
            <div style={{overflow:'auto',paddingBottom:10}}>
              {dispPlace&&dispSummary&&(dispBlock?(
                <SessionCard placeId={dispPlace.placeId} session={dispBlock}
                  onBack={()=>{setSelectedSessionId(null);if(dispPlace)focusPlace(dispPlace,true);}}
                  onOpenFull={()=>router.push(`/session/${dispBlock.sessionId}`)}
                  onClose={()=>{setSelectedPlaceId(null);setSelectedSessionId(null);}}
                />
              ):(
                <PlaceCard placeId={dispPlace.placeId} summary={dispSummary} timeFilter={timeFilter} friendFilter={friendFilter}
                  onPickFriend={fid=>setFriendFilter(fid)}
                  onClose={()=>{setSelectedPlaceId(null);setSelectedSessionId(null);}}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   UI helpers
========================= */

function menuBtnStyle(a:boolean):React.CSSProperties{return{width:'100%',textAlign:'left',padding:'10px 14px',borderRadius:10,background:a?'rgba(255,255,255,0.12)':'transparent',border:'none',color:a?'white':'rgba(255,255,255,0.7)',fontSize:14,cursor:'pointer',fontWeight:a?600:400,transition:'all 0.15s ease'};}

function CardShell({children}:{children:React.ReactNode}){return(<div style={{width:'100%',background:'transparent',borderRadius:14,padding:12,color:'white',fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',userSelect:'none'}} onPointerDown={e=>e.stopPropagation()}>{children}</div>);}

function PlaceCard({placeId,summary,timeFilter,friendFilter,onPickFriend,onClose}:{placeId:string;summary:ReturnType<typeof getPlaceSummary>;timeFilter:TimeFilter;friendFilter:string;onPickFriend:(fid:string)=>void;onClose:()=>void;}){
  return(<CardShell>
    <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
      <div><div style={{fontSize:13,opacity:0.8}}>Place</div><div style={{fontSize:18,fontWeight:700}}>{placeId}</div></div>
      <button onClick={onClose} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.12)',color:'white',borderRadius:10,padding:'6px 10px',cursor:'pointer'}}>Close</button>
    </div>
    <div style={{display:'flex',gap:10,marginTop:12}}>
      <div style={{flex:1,borderRadius:12,padding:10,background:'rgba(255,255,255,0.06)'}}><div style={{fontSize:12,opacity:0.75}}>Total Focused</div><div style={{fontSize:20,fontWeight:700}}>{Math.round(summary.totalMinutes)}m</div></div>
      <div style={{flex:1,borderRadius:12,padding:10,background:'rgba(255,255,255,0.06)'}}><div style={{fontSize:12,opacity:0.75}}>Oops</div><div style={{fontSize:20,fontWeight:700}}>{summary.totalOops}</div></div>
    </div>
    <div style={{marginTop:12,fontSize:13,opacity:0.85}}>Top friends</div>
    <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:8}}>
      {summary.topFriends.slice(0,4).map(f=>{const a=friendFilter===f.friendId;return(
        <button key={f.friendId} onClick={()=>onPickFriend(f.friendId)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'10px',borderRadius:12,background:a?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)',border:a?'1px solid rgba(255,255,255,0.22)':'1px solid rgba(255,255,255,0.06)',cursor:'pointer',color:'white',textAlign:'left'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:10,height:10,borderRadius:3,background:f.color}}/><div style={{fontWeight:650}}>{f.name}</div></div>
          <div style={{display:'flex',gap:12,opacity:0.9}}><div>{Math.round(f.minutes)}m</div><div style={{opacity:0.8}}>oops {f.oops}</div></div>
        </button>
      );})}
    </div>
    <div style={{marginTop:10,fontSize:12,opacity:0.65}}>Tip: click again on the building to pick a floor.</div>
  </CardShell>);
}

function SessionCard({placeId,session,onBack,onOpenFull,onClose}:{placeId:string;session:PlaceAggregate['blocks'][number];onBack:()=>void;onOpenFull:()=>void;onClose:()=>void;}){
  const name=FRIEND_NAMES[session.friendId]??session.friendId;
  const color=FRIEND_COLORS[session.friendId]??'#888';
  return(<CardShell>
    <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
      <div><div style={{fontSize:13,opacity:0.8}}>Session log</div><div style={{fontSize:18,fontWeight:800}}>{placeId}</div></div>
      <button onClick={onClose} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.12)',color:'white',borderRadius:10,padding:'6px 10px',cursor:'pointer'}}>Close</button>
    </div>
    <div style={{marginTop:10,display:'flex',alignItems:'center',gap:10}}>
      <div style={{width:12,height:12,borderRadius:4,background:color}}/><div style={{fontWeight:800,fontSize:16}}>{name}</div>
      <div style={{marginLeft:'auto',fontSize:12,opacity:0.9,padding:'6px 10px',borderRadius:999,border:'1px solid rgba(255,255,255,0.10)',background:'rgba(255,255,255,0.06)'}}>{session.hangoutType}</div>
    </div>
    <div style={{marginTop:10,display:'flex',gap:10}}>
      <div style={{flex:1,borderRadius:12,padding:10,background:'rgba(255,255,255,0.06)'}}><div style={{fontSize:12,opacity:0.75}}>Focused</div><div style={{fontSize:20,fontWeight:800}}>{Math.round(session.minutes)}m</div></div>
      <div style={{flex:1,borderRadius:12,padding:10,background:'rgba(255,255,255,0.06)'}}><div style={{fontSize:12,opacity:0.75}}>Oops</div><div style={{fontSize:20,fontWeight:800}}>{session.oops}</div></div>
    </div>
    <div style={{marginTop:12}}><div style={{fontSize:12,opacity:0.75}}>Experience</div>
      <div style={{marginTop:6,display:'flex',alignItems:'center',gap:8}}>
        <div style={{fontSize:14,fontWeight:700}}>{moodLabel(session.moodScore)}</div>
        <div style={{opacity:0.7,fontSize:12}}>({session.moodScore}/5)</div>
        <div style={{marginLeft:'auto',opacity:0.75,fontSize:12}}>{fmtTime(session.startedAt)}</div>
      </div>
    </div>
    <div style={{marginTop:10,borderRadius:12,padding:10,background:'rgba(255,255,255,0.05)'}}>
      <div style={{fontSize:12,opacity:0.75}}>Notes</div>
      <div style={{marginTop:6,fontSize:13,lineHeight:1.35,opacity:0.92}}>{session.notes||'—'}</div>
    </div>
    <div style={{marginTop:12,display:'flex',gap:8}}>
      <button onClick={onBack} style={{flex:1,borderRadius:12,padding:'10px',border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.06)',color:'white',cursor:'pointer'}}>Back</button>
      <button onClick={onOpenFull} style={{flex:1,borderRadius:12,padding:'10px',border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.14)',color:'white',cursor:'pointer',fontWeight:700}}>Open full log</button>
    </div>
  </CardShell>);
}
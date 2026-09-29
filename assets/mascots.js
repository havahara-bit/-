/* ================================================================
   쮸토피아 3인방 — 벡터(SVG) 캐릭터 + 절차적 애니메이션 엔진
   ----------------------------------------------------------------
   · 캐릭터는 부위별 <g data-p="…"> 로 나뉘어 있고, 매 프레임 JS가
     각 부위의 이동·회전·크기를 계산해 적용한다(해상도와 무관하게 선명).
   · 로컬 좌표계: 원점 = 두 발 사이 바닥 중앙, y는 아래로 증가(머리는 음수).
   · 상태(대기·기대·회전·댄스·만세)는 가중치로 섞여서, 상태가 바뀌어도
     현재 자세에서 부드럽게 이어진다.
   ================================================================ */
(function(){
"use strict";

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const r1 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const S = (t, per, ph) => Math.sin((t / per + (ph || 0)) * TAU);
const easeIO = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const easeOut = k => 1 - Math.pow(1 - k, 3);
const bump = k => k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k);

/* ---------- 경로 도우미: 점 목록 → 부드러운 폐곡선(Catmull-Rom → Bézier) ---------- */
function smooth(pts, closed = true){
  const n = pts.length, P = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  let d = "M" + r1(pts[0][0]) + "," + r1(pts[0][1]);
  const last = closed ? n : n - 1;
  for(let i = 0; i < last; i++){
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += "C" + r1(p1[0] + (p2[0] - p0[0]) / 6) + "," + r1(p1[1] + (p2[1] - p0[1]) / 6) + " "
       + r1(p2[0] - (p3[0] - p1[0]) / 6) + "," + r1(p2[1] - (p3[1] - p1[1]) / 6) + " "
       + r1(p2[0]) + "," + r1(p2[1]);
  }
  return d + (closed ? "Z" : "");
}
const mir = pts => pts.map(([x, y]) => [-x, y]);
const star = (s) => { const b = s * .2;
  return `M0,${-s}C${b},${-b} ${b},${-b} ${s},0C${b},${b} ${b},${b} 0,${s}C${-b},${b} ${-b},${b} ${-s},0C${-b},${-b} ${-b},${-b} 0,${-s}Z`; };

/* ---------- 눈 규격 (캐릭터별) ---------- */
const EYES = {
  rabbit: { x:38, y:-262, rx:20.5, ry:22,  pr:15.6 },
  tiger:  { x:40, y:-266, rx:25.5, ry:27,  pr:19.4 },
  lion:   { x:32, y:-268, rx:22.5, ry:23.5, pr:16.8 }
};
const INK = "#2B2631";

/* ---------- 공용 그라데이션 · 클립 (문서에 한 번만) ---------- */
function defsMarkup(){
  const rg = (id, stops, a) => `<radialGradient id="${id}" ${a || 'cx=".36" cy=".28" r=".86"'}>` +
    stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ""}/>`).join("") + `</radialGradient>`;
  const lg = (id, stops, a) => `<linearGradient id="${id}" ${a || 'x1="0" y1="0" x2="1" y2="0"'}>` +
    stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ""}/>`).join("") + `</linearGradient>`;
  let clips = "";
  for(const k in EYES){
    const e = EYES[k], id = { rabbit:"rb", tiger:"tg", lion:"ln" }[k];
    clips += `<clipPath id="mc_${id}L" clipPathUnits="userSpaceOnUse"><ellipse cx="${-e.x}" cy="${e.y + .4}" rx="${e.rx}" ry="${e.ry}"/></clipPath>`;
    clips += `<clipPath id="mc_${id}R" clipPathUnits="userSpaceOnUse"><ellipse cx="${e.x}" cy="${e.y + .4}" rx="${e.rx}" ry="${e.ry}"/></clipPath>`;
  }
  clips += `<clipPath id="mc_tgTail" clipPathUnits="userSpaceOnUse"><path d="${TIGER_TAIL}"/></clipPath>`;
  return `<defs>
  ${rg("mgRbSkin", [[0,"#FFE8EF"],[.4,"#FAC3D2"],[.78,"#F2A5BA"],[1,"#E3869F"]])}
  ${rg("mgRbSkinLo", [[0,"#FCD3DF"],[.5,"#F4AFC2"],[1,"#DE8199"]], 'cx=".4" cy=".25" r=".9"')}
  ${rg("mgRbBelly", [[0,"#FFFFFF"],[.62,"#FFF5F8"],[1,"#F4D9E2"]], 'cx=".42" cy=".3" r=".78"')}
  ${rg("mgRbInner", [[0,"#EE8DA6",.55],[1,"#EE8DA6",0]], 'cx=".5" cy=".42" r=".6"')}
  ${rg("mgRbPad", [[0,"#FFB9CB"],[1,"#F08AA6"]], 'cx=".4" cy=".35" r=".7"')}
  ${rg("mgBlushPink", [[0,"#FF7B9C",.62],[.55,"#FF8FAA",.3],[1,"#FF8FAA",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgBlushOrange", [[0,"#FF8A2E",.5],[.55,"#FF9B40",.22],[1,"#FF9B40",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgTgSkin", [[0,"#E3E3E7"],[.4,"#BDBDC2"],[.78,"#A2A2A9"],[1,"#86868E"]])}
  ${rg("mgTgSkinLo", [[0,"#CDCDD2"],[.55,"#A8A8AF"],[1,"#83838B"]], 'cx=".4" cy=".25" r=".9"')}
  ${rg("mgTgBelly", [[0,"#FFFFFF"],[.62,"#F6F6F8"],[1,"#DCDCE2"]], 'cx=".42" cy=".3" r=".78"')}
  ${rg("mgTgEarIn", [[0,"#FFD3DE"],[1,"#F29FB5"]], 'cx=".45" cy=".4" r=".62"')}
  ${rg("mgTgMuzzle", [[0,"#FFFFFF"],[.65,"#FAFAFB"],[1,"#DCDCE3"]], 'cx=".4" cy=".32" r=".72"')}
  ${rg("mgTgNose", [[0,"#FFC2D0"],[1,"#EE8EA6"]], 'cx=".4" cy=".3" r=".8"')}
  ${rg("mgLnFace", [[0,"#FFF8A8"],[.42,"#FFE747"],[.8,"#FFD522"],[1,"#F4B51A"]])}
  ${rg("mgLnSkinLo", [[0,"#FFF07A"],[.5,"#FFD92C"],[1,"#EFAA16"]], 'cx=".4" cy=".25" r=".9"')}
  ${rg("mgLnMane", [[0,"#FFA172"],[.45,"#FA6B33"],[.78,"#EE5022"],[1,"#D23A16"]], 'gradientUnits="userSpaceOnUse" cx="-34" cy="-312" r="176"')}
  ${rg("mgLnTuft", [[0,"#FF9A68"],[.6,"#F25A28"],[1,"#CF3915"]], 'cx=".38" cy=".32" r=".75"')}
  ${rg("mgLnHeart", [[0,"#FF8467"],[.55,"#EE4632"],[1,"#D12F20"]], 'cx=".36" cy=".3" r=".8"')}
  ${rg("mgEyeWhite", [[0,"#FFFFFF"],[.72,"#FBFBFD"],[1,"#E1E4EE"]], 'cx=".45" cy=".3" r=".8"')}
  ${rg("mgPupil", [[0,"#555665"],[.4,"#23232C"],[1,"#060609"]], 'cx=".46" cy=".66" r=".72"')}
  ${rg("mgSpec", [[0,"#FFFFFF",.75],[1,"#FFFFFF",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgShadow", [[0,"#020C30",.5],[.6,"#020C30",.2],[1,"#020C30",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgOccRb", [[0,"#B85C7A",.3],[1,"#B85C7A",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgOccTg", [[0,"#4A4A55",.3],[1,"#4A4A55",0]], 'cx=".5" cy=".5" r=".5"')}
  ${rg("mgOccLn", [[0,"#B5641A",.28],[1,"#B5641A",0]], 'cx=".5" cy=".5" r=".5"')}
  ${lg("mgRod", [[0,"#6F84BA"],[.2,"#F4F7FF"],[.42,"#FFFFFF"],[.62,"#D5DFF4"],[.86,"#95A8D6"],[1,"#6A7FB4"]])}
  ${rg("mgKnob", [[0,"#FFF9DD"],[.25,"#FFE27A"],[.62,"#F6B41E"],[.9,"#D98A05"],[1,"#B97200"]], 'cx=".36" cy=".3" r=".78"')}
  ${lg("mgMount", [[0,"#3A74FF"],[.35,"#1650E6"],[1,"#06298A"]])}
  ${rg("mgHub", [[0,"#FFFFFF"],[.45,"#D3DEF6"],[1,"#7489C0"]], 'cx=".36" cy=".3" r=".75"')}
  ${lg("mgPole", [[0,"#8FA3D2"],[.35,"#FFFFFF"],[.7,"#DCE4F7"],[1,"#8A9DCC"]])}
  ${rg("mgGold", [[0,"#FFF6CC"],[.4,"#FFD24D"],[1,"#D69200"]], 'cx=".36" cy=".3" r=".75"')}
  ${clips}
  </defs>`;
}

/* ---------- 부위 그리기 도우미 ---------- */
function eyePair(kind, id){
  const e = EYES[kind];
  const one = (side, sx) => {
    const cx = sx * e.x, cy = e.y, pr = e.pr, px = cx, py = cy + 1.5;
    return `<g>
      <ellipse cx="${cx}" cy="${cy - 1.8}" rx="${e.rx + 3.6}" ry="${e.ry + 3.9}" fill="${INK}"/>
      <ellipse cx="${cx}" cy="${cy + .4}" rx="${e.rx}" ry="${e.ry}" fill="url(#mgEyeWhite)"/>
      <g clip-path="url(#mc_${id}${side})"><g data-p="pup${side}">
        <circle cx="${px}" cy="${py}" r="${pr}" fill="url(#mgPupil)"/>
        <path d="M${r1(px - pr * .72)},${r1(py + pr * .3)}A${r1(pr * .8)},${r1(pr * .8)} 0 0 0 ${r1(px + pr * .72)},${r1(py + pr * .3)}A${r1(pr * 1.05)},${r1(pr * 1.05)} 0 0 1 ${r1(px - pr * .72)},${r1(py + pr * .3)}Z" fill="#9AA3C8" opacity=".32"/>
        <circle cx="${r1(px + pr * .36)}" cy="${r1(py - pr * .4)}" r="${r1(pr * .31)}" fill="#fff"/>
        <circle cx="${r1(px - pr * .44)}" cy="${r1(py + pr * .38)}" r="${r1(pr * .14)}" fill="#fff" opacity=".92"/>
        <circle cx="${r1(px - pr * .06)}" cy="${r1(py - pr * .62)}" r="${r1(pr * .075)}" fill="#fff" opacity=".85"/>
        <g data-p="spk${side}" opacity="0" transform="translate(${r1(px + pr * .34)} ${r1(py - pr * .36)})"><path d="${star(pr * .62)}" fill="#fff"/></g>
      </g></g>
      <ellipse cx="${cx}" cy="${r1(cy - e.ry * .62)}" rx="${r1(e.rx * .78)}" ry="${r1(e.ry * .3)}" fill="${INK}" opacity=".07"/>
    </g>`;
  };
  const happy = sx => `<path d="M${r1(sx * e.x - e.rx * .8)},${r1(e.y + e.ry * .25)}Q${sx * e.x},${r1(e.y - e.ry * .95)} ${r1(sx * e.x + e.rx * .8)},${r1(e.y + e.ry * .25)}" fill="none" stroke="${INK}" stroke-width="${r1(e.rx * .3)}" stroke-linecap="round"/>`;
  return `<g data-p="eyes">${one("L", -1)}${one("R", 1)}</g><g data-p="happy" opacity="0">${happy(-1)}${happy(1)}</g>`;
}
function foot(sx, fill, extra){
  const pts = [[-24,-2],[-26,-16],[-16,-28],[0,-31],[16,-28],[25,-16],[23,-2],[0,2]];
  const cx = sx * 28;
  return `<g transform="translate(${cx} 0)"><path d="${smooth(pts)}" fill="${fill}"/>
    <path d="M-7,-4C-7,-8 -7,-10 -6,-13M7,-4C7,-8 7,-10 6,-13" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="-8" cy="-20" rx="8" ry="5" fill="url(#mgSpec)" opacity=".45"/>${extra || ""}</g>`;
}
// 팔: 어깨(피벗)에서 아래로 뻗은 모양. 길이 ≈ 52 (손바닥 중심까지)
const ARM = [[-13,-12],[-15.5,8],[-15.5,30],[-15,46],[-12,58],[-5,65],[5,65],[12,58],[15,46],[15.5,30],[15.5,8],[13,-12],[0,-18]];
function arm(px, py, fill, extra, pads){
  return `<g transform="translate(${px} ${py})"><path d="${smooth(ARM)}" fill="${fill}"/>
    ${extra || ""}
    <path d="M-5,57C-5.5,60 -5,62.5 -4,64.5M5,57C5.5,60 5,62.5 4,64.5" fill="none" stroke="#000" stroke-opacity=".14" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="-6" cy="14" rx="5" ry="14" fill="url(#mgSpec)" opacity=".35"/>
    ${pads || ""}</g>`;
}

/* ================================================================
   토끼
   ================================================================ */
function rabbitParts(){
  const earL = [[-50,-306],[-56,-350],[-57,-398],[-50,-428],[-38,-443],[-25,-434],[-18,-404],[-15,-360],[-19,-308]];
  const earLin = [[-43,-332],[-47,-366],[-47,-400],[-41,-420],[-32,-424],[-26,-404],[-24,-366],[-27,-332]];
  const head = [[0,-339],[50,-331],[84,-303],[95,-260],[89,-216],[63,-183],[27,-167],[0,-165],[-27,-167],[-63,-183],[-89,-216],[-95,-260],[-84,-303],[-50,-331]];
  const torso = [[-36,-186],[-50,-156],[-60,-110],[-62,-68],[-54,-36],[-30,-22],[0,-19],[30,-22],[54,-36],[62,-68],[60,-110],[50,-156],[36,-186],[0,-194]];
  const belly = [[0,-150],[28,-140],[40,-104],[36,-62],[18,-40],[0,-36],[-18,-40],[-36,-62],[-40,-104],[-28,-140]];
  const pads = side => `<g data-p="pads${side}" opacity="0"><ellipse cx="0" cy="47" rx="7.5" ry="5.8" fill="url(#mgRbPad)"/>
    <circle cx="-7.5" cy="56.5" r="3" fill="url(#mgRbPad)"/><circle cx="0" cy="59" r="3.2" fill="url(#mgRbPad)"/><circle cx="7.5" cy="56.5" r="3" fill="url(#mgRbPad)"/></g>`;
  const ear = (pts, pin) => `<path d="${smooth(pts)}" fill="url(#mgRbSkinLo)"/><path d="${smooth(pin)}" fill="url(#mgRbInner)"/>`;
  return `
  <g data-p="root">
    <g data-p="footL">${foot(-1, "url(#mgRbSkinLo)")}</g>
    <g data-p="footR">${foot(1, "url(#mgRbSkinLo)")}</g>
    <g data-p="body">
      <path d="${smooth(torso)}" fill="url(#mgRbSkin)"/>
      <path d="${smooth(belly)}" fill="url(#mgRbBelly)"/>
      <ellipse cx="-30" cy="-120" rx="11" ry="25" fill="url(#mgSpec)" opacity=".42" transform="rotate(12 -30 -120)"/>
      <ellipse cx="0" cy="-174" rx="62" ry="17" fill="url(#mgOccRb)"/>
      <g data-p="armL">${arm(-46, -152, "url(#mgRbSkin)", "", pads("L"))}</g>
      <g data-p="armR">${arm(46, -152, "url(#mgRbSkin)", "", pads("R"))}</g>
      <g data-p="head">
        <g data-p="earL">${ear(earL, earLin)}</g>
        <g data-p="earR">${ear(mir(earL), mir(earLin))}</g>
        <path d="${smooth(head)}" fill="url(#mgRbSkin)"/>
        <ellipse cx="-36" cy="-301" rx="30" ry="17" fill="url(#mgSpec)" opacity=".55" transform="rotate(-24 -36 -301)"/>
        <path d="M-20,-332C-24,-346 -12,-356 0,-353C4,-362 18,-360 20,-349C24,-341 18,-332 10,-331C0,-329 -12,-329 -20,-332Z" fill="url(#mgRbSkin)"/>
        <path d="M-3,-340C1,-346 7,-349 13,-347" fill="none" stroke="#DB8199" stroke-width="2" stroke-linecap="round" opacity=".7"/>
        <ellipse cx="-8" cy="-346" rx="5.5" ry="2.8" fill="#fff" opacity=".55" transform="rotate(-18 -8 -346)"/>
        <ellipse cx="9" cy="-354" rx="3.4" ry="1.8" fill="#fff" opacity=".45"/>
        <g data-p="blush"><ellipse cx="-62" cy="-228" rx="18" ry="11" fill="url(#mgBlushPink)"/><ellipse cx="62" cy="-228" rx="18" ry="11" fill="url(#mgBlushPink)"/></g>
        ${eyePair("rabbit", "rb")}
        <path d="M-7,-248C-7,-252.5 7,-252.5 7,-248C6,-244 2.2,-241 0,-241C-2.2,-241 -6,-244 -7,-248Z" fill="#F07892"/>
        <ellipse cx="-2" cy="-249.5" rx="2.6" ry="1.3" fill="#fff" opacity=".6"/>
        <g data-p="mouthA"><path d="M-7.5,-236C-7.5,-238.5 7.5,-238.5 7.5,-236C8.2,-225 4.6,-218 0,-218C-4.6,-218 -8.2,-225 -7.5,-236Z" fill="#E4505E"/>
          <path d="M-4.6,-222.4C-2.6,-225 2.6,-225 4.6,-222.4C3.6,-219.2 -3.6,-219.2 -4.6,-222.4Z" fill="#FF8D92"/></g>
        <g data-p="mouthB" opacity="0"><path d="M-12,-238C-12,-240.5 12,-240.5 12,-238C12.8,-220 6.6,-208 0,-208C-6.6,-208 -12.8,-220 -12,-238Z" fill="#DE4555"/>
          <path d="M-7.6,-215.4C-4.2,-220 4.2,-220 7.6,-215.4C5.8,-210.4 -5.8,-210.4 -7.6,-215.4Z" fill="#FF8D92"/></g>
      </g>
    </g>
  </g>`;
}

/* 토끼 앞발이 레버 손잡이를 감싸 쥐는 손가락 (손잡이 기준 좌표, 손잡이 반지름 21) */
const GRIP_FINGERS = `<g data-p="grip">
  <g fill="#8A4F00" opacity=".32">
    <ellipse cx="-9.5" cy="-7.5" rx="9.6" ry="7.2" transform="rotate(-30 -9.5 -7.5)"/>
    <ellipse cx="-12" cy="4" rx="9.8" ry="7.4" transform="rotate(-6 -12 4)"/>
    <ellipse cx="-9" cy="15" rx="9.2" ry="6.8" transform="rotate(24 -9 15)"/>
  </g>
  <ellipse cx="-3.5" cy="-18.5" rx="9" ry="6.4" fill="url(#mgRbSkin)" transform="rotate(-14 -3.5 -18.5)"/>
  <ellipse cx="-13" cy="-10" rx="10.2" ry="7.6" fill="url(#mgRbSkin)" transform="rotate(-30 -13 -10)"/>
  <ellipse cx="-16" cy="1.8" rx="10.4" ry="7.8" fill="url(#mgRbSkin)" transform="rotate(-6 -16 1.8)"/>
  <ellipse cx="-12.5" cy="13.2" rx="9.8" ry="7.3" fill="url(#mgRbSkin)" transform="rotate(24 -12.5 13.2)"/>
  <path d="M-5.6,-4.4C-9,-3.4 -13,-3.5 -17,-5.2M-6,7.8C-9.6,8.6 -13.4,8.4 -17.4,6.6" fill="none" stroke="#C26A86" stroke-width="1.7" stroke-linecap="round" opacity=".62"/>
  <path d="M-8.6,-16.4C-5.6,-14.6 -1.6,-14.4 2,-15.8" fill="none" stroke="#C26A86" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>
  <ellipse cx="-11" cy="-13.5" rx="3.8" ry="2" fill="#fff" opacity=".5" transform="rotate(-30 -11 -13.5)"/>
  <ellipse cx="-4" cy="-21" rx="3" ry="1.5" fill="#fff" opacity=".45" transform="rotate(-14 -4 -21)"/>
</g>`;

/* ================================================================
   호랑이
   ================================================================ */
const TIGER_TAIL = "M-2,-6C24,-10 48,-28 56,-58C60,-74 58,-88 52,-96C48,-102 60,-106 66,-96C74,-82 74,-60 66,-38C56,-12 30,8 4,10Z";
function tigerParts(){
  const head = [[0,-354],[58,-346],[96,-314],[107,-264],[99,-216],[72,-186],[32,-173],[0,-171],[-32,-173],[-72,-186],[-99,-216],[-107,-264],[-96,-314],[-58,-346]];
  const torso = [[-40,-190],[-54,-158],[-64,-110],[-66,-68],[-57,-34],[-31,-21],[0,-18],[31,-21],[57,-34],[66,-68],[64,-110],[54,-158],[40,-190],[0,-198]];
  const belly = [[0,-160],[33,-148],[45,-104],[40,-60],[20,-38],[0,-34],[-20,-38],[-40,-60],[-45,-104],[-33,-148]];
  const band = `<path d="M-15.6,22C-6,26.5 6,26.5 15.6,22L15.4,30.5C6,35 -6,35 -15.4,30.5Z" fill="#3B3A41"/>`;
  const footBand = `<path d="M-22,-19C-10,-15 10,-15 22,-19L23.5,-12C10,-8 -10,-8 -23.5,-12Z" fill="#3B3A41" opacity=".92"/>`;
  const ear = sx => `<circle cx="${sx * 78}" cy="-334" r="27.5" fill="url(#mgTgSkin)"/><circle cx="${sx * 77}" cy="-332" r="16.5" fill="url(#mgTgEarIn)"/>`;
  return `
  <g data-p="root">
    <g data-p="tail"><g transform="translate(36 -58)">
      <path d="${TIGER_TAIL}" fill="url(#mgTgSkinLo)"/>
      <g clip-path="url(#mc_tgTail)" fill="none" stroke="#3B3A41" stroke-width="9" stroke-linecap="round">
        <path d="M22,-26L36,-8"/><path d="M40,-50L58,-40"/><path d="M50,-80L68,-78"/>
      </g></g></g>
    <g data-p="footL">${foot(-1, "url(#mgTgSkinLo)", footBand)}</g>
    <g data-p="footR">${foot(1, "url(#mgTgSkinLo)", footBand)}</g>
    <g data-p="body">
      <path d="${smooth(torso)}" fill="url(#mgTgSkin)"/>
      <path d="${smooth(belly)}" fill="url(#mgTgBelly)"/>
      <path d="M-65,-104C-56,-102 -50,-97 -47,-89M-62,-78C-55,-76 -51,-72 -49,-66M65,-104C56,-102 50,-97 47,-89M62,-78C55,-76 51,-72 49,-66" fill="none" stroke="#3B3A41" stroke-width="6.5" stroke-linecap="round"/>
      <ellipse cx="-32" cy="-124" rx="11" ry="25" fill="url(#mgSpec)" opacity=".38" transform="rotate(12 -32 -124)"/>
      <ellipse cx="0" cy="-178" rx="68" ry="18" fill="url(#mgOccTg)"/>
      <g data-p="armL">${arm(-52, -160, "url(#mgTgSkin)", band)}</g>
      <g data-p="armR">${arm(52, -160, "url(#mgTgSkin)", band)}</g>
      <g data-p="head">
        <g data-p="earL">${ear(-1)}</g>
        <g data-p="earR">${ear(1)}</g>
        <path d="${smooth(head)}" fill="url(#mgTgSkin)"/>
        <ellipse cx="-40" cy="-314" rx="32" ry="17" fill="url(#mgSpec)" opacity=".5" transform="rotate(-22 -40 -314)"/>
        <g fill="none" stroke="#38373E" stroke-linecap="round">
          <path d="M-31,-338C-12,-344 12,-345 31,-340" stroke-width="10"/>
          <path d="M-22,-323C-8,-327 9,-327 23,-324" stroke-width="9.5"/>
          <path d="M1.5,-357C.5,-345 -.5,-332 -1.5,-315" stroke-width="10"/>
          <path d="M-62,-226C-76,-228 -90,-222 -103,-211M62,-226C76,-228 90,-222 103,-211" stroke-width="11"/>
          <path d="M-72,-252C-82,-254 -92,-252 -101,-246M72,-252C82,-254 92,-252 101,-246" stroke-width="7"/>
        </g>
        <g data-p="blush" opacity=".55"><ellipse cx="-66" cy="-238" rx="17" ry="10" fill="url(#mgBlushPink)"/><ellipse cx="66" cy="-238" rx="17" ry="10" fill="url(#mgBlushPink)"/></g>
        ${eyePair("tiger", "tg")}
        <g data-p="mouthA"><path d="M-7,-221Q0,-215.5 7,-221Q6.2,-209 0,-207.5Q-6.2,-209 -7,-221Z" fill="#D2647E"/>
          <ellipse cx="0" cy="-211.2" rx="4.6" ry="3.4" fill="#F7A7B8"/></g>
        <g data-p="mouthB" opacity="0"><path d="M-11,-223Q0,-217 11,-223Q10.4,-202 0,-199Q-10.4,-202 -11,-223Z" fill="#C44B67"/>
          <ellipse cx="0" cy="-205" rx="7" ry="4.6" fill="#F7A7B8"/></g>
        <circle cx="-15.5" cy="-235" r="18" fill="url(#mgTgMuzzle)"/>
        <circle cx="15.5" cy="-235" r="18" fill="url(#mgTgMuzzle)"/>
        <path d="M0,-238C-1,-232 -1,-228 0,-224" fill="none" stroke="#C8C8D0" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M-9.5,-254C-9.5,-259 9.5,-259 9.5,-254C8.5,-249 3.2,-245 0,-245C-3.2,-245 -8.5,-249 -9.5,-254Z" fill="url(#mgTgNose)"/>
        <ellipse cx="-3" cy="-255" rx="3" ry="1.5" fill="#fff" opacity=".65"/>
      </g>
    </g>
  </g>`;
}

/* ================================================================
   사자
   ================================================================ */
function maneLobes(list){
  return list.map(([x, y, r]) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}"/>`).join("");
}
function lionParts(){
  const cx = 0, cy = -272, N = 9, ring = 92, lr = 45;
  const lobes = [];
  for(let i = 0; i < N; i++){ const a = (-90 + i * 360 / N) * D2R; lobes.push([cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, lr]); }
  let grooves = "";
  for(let i = 0; i < N; i++){
    const a = (-90 + (i + .5) * 360 / N) * D2R, c = Math.cos(a), s = Math.sin(a);
    grooves += `M${r1(cx + c * 84)},${r1(cy + s * 84)}L${r1(cx + c * 118)},${r1(cy + s * 118)}`;
  }
  const face = [[0,-336],[46,-328],[70,-304],[76,-266],[70,-226],[48,-200],[0,-192],[-48,-200],[-70,-226],[-76,-266],[-70,-304],[-46,-328]];
  const torso = [[-40,-180],[-52,-150],[-62,-106],[-64,-64],[-55,-32],[-29,-20],[0,-17],[29,-20],[55,-32],[64,-64],[62,-106],[52,-150],[40,-180],[0,-188]];
  const claws = `<g fill="#7A5210" opacity=".75"><circle cx="-6" cy="61" r="1.8"/><circle cx="0" cy="63" r="1.8"/><circle cx="6" cy="61" r="1.8"/></g>`;
  const footClaws = `<g fill="#7A5210" opacity=".6"><circle cx="-7" cy="-5" r="1.7"/><circle cx="0" cy="-3.5" r="1.7"/><circle cx="7" cy="-5" r="1.7"/></g>`;
  // 깃대를 쥔 손가락(깃대 앞)
  const poleFingers = `<g data-p="fingers"><ellipse cx="-2" cy="44" rx="10" ry="6.4" fill="url(#mgLnFace)"/><ellipse cx="-3" cy="53" rx="10.5" ry="6.6" fill="url(#mgLnFace)"/><ellipse cx="-2" cy="61.5" rx="9.5" ry="6" fill="url(#mgLnFace)"/>
    <path d="M-10,48.6C-5,50 3,50 8,48.4M-10.4,57.6C-5,59 3,59 8,57.4" fill="none" stroke="#C98A12" stroke-width="1.5" stroke-linecap="round" opacity=".55"/></g>`;
  const pole = `<g data-p="pole"><g transform="translate(0 52)"><g data-p="cloth"></g>
      <rect x="-3.6" y="-150" width="7.2" height="182" rx="3.6" fill="url(#mgPole)"/>
      <circle cx="0" cy="-154" r="7" fill="url(#mgGold)"/></g></g>`;
  return `
  <g data-p="root">
    <g data-p="tail"><g transform="translate(34 -52)">
      <path d="M0,0C24,2 46,-10 56,-38" fill="none" stroke="url(#mgLnSkinLo)" stroke-width="9.5" stroke-linecap="round"/>
      <circle cx="58" cy="-48" r="13" fill="url(#mgLnTuft)"/></g></g>
    <g data-p="footL">${foot(-1, "url(#mgLnSkinLo)", footClaws)}</g>
    <g data-p="footR">${foot(1, "url(#mgLnSkinLo)", footClaws)}</g>
    <g data-p="body">
      <path d="${smooth(torso)}" fill="url(#mgLnFace)"/>
      <path d="M0,-98C-27,-112 -28,-139 -13,-142C-5.5,-143.5 -1.2,-138.5 0,-134C1.2,-138.5 5.5,-143.5 13,-142C28,-139 27,-112 0,-98Z" fill="url(#mgLnHeart)"/>
      <ellipse cx="-8" cy="-130" rx="5" ry="3" fill="#fff" opacity=".45" transform="rotate(-25 -8 -130)"/>
      <ellipse cx="-30" cy="-110" rx="10" ry="22" fill="url(#mgSpec)" opacity=".35" transform="rotate(12 -30 -110)"/>
      <g data-p="head">
        <g data-p="mane"><g fill="url(#mgLnMane)"><circle cx="${cx}" cy="${cy}" r="100"/>${maneLobes(lobes)}</g>
          <path d="${grooves}" fill="none" stroke="#B42F10" stroke-opacity=".22" stroke-width="3.2" stroke-linecap="round"/></g>
      </g>
      <g data-p="armR">${arm(52, -156, "url(#mgLnFace)", "", claws)}</g>
      <g data-p="armL"><g transform="translate(-52 -156)"><path d="${smooth(ARM)}" fill="url(#mgLnFace)"/>
        <ellipse cx="-6" cy="14" rx="5" ry="14" fill="url(#mgSpec)" opacity=".35"/>${pole}${poleFingers}</g></g>
      <g data-p="headF"><g data-p="maneF"><g fill="url(#mgLnMane)"><circle cx="-54" cy="-176" r="30"/><circle cx="54" cy="-176" r="30"/></g></g></g>
      <g data-p="face">
        <path d="${smooth(face)}" fill="url(#mgLnFace)"/>
        <ellipse cx="-30" cy="-306" rx="26" ry="13" fill="url(#mgSpec)" opacity=".55" transform="rotate(-20 -30 -306)"/>
        <g data-p="blush"><ellipse cx="-52" cy="-237" rx="18" ry="11" fill="url(#mgBlushOrange)"/><ellipse cx="52" cy="-237" rx="18" ry="11" fill="url(#mgBlushOrange)"/></g>
        <path d="M-44,-307Q-35,-310.5 -26,-308.5M26,-308.5Q35,-310.5 44,-307" fill="none" stroke="#3A2616" stroke-width="7" stroke-linecap="round"/>
        ${eyePair("lion", "ln")}
        <path d="M-6.5,-249C-6.5,-253 6.5,-253 6.5,-249C5.5,-244.5 2,-242 0,-242C-2,-242 -5.5,-244.5 -6.5,-249Z" fill="#3A2616"/>
        <g data-p="mouthA"><path d="M0,-242L0,-235.5M-13,-236C-11,-229.5 -3,-229 0,-235.5C3,-229 11,-229.5 13,-236" fill="none" stroke="#3A2616" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>
        <g data-p="mouthB" opacity="0"><path d="M0,-242L0,-236" fill="none" stroke="#3A2616" stroke-width="3.4" stroke-linecap="round"/>
          <path d="M-12,-236Q0,-230 12,-236Q10.4,-214 0,-212Q-10.4,-214 -12,-236Z" fill="#9E2C22"/>
          <ellipse cx="0" cy="-218" rx="7" ry="4.4" fill="#F27A66"/></g>
      </g>
    </g>
  </g>`;
}

/* ================================================================
   레버 (토끼 장면 안에 함께 그린다 — 손과 손잡이의 겹침 순서 때문)
   ================================================================ */
const LEVER = { x:214, y:406, R:120, rod:12, knob:21 };
function leverMarkup(){
  const L = LEVER;
  return `<g data-p="lever" class="m-lever">
    <rect x="${L.x - 20}" y="${L.y - 46}" width="${L.x + 16 - (L.x - 20)}" height="92" rx="11" fill="url(#mgMount)"/>
    <rect x="${L.x - 17}" y="${L.y - 43}" width="4" height="86" rx="2" fill="#fff" opacity=".22"/>
    <circle cx="${L.x + 6}" cy="${L.y - 34}" r="3" fill="#C9D6F4"/><circle cx="${L.x + 6}" cy="${L.y + 34}" r="3" fill="#C9D6F4"/>
    <rect data-p="rod" x="${L.x - L.rod / 2}" y="${L.y - L.R}" width="${L.rod}" height="${L.R + 6}" rx="${L.rod / 2}" fill="url(#mgRod)"/>
    <circle cx="${L.x}" cy="${L.y}" r="14" fill="#0A2E8F"/><circle cx="${L.x}" cy="${L.y}" r="11.5" fill="url(#mgHub)"/>
    <g data-p="knob" transform="translate(${L.x} ${L.y - L.R})">
      <ellipse cx="0" cy="17" rx="9" ry="4.5" fill="#B77400"/>
      <circle cx="0" cy="0" r="${L.knob}" fill="url(#mgKnob)"/>
      <ellipse cx="-6.5" cy="-8.5" rx="7.5" ry="5" fill="#fff" opacity=".75" transform="rotate(-30 -6.5 -8.5)"/>
      <circle cx="9" cy="8" r="2.4" fill="#fff" opacity=".35"/>
      ${GRIP_FINGERS}
    </g>
    <text x="${L.x}" y="${L.y + 64}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" fill-opacity=".55" letter-spacing=".6">SPACE</text>
    <rect x="${L.x - 40}" y="${L.y - L.R - 40}" width="80" height="${L.R + 110}" fill="transparent"/>
  </g>`;
}

/* ================================================================
   장면 구성
   ================================================================ */
const PIV = {
  rabbit: { root:[0,0], footL:[-28,-12], footR:[28,-12], body:[0,-30], armL:[-46,-152], armR:[46,-152], head:[0,-172], earL:[-34,-316], earR:[34,-316], eyes:[0,-262] },
  tiger:  { root:[0,0], tail:[36,-58], footL:[-28,-12], footR:[28,-12], body:[0,-30], armL:[-52,-160], armR:[52,-160], head:[0,-178], earL:[-78,-334], earR:[78,-334], eyes:[0,-266] },
  lion:   { root:[0,0], tail:[34,-52], footL:[-28,-12], footR:[28,-12], body:[0,-30], armL:[-52,-156], armR:[52,-156], head:[0,-192], mane:[0,-272], headF:[0,-192], maneF:[0,-272], face:[0,-192], eyes:[0,-268] }
};
const REST = {
  rabbit: { armL:16, armR:-16, earL:-9, earR:7 },
  tiger:  { armL:14, armR:-14 },
  lion:   { armL:112, armR:-18 }
};
const ARM_LEN = 52;
let defsInjected = false;
function injectDefs(){
  if(defsInjected) return; defsInjected = true;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("aria-hidden", "true"); s.setAttribute("width", "0"); s.setAttribute("height", "0");
  s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  s.innerHTML = defsMarkup();
  document.body.prepend(s);
}

/* 장면: { kind, viewBox, at:[x,y], lever } */
function sceneMarkup(kind, o){
  const parts = kind === "rabbit" ? rabbitParts() : kind === "tiger" ? tigerParts() : lionParts();
  const [ax, ay] = o.at || [0, 0];
  const sh = { rabbit:[72, 13], tiger:[82, 14], lion:[74, 13] }[kind];
  return `<svg class="m-svg" viewBox="${o.viewBox}" preserveAspectRatio="xMidYMax meet" overflow="visible" aria-hidden="true">
    <g transform="translate(${ax} ${ay})">
      <ellipse data-p="shadow" cx="0" cy="-2" rx="${sh[0]}" ry="${sh[1]}" fill="url(#mgShadow)"/>
      ${parts}
    </g>
    ${o.lever ? leverMarkup() : ""}
  </svg>`;
}

/* ================================================================
   2D 행렬 (IK 계산용)
   ================================================================ */
function mMul(A, B){ return [A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1], A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3], A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5]]; }
function mInv(M){ const det = M[0]*M[3] - M[1]*M[2]; return [M[3]/det, -M[1]/det, -M[2]/det, M[0]/det, (M[2]*M[5] - M[3]*M[4])/det, (M[1]*M[4] - M[0]*M[5])/det]; }
function mApply(M, x, y){ return [M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5]]; }
function mPose(p, piv){
  const [ox, oy] = piv, c = Math.cos(p.r * D2R), s = Math.sin(p.r * D2R);
  let M = [1, 0, 0, 1, p.x + ox, p.y + oy];
  M = mMul(M, [c, s, -s, c, 0, 0]);
  M = mMul(M, [p.sx, 0, 0, p.sy, 0, 0]);
  return mMul(M, [1, 0, 0, 1, -ox, -oy]);
}

/* ================================================================
   박자 시계 (댄스용) — BGM 템포가 잡히면 맞춘다
   ================================================================ */
const BEAT = { period:.5, t0:0 };

/* ================================================================
   동작 레이어 — 각 부위의 오프셋(이동·회전·크기)을 가중치만큼 더한다
   ================================================================ */
function add(p, w, x, y, r, sx, sy){
  if(!p) return;
  if(x) p.x += x * w; if(y) p.y += y * w; if(r) p.r += r * w;
  if(sx) p.sx += sx * w; if(sy) p.sy += sy * w;
}
const LAYERS = {
  rabbit: {
    idle(P, t, w, M){
      const b = S(t, 2.8);
      add(P.root, w, 0, 0, 0, -.005 * b, .012 * b);
      add(P.head, w, 0, 1.2 * S(t, 2.8, .2), 1.6 * S(t, 5.6));
      add(P.earL, w, 0, 0, 4.2 * S(t, 2.8, -.12)); add(P.earR, w, 0, 0, -3.6 * S(t, 2.8, -.06));
      add(P.armL, w, 0, 0, 3 * S(t, 2.8, .1));
      M.gaze(.35, .05, w * .6);
    },
    hope(P, t, w, M){
      const q = S(t, .6);
      add(P.root, w, 0, 0, 4.5, 0, .01 * q);
      add(P.head, w, 0, -2, 5);
      add(P.earL, w, 0, 0, 7 + 3 * S(t, .6, -.1)); add(P.earR, w, 0, 0, -5 - 3 * S(t, .6, -.1));
      add(P.armL, w, 0, 0, -70 + 5 * q);
      M.squeeze += w * (.5 + .5 * q) * .06;
      M.gaze(.55, .6, w);
    },
    spin(P, t, w, M){
      const s1 = S(t, .5), st = Math.max(0, s1), st2 = Math.max(0, -s1);
      add(P.root, w, 0, -3 * Math.abs(s1), 0);
      add(P.footL, w, 0, -7 * st); add(P.footR, w, 0, -7 * st2);
      add(P.armL, w, 0, 0, -78 + 7 * S(t, .25)); add(P.armR, w, 0, 0, 78 - 7 * S(t, .25));
      add(P.head, w, 0, 1.5 * s1, 2.5 * S(t, 1));
      add(P.earL, w, 0, 0, 6 * S(t, .5, -.15)); add(P.earR, w, 0, 0, -6 * S(t, .5, -.1));
      M.pads = Math.max(M.pads, w);
      M.gaze(.5, -.35, w);
    },
    dance(P, t, w, M, b){
      const k = Math.floor(b), u = b - k, sw = Math.sin(Math.PI * b), bo = Math.abs(sw);
      const turn = (k % 8 === 7) ? u : 0;
      add(P.root, w, 7 * sw, -13 * bo - 38 * bump(turn), 3.5 * sw, (Math.cos(TAU * turn) - 1), -.03 * (1 - bo));
      const up = .5 + .5 * Math.sin(Math.PI * b);
      add(P.armL, w, 0, 0, 104 * up + 8, 0, .12 * up); add(P.armR, w, 0, 0, -104 * (1 - up) - 8, 0, .12 * (1 - up));
      add(P.earL, w, 0, 0, 14 * Math.sin(Math.PI * (b - .25))); add(P.earR, w, 0, 0, -12 * Math.sin(Math.PI * (b - .2)));
      add(P.head, w, 0, 2 * bo, 6 * Math.sin(Math.PI * (b - .1)));
      add(P.footL, w, 0, -8 * Math.max(0, Math.sin(Math.PI * b))); add(P.footR, w, 0, -8 * Math.max(0, -Math.sin(Math.PI * b)));
      M.pads = Math.max(M.pads, w); M.happyW = Math.max(M.happyW, w * (k % 4 === 3 ? 1 : 0));
      M.gaze(0, .1, w);
    },
    banzai(P, t, w, M){
      add(P.root, w, 0, -8, 0, 0, .03);
      add(P.armL, w, 0, 0, 108, 0, .14); add(P.armR, w, 0, 0, -108, 0, .14);
      add(P.earL, w, 0, 0, -6); add(P.earR, w, 0, 0, 6);
      M.pads = Math.max(M.pads, w); M.happyW = Math.max(M.happyW, w);
    }
  },
  tiger: {
    idle(P, t, w, M){
      const b = S(t, 3.2);
      add(P.root, w, 0, 0, 0, -.005 * b, .012 * b);
      add(P.head, w, 0, 1 * S(t, 3.2, .2), 2 * S(t, 6.4));
      add(P.tail, w, 0, 0, 9 * S(t, 3.2, .1));
      add(P.armL, w, 0, 0, 3 * S(t, 3.2)); add(P.armR, w, 0, 0, -3 * S(t, 3.2, .1));
      M.gaze(-.4, .05, w * .6);
    },
    hope(P, t, w, M){
      const q = Math.abs(S(t, .56));
      add(P.root, w, 0, -4 * q, 0);
      add(P.head, w, 0, -2, -8);
      add(P.armL, w, 0, 0, -58); add(P.armR, w, 0, 0, 58);
      add(P.tail, w, 0, 0, 14 * S(t, .5));
      M.gaze(-.55, .6, w);
    },
    spin(P, t, w, M){
      add(P.head, w, 0, 0, -3 + 2 * S(t, .8));
      add(P.tail, w, 0, 0, 16 * S(t, .7));
      add(P.armL, w, 0, 0, -62 + 4 * S(t, .3)); add(P.armR, w, 0, 0, 62 - 4 * S(t, .3));
      add(P.root, w, 0, -2 * Math.abs(S(t, .7)));
      M.gaze(M.watch, -.1, w);
    },
    dance(P, t, w, M, b){
      const k = Math.floor(b), u = b - k, bo = Math.abs(Math.sin(Math.PI * b));
      const hip = Math.sin(Math.PI * b), big = (k % 8 === 7) ? bump(u) : 0;
      add(P.root, w, 4 * hip, -9 * bo - 20 * big, 4.5 * hip);
      add(P.tail, w, 0, 0, -22 * hip);
      const clap = 1 - bo;
      add(P.armL, w, 0, 0, lerp(-62 + 28 * (1 - clap), 112, big), 0, .12 * big);
      add(P.armR, w, 0, 0, lerp(62 - 28 * (1 - clap), -112, big), 0, .12 * big);
      add(P.head, w, 0, 2 * bo, -5 * hip);
      add(P.footL, w, 0, -7 * Math.max(0, hip)); add(P.footR, w, 0, -7 * Math.max(0, -hip));
      M.happyW = Math.max(M.happyW, w * big);
      M.gaze(-.1, .1, w);
    },
    banzai(P, t, w, M){
      add(P.root, w, 0, -8, 0, 0, .03);
      add(P.armL, w, 0, 0, 112, 0, .16); add(P.armR, w, 0, 0, -112, 0, .16);
      M.happyW = Math.max(M.happyW, w);
    }
  },
  lion: {
    idle(P, t, w, M){
      const b = S(t, 2.6);
      add(P.root, w, 0, -3 - 3 * b, 1 * S(t, 2.6, .25));
      add(P.armL, w, 0, 0, 6 * S(t, 1.3)); add(P.armR, w, 0, 0, 4 * S(t, 2.6, .3));
      add(P.mane, w, 0, 0, 0, .01 * S(t, 1.3), .01 * S(t, 1.3));
      add(P.tail, w, 0, 0, 8 * S(t, 2.6));
      M.flag = Math.max(M.flag, .35 * w);
      M.gaze(.1, .35, w * .6);
    },
    hope(P, t, w, M){
      add(P.root, w, 0, -20, 0);
      add(P.head, w, 0, 0, 3 * S(t, .6));
      add(P.armR, w, 0, 0, -40 + 10 * S(t, .6));
      M.gaze(0, .85, w);
    },
    spin(P, t, w, M){
      add(P.root, w, 0, -10 * Math.abs(S(t, .84)), 3 * S(t, .84));
      add(P.armL, w, 0, 0, 24 * S(t, .42)); add(P.armR, w, 0, 0, -50 + 30 * S(t, .42, .5));
      add(P.mane, w, 0, 0, 0, .02 * S(t, .42), -.02 * S(t, .42));
      M.flag = Math.max(M.flag, w);
      M.gaze(0, .7, w);
    },
    dance(P, t, w, M, b){
      const k = Math.floor(b), u = b - k, bo = Math.abs(Math.sin(Math.PI * b)), pop = (k % 8 === 7) ? bump(u) : 0;
      add(P.root, w, 5 * Math.sin(Math.PI * b), -12 * bo, 5 * Math.sin(Math.PI * b));
      add(P.armL, w, 0, 0, 34 * Math.sin(Math.PI * b));
      add(P.armR, w, 0, 0, -70 + 45 * Math.sin(Math.PI * b));
      add(P.mane, w, 0, 0, 0, .13 * pop, .13 * pop);
      M.flag = Math.max(M.flag, w); M.happyW = Math.max(M.happyW, w * pop);
      M.gaze(0, .2, w);
    },
    banzai(P, t, w, M){
      add(P.root, w, 0, -12, 0, 0, .03);
      add(P.armL, w, 0, 0, 20); add(P.armR, w, 0, 0, -92, 0, .12);
      add(P.mane, w, 0, 0, 0, .06, .06);
      M.happyW = Math.max(M.happyW, w); M.flag = Math.max(M.flag, w);
    }
  }
};

/* ================================================================
   Puppet — 캐릭터 한 명(장면 하나)
   ================================================================ */
class Puppet {
  constructor(host, kind, o){
    this.kind = kind; this.o = o || {}; this.host = host;
    host.innerHTML = sceneMarkup(kind, this.o);
    this.svg = host.querySelector("svg");
    this.el = {}; this.svg.querySelectorAll("[data-p]").forEach(g => { this.el[g.getAttribute("data-p")] = g; });
    this.piv = PIV[kind]; this.rest = REST[kind]; this.cache = new Map();
    const st = { idle:1, hope:0, spin:0, dance:0, banzai:0 };
    this.W = Object.assign({}, st); this.T = Object.assign({}, st);
    this.look = [0, 0]; this.glance = [0, 0]; this.glanceAt = 0;
    this.blinkAt = 1 + Math.random() * 3; this.blinkT = -9;
    this.acts = []; this.t = 0; this.active = true;
    this.watch = -.6;
    // 레버(토끼 장면)
    this.hold = this.o.lever ? 1 : 0; this.holdT = this.hold;
    this.phi = 0; this.phiV = 0;
    this.flagT = 0;
  }
  set(state, on){ this.T[state] = on ? 1 : 0; }
  mood(m){ for(const k of ["hope","spin","dance","banzai"]) this.T[k] = (k === m) ? 1 : 0; }
  act(type, extra){ this.acts.push(Object.assign({ type, t0:this.t }, extra || {})); }
  gaze(x, y, w){ if(w <= 0) return; const k = Math.min(1, w); this._gz[0] = lerp(this._gz[0], x, k); this._gz[1] = lerp(this._gz[1], y, k); }

  update(t, dt){
    this.t = t;
    const W = this.W, T = this.T;
    for(const k in W) W[k] += (T[k] - W[k]) * (1 - Math.exp(-dt / (k === "hope" ? .11 : k === "banzai" ? .12 : .2)));
    const P = {};
    for(const n in this.piv) P[n] = { x:0, y:0, r:this.rest[n] || 0, sx:1, sy:1 };
    this.P = P; this.squeeze = 0; this.pads = 0; this.happyW = 0; this.flag = 0; this.mouthOpen = 0;
    this._gz = [this.glance[0], this.glance[1]];
    // 가끔 시선을 돌린다
    if(t > this.glanceAt){ this.glance = [(Math.random() - .5) * .7, (Math.random() - .5) * .35]; this.glanceAt = t + 1.6 + Math.random() * 3.4; }
    const L = LAYERS[this.kind], b = (t - BEAT.t0) / BEAT.period;
    L.idle(P, t, 1, this);
    if(W.hope > .002) L.hope(P, t, W.hope, this);
    if(W.spin > .002) L.spin(P, t, W.spin, this);
    if(W.dance > .002) L.dance(P, t, W.dance, this, b);
    if(W.banzai > .002) L.banzai(P, t, W.banzai, this);
    if(this.fixGaze) this.gaze(this.fixGaze[0], this.fixGaze[1], .85);
    this.runActs(P, t);
    if(this.kind === "lion"){ P.headF = Object.assign({}, P.head); P.maneF = Object.assign({}, P.mane); P.face = Object.assign({}, P.head); }
    if(this.o.lever) this.leverStep(P, t, dt);
    this.faceStep(t, dt);
    if(this.kind === "lion") this.flagStep(P, t, dt);
    this.apply(P);
  }

  runActs(P, t){
    const keep = [];
    for(const a of this.acts){
      const u = t - a.t0;
      if(a.type === "nod"){ const k = u / .32; if(k < 1){ add(P.head, 1, 0, 6 * bump(k), -3 * bump(k)); keep.push(a); } }
      else if(a.type === "shake"){ const k = u / .7; if(k < 1){ add(P.head, 1, 0, 0, 11 * Math.sin(k * TAU * 2) * (1 - k)); keep.push(a); } }
      else if(a.type === "tilt"){ const k = u / .9; if(k < 1){ add(P.head, 1, 0, 0, -13 * bump(k)); keep.push(a); } }
      else if(a.type === "beat"){ const k = u / .22; if(k < 1){ add(P.root, 1, 0, 0, 0, .035 * bump(k), .035 * bump(k)); keep.push(a); } }
      else if(a.type === "jump"){ const k = u / .56; if(k < 1){
          const air = bump(clamp((k - .12) / .76, 0, 1)), sq = k < .12 ? bump(k / .12 * .5) : k > .88 ? bump((k - .88) / .12 * .5) : 0;
          add(P.root, 1, 0, -44 * air, 0, .06 * sq, -.1 * sq + .04 * air);
          add(P.armL, 1, 0, 0, 60 * air); add(P.armR, 1, 0, 0, -60 * air);
          keep.push(a); } }
      else if(a.type === "fist"){ const k = u / .9; if(k < 1){ const e = k < .25 ? easeOut(k / .25) : 1 - easeIO(clamp((k - .7) / .3, 0, 1));
          add(P.armL, 1, 0, 0, -52 * e); add(P.armR, 1, 0, 0, 52 * e); add(P.root, 1, 0, 0, 0, .02 * e, .02 * e);
          this.mouthOpen = Math.max(this.mouthOpen, e); keep.push(a); } }
      else if(a.type === "pull"){ if(this.pullStep(P, a, u)) keep.push(a); }
      else if(a.type === "wow"){ const k = u / 1.2; if(k < 1){ this.mouthOpen = Math.max(this.mouthOpen, bump(k)); keep.push(a); } }
    }
    this.acts = keep;
  }

  /* 토끼가 레버를 잡아당기는 1.1초 시퀀스 */
  pullStep(P, a, u){
    if(u < .16){ const k = easeIO(u / .16);
      a.phi = -4 * k; add(P.root, 1, 0, 0, -4 * k, 0, -.02 * k); this.squeeze += .1 * bump(u / .16);
      add(P.earL, 1, 0, 0, -4 * k); add(P.earR, 1, 0, 0, 4 * k);
      a.hold = 1; return true; }
    if(u < .5){ const k = (u - .16) / .34, e = k * k;
      a.phi = -4 + 64 * e;
      add(P.root, 1, 0, 0, -4 + 10 * e, .02 * e, -.02 - .05 * e);
      add(P.body, 1, 0, 9 * e, 0);
      add(P.head, 1, 0, 3 * e, 4 * e);
      add(P.earL, 1, 0, 0, -4 + 18 * e); add(P.earR, 1, 0, 0, 4 - 16 * e);
      add(P.armL, 1, 0, 0, 40 * e);
      this.mouthOpen = Math.max(this.mouthOpen, e);
      a.hold = 1; return true; }
    if(!a.fired){ a.fired = true; if(a.cb) try{ a.cb(); }catch(e){} }
    if(u < .62){ const k = (u - .5) / .12;
      a.phi = 60;
      add(P.root, 1, 0, 0, 6, .02, -.07 + .025 * Math.sin(k * Math.PI));
      add(P.body, 1, 0, 9, 0); add(P.head, 1, 0, 3, 4);
      add(P.earL, 1, 0, 0, 14 * Math.cos(k * Math.PI)); add(P.earR, 1, 0, 0, -12 * Math.cos(k * Math.PI));
      add(P.armL, 1, 0, 0, 40);
      this.mouthOpen = 1; a.hold = 1; return true; }
    // 놓기 — 레버는 스프링으로 튕겨 돌아가고, 토끼는 뒤로 반동한 뒤 응원 자세로
    if(!a.released){ a.released = true; this.phi = 60; this.phiV = 0; this.T.spin = 1; }
    const v = u - .62, env = Math.exp(-v * 5.5);
    a.phi = null; a.hold = 0;
    add(P.root, 1, 0, 0, 6 * env * Math.cos(v * 13), .02 * env, (-.07 + .02) * env);
    add(P.body, 1, 0, 9 * env, 0); add(P.head, 1, 0, 3 * env, 4 * env * Math.cos(v * 9));
    add(P.earL, 1, 0, 0, 16 * env * Math.sin(v * 16)); add(P.earR, 1, 0, 0, -14 * env * Math.sin(v * 15));
    this.mouthOpen = Math.max(this.mouthOpen, env);
    return v < .7;
  }

  leverStep(P, t, dt){
    const pull = this.acts.find(a => a.type === "pull");
    const busy = this.T.spin > .5 || this.T.dance > .5 || this.T.banzai > .5;
    this.holdT = pull ? (pull.hold != null ? pull.hold : 1) : (busy ? 0 : 1);
    const tau = this.holdT < this.hold ? .05 : .16;
    this.hold += (this.holdT - this.hold) * (1 - Math.exp(-dt / tau));
    if(Math.abs(this.hold - this.holdT) < .002) this.hold = this.holdT;
    if(pull && pull.phi != null){ this.phi = pull.phi; this.phiV = 0; }
    else { // 감쇠 스프링으로 제자리
      const k = 210, c = 13;
      this.phiV += (-k * this.phi - c * this.phiV) * dt; this.phi += this.phiV * dt;
      if(Math.abs(this.phi) < .01 && Math.abs(this.phiV) < .01){ this.phi = 0; this.phiV = 0; }
    }
    const L = LEVER, ph = this.phi * D2R;
    const ky = L.y - L.R * Math.cos(ph), ks = 1 + .2 * Math.sin(Math.max(0, ph)), kx = L.x;
    const sq = 1 + this.squeeze;
    this.setAttr(this.el.rod, "y", r1(ky)); this.setAttr(this.el.rod, "height", r1(L.y - ky + 6));
    this.setAttr(this.el.knob, "transform", `translate(${r1(kx)} ${r1(ky)}) scale(${r1(ks)})`);
    this.setAttr(this.el.grip, "opacity", this.hold > .97 ? 1 : 0);
    this.setAttr(this.el.grip, "transform", `translate(-2 0) scale(${r1(sq)} ${r1(2 - sq)})`);
    // IK — 오른팔 끝(손바닥)을 손잡이 왼쪽 뒤에 붙인다
    const at = this.o.at || [0, 0];
    const chain = mMul(mMul([1, 0, 0, 1, at[0], at[1]], mPose(P.root, this.piv.root)), mPose(P.body, this.piv.body));
    const [tx, ty] = mApply(mInv(chain), kx - 15 * ks, ky + 4 * ks);
    const [sx0, sy0] = this.piv.armR, dx = tx - sx0, dy = ty - sy0;
    const len = Math.hypot(dx, dy), ang = Math.atan2(-dx, dy) / D2R;
    const h = this.hold, a = P.armR;
    let da = ang - a.r; while(da > 180) da -= 360; while(da < -180) da += 360;
    a.r = a.r + da * h;
    const s = clamp(len / ARM_LEN, .7, 1.5);
    a.sy = lerp(a.sy, s, h); a.sx = lerp(a.sx, 1 / Math.sqrt(s), h * .6);
  }

  faceStep(t, dt){
    const E = EYES[this.kind], el = this.el;
    // 눈 깜빡임
    if(t > this.blinkAt){ this.blinkT = t; this.blinkAt = t + 2.4 + Math.random() * 3.6; if(Math.random() < .15) this.blinkAt = t + .28; }
    const bk = (t - this.blinkT) / .13, lid = bk >= 0 && bk < 1 ? 1 - .9 * bump(bk) : 1;
    // 시선
    const k = 1 - Math.exp(-dt / .085);
    this.look[0] += (this._gz[0] - this.look[0]) * k; this.look[1] += (this._gz[1] - this.look[1]) * k;
    const dx = clamp(this.look[0], -1, 1) * E.rx * .34, dy = clamp(this.look[1], -1, 1) * E.ry * .28;
    const pt = `translate(${r1(dx)} ${r1(dy)})`;
    this.setAttr(el.pupL, "transform", pt); this.setAttr(el.pupR, "transform", pt);
    const happy = clamp(this.happyW, 0, 1);
    const ey = this.piv.eyes[1];
    this.setAttr(el.eyes, "transform", `translate(0 ${r1(ey)}) scale(1 ${r1(lid)}) translate(0 ${r1(-ey)})`);
    this.setAttr(el.eyes, "opacity", r1(1 - happy));
    this.setAttr(el.happy, "opacity", r1(happy));
    // 기대 눈빛 — 별 하이라이트
    const W = this.W, spk = clamp(W.hope * 1.1, 0, 1);
    const tw = .75 + .35 * (.5 + .5 * S(t, .6));
    for(const sd of ["spkL", "spkR"]){
      const g = el[sd]; if(!g) continue;
      const base = g.getAttribute("data-base") || g.getAttribute("transform");
      if(!g.hasAttribute("data-base")) g.setAttribute("data-base", base);
      this.setAttr(g, "opacity", r1(spk));
      this.setAttr(g, "transform", `${base} scale(${r1(tw * (.4 + .6 * spk))}) rotate(${r1(t * 40 % 360)})`);
    }
    // 입·볼
    const open = clamp(Math.max(W.hope, W.spin * .9, W.dance, W.banzai, this.mouthOpen), 0, 1);
    this.setAttr(el.mouthA, "opacity", r1(1 - open)); this.setAttr(el.mouthB, "opacity", r1(open));
    if(el.blush) this.setAttr(el.blush, "opacity", r1((this.kind === "tiger" ? .5 : .8) + .35 * Math.max(W.hope, W.dance, W.banzai)));
    if(el.padsL) { this.setAttr(el.padsL, "opacity", r1(this.pads)); this.setAttr(el.padsR, "opacity", r1(this.pads)); }
    // 그림자는 점프 높이에 따라 작아진다
    const lift = clamp(-this.P.root.y / 80, 0, 1);
    this.setAttr(el.shadow, "transform", `scale(${r1(1 - .35 * lift)} ${r1(1 - .35 * lift)})`);
    this.setAttr(el.shadow, "opacity", r1(1 - .4 * lift));
  }

  /* 사자의 깃발 — 매 프레임 천을 새로 그린다 */
  flagStep(P, t, dt){
    const el = this.el; if(!el.cloth || !el.pole) return;
    const armR = P.armL.r;
    const swing = 8 * S(t, 1.3) * (1 - this.flag) + 14 * S(t, .42) * this.flag;
    this.setAttr(el.pole, "transform", `rotate(${r1(-armR - 12 + swing)} 0 52)`);
    const speed = 5 + 9 * this.flag; this.flagT += dt * speed;
    const amp = 6 + 7 * this.flag, W = 116, H = 66, top = -148, N = 12;
    const pt = (u, v) => {
      const ph = this.flagT - u * 5.4, wv = Math.sin(ph) * amp * (u * .9 + .1);
      return [r1(4 - u * W * (1 - .03 * Math.abs(Math.cos(ph)))), r1(top + v * H + wv + v * u * 7)];
    };
    const band = (v0, v1) => {
      let d = "";
      for(let i = 0; i <= N; i++){ const [x, y] = pt(i / N, v0); d += (i ? "L" : "M") + x + "," + y; }
      for(let i = N; i >= 0; i--){ const [x, y] = pt(i / N, v1); d += "L" + x + "," + y; }
      return d + "Z";
    };
    if(!this.flagEls){
      const NS = "http://www.w3.org/2000/svg", mk = fill => { const p = document.createElementNS(NS, "path"); p.setAttribute("fill", fill); el.cloth.appendChild(p); return p; };
      this.flagEls = { bands:[mk("#FFFFFF"), mk("#0C4DE0"), mk("#FFC53D")], shade:Array.from({ length:N }, () => mk("#FFFFFF")) };
    }
    const F = this.flagEls;
    F.bands[0].setAttribute("d", band(0, 1)); F.bands[1].setAttribute("d", band(.28, .56)); F.bands[2].setAttribute("d", band(.66, .75));
    for(let i = 0; i < N; i++){
      const u0 = i / N, u1 = (i + 1) / N, sl = Math.cos(this.flagT - (u0 + u1) / 2 * 5.4);
      const a = pt(u0, 0), b = pt(u1, 0), c = pt(u1, 1), d = pt(u0, 1), p = F.shade[i];
      p.setAttribute("d", "M" + a + "L" + b + "L" + c + "L" + d + "Z");
      p.setAttribute("fill", sl > 0 ? "#001248" : "#FFFFFF");
      p.setAttribute("opacity", r1(Math.abs(sl) * (sl > 0 ? .16 : .22)));
    }
  }

  apply(P){
    for(const n in P){
      const g = this.el[n]; if(!g) continue;
      const p = P[n], [ox, oy] = this.piv[n];
      const v = (p.x || p.y || p.r || p.sx !== 1 || p.sy !== 1)
        ? `translate(${r1(p.x + ox)} ${r1(p.y + oy)}) rotate(${r1(p.r)}) scale(${r1(p.sx)} ${r1(p.sy)}) translate(${-ox} ${-oy})` : "";
      this.setAttr(g, "transform", v);
    }
  }
  setAttr(el, name, v){
    if(!el) return; const key = el; let c = this.cache.get(key); if(!c){ c = {}; this.cache.set(key, c); }
    const s = String(v); if(c[name] === s) return; c[name] = s;
    if(s === "" && name === "transform") el.removeAttribute("transform"); else el.setAttribute(name, s);
  }
}

/* ================================================================
   전역 루프 / 공개 API
   ================================================================ */
const ALL = [];
let raf = 0, last = 0, clock = 0;
function loop(now){
  const dt = last ? Math.min(.05, (now - last) / 1000) : .016; last = now; clock += dt;
  for(const p of ALL) if(p.active) p.update(clock, dt);
  raf = requestAnimationFrame(loop);
}
function start(){ if(!raf){ last = 0; raf = requestAnimationFrame(loop); } }

window.Mascots = {
  Puppet, BEAT, LEVER,
  create(host, kind, o){ injectDefs(); const p = new Puppet(host, kind, o); ALL.push(p); start(); return p; },
  now(){ return clock; },
  pause(){ cancelAnimationFrame(raf); raf = 0; },
  resume(){ start(); },
  step(tAbs){ const dt = Math.max(.001, tAbs - clock); clock = tAbs; for(const p of ALL) if(p.active) p.update(clock, Math.min(.05, dt)); },
  setBeat(period, phaseAt){ BEAT.period = period; BEAT.t0 = phaseAt != null ? phaseAt : clock; }
};
})();

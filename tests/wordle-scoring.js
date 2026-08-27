import { scoreGuess, keyboardState } from '../v1/generators/wordle.js';
const S=s=>s.map(x=>({correct:'G',present:'Y',absent:'.'}[x])).join('');
// Known-tricky repeated-letter cases. Expected values follow official Wordle rules.
// Every expectation below was worked through by hand, letter by letter, using
// the official two-pass rule. G = right letter right place, Y = right letter
// wrong place, . = not in the answer (or already accounted for by an earlier
// G/Y on the same letter).
const cases = [
  ['SPEED', 'ERASE', 'Y.YY.'], // S present; ERASE has two Es, so both Es score
  ['ERASE', 'SPEED', 'Y..YY'], // mirror of the above
  ['SPEED', 'SPEED', 'GGGGG'],
  ['EERIE', 'SPEED', 'YY...'], // third E gets nothing: SPEED's two Es are used
  ['ALLOY', 'LLAMA', 'YGY..'],
  ['LLAMA', 'ALLOY', 'YGY..'],
  ['ABBEY', 'BABES', 'YYGG.'],
  ['ROBOT', 'GHOST', '.Y..G'], // second O absent, only one O in GHOST
  ['ARRAY', 'RADAR', 'YYYG.'],
  ['GEESE', 'THEME', '..G.G'],
  ['LEVEL', 'ELVES', 'YYGG.'], // trailing L absent, ELVES' only L is used
  ['SASSY', 'SUNNY', 'G...G'], // middle Ss absent, SUNNY's only S is at index 0
];
let fail=0;
for (const [guess, answer, expect] of cases) {
  const got = S(scoreGuess(guess, answer));
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'} guess=${guess} answer=${answer} -> ${got} ${ok?'':'(expected '+expect+')'}`);
}
// Invariant checks against a brute-force reference on random pairs.
function reference(guess, answer){
  const n=guess.length; const res=new Array(n).fill('absent');
  const used=new Array(n).fill(false);
  for(let i=0;i<n;i++) if(guess[i]===answer[i]){res[i]='correct';used[i]=true;}
  for(let i=0;i<n;i++){
    if(res[i]==='correct') continue;
    for(let j=0;j<n;j++){
      if(!used[j] && answer[j]===guess[i] && guess[j]!==answer[j]){res[i]='present';used[j]=true;break;}
    }
  }
  return res;
}
const A='ABCDE'.split('');
let mismatch=0, tested=0;
const rnd=(n)=>Math.floor(Math.random()*n);
for(let t=0;t<200000;t++){
  const g=Array.from({length:5},()=>A[rnd(5)]).join('');
  const a=Array.from({length:5},()=>A[rnd(5)]).join('');
  tested++;
  if(S(scoreGuess(g,a))!==S(reference(g,a))){mismatch++; if(mismatch<4)console.log('MISMATCH',g,a,S(scoreGuess(g,a)),S(reference(g,a)));}
}
console.log(`\nrandom cross-check vs independent reference: ${tested} pairs, ${mismatch} mismatches`);
// count invariant: greens+yellows for a letter never exceeds its count in the answer
let viol=0;
for(let t=0;t<50000;t++){
  const g=Array.from({length:5},()=>A[rnd(5)]).join('');
  const a=Array.from({length:5},()=>A[rnd(5)]).join('');
  const m=scoreGuess(g,a);
  for(const L of new Set(g)){
    const marked=[...g].filter((c,i)=>c===L&&m[i]!=='absent').length;
    const inAnswer=[...a].filter(c=>c===L).length;
    if(marked>inAnswer) viol++;
  }
}
console.log('count-invariant violations:', viol);
console.log('\nkeyboard state (guesses CRANE, SLOPE vs SLOPE):');
console.log([...keyboardState(['CRANE','SLOPE'],'SLOPE')].map(([k,v])=>k+':'+v[0]).join(' '));
process.exit(fail||mismatch||viol?1:0);

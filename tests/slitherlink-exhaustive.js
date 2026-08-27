// Independent uniqueness check: enumerate ALL 2^(rows*cols) interior masks.
// A simple loop is exactly the boundary of its interior cell set, so this
// enumerates every candidate solution with no shared code with the solver.
import { Rng } from '../v1/index.js';
import { generate } from '../v1/generators/slitherlink.js';

function bruteCount(rows,cols,clues){
  const hCount=(rows+1)*cols;
  const H=(r,c)=>r*cols+c, V=(r,c)=>hCount+r*(cols+1)+c;
  const n=rows*cols; let solutions=0;
  for(let mask=0; mask<(1<<n); mask++){
    const inR=(r,c)=> r>=0&&r<rows&&c>=0&&c<cols && ((mask>>(r*cols+c))&1)===1;
    // clue check first (cheap reject)
    let ok=true;
    const on=new Set();
    for(let r=0;r<=rows&&ok;r++)for(let c=0;c<cols;c++) if(inR(r-1,c)!==inR(r,c)) on.add(H(r,c));
    for(let r=0;r<rows&&ok;r++)for(let c=0;c<=cols;c++) if(inR(r,c-1)!==inR(r,c)) on.add(V(r,c));
    if(on.size<4) continue;
    for(let r=0;r<rows&&ok;r++)for(let c=0;c<cols;c++){
      const want=clues[r*cols+c]; if(want<0) continue;
      let k=0; for(const e of [H(r,c),H(r+1,c),V(r,c),V(r,c+1)]) if(on.has(e)) k++;
      if(k!==want) ok=false;
    }
    if(!ok) continue;
    // vertex degrees
    for(let r=0;r<=rows&&ok;r++)for(let c=0;c<=cols;c++){
      let d=0;
      if(c>0&&on.has(H(r,c-1)))d++; if(c<cols&&on.has(H(r,c)))d++;
      if(r>0&&on.has(V(r-1,c)))d++; if(r<rows&&on.has(V(r,c)))d++;
      if(d!==0&&d!==2) ok=false;
    }
    if(!ok) continue;
    // single loop: walk edges
    const edges=[...on]; const vOf=e=>{
      if(e<hCount){const r=Math.floor(e/cols),c=e%cols;return [r*(cols+1)+c, r*(cols+1)+c+1];}
      const i=e-hCount; const r=Math.floor(i/(cols+1)),c=i%(cols+1);
      return [r*(cols+1)+c,(r+1)*(cols+1)+c];
    };
    const inc=new Map();
    for(const e of edges) for(const v of vOf(e)){ if(!inc.has(v))inc.set(v,[]); inc.get(v).push(e); }
    const used=new Set(); let cur=edges[0]; let at=vOf(cur)[0]; const start=at;
    for(;;){ used.add(cur); const [a,b]=vOf(cur); at = at===a?b:a;
      if(at===start) break;
      const nx=inc.get(at).find(e=>!used.has(e)); if(nx===undefined) break; cur=nx; }
    if(used.size===edges.length) solutions++;
  }
  return solutions;
}

for(let i=0;i<6;i++){
  const p=generate(new Rng(`ex-${i}`),{rows:4,cols:4,difficulty:'easy',maxAttempts:200});
  const t0=Date.now();
  const b=bruteCount(4,4,p.clues);
  console.log(`4x4 #${i} clues=${p.stats.clueCount} brute-force solutions=${b} ${b===1?'OK':'*** MISMATCH ***'} (${Date.now()-t0}ms)`);
}
for(let i=0;i<3;i++){
  const p=generate(new Rng(`ex5-${i}`),{rows:5,cols:5,difficulty:'easy',maxAttempts:200});
  const t0=Date.now();
  const b=bruteCount(5,5,p.clues);
  console.log(`5x5 #${i} clues=${p.stats.clueCount} brute-force solutions=${b} ${b===1?'OK':'*** MISMATCH ***'} (${Date.now()-t0}ms)`);
}

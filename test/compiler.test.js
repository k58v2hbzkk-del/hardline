const H=require('../src/compiler.js');
function rnd(n,d){ if(d<=0||Math.random()<0.3) return {op:'var',v:Math.floor(Math.random()*n),neg:Math.random()<0.3};
 const ops=['all','any','none','atleast'];const op=ops[Math.floor(Math.random()*4)];
 const kids=Array.from({length:Math.floor(Math.random()*5)},()=>rnd(n,d-1));
 const node={op,kids}; if(op==='atleast') node.k=Math.floor(Math.random()*(kids.length+2)); return node;}
let bad=0,tot=0;
for(let t=0;t<20000;t++){const n=1+Math.floor(Math.random()*8);const r=rnd(n,3);const c=H.compileRule(r,n);const p=H.prove(r,n,c.hex);tot++;if(!p.ok){bad++; if(bad<3) console.log(JSON.stringify(r),n,p);}}
console.log('fuzz',tot,'bad',bad);
// templates
const v=(i,neg=false)=>({op:'var',v:i,neg});
const t1={op:'all',kids:[{op:'atleast',k:3,kids:[0,1,2,3,4].map(i=>v(i))},v(5,true)]};
let c=H.compileRule(t1,6);console.log('3of5+freeze gates',c.gates,H.prove(t1,6,c.hex));
const t2={op:'all',kids:[v(3,true),{op:'any',kids:[{op:'all',kids:[v(0),v(1)]},v(2)]}]};
c=H.compileRule(t2,4);console.log('agent gates',c.gates,H.prove(t2,4,c.hex));
const t16={op:'atleast',k:9,kids:Array.from({length:16},(_,i)=>v(i))};
let s=Date.now();c=H.compileRule(t16,16);console.log('9of16 gates',c.gates,H.prove(t16,16,c.hex),Date.now()-s,'ms');
console.log(H.evalBytes([1,0,1,0,0,0,0,0,1]));
// cross-check format against the real on-chain adder decoded earlier: simulate() matches engine assumptions

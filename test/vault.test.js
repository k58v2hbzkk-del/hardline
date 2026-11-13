const ganache=require('ganache'),{ethers}=require('ethers'),B=require('../contracts/build.json'),H=require('../src/compiler.js');
const V=(i,neg=false)=>({op:'var',v:i,neg});
const rule={op:'all',kids:[{op:'atleast',k:3,kids:[V(0),V(1),V(2),V(3),V(4)]},V(5,true)]};
const chip=H.compileRule(rule,6); console.log('chip gates',chip.gates);
(async()=>{
 const prov=new ethers.BrowserProvider(ganache.provider({logging:{quiet:true},chain:{hardfork:'london'}}));
 const me=await prov.getSigner(0), other=await prov.getSigner(1), rcpt=(await prov.getSigner(2)).address;
 const mock=await new ethers.ContractFactory(B.mock.abi,B.mock.bytecode,me).deploy(chip.hex,6); await mock.waitForDeployment();
 const M=await mock.getAddress(), my=await me.getAddress();
 const vf=new ethers.ContractFactory(B.vault.abi,B.vault.bytecode,me);
 const dep=vf.getDeployTransaction(M,2,my,[my,my,my,my,my]);
 const v=await vf.deploy(M,2,my,[my,my,my,my,my]); const r0=await (await v.deploymentTransaction()).wait(); console.log('deploy gas',r0.gasUsed.toString());
 const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1};
 // full truth table via check(): mirror rule
 await (await me.sendTransaction({to:await v.getAddress(),value:ethers.parseEther('1')})).wait();
 let bad=0;
 for(let m=0;m<64;m++){ await (await v.propose(rcpt,1n)).wait(); const id=(await v.paymentsCount())-1n;
   for(let s=0;s<5;s++) if(m>>s&1) await (await v.approve(id,s)).wait();
   const fz=!!(m>>5&1); if((await v.frozen())!==fz) await (await v.setFrozen(fz)).wait();
   const [allowed,facts]=await v.check(id); const want=H.evalRule(rule,[0,1,2,3,4,5].map(i=>m>>i&1));
   if(Number(facts)!==m || (allowed?1:0)!==want) bad++;
 }
 ok(bad===0,'check() matches rule on all 64 fact combos');
 await (await v.setFrozen(false)).wait();
 // scenario: 2 approvals -> blocked, nothing moves
 await (await v.propose(rcpt,ethers.parseEther('0.1'))).wait(); let id=(await v.paymentsCount())-1n;
 await (await v.approve(id,0)).wait(); await (await v.approve(id,1)).wait();
 let b0=await prov.getBalance(rcpt); let rc=await (await v.execute(id)).wait();
 ok(rc.logs.some(l=>v.interface.parseLog(l)?.name==='Blocked') && (await prov.getBalance(rcpt))===b0,'2 approvals -> Blocked, no transfer');
 await (await v.approve(id,2)).wait();
 await (await v.setFrozen(true)).wait(); rc=await (await v.execute(id)).wait();
 ok(rc.logs.some(l=>v.interface.parseLog(l)?.name==='Blocked') && (await prov.getBalance(rcpt))===b0,'3 approvals + frozen -> Blocked');
 await (await v.setFrozen(false)).wait(); rc=await (await v.execute(id)).wait(); console.log('execute gas',rc.gasUsed.toString());
 ok(rc.logs.some(l=>v.interface.parseLog(l)?.name==='Released') && (await prov.getBalance(rcpt))-b0===ethers.parseEther('0.1'),'3 approvals, not frozen -> Released 0.1');
 try{await (await v.execute(id)).wait();ok(false,'double execute')}catch(e){ok(true,'cannot execute twice')}
 const vo=v.connect(other);
 try{await (await vo.approve(id,0)).wait();ok(false,'stranger approve')}catch(e){ok(true,'stranger cannot approve')}
 try{await (await vo.setFrozen(true)).wait();ok(false,'stranger freeze')}catch(e){ok(true,'stranger cannot freeze')}
 try{await (await vo.propose(rcpt,1n)).wait();ok(false,'stranger propose')}catch(e){ok(true,'stranger cannot propose')}
})();
